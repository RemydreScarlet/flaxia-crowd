import { pipeline } from '@huggingface/transformers';
import type { AiInferencePayload, AiInferenceResult } from '@flaxia/sdk';

// Cache pipelines to avoid reloading models for each task
const pipelineCache = new Map<string, any>();

export const handleAiInference = async (payload: AiInferencePayload): Promise<AiInferenceResult> => {
  const { task, model, input, options = {} } = payload;
  const cacheKey = `${task}:${model}`;

  try {
    let pipe = pipelineCache.get(cacheKey);

    if (!pipe) {
      console.log(`Loading model: ${model} for task: ${task}...`);
      pipe = await pipeline(task as any, model, {
        // Default to quantized for browser nodes to save bandwidth/memory
        // as per docs/04-types.md
        ...options,
      });
      pipelineCache.set(cacheKey, pipe);
    }

    const output = await pipe(input, options);
    
    return { output };
  } catch (error) {
    console.error(`AI Inference error (${task}, ${model}):`, error);
    throw error;
  }
};
