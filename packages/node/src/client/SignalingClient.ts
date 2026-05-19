import { ConsentUI } from '../consent/ConsentUI';
import { hasConsent, saveConsent } from '../consent/storage';
import { WorkerPool } from '../executor/WorkerPool';

import type { NodeConfig, WorkloadType } from '@flaxia/sdk';

const startNode = (config: NodeConfig) => {
  console.log('Consent granted, connecting to signaling...');
  const workerPool = new WorkerPool();
  
  // Use a stable nodeId (could be stored in localStorage)
  let nodeId = localStorage.getItem('flaxia_node_id');
  if (!nodeId) {
    nodeId = crypto.randomUUID();
    localStorage.setItem('flaxia_node_id', nodeId);
  }

  const capabilities: WorkloadType[] = ['ai-inference', 'image-process'];
  const wsUrl = new URL(`${config.orchestratorUrl.replace('http', 'ws')}/crowd/signal`);
  wsUrl.searchParams.set('nodeId', nodeId);
  wsUrl.searchParams.set('capabilities', capabilities.join(','));

  const ws = new WebSocket(wsUrl.toString());
  
  ws.onopen = () => {
    console.log(`Connected to Flaxia Orchestrator as ${nodeId}`);
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', cpuLoad: 0.1 })); // Mock CPU load
      return;
    }

    if (data.type === 'task') {
      console.log('Task received:', data.taskId, data.workload);
      
      try {
        const result = await workerPool.run(data.taskId, data.workload, data.payload);
        console.log('Task completed successfully:', data.taskId);
        
        ws.send(JSON.stringify({
          type: 'result',
          taskId: data.taskId,
          payload: result
        }));
      } catch (err) {
        console.error('Task failed:', data.taskId, err);
        ws.send(JSON.stringify({
          type: 'error',
          taskId: data.taskId,
          error: err instanceof Error ? err.message : String(err)
        }));
      }
    }
  };

  ws.onclose = () => {
    console.log('Signaling connection closed. Retrying in 5s...');
    setTimeout(() => startNode(config), 5000);
  };
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
