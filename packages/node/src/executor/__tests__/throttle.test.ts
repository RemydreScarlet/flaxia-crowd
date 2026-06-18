import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CpuThrottle } from '../throttle';

describe('CpuThrottle', () => {
  let originalRic: typeof window.requestIdleCallback;

  beforeEach(() => {
    originalRic = window.requestIdleCallback;
  });

  afterEach(() => {
    window.requestIdleCallback = originalRic;
  });

  it('should clamp maxLoad between 0.05 and 0.30', () => {
    const t1 = new CpuThrottle(0.01);
    expect(t1.maxLoadValue).toBe(0.05);

    const t2 = new CpuThrottle(0.5);
    expect(t2.maxLoadValue).toBe(0.30);

    const t3 = new CpuThrottle(0.15);
    expect(t3.maxLoadValue).toBe(0.15);
  });

  it('should return 0 as initial lastMeasuredLoad', () => {
    const t = new CpuThrottle();
    expect(t.lastMeasuredLoad).toBe(0);
  });

  it('should measure idle delay and return a load value', async () => {
    window.requestIdleCallback = ((cb: IdleRequestCallback) => {
      queueMicrotask(() => cb({ didTimeout: false, timeRemaining: () => 50 }));
      return 0;
    }) as any;

    const t = new CpuThrottle();
    const load = await t.getCurrentLoad();
    expect(load).toBeGreaterThanOrEqual(0);
    expect(load).toBeLessThanOrEqual(1);
  });

  it('should indicate pause when load exceeds threshold', async () => {
    vi.useFakeTimers();
    window.requestIdleCallback = ((cb: IdleRequestCallback) => {
      setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 200);
      return 0;
    }) as any;

    const t = new CpuThrottle(0.1);

    const promise = t.shouldPause();
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result).toBe(true);

    vi.useRealTimers();
  });

  it('should not pause when load is below threshold', async () => {
    vi.useFakeTimers();
    window.requestIdleCallback = ((cb: IdleRequestCallback) => {
      setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 10);
      return 0;
    }) as any;

    const t = new CpuThrottle(0.5);

    const promise = t.shouldPause();
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result).toBe(false);

    vi.useRealTimers();
  });

  it('should wait for slot when CPU is busy and eventually proceed', async () => {
    let callCount = 0;
    window.requestIdleCallback = ((cb: IdleRequestCallback) => {
      callCount++;
      const delay = callCount <= 2 ? 200 : 10;
      setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), delay);
      return 0;
    }) as any;

    vi.useFakeTimers();
    const t = new CpuThrottle(0.1);

    const promise = t.waitForSlot();

    // First 2 checks see high load, 3rd check sees low load
    // Loop until we've advanced past the 3rd check
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('should start and stop periodic measuring', async () => {
    window.requestIdleCallback = ((cb: IdleRequestCallback) => {
      queueMicrotask(() => cb({ didTimeout: false, timeRemaining: () => 50 }));
      return 0;
    }) as any;

    vi.useFakeTimers();
    const t = new CpuThrottle();

    t.startMeasuring(1000);
    // Initial measurement via queueMicrotask
    await vi.advanceTimersByTimeAsync(0);
    const afterStart = t.lastMeasuredLoad;
    expect(afterStart).toBeGreaterThanOrEqual(0);

    // Advance past the interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.lastMeasuredLoad).toBeGreaterThanOrEqual(0);

    t.stopMeasuring();
    await vi.advanceTimersByTimeAsync(0);
    const before = t.lastMeasuredLoad;
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.lastMeasuredLoad).toBe(before);

    vi.useRealTimers();
  });

  it('should fallback to setTimeout if requestIdleCallback is not available', async () => {
    (window as any).requestIdleCallback = undefined;

    vi.useFakeTimers();
    const t = new CpuThrottle();

    const promise = t.getCurrentLoad();
    await vi.advanceTimersByTimeAsync(0);
    const load = await promise;

    expect(load).toBeGreaterThanOrEqual(0);
    expect(load).toBeLessThanOrEqual(1);

    vi.useRealTimers();
  });
});
