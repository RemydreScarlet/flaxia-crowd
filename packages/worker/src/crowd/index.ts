import { Hono } from 'hono'
import type { Env } from '../index'
import type { TaskRecord, WorkloadType } from '@flaxia/sdk'

const VALID_WORKLOADS: readonly string[] = [
  'ai-inference', 'image-process', 'file-convert', 'container',
  'vector-embed', 'vector-store', 'vector-query'
]

export async function validateApiKey(env: Env, authHeader: string | undefined): Promise<boolean> {
  if (!authHeader) return false
  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return false
  const staticKeys = (env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean)
  return staticKeys.includes(token)
}

function getClientIp(c: any): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(env: Env, key: string): boolean {
  const maxStr = env.RATE_LIMIT_MAX || '100'
  const max = parseInt(maxStr, 10) || 100
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 60000 })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

function validatePayloadSize(env: Env, body: string): boolean {
  const maxStr = env.MAX_PAYLOAD_SIZE || '1048576'
  const max = parseInt(maxStr, 10) || 1048576
  return body.length <= max
}

const app = new Hono<{ Bindings: Env }>()

function getCoordinator(c: any) {
  const id = c.env.COORDINATOR.idFromName('global-coordinator')
  return c.env.COORDINATOR.get(id)
}

app.get('/signal', async (c) => {
  const upgradeHeader = c.req.header('Upgrade')
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
  }
  const origin = c.req.header('Origin')
  if (origin) {
    const allowed = (c.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(origin)) {
      return c.text('Origin not allowed', 403)
    }
  }
  if (!checkRateLimit(c.env, `signal:${getClientIp(c)}`)) {
    return c.text('Rate limit exceeded', 429)
  }
  const url = new URL(c.req.url)
  url.pathname = '/ws'
  const stub = getCoordinator(c)
  return stub.fetch(new Request(url.toString(), {
    headers: c.req.raw.headers,
    signal: c.req.raw.signal,
  }))
})

app.get('/subscribe', async (c) => {
  const upgradeHeader = c.req.header('Upgrade')
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
  }
  const origin = c.req.header('Origin')
  if (origin) {
    const allowed = (c.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(origin)) {
      return c.text('Origin not allowed', 403)
    }
  }
  if (!checkRateLimit(c.env, `subscribe:${getClientIp(c)}`)) {
    return c.text('Rate limit exceeded', 429)
  }
  const taskId = c.req.query('taskId')
  if (!taskId) return c.text('taskId is required', 400)
  const url = new URL(c.req.url)
  url.pathname = '/subscribe'
  const stub = getCoordinator(c)
  return stub.fetch(new Request(url.toString(), {
    headers: c.req.raw.headers,
    signal: c.req.raw.signal,
  }))
})

app.post('/tasks', async (c) => {
  const auth = c.req.header('Authorization')
  if (!await validateApiKey(c.env, auth)) return c.json({ error: 'Unauthorized' }, 401)
  if (!checkRateLimit(c.env, `tasks:${getClientIp(c)}`)) return c.json({ error: 'Rate limit exceeded' }, 429)

  const rawBody = await c.req.text()
  if (!validatePayloadSize(c.env, rawBody)) return c.json({ error: 'Payload too large' }, 413)

  const body = JSON.parse(rawBody) as { workload: string; payload: unknown; timeoutMs?: number; callbackUrl?: string }
  if (!body.workload || !VALID_WORKLOADS.includes(body.workload)) return c.json({ error: 'Invalid workload type' }, 400)
  if (!body.payload) return c.json({ error: 'payload is required' }, 400)

  const taskId = crypto.randomUUID()
  const task: TaskRecord = {
    id: taskId,
    status: 'pending',
    workload: body.workload as WorkloadType,
    payload: body.payload as any,
    createdAt: Date.now(),
    retryCount: 0,
    timeoutMs: body.timeoutMs || 30000,
    callbackUrl: body.callbackUrl,
  }

  const stub = getCoordinator(c)
  await stub.fetch(new Request('http://internal/enqueue', {
    method: 'POST',
    body: JSON.stringify(task),
  }))

  return c.json({ message: 'Task submitted', taskId, id: taskId, status: task.status, createdAt: task.createdAt })
})

app.get('/tasks/:id', async (c) => {
  const auth = c.req.header('Authorization')
  if (!await validateApiKey(c.env, auth)) return c.json({ error: 'Unauthorized' }, 401)
  if (!checkRateLimit(c.env, `tasks:${getClientIp(c)}`)) return c.json({ error: 'Rate limit exceeded' }, 429)

  const id = c.req.param('id')
  const stub = getCoordinator(c)
  const resp = await stub.fetch(`http://internal/task/${id}`)
  if (resp.status === 404) return c.json({ error: 'Not found' }, 404)
  const task = await resp.json()
  return c.json(task)
})

export { app as crowdApp }
