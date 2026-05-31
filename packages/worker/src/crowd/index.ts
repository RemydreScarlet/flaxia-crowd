import { Hono } from 'hono'
import type { Env } from '../index'
import type { TaskRecord, TaskPayload, WorkloadType } from '@flaxia/sdk'

const VALID_WORKLOADS: readonly string[] = [
  'ai-inference', 'image-process', 'file-convert', 'container',
  'vector-embed', 'vector-store', 'vector-query'
]

// --- In-memory state ---
interface NodeInfo {
  ws: WebSocket
  status: 'idle' | 'busy'
  capabilities: string[]
  cpuLoad: number
  lastPongAt: number
  currentTaskId?: string
}

const nodes = new Map<string, NodeInfo>()
const tasks = new Map<string, TaskRecord>()
const subscribers = new Map<string, Set<WebSocket>>()
const taskTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

let cleanupTimer: ReturnType<typeof setInterval> | null = null
function ensureCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, info] of nodes) {
      if (now - info.lastPongAt > 60000) {
        if (info.currentTaskId && tasks.has(info.currentTaskId)) {
          failTask(info.currentTaskId, 'Node disconnected')
        }
        try { info.ws.close() } catch {}
        nodes.delete(id)
      }
    }
  }, 30000)
}

function completeTask(taskId: string, result: unknown, nodeId: string) {
  const task = tasks.get(taskId)
  if (!task) return
  task.status = 'done'
  task.result = result
  task.completedAt = Date.now()
  task.assignedNodeId = nodeId
  tasks.set(taskId, task)
  clearTaskTimeout(taskId)
  notifySubscribers(taskId, { type: 'done', result })
  releaseNode(nodeId)
  assignNextTasks()
}

function failTask(taskId: string, error: string) {
  const task = tasks.get(taskId)
  if (!task) return
  task.status = 'failed'
  task.error = error
  task.completedAt = Date.now()
  tasks.set(taskId, task)
  clearTaskTimeout(taskId)
  notifySubscribers(taskId, { type: 'error', error })
  if (task.assignedNodeId) releaseNode(task.assignedNodeId)
  assignNextTasks()
}

function clearTaskTimeout(taskId: string) {
  const tid = taskTimeouts.get(taskId)
  if (tid) { clearTimeout(tid); taskTimeouts.delete(taskId) }
}

function setTaskTimeout(taskId: string, timeoutMs: number) {
  clearTaskTimeout(taskId)
  const tid = setTimeout(() => failTask(taskId, 'Task timed out'), timeoutMs)
  taskTimeouts.set(taskId, tid)
}

function releaseNode(nodeId: string) {
  const info = nodes.get(nodeId)
  if (info) {
    info.status = 'idle'
    info.currentTaskId = undefined
  }
}

function notifySubscribers(taskId: string, message: Record<string, unknown>) {
  const subs = subscribers.get(taskId)
  if (!subs) return
  const msg = JSON.stringify(message)
  for (const ws of subs) {
    try { ws.send(msg); ws.close() } catch {}
  }
  subscribers.delete(taskId)
}

function assignNextTasks() {
  for (const [taskId, task] of tasks) {
    if (task.status !== 'pending') continue
    const nodeId = pickNode(task.workload)
    if (!nodeId) break
    assignTask(taskId, task, nodeId)
  }
}

function pickNode(workload: string): string | null {
  let best: string | null = null
  let bestLoad = Infinity
  for (const [id, info] of nodes) {
    if (info.status !== 'idle') continue
    if (!info.capabilities.includes(workload)) continue
    if (info.cpuLoad < bestLoad) {
      best = id
      bestLoad = info.cpuLoad
    }
  }
  return best
}

