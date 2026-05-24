import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import type { TaskRecord } from '@flaxia/sdk';

describe('TaskQueue', () => {
  it('should be instantiable', async () => {
    const id = env.TASK_QUEUE.idFromName('test-queue');
    const stub = env.TASK_QUEUE.get(id);
    expect(stub).toBeDefined();
  });

  it('should enqueue a task and retrieve it', async () => {
    const id = env.TASK_QUEUE.idFromName('enqueue-test');
    const stub = env.TASK_QUEUE.get(id);

    const task: TaskRecord = {
      id: 'task-1',
      status: 'pending',
      workload: 'ai-inference',
      payload: { task: 'text-classification', model: 'test-model', input: 'hello' },
      createdAt: Date.now(),
      retryCount: 0,
      timeoutMs: 30000,
    };

    await stub.enqueue(task);

    const retrieved = await stub.getTask('task-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('task-1');
    expect(retrieved!.status).toBe('pending');
    expect(retrieved!.workload).toBe('ai-inference');
  });

  it('should return pending task ids after enqueue', async () => {
    const id = env.TASK_QUEUE.idFromName('pending-test');
    const stub = env.TASK_QUEUE.get(id);

    const task: TaskRecord = {
      id: 'pending-task',
      status: 'pending',
      workload: 'image-process',
      payload: { operation: 'resize', imageBase64: '', mimeType: 'image/jpeg', options: {} },
      createdAt: Date.now(),
      retryCount: 0,
      timeoutMs: 30000,
    };

    await stub.enqueue(task);

    const pending = await stub.getPending();
    expect(Array.isArray(pending)).toBe(true);
    expect(pending.length).toBe(1);
    expect(pending).toContain('pending-task');
  });

  it('should return undefined for unknown task', async () => {
    const id = env.TASK_QUEUE.idFromName('unknown-test');
    const stub = env.TASK_QUEUE.get(id);

    const task = await stub.getTask('nonexistent');
    expect(task).toBeUndefined();
  });

  it('should handle multiple tasks', async () => {
    const id = env.TASK_QUEUE.idFromName('multi-test');
    const stub = env.TASK_QUEUE.get(id);

    const task1: TaskRecord = {
      id: 'multi-1',
      status: 'pending',
      workload: 'ai-inference',
      payload: { task: 'test', model: 'test', input: 'hi' },
      createdAt: Date.now(),
      retryCount: 0,
      timeoutMs: 30000,
    };
    const task2: TaskRecord = {
      id: 'multi-2',
      status: 'pending',
      workload: 'image-process',
      payload: { operation: 'resize', imageBase64: '', mimeType: 'image/jpeg', options: {} },
      createdAt: Date.now(),
      retryCount: 0,
      timeoutMs: 30000,
    };

    await stub.enqueue(task1);
    await stub.enqueue(task2);

    const retrieved1 = await stub.getTask('multi-1');
    const retrieved2 = await stub.getTask('multi-2');
    expect(retrieved1).toBeDefined();
    expect(retrieved2).toBeDefined();
    expect(retrieved1!.id).toBe('multi-1');
    expect(retrieved2!.id).toBe('multi-2');

    const pending = await stub.getPending();
    expect(pending).toContain('multi-1');
    expect(pending).toContain('multi-2');
  });
});
