import { env, pipeline, TextStreamer } from '@huggingface/transformers';
import type { AiInferencePayload, AiInferenceResult, AiInferenceOptions } from '@flaxia/sdk';

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

const createBufferedTokenCallback = (
  onToken: (token: string) => void,
  options: AiInferenceOptions,
): ((text: string) => void) => {
  if (!options.tokenBuffer) return onToken;

  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const interval = options.tokenBufferIntervalMs ?? 50;

  const flush = () => {
    if (buffer) {
      onToken(buffer);
      buffer = '';
    }
    timer = null;
  };

  return (text: string) => {
    buffer += text;
    if (!timer) {
      timer = setTimeout(flush, interval);
    }
  };
};

export const handleAiInference = async (
  payload: AiInferencePayload,
  onToken?: (token: string) => void,
): Promise<AiInferenceResult> => {
  const { task, model, input, options = {} } = payload;

  if (!SUPPORTED_TASKS.includes(task as any)) {
    throw new Error(`Invalid or unsupported task: ${task}. Supported tasks are: ${SUPPORTED_TASKS.join(', ')}`);
  }

  if (self.crossOriginIsolated) {
    const numThreads = options.numThreads ?? navigator.hardwareConcurrency;
    if (env.backends.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(numThreads, navigator.hardwareConcurrency || 4));
    }
  }

  const cacheKey = `${task}:${model}`;
  let generator = pipelineCache.get(cacheKey);
  if (!generator) {
    const pipelineOpts: Record<string, unknown> = {
      dtype: options.dtype ?? 'q4f16',
      device: options.device,
    };
    try {
      generator = await pipeline(task as any, model, pipelineOpts);
    } catch (err) {
      if (options.device && options.device !== 'wasm') {
        console.warn(`[AiInference] ${options.device} failed, falling back to wasm:`, err);
        pipelineOpts.device = 'wasm';
        generator = await pipeline(task as any, model, pipelineOpts);
      } else {
        throw err;
      }
    }
    pipelineCache.set(cacheKey, generator);
  }

  const genOptions: Record<string, unknown> = {
    max_new_tokens: options.max_new_tokens ?? 128,
    do_sample: options.do_sample ?? false,
  };

  if (options.temperature != null) genOptions.temperature = options.temperature;
  if (options.top_p != null) genOptions.top_p = options.top_p;
  if (options.top_k != null) genOptions.top_k = options.top_k;
  if (options.repetition_penalty != null) genOptions.repetition_penalty = options.repetition_penalty;

  if (onToken && generator.tokenizer) {
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: createBufferedTokenCallback(onToken, options),
    });
    genOptions.streamer = streamer;
  }

  const output = await generator(input, genOptions);
  return { output };
};
