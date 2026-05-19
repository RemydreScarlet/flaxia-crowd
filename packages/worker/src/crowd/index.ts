import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/cloudflare-workers'
import type { Env } from '../index'
import type { TaskRecord, WorkloadType } from '@flaxia/sdk'

const app = new Hono<{ Bindings: Env }>()

// Signaling
app.get(
  '/signal',
  upgradeWebSocket((c) => {
    return {
      onOpen: (_event, ws) => {
        console.log('Connection opened')
        ws.send(JSON.stringify({ type: 'hello', nodeId: 'node-1' }))
      },
      onMessage: (event, ws) => {
        const data = JSON.parse(event.data as string)
        console.log('Received message:', data)
      },
      onClose: () => console.log('Connection closed'),
    }
  })
)

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
  const body = await c.req.json()
  console.log(`Result for ${id}:`, body)
  return c.json({ id, message: 'Result posted' })
})

// Nodes
app.get('/nodes', (c) => c.json({ nodes: [] }))
app.post('/nodes/register', async (c) => {
  const body = await c.req.json()
  console.log('Node registered:', body)
  return c.json({ message: 'Node registered' })
})

export { app as crowdApp }
