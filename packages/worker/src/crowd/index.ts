import { Hono } from 'hono'
import type { Env } from '../index'
import type { TaskRecord, WorkloadType, VectorQueryResult } from '@flaxia/sdk'

const VALID_WORKLOADS: readonly WorkloadType[] = [
  'ai-inference', 'image-process', 'file-convert', 'container',
  'vector-embed', 'vector-store', 'vector-query'
]

interface NodeShardInfoResponse {
  nodeId: string;
  rangeStart: number;
  rangeEnd: number;
  vectorCount: number;
  lastHeartbeat: number;
}

interface MergedResult {
  docId: string;
  score: number;
  metadata: { title: string; url: string; snippet: string };
  sources: number;
}

// --- 認証ユーティリティ ---

export async function validateApiKey(env: Env, authHeader: string | undefined): Promise<boolean> {
  if (!authHeader) return false
  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return false

  // 高速パス: 静的なAPI_KEYS env var との一致
  const staticKeys = (env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean)
  if (staticKeys.includes(token)) return true

  // DB検証: ApiKeyManager DO で SHA-256 ハッシュ検証
  if (env.API_KEY_MANAGER) {
    try {
      const id = env.API_KEY_MANAGER.idFromName('global-key-manager')
      const obj = env.API_KEY_MANAGER.get(id)
      const resp = await obj.fetch(new Request('http://internal/validate', {
        method: 'POST',
        headers: { 'X-DO-Shared-Secret': env.DO_SHARED_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }))
      const { valid } = await resp.json() as { valid: boolean }
      if (valid) return true
    } catch {
      // DO が利用不可の場合、静的キーのみで判断
    }
  }

  return false
}

export function validateInternalRequest(request: Request, env: Env): boolean {
  const secret = request.headers.get('X-DO-Shared-Secret')
  if (!secret) return false
  return secret === env.DO_SHARED_SECRET
}

function getClientIp(c: any): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
}

// 簡易インメモリレートリミッター（単一ワーカー内）
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

// --- ルート ---

const app = new Hono<{ Bindings: Env }>()

// WebSocket: Origin検証 + レート制限（シグナリング: 認証不要）
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

  const nodeId = c.req.query('nodeId') || crypto.randomUUID()
  const capabilities = c.req.query('capabilities') || ''

  const id = c.env.NODE_MANAGER.idFromName('global-manager')
  const obj = c.env.NODE_MANAGER.get(id)

  const url = new URL(c.req.url)
  url.pathname = '/ws'
  url.searchParams.set('nodeId', nodeId)
  url.searchParams.set('capabilities', capabilities)

  return obj.fetch(new Request(url.toString(), {
    headers: c.req.raw.headers,
    signal: c.req.raw.signal,
  }))
})

// WebSocket: Origin検証 + レート制限（サブスクライブ: 認証不要）
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

  const id = c.env.NODE_MANAGER.idFromName('global-manager')
  const obj = c.env.NODE_MANAGER.get(id)

  const url = new URL(c.req.url)
  url.pathname = '/subscribe'
  url.searchParams.set('taskId', taskId)

  return obj.fetch(new Request(url.toString(), {
    headers: c.req.raw.headers,
    signal: c.req.raw.signal,
  }))
})

