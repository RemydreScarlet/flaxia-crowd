import type { VectorEmbedPayload, VectorEmbedResult } from '@flaxia/sdk';

let embeddingPipeline: any = null;

export async function handleVectorEmbed(payload: VectorEmbedPayload): Promise<VectorEmbedResult> {
  const startTime = performance.now();

  if (!embeddingPipeline) {
    const { pipeline } = await import('@huggingface/transformers');
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'onnx-community/Qwen3-Embedding-0.6B-ONNX',
      { device: 'wasm' } as any,
    );
  }

  const result = await embeddingPipeline(payload.text, {
    pooling: 'mean',
    normalize: true,
  });

  const vector = Array.from(result.data) as number[];
  const duration = performance.now() - startTime;

  return {
    vector,
    model: 'Qwen/Qwen3-Embedding-0.6B',
    dimensions: 1024,
    durationMs: Math.round(duration),
  };
}
