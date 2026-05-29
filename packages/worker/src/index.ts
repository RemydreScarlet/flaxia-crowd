/**
 * Flaxia Worker - Orchestrator
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { crowdApp, validateApiKey } from './crowd'
import { adminApp } from './admin'
export { TaskQueue } from './worker/TaskQueue'
export { NodeManager } from './worker/NodeManager'
export { VectorIndex } from './worker/VectorIndex'
export { ApiKeyManager } from './worker/ApiKeyManager'

export interface Env {
  TASK_QUEUE: DurableObjectNamespace
  NODE_MANAGER: DurableObjectNamespace
  VECTOR_INDEX: DurableObjectNamespace
  API_KEY_MANAGER: DurableObjectNamespace
  API_KEYS: string
  CORS_ORIGINS: string
  DO_SHARED_SECRET: string
  RATE_LIMIT_MAX: string
  MAX_PAYLOAD_SIZE: string
}

const app = new Hono<{ Bindings: Env }>()

const getOrigins = (env: Env | undefined): string[] => {
  if (!env) return ['*']
  const origins = env.CORS_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean)
  return origins && origins.length > 0 ? origins : ['http://localhost:5173', 'http://localhost:5174']
}

const corsMiddleware = cors({
  origin: (origin, c) => {
    const allowed = getOrigins(c.env as Env | undefined)
    if (allowed.includes('*')) return origin || '*'
    if (!origin) return allowed[0]
    if (allowed.includes(origin)) return origin
    return allowed[0]
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
})

// Basic Routing
app.get('/health', (c) => c.text('OK'))

// Crowd Routing (CORS + 認証)
app.use('/crowd/*', corsMiddleware)
app.route('/crowd', crowdApp)

// Admin Routing (管理画面 + API)
app.route('/admin', adminApp)

export default app

