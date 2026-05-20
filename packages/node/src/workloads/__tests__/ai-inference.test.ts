import { describe, it, expect, vi } from 'vitest';
import { handleAiInference } from '../ai-inference';

// Mock @huggingface/transformers
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(
    vi.fn().mockResolvedValue([{ label: 'POSITIVE', score: 0.99 }])
  )
}));

describe('AI Inference Workload', () => {
  it('should call transformer.js pipeline and return results', async () => {
    const payload = {
      task: 'text-classification',
      model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      input: 'I love this service!',
      options: { quantized: true }
    };

    const result = await handleAiInference(payload);
    
    expect(result.output).toBeDefined();
    expect(result.output[0].label).toBe('POSITIVE');
  });
});