// 認証必須エンドポイント
app.post('/tasks', async (c) => {
  const auth = c.req.header('Authorization')
  if (!await validateApiKey(c.env, auth)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if (!checkRateLimit(c.env, `tasks:${getClientIp(c)}`)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  const rawBody = await c.req.text()
  if (!validatePayloadSize(c.env, rawBody)) {
    return c.json({ error: 'Payload too large' }, 413)
  }

  const body = JSON.parse(rawBody) as {
    workload: string
    payload: unknown
    timeoutMs?: number
    callbackUrl?: string
  }

  if (!body.workload || !VALID_WORKLOADS.includes(body.workload as WorkloadType)) {
    return c.json({ error: 'Invalid workload type' }, 400)
  }
  if (!body.payload) {
    return c.json({ error: 'payload is required' }, 400)
  }

  const taskId = crypto.randomUUID()

  const task: TaskRecord = {
    id: taskId,
    status: 'pending',
    workload: body.workload as WorkloadType,
    payload: body.payload,
    createdAt: Date.now(),
    retryCount: 0,
    timeoutMs: body.timeoutMs || 30000,
    callbackUrl: body.callbackUrl,
  }

  const id = c.env.TASK_QUEUE.idFromName('global-queue')
  const obj = c.env.TASK_QUEUE.get(id)
  await obj.enqueue(task)

  return c.json({ message: 'Task submitted', taskId })
})

app.get('/tasks/:id', async (c) => {
  const auth = c.req.header('Authorization')
  if (!await validateApiKey(c.env, auth)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if (!checkRateLimit(c.env, `tasks:${getClientIp(c)}`)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  const id = c.req.param('id')
  const doId = c.env.TASK_QUEUE.idFromName('global-queue')
  const obj = c.env.TASK_QUEUE.get(doId)
  const task = await obj.getTask(id)

  if (!task) return c.json({ error: 'Not found' }, 404)
  return c.json(task)
})

app.post('/tasks/:id/result', async (c) => {
  const rawBody = await c.req.text()
  if (!validatePayloadSize(c.env, rawBody)) {
    return c.json({ error: 'Payload too large' }, 413)
  }

  const id = c.req.param('id')
  const { result, nodeId } = JSON.parse(rawBody) as { result: unknown; nodeId: string }

  const doId = c.env.TASK_QUEUE.idFromName('global-queue')
  const obj = c.env.TASK_QUEUE.get(doId)

  await obj.fetch(new Request('http://internal/complete', {
    method: 'POST',
    headers: { 'X-DO-Shared-Secret': c.env.DO_SHARED_SECRET },
    body: JSON.stringify({ taskId: id, result, nodeId })
  }))

  return c.json({ id, message: 'Result posted' })
})

app.get('/nodes', async (c) => {
  const auth = c.req.header('Authorization')
  if (!await validateApiKey(c.env, auth)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if (!checkRateLimit(c.env, `nodes:${getClientIp(c)}`)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  const id = c.env.NODE_MANAGER.idFromName('global-manager')
  const obj = c.env.NODE_MANAGER.get(id)

  const response = await obj.fetch(new Request('http://internal/nodes', {
    headers: { 'X-DO-Shared-Secret': c.env.DO_SHARED_SECRET },
  }))
  const data = await response.json() as { nodes: unknown }
  return c.json(data)
})

app.post('/query', async (c) => {
  const auth = c.req.header('Authorization')
  if (!await validateApiKey(c.env, auth)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  if (!checkRateLimit(c.env, `query:${getClientIp(c)}`)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  const rawBody = await c.req.text()
  if (!validatePayloadSize(c.env, rawBody)) {
    return c.json({ error: 'Payload too large' }, 413)
  }

  const { queryVector, topK = 10 } = JSON.parse(rawBody) as {
    queryVector: number[]
    topK?: number
  }

  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    return c.json({ error: 'queryVector is required' }, 400)
  }

  const vectorIndexId = c.env.VECTOR_INDEX.idFromName('global-vector-index')
  const vectorIndex = c.env.VECTOR_INDEX.get(vectorIndexId)
  const nodesResp = await vectorIndex.fetch(new Request('http://internal/query-nodes', {
    headers: { 'X-DO-Shared-Secret': c.env.DO_SHARED_SECRET },
  }))
  const { nodes } = await nodesResp.json() as { nodes: NodeShardInfoResponse[] }

  if (nodes.length === 0) {
    return c.json({ results: [], message: 'No storage nodes available' })
  }

  const taskPromises = nodes.map(async (node) => {
    const taskId = crypto.randomUUID()
    const task: TaskRecord = {
      id: taskId,
      status: 'pending',
      workload: 'vector-query',
      payload: { queryVector, topK },
      createdAt: Date.now(),
      retryCount: 0,
      timeoutMs: 30000,
    }
    const taskQueueId = c.env.TASK_QUEUE.idFromName('global-queue')
    const taskQueue = c.env.TASK_QUEUE.get(taskQueueId)
    await taskQueue.enqueue(task)
    return { taskId, nodeId: node.nodeId }
  })

  const taskEntries = await Promise.all(taskPromises)
  const taskIds = taskEntries.map(e => e.taskId)

  const allResults: VectorQueryResult[] = []
  const maxWaitMs = 15000
  const pollStart = Date.now()

  while (allResults.length < taskIds.length && Date.now() - pollStart < maxWaitMs) {
    for (const taskId of taskIds) {
      const taskQueueId = c.env.TASK_QUEUE.idFromName('global-queue')
      const taskQueue = c.env.TASK_QUEUE.get(taskQueueId)
      const task = await taskQueue.getTask(taskId)
      if (task?.status === 'done') {
        if (!allResults.find(r => r.nodeId === task.assignedNodeId)) {
          allResults.push(task.result as VectorQueryResult)
        }
      }
    }
    if (allResults.length < taskIds.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  const merged = mergeResults(allResults)
  return c.json({
    results: merged.slice(0, topK),
    totalNodes: allResults.length,
    totalResults: merged.length,
  })
})

// --- 内部関数 ---

function mergeResults(nodesResults: VectorQueryResult[]): MergedResult[] {
  const merged = new Map<string, MergedResult>();

  for (const nodeResult of nodesResults) {
    for (const r of nodeResult.results) {
      const existing = merged.get(r.docId);
      if (!existing || r.score > existing.score) {
        merged.set(r.docId, { ...r, sources: 1 });
      } else if (existing) {
        existing.sources++;
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score);
}

export { app as crowdApp }
