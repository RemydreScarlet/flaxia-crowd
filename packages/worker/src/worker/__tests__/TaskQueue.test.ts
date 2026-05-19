import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { TaskQueue } from '../TaskQueue';

describe('TaskQueue', () => {
  it('should be instantiable', async () => {
    const id = env.TASK_QUEUE.idFromName('test-queue');
    const queue = env.TASK_QUEUE.get(id);
    expect(queue).toBeDefined();
  });
});
