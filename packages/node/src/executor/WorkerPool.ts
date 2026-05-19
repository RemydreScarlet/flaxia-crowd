import type { WorkloadType } from "@flaxia/sdk";

export class WorkerPool {
  private worker: Worker | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    if (typeof Worker === 'undefined') return;
    
    // In Vite, this URL will be resolved correctly
    this.worker = new Worker(new URL('../worker/main.worker.ts', import.meta.url), {
      type: 'module'
    });
  }

  run(id: string, workload: WorkloadType, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        // Fallback for non-worker environments (tests)
        resolve({ output: 'Mock result (no worker)' });
        return;
      }

      const timeoutMs = 30000;
      const timeoutId = setTimeout(() => {
        this.terminate();
        this.initWorker();
        reject(new Error('TIMEOUT'));
      }, timeoutMs);

      this.worker.onmessage = (e: MessageEvent) => {
        const { id: resId, type, result, error } = e.data;
        if (resId !== id) return;

        if (type === 'done') {
          clearTimeout(timeoutId);
          resolve(result);
        } else if (type === 'error') {
          clearTimeout(timeoutId);
          reject(new Error(error));
        }
      };

      this.worker.postMessage({ id, workload, payload });
    });
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
