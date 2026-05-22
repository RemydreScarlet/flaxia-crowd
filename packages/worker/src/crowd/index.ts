import { Hono } from 'hono'
import type { Env } from '../index'
import type { TaskRecord, WorkloadType } from '@flaxia/sdk'

const app = new Hono<{ Bindings: Env }>()

// Signaling - Upgrading to NodeManager Durable Object
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

  return obj.fetch(new Request(`${url.toString()}?nodeId=${nodeId}&capabilities=${capabilities}`, {
    headers: c.req.raw.headers,
    signal: c.req.raw.signal,
  }))
})

// Tasks
app.post('/tasks', async (c) => {
  const { workload, payload, timeoutMs, callbackUrl } = await c.req.json()
  const taskId = crypto.randomUUID()
  
  const task: TaskRecord = {
    id: taskId,
    status: 'pending',
    workload: workload as WorkloadType,
    payload,
    createdAt: Date.now(),
    retryCount: 0,
    timeoutMs: timeoutMs || 30000,
    callbackUrl
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
  const { result, nodeId } = await c.req.json()
  
  const doId = c.env.TASK_QUEUE.idFromName('global-queue')
  const obj = c.env.TASK_QUEUE.get(doId)
  
  await obj.fetch(new Request(`http://internal/complete`, {
    method: 'POST',
    body: JSON.stringify({ taskId: id, result, nodeId })
  }))

  return c.json({ id, message: 'Result posted' })
})

// Nodes
app.get('/nodes', async (c) => {
  const id = c.env.NODE_MANAGER.idFromName('global-manager')
  const obj = c.env.NODE_MANAGER.get(id)
  
  // We can add a method to get all nodes if needed
  return c.json({ nodes: [] })
})

export { app as crowdApp }
