import type { WorkloadType } from '@flaxia/sdk';

self.onmessage = async (e: MessageEvent) => {
  const { id, workload, payload } = e.data;

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
      default:
        throw new Error(`Unknown workload type: ${workload}`);
    }

    self.postMessage({ id, type: 'done', result });
  } catch (err) {
    self.postMessage({ id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
