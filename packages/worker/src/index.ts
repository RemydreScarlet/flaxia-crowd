/**
 * Flaxia Worker - Orchestrator
 */
import { Hono } from 'hono'
import { crowdApp } from './crowd'
export { TaskQueue } from './worker/TaskQueue'
export { NodeManager } from './worker/NodeManager'

export interface Env {
  TASK_QUEUE: DurableObjectNamespace
  NODE_MANAGER: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

// Basic Routing
app.get('/health', (c) => c.text('OK'))

// Crowd Routing
app.route('/crowd', crowdApp)

export default app
