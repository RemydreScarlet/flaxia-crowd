// Simple WebWorker wrapper for task execution
export class WorkerPool {
  private worker: Worker | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    if (typeof Worker === 'undefined') return; // Mock for test environment
    const code = `
      self.onmessage = (e) => {
        const { taskId, payload } = e.data;
        console.log('Worker processing:', taskId);
        self.postMessage({ taskId, result: 'processed: ' + JSON.stringify(payload) });
      };
    `;
    const blob = new Blob([code], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
  }

  execute(taskId: string, payload: any, callback: (result: any) => void) {
    if (!this.worker) {
        // Mock result for test environment
        callback('processed: ' + JSON.stringify(payload));
        return;
    }
    
    this.worker.onmessage = (e) => {
      if (e.data.taskId === taskId) {
        callback(e.data.result);
      }
    };
    this.worker.postMessage({ taskId, payload });
  }
}
