import { ConsentUI } from '../consent/ConsentUI';
import { hasConsent, saveConsent } from '../consent/storage';
import { WorkerPool } from '../executor/WorkerPool';

import type { NodeConfig, WorkloadType } from '@flaxia/sdk';

class SignalingClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_DELAY = 30000;

  constructor(
    private config: NodeConfig,
    private workerPool: WorkerPool,
    private nodeId: string
  ) {}

  connect() {
    const capabilities: WorkloadType[] = ['ai-inference', 'image-process'];
    const wsUrl = new URL(`${this.config.orchestratorUrl.replace('http', 'ws')}/crowd/signal`);
    wsUrl.searchParams.set('nodeId', this.nodeId);
    wsUrl.searchParams.set('capabilities', capabilities.join(','));

    this.ws = new WebSocket(wsUrl.toString());

    this.ws.onopen = () => {
      console.log(`Connected to Flaxia Orchestrator as ${this.nodeId}`);
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'ping') {
        this.ws?.send(JSON.stringify({ type: 'pong', cpuLoad: 0.1 }));
        return;
      }
      if (data.type === 'task') {
        this.handleTask(data);
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.MAX_RECONNECT_DELAY);
      console.log(`Connection closed. Retrying in ${delay}ms...`);
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect();
      }, delay);
    };
  }

  private async handleTask(data: any) {
    console.log('Task received:', data.taskId, data.workload);
    try {
      const result = await this.workerPool.run(data.taskId, data.workload, data.payload);
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

const startNode = (config: NodeConfig) => {
  const workerPool = new WorkerPool();
  let nodeId = localStorage.getItem('flaxia_node_id');
  if (!nodeId) {
    nodeId = crypto.randomUUID();
    localStorage.setItem('flaxia_node_id', nodeId);
  }

  const client = new SignalingClient(config, workerPool, nodeId);
  client.connect();
};

export const initFlaxiaNode = (config: NodeConfig) => {
  if (hasConsent()) {
    startNode(config);
    return;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);

  new ConsentUI(container, config.consent, () => {
    saveConsent();
    startNode(config);
  });
};
