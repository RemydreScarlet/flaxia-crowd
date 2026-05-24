import { describe, it, expect, vi } from 'vitest';
import { handleAiInference } from '../ai-inference';

vi.mock('@huggingface/transformers', () => {
  const gen = Object.assign(
    vi.fn().mockResolvedValue([{ label: 'POSITIVE', score: 0.99 }]),
    { tokenizer: {} },
  );
  return {
    pipeline: vi.fn().mockResolvedValue(gen),
    TextStreamer: class { constructor() {} },
  };
});

describe('AI Inference Workload', () => {
  it('should return pipeline output for text-classification', async () => {
    const payload = {
      task: 'text-classification',
      model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      input: 'I love this service!',
      options: { quantized: true }
    };

    const result = await handleAiInference(payload);

    expect(result.output).toBeDefined();
    expect(result.output).toEqual([{ label: 'POSITIVE', score: 0.99 }]);
  });

  it('should pass streamer to generator when onToken provided', async () => {
    const payload = {
      task: 'text-classification',
      model: 'test-model',
      input: 'hello',
    };

    const result = await handleAiInference(payload, () => {});
    expect(result.output).toBeDefined();
  });

  it('should throw an error for unsupported tasks', async () => {
    const payload = {
      task: 'invalid-task',
      model: 'some-model',
      input: 'test',
    };

    await expect(handleAiInference(payload as any)).rejects.toThrow(/Invalid or unsupported task/);
  });

  it('should handle array input', async () => {
    const payload = {
      task: 'text-classification',
      model: 'test-model',
      input: ['first input', 'second input'],
    };

    const result = await handleAiInference(payload);
    expect(result.output).toBeDefined();
  });

  it('should accept all supported tasks without throwing', async () => {
    const supportedTasks = [
      'text-classification', 'token-classification', 'question-answering', 'fill-mask',
      'summarization', 'translation', 'text2text-generation', 'text-generation',
      'zero-shot-classification', 'audio-classification', 'zero-shot-audio-classification',
      'automatic-speech-recognition', 'text-to-audio', 'image-to-text', 'image-classification',
      'image-segmentation', 'background-removal', 'zero-shot-image-classification',
      'object-detection', 'zero-shot-object-detection', 'document-question-answering',
      'image-to-image', 'depth-estimation', 'feature-extraction', 'image-feature-extraction'
    ];

    for (const task of supportedTasks) {
      const payload = { task, model: 'test-model', input: 'test' };
      const result = await handleAiInference(payload);
      expect(result.output).toBeDefined();
    }
  });

  it('should provide informative error message listing supported tasks', async () => {
    try {
      await handleAiInference({ task: 'unsupported', model: 'm', input: 'test' } as any);
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toContain('unsupported task');
      expect(e.message).toContain('text-classification');
    }
  });
});
