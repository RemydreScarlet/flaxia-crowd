import { describe, it, expect, vi } from 'vitest';
import { handleImageProcess } from '../image-process';

// Mock OffscreenCanvas and related APIs if not available in environment
if (typeof OffscreenCanvas === 'undefined') {
  global.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        drawImage: vi.fn(),
        filter: ''
      };
    }
    convertToBlob() {
      return Promise.resolve(new Blob(['mock-data'], { type: 'image/jpeg' }));
    }
  } as any;
}

if (typeof createImageBitmap === 'undefined') {
  global.createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100 });
}

describe('Image Processing Workload', () => {
  it('should process image using OffscreenCanvas', async () => {
    const payload = {
      operation: 'resize' as const,
      imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      mimeType: 'image/png' as const,
      options: { width: 50, height: 50, outputFormat: 'webp' as const }
    };

    const result = await handleImageProcess(payload);
    
    expect(result.imageBase64).toBeDefined();
    expect(result.mimeType).toBe('image/webp');
  });
});
