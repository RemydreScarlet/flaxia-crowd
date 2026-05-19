export const initFlaxiaNode = (config: { orchestratorUrl: string }) => {
  console.log('Initializing Flaxia Node with:', config.orchestratorUrl);
  
  const ws = new WebSocket(`${config.orchestratorUrl.replace('http', 'ws')}/crowd/signal`);
  
  ws.onopen = () => {
    console.log('Connected to signaling server');
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);
  };
};
