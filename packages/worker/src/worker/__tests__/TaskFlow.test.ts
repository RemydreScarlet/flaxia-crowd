import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import type { TaskRecord } from '@flaxia/sdk';

describe('Task Flow Integration', () => {
  it('should return undefined when no node is registered', async () => {
    const nodeManagerId = env.NODE_MANAGER.idFromName('flow-empty');
    const nodeManagerStub = env.NODE_MANAGER.get(nodeManagerId);

    const response = await nodeManagerStub.fetch(new Request('http://internal/pick?workload=ai-inference', {
      headers: { 'X-DO-Shared-Secret': 'dev-shared-secret-change-in-production' },
    }));
    expect(response.status).toBe(200);
    const data = await response.json() as { nodeId?: string };
    expect(data.nodeId).toBeUndefined();
  });

  it('should enqueue and retrieve a task', async () => {
    const taskQueueId = env.TASK_QUEUE.idFromName('flow-enqueue');
    const taskQueueStub = env.TASK_QUEUE.get(taskQueueId);

    const task: TaskRecord = {
      id: 'flow-task-1',
      status: 'pending',
      workload: 'ai-inference',
      payload: { task: 'text-classification', model: 'test', input: 'hi' },
      createdAt: Date.now(),
      retryCount: 0,
      timeoutMs: 30000,
    };

    await taskQueueStub.enqueue(task);

    const retrieved = await taskQueueStub.getTask('flow-task-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.status).toBe('pending');

    const pending = await taskQueueStub.getPending();
    expect(pending).toContain('flow-task-1');
  });
});
