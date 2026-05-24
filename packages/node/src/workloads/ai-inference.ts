import { pipeline, TextStreamer } from '@huggingface/transformers';
import type { AiInferencePayload, AiInferenceResult } from '@flaxia/sdk';

const SUPPORTED_TASKS = [
  'text-classification', 'token-classification', 'question-answering', 'fill-mask',
  'summarization', 'translation', 'text2text-generation', 'text-generation',
  'zero-shot-classification', 'audio-classification', 'zero-shot-audio-classification',
  'automatic-speech-recognition', 'text-to-audio', 'image-to-text', 'image-classification',
  'image-segmentation', 'background-removal', 'zero-shot-image-classification',
  'object-detection', 'zero-shot-object-detection', 'document-question-answering',
  'image-to-image', 'depth-estimation', 'feature-extraction', 'image-feature-extraction'
] as const;

const pipelineCache = new Map<string, any>();

export const handleAiInference = async (
  payload: AiInferencePayload,
  onToken?: (token: string) => void,
): Promise<AiInferenceResult> => {
  const { task, model, input } = payload;

  if (!SUPPORTED_TASKS.includes(task as any)) {
    throw new Error(`Invalid or unsupported task: ${task}. Supported tasks are: ${SUPPORTED_TASKS.join(', ')}`);
  }

  const cacheKey = `${task}:${model}`;
  let generator = pipelineCache.get(cacheKey);
  if (!generator) {
    generator = await pipeline(task as any, model, { dtype: (payload.options?.dtype as any) || 'q4f16' });
    pipelineCache.set(cacheKey, generator);
  }

  const genOptions: Record<string, unknown> = {
    max_new_tokens: (payload.options?.max_new_tokens as number) || 128,
  };

  if (onToken && generator.tokenizer) {
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        onToken(text);
      },
    });
    genOptions.streamer = streamer;
  }

  const output = await generator(input, genOptions);
  return { output };
};
