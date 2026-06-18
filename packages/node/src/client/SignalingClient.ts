import { ConsentUI } from '../consent/ConsentUI';
import { hasConsent, saveConsent } from '../consent/storage';
import { WorkerPool } from '../executor/WorkerPool';
import { CpuThrottle } from '../executor/throttle';

import type { NodeConfig, WorkloadType } from '@flaxia/sdk';

export interface TaskMessage {
  type: 'task';
  taskId: string;
  workload: WorkloadType;
  payload: unknown;
}

class SignalingClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_DELAY = 30000;
  private destroyed = false;
  private suspended = false;
  private visibilityHandler: (() => void) | null = null;

  constructor(
    private config: NodeConfig,
    private workerPool: WorkerPool,
    private nodeId: string,
    private throttle: CpuThrottle,
  ) {}

  connect() {
    if (this.destroyed) return;

    if (this.ws) {
      const old = this.ws;
      old.onclose = null;
      try { old.close(); } catch {}
      this.ws = null;
    }

    this.setupVisibilityHandler();

    const capabilities: WorkloadType[] = this.config.capabilities ?? ['ai-inference', 'image-process'];
    const wsUrl = new URL(`${this.config.orchestratorUrl.replace('http', 'ws')}/crowd/signal`);
    wsUrl.searchParams.set('nodeId', this.nodeId);
    wsUrl.searchParams.set('capabilities', capabilities.join(','));

    const ws = new WebSocket(wsUrl.toString());
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', cpuLoad: this.throttle.lastMeasuredLoad }));
        return;
      }
      if (data.type === 'task') {
        this.handleTask(data as TaskMessage);
      }
    };

    ws.onclose = () => {
      ws.onclose = null;
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.destroyed) return;

      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.MAX_RECONNECT_DELAY);
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect();
      }, delay);
    };
  }

  disconnect() {
    this.destroyed = true;
    this.suspended = false;
    this.removeVisibilityHandler();
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }

  suspend() {
    if (this.suspended || this.destroyed) return;
    this.suspended = true;
    if (this.ws) {
      const old = this.ws;
      old.onclose = null;
      try { old.close(); } catch {}
      this.ws = null;
    }
    this.workerPool.terminate();
  }

  resume() {
    if (!this.suspended || this.destroyed) return;
    this.suspended = false;
    this.workerPool.resume();
    this.connect();
  }

  private setupVisibilityHandler() {
    this.removeVisibilityHandler();
    this.visibilityHandler = () => {
      if (document.hidden) {
        this.suspend();
      } else if (this.suspended) {
        this.resume();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private removeVisibilityHandler() {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  private async handleTask(data: TaskMessage) {
    try {
      await this.throttle.waitForSlot();
      const result = await this.workerPool.run(
        data.taskId, data.workload, data.payload,
        undefined,
        (token: string) => {
          this.ws?.send(JSON.stringify({ type: 'progress', taskId: data.taskId, token }));
        },
      );
      this.ws?.send(JSON.stringify({ type: 'result', taskId: data.taskId, payload: result }));
    } catch (err) {
      this.ws?.send(JSON.stringify({
        type: 'error',
        taskId: data.taskId,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }
}

const WINDOW_KEY = '__flaxia_node_signal_client';

const startNode = (config: NodeConfig) => {
  const prev: SignalingClient | undefined = (window as any)[WINDOW_KEY];
  if (prev) {
    prev.disconnect();
  }

  const throttle = new CpuThrottle(config.maxCpuLoad);
  throttle.startMeasuring();

  const workerUrl = new URL('./worker.js', import.meta.url).href;
  const workerPool = new WorkerPool(workerUrl);
  let nodeId = localStorage.getItem('flaxia_node_id');
  if (!nodeId) {
    nodeId = crypto.randomUUID();
    localStorage.setItem('flaxia_node_id', nodeId);
  }

  const client = new SignalingClient(config, workerPool, nodeId, throttle);
  (window as any)[WINDOW_KEY] = client;
  client.connect();
};

export const initFlaxiaNode = (config: NodeConfig) => {
  if (hasConsent()) {
    startNode(config);
    return;
  }

  const container = document.createElement('div');
  container.id = 'flaxia-consent-container';
  document.body.appendChild(container);

  const ui = new ConsentUI(container, config.consent, () => {
    saveConsent();
    container.remove();
    startNode(config);
  });
};
