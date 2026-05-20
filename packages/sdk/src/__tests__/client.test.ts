import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlaxiaClient } from '../client';
import { TaskRecord } from '../types';

describe('FlaxiaClient', () => {
  const apiKey = 'fc_test_abc123';
  const client = new FlaxiaClient({ apiKey });

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('submits a task successfully', async () => {
    const mockTask: TaskRecord = {
      id: 'task_1',
      status: 'pending',
      workload: 'ai-inference',
      payload: { task: 'test', model: 'test', input: 'hi' },
      createdAt: Date.now(),
      retryCount: 0,
      timeoutMs: 30000,
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockTask,
    });

    const result = await client.submit({
      workload: 'ai-inference',
      payload: { task: 'test', model: 'test', input: 'hi' },
    });

    expect(result).toEqual(mockTask);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Authorization': `Bearer ${apiKey}`,
      }),
    }));
  });

  it('throws an error if API key is missing', () => {
    expect(() => new FlaxiaClient({ apiKey: '' as any })).toThrow('API Key is required');
  });

  it('polls for task completion', async () => {
    const mockTask: TaskRecord = {
      id: 'task_1',
      status: 'done',
      workload: 'ai-inference',
      payload: {},
      createdAt: Date.now(),
      retryCount: 0,
      timeoutMs: 30000,
    } as any;

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockTask,
    });

    const result = await client.waitForTask('task_1', 10);
    expect(result.status).toBe('done');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