function assignTask(taskId: string, task: TaskRecord, nodeId: string) {
  const info = nodes.get(nodeId)
  if (!info) return
  task.status = 'processing'
  task.assignedNodeId = nodeId
  task.assignedAt = Date.now()
  tasks.set(taskId, task)
  info.status = 'busy'
  info.currentTaskId = taskId
  setTaskTimeout(taskId, task.timeoutMs || 30000)
  try {
    info.ws.send(JSON.stringify({
      type: 'task',
      taskId: task.id,
      workload: task.workload,
      payload: task.payload
    }))
  } catch {
    failTask(taskId, 'Failed to send task to node')
  }
}

// --- Auth utilities ---
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

// --- Routes ---
const app = new Hono<{ Bindings: Env }>()

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
  const [client, server] = Object.values(new WebSocketPair())
  server.accept()
  const nodeId = c.req.query('nodeId') || crypto.randomUUID()
  const capabilities = (c.req.query('capabilities') || '').split(',').filter(Boolean)

  nodes.set(nodeId, { ws: server, status: 'idle', capabilities, cpuLoad: 0, lastPongAt: Date.now() })
  ensureCleanup()

  server.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data as string)
      if (data.type === 'pong') {
        const info = nodes.get(nodeId)
        if (info) { info.lastPongAt = Date.now(); info.cpuLoad = data.cpuLoad || 0 }
        return
      }
      if (data.type === 'result' || data.type === 'error') {
        const isError = data.type === 'error'
        if (isError) failTask(data.taskId, data.error || 'Node error')
        else completeTask(data.taskId, data.payload, nodeId)
        return
      }
      if (data.type === 'progress') {
        const subs = subscribers.get(data.taskId)
        if (!subs) return
        const msg = JSON.stringify({ type: 'token', token: data.token })
        for (const ws of subs) { try { ws.send(msg) } catch {} }
        return
      }
    } catch {}
  })

  server.addEventListener('close', () => {
    const info = nodes.get(nodeId)
    if (info?.currentTaskId) failTask(info.currentTaskId, 'Node disconnected')
    nodes.delete(nodeId)
  })
  server.addEventListener('error', () => { nodes.delete(nodeId) })

  assignNextTasks()
  return new Response(null, { status: 101, webSocket: client })
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

  const existingTask = tasks.get(taskId)
  if (existingTask?.status === 'done' || existingTask?.status === 'failed') {
    const [client, server] = Object.values(new WebSocketPair())
    server.accept()
    const msg = existingTask.status === 'done'
      ? { type: 'done', result: existingTask.result }
      : { type: 'error', error: existingTask.error }
    server.send(JSON.stringify(msg))
    server.close()
    return new Response(null, { status: 101, webSocket: client })
  }

  const [client, server] = Object.values(new WebSocketPair())
  server.accept()
  if (!subscribers.has(taskId)) subscribers.set(taskId, new Set())
  subscribers.get(taskId)!.add(server)
  server.send(JSON.stringify({ type: 'subscribed', taskId }))

  server.addEventListener('close', () => {
    const subs = subscribers.get(taskId)
    if (subs) {
      subs.delete(server)
      if (subs.size === 0) subscribers.delete(taskId)
    }
  })
  return new Response(null, { status: 101, webSocket: client })
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
    payload: body.payload as TaskPayload,
    createdAt: Date.now(),
    retryCount: 0,
    timeoutMs: body.timeoutMs || 30000,
    callbackUrl: body.callbackUrl,
  }

  tasks.set(taskId, task)
  ensureCleanup()
  setTimeout(() => assignNextTasks(), 0)

  return c.json({ message: 'Task submitted', taskId, id: taskId, status: task.status, createdAt: task.createdAt })
})

app.get('/tasks/:id', async (c) => {
  const auth = c.req.header('Authorization')
  if (!await validateApiKey(c.env, auth)) return c.json({ error: 'Unauthorized' }, 401)
  if (!checkRateLimit(c.env, `tasks:${getClientIp(c)}`)) return c.json({ error: 'Rate limit exceeded' }, 429)

  const id = c.req.param('id')
  const task = tasks.get(id)
  if (!task) return c.json({ error: 'Not found' }, 404)
  return c.json(task)
})

export { app as crowdApp }
