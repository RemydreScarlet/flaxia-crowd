import { Hono } from 'hono'
import type { Env } from '../index'
import type { TaskRecord, WorkloadType, VectorQueryResult } from '@flaxia/sdk'

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

const app = new Hono<{ Bindings: Env }>()

app.get('/signal', async (c) => {
  const upgradeHeader = c.req.header('Upgrade')
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
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

app.get('/subscribe', async (c) => {
  const upgradeHeader = c.req.header('Upgrade')
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
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

app.post('/tasks', async (c) => {
  const body = await c.req.json() as {
    workload: string
    payload: unknown
    timeoutMs?: number
    callbackUrl?: string
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
  const id = c.req.param('id')
  const doId = c.env.TASK_QUEUE.idFromName('global-queue')
  const obj = c.env.TASK_QUEUE.get(doId)
  const task = await obj.getTask(id)

  if (!task) return c.json({ error: 'Not found' }, 404)
  return c.json(task)
})

app.post('/tasks/:id/result', async (c) => {
  const id = c.req.param('id')
  const { result, nodeId } = await c.req.json() as { result: unknown; nodeId: string }

  const doId = c.env.TASK_QUEUE.idFromName('global-queue')
  const obj = c.env.TASK_QUEUE.get(doId)

  await obj.fetch(new Request('http://internal/complete', {
    method: 'POST',
    body: JSON.stringify({ taskId: id, result, nodeId })
  }))

  return c.json({ id, message: 'Result posted' })
})

app.get('/nodes', async (c) => {
  const id = c.env.NODE_MANAGER.idFromName('global-manager')
  const obj = c.env.NODE_MANAGER.get(id)

  const response = await obj.fetch(new Request('http://internal/nodes'))
  const data = await response.json() as { nodes: unknown }
  return c.json(data)
})

app.post('/query', async (c) => {
  const { queryVector, topK = 10 } = await c.req.json() as {
    queryVector: number[]
    topK?: number
  }

  const vectorIndexId = c.env.VECTOR_INDEX.idFromName('global-vector-index')
  const vectorIndex = c.env.VECTOR_INDEX.get(vectorIndexId)
  const nodesResp = await vectorIndex.fetch(new Request('http://internal/query-nodes'))
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

export { app as crowdApp }
