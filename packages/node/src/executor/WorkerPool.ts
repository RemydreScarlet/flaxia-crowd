import type { WorkloadType } from "@flaxia/sdk";

export class WorkerPool {
  private worker: Worker | null = null;
  private defaultTimeoutMs: number;
  private workerUrl: string;

  constructor(workerUrl?: string, timeoutMs = 300000) {
    this.workerUrl = workerUrl || '/worker.js';
    this.defaultTimeoutMs = timeoutMs;
    this.initWorker();
  }

  private initWorker() {
    if (typeof Worker === 'undefined') return;
    this.worker = new Worker(this.workerUrl, { type: 'module' });
  }

  run(
    id: string,
    workload: WorkloadType,
    payload: unknown,
    timeoutMs?: number,
    onToken?: (token: string) => void,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not available'));
        return;
      }

      const timeout = timeoutMs ?? this.defaultTimeoutMs;
      let timeoutId = setTimeout(() => {
        this.cleanupWorker();
        reject(new Error('TIMEOUT'));
      }, timeout);

      const handleMessage = (e: MessageEvent) => {
        const { id: resId, type, result, error, token } = e.data;
        if (resId !== id) return;

        if (type === 'heartbeat') {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            this.cleanupWorker();
            reject(new Error('TIMEOUT'));
          }, timeout);
          return;
        }

        if (type === 'token') {
          onToken?.(token);
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            this.cleanupWorker();
            reject(new Error('TIMEOUT'));
          }, timeout);
          return;
        }

        clearTimeout(timeoutId);
        this.worker?.removeEventListener('message', handleMessage);

        if (type === 'done') {
          resolve(result);
        } else if (type === 'error') {
          reject(new Error(error));
        }
      };

      this.worker.addEventListener('message', handleMessage);
      this.worker.postMessage({ id, workload, payload });
    });
  }

  private cleanupWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initWorker();
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
