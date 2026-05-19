import { ConsentUI } from '../consent/ConsentUI';
import { hasConsent, saveConsent } from '../consent/storage';
import { WebRTCPeer } from './WebRTCPeer';
import { WorkerPool } from '../executor/WorkerPool';

import type { NodeConfig } from '@flaxia/sdk';

const startNode = (config: NodeConfig) => {
  console.log('Consent granted, connecting to signaling...');
  const workerPool = new WorkerPool();
  const ws = new WebSocket(`${config.orchestratorUrl.replace('http', 'ws')}/crowd/signal`);
  
  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);

    if (data.type === 'task') {
      const peer = new WebRTCPeer((result) => {
          ws.send(JSON.stringify({ type: 'result', taskId: data.taskId, success: true, payload: result }));
      });
      
      await peer.handleOffer(data.offer, (answer) => {
        ws.send(JSON.stringify({ type: 'answer', taskId: data.taskId, answer }));
      });

      // Trigger worker execution
      workerPool.execute(data.taskId, data.payload, (result) => {
        console.log('Task completed:', result);
      });
    }
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
