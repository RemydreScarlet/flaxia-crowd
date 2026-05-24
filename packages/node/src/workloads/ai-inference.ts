import { pipeline } from '@huggingface/transformers';
import type { AiInferencePayload, AiInferenceResult } from '@flaxia/sdk';

// Support list based on Transformers.js
const SUPPORTED_TASKS = [
  'text-classification', 'token-classification', 'question-answering', 'fill-mask',
  'summarization', 'translation', 'text2text-generation', 'text-generation',
  'zero-shot-classification', 'audio-classification', 'zero-shot-audio-classification',
  'automatic-speech-recognition', 'text-to-audio', 'image-to-text', 'image-classification',
  'image-segmentation', 'background-removal', 'zero-shot-image-classification',
  'object-detection', 'zero-shot-object-detection', 'document-question-answering',
  'image-to-image', 'depth-estimation', 'feature-extraction', 'image-feature-extraction'
] as const;

// Cache pipelines to avoid reloading models for each task
const pipelineCache = new Map<string, any>();

export const handleAiInference = async (payload: AiInferencePayload): Promise<AiInferenceResult> => {
  const { task, model, input } = payload;

  if (!SUPPORTED_TASKS.includes(task as any)) {
    throw new Error(`Invalid or unsupported task: ${task}. Supported tasks are: ${SUPPORTED_TASKS.join(', ')}`);
  }

  // Temporary bypass for model loading: return dummy response
  console.log(`[Dummy] Returning mock response for task: ${task}, model: ${model}`);
  return { 
    output: [{ generated_text: `Dummy! Input was: ${input}` }] 
  };
};
