import { ConsentUI } from '../consent/ConsentUI';
import { WebRTCPeer } from './WebRTCPeer';
import { WorkerPool } from '../executor/WorkerPool';

export const initFlaxiaNode = (config: { orchestratorUrl: string }) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const workerPool = new WorkerPool();

  new ConsentUI(container, () => {
    console.log('Consent granted, connecting to signaling...');
    
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
          // In a real WebRTC app, we'd send this over the RTC DataChannel
        });
      }
    };
  });
};
