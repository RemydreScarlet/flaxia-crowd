import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerPool } from '../WorkerPool';

describe('WorkerPool', () => {
  let pool: WorkerPool;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    pool?.terminate();
  });

  it('should reject when Worker is not available', async () => {
    const originalWorker = globalThis.Worker;
    (globalThis as any).Worker = undefined;

    pool = new WorkerPool();
    await expect(pool.run('1', 'ai-inference', {})).rejects.toThrow('Worker not available');

    (globalThis as any).Worker = originalWorker;
  });

  it('should reject on timeout', async () => {
    class MockWorker {
      postMessage = vi.fn();
      terminate = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    }

    (globalThis as any).Worker = MockWorker as any;

    pool = new WorkerPool(undefined, 10);
    await expect(pool.run('1', 'ai-inference', {})).rejects.toThrow('TIMEOUT');
  });

  it('should resolve when worker returns done', async () => {
    let handler: Function;
    const mockAddEventListener = vi.fn((_event: string, h: Function) => {
      handler = h;
    });

    class MockWorker {
      postMessage = vi.fn(() => {
        setTimeout(() => handler({ data: { id: '1', type: 'done', result: { output: 'ok' } } }), 0);
      });
      terminate = vi.fn();
      addEventListener = mockAddEventListener;
      removeEventListener = vi.fn();
    }

    (globalThis as any).Worker = MockWorker as any;

    pool = new WorkerPool();
    const result = await pool.run('1', 'ai-inference', {}, 100);
    expect(result).toEqual({ output: 'ok' });
  });

  it('should reject when worker returns error', async () => {
    let handler: Function;
    const mockAddEventListener = vi.fn((_event: string, h: Function) => {
      handler = h;
    });

    class MockWorker {
      postMessage = vi.fn(() => {
        setTimeout(() => handler({ data: { id: '1', type: 'error', error: 'Something failed' } }), 0);
      });
      terminate = vi.fn();
      addEventListener = mockAddEventListener;
      removeEventListener = vi.fn();
    }

    (globalThis as any).Worker = MockWorker as any;

    pool = new WorkerPool();
    await expect(pool.run('1', 'ai-inference', {}, 100)).rejects.toThrow('Something failed');
  });

  it('should ignore messages with different id', async () => {
    let handler: Function;
    const mockAddEventListener = vi.fn((_event: string, h: Function) => {
      handler = h;
    });

    class MockWorker {
      postMessage = vi.fn(() => {
        setTimeout(() => {
          handler({ data: { id: 'wrong-id', type: 'done', result: { output: 'ignored' } } });
          handler({ data: { id: '1', type: 'done', result: { output: 'correct' } } });
        }, 0);
      });
      terminate = vi.fn();
      addEventListener = mockAddEventListener;
      removeEventListener = vi.fn();
    }

    (globalThis as any).Worker = MockWorker as any;

    pool = new WorkerPool();
    const result = await pool.run('1', 'ai-inference', {}, 100);
    expect(result).toEqual({ output: 'correct' });
  });
});
