import { describe, it, expect } from 'vitest';
import { TaskQueue } from '../TaskQueue';

describe('TaskQueue', () => {
  it('should be instantiable', () => {
    const queue = new TaskQueue();
    expect(queue).toBeDefined();
  });
});
