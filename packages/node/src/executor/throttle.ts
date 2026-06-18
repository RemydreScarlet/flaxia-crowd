export class CpuThrottle {
  private baseline: number | null = null;
  private baselineReady = false;
  private _lastMeasuredLoad = 0;
  private measuringInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxLoad: number;

  constructor(maxLoad = 0.15) {
    this.maxLoad = Math.max(0.05, Math.min(0.3, maxLoad));
  }

  private measureIdleDelay(): Promise<number> {
    return new Promise(resolve => {
      const start = performance.now();
      (window.requestIdleCallback || ((cb: IdleRequestCallback) => setTimeout(cb, 0)))(() => {
        resolve(performance.now() - start);
      });
    });
  }

  async getCurrentLoad(): Promise<number> {
    const delay = await this.measureIdleDelay();
    return Math.min(1.0, delay / 120);
  }

  async shouldPause(): Promise<boolean> {
    const load = await this.getCurrentLoad();
    return load > this.maxLoad;
  }

  async waitForSlot(): Promise<void> {
    let attempts = 0;
    while (await this.shouldPause()) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  startMeasuring(intervalMs = 30000): void {
    this.stopMeasuring();
    this.getCurrentLoad().then(load => { this._lastMeasuredLoad = load; });
    this.measuringInterval = setInterval(async () => {
      this._lastMeasuredLoad = await this.getCurrentLoad();
    }, intervalMs);
  }

  stopMeasuring(): void {
    if (this.measuringInterval) {
      clearInterval(this.measuringInterval);
      this.measuringInterval = null;
    }
  }

  get lastMeasuredLoad(): number {
    return this._lastMeasuredLoad;
  }

  get maxLoadValue(): number {
    return this.maxLoad;
  }
}
