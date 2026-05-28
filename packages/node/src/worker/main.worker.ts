import type { WorkloadType } from '@flaxia/sdk';

self.onmessage = async (e: MessageEvent) => {
  const { id, workload, payload } = e.data;

  const heartbeat = setInterval(() => {
    self.postMessage({ id, type: 'heartbeat' });
  }, 10000);

  try {
    let result;
    const emitToken = (token: string) => {
      self.postMessage({ id, type: 'token', token });
    };
    switch (workload as WorkloadType) {
      case 'ai-inference':
        const { handleAiInference } = await import('../workloads/ai-inference');
        result = await handleAiInference(payload, emitToken);
        break;
      case 'image-process':
        const { handleImageProcess } = await import('../workloads/image-process');
        result = await handleImageProcess(payload);
        break;
      case 'container':
        const { handleContainer } = await import('../workloads/container');
        result = await handleContainer(payload);
        break;
      case 'web-crawl':
        const { handleWebCrawl } = await import('../workloads/web-crawl');
        result = await handleWebCrawl(payload);
        break;
      case 'vector-embed':
        const { handleVectorEmbed } = await import('../workloads/vector-embed');
        result = await handleVectorEmbed(payload);
        break;
      case 'vector-store':
        const { handleVectorStore } = await import('../workloads/vector-store');
        result = await handleVectorStore(payload);
        break;
      case 'vector-query':
        const { handleVectorQuery } = await import('../workloads/vector-query');
        result = await handleVectorQuery(payload);
        break;
      default:
        throw new Error(`Unknown workload type: ${workload}`);
    }

    clearInterval(heartbeat);
    self.postMessage({ id, type: 'done', result });
  } catch (err) {
    clearInterval(heartbeat);
    self.postMessage({ id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
