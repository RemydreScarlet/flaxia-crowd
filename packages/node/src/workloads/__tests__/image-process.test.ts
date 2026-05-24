import { describe, it, expect, vi } from 'vitest';
import { handleImageProcess } from '../image-process';

const mockConvertToBlob = vi.fn();

if (typeof OffscreenCanvas === 'undefined') {
  global.OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        drawImage: vi.fn(),
        filter: ''
      };
    }
    convertToBlob(...args: any[]) {
      mockConvertToBlob(...args);
      return Promise.resolve(new Blob(['mock-data'], { type: 'image/jpeg' }));
    }
  } as any;
}

if (typeof createImageBitmap === 'undefined') {
  global.createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100 });
}

const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Image Processing Workload', () => {
  beforeEach(() => {
    mockConvertToBlob.mockClear();
  });

  it('should process resize operation', async () => {
    const result = await handleImageProcess({
      operation: 'resize',
      imageBase64: sampleBase64,
      mimeType: 'image/png',
      options: { width: 50, height: 50, outputFormat: 'webp' }
    });

    expect(result.imageBase64).toBeDefined();
    expect(result.mimeType).toBe('image/webp');
    expect(result.originalSizeBytes).toBeGreaterThan(0);
    expect(result.resultSizeBytes).toBeGreaterThan(0);
  });

  it('should process grayscale operation', async () => {
    const result = await handleImageProcess({
      operation: 'grayscale',
      imageBase64: sampleBase64,
      mimeType: 'image/jpeg',
      options: { outputFormat: 'jpeg' }
    });

    expect(result.imageBase64).toBeDefined();
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('should process compress operation', async () => {
    const result = await handleImageProcess({
      operation: 'compress',
      imageBase64: sampleBase64,
      mimeType: 'image/png',
      options: { quality: 0.5 }
    });

    expect(result.imageBase64).toBeDefined();
  });

  it('should process thumbnail operation', async () => {
    const result = await handleImageProcess({
      operation: 'thumbnail',
      imageBase64: sampleBase64,
      mimeType: 'image/jpeg',
      options: { width: 150, height: 150, outputFormat: 'jpeg' }
    });

    expect(result.imageBase64).toBeDefined();
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('should default to input mimeType when outputFormat not specified', async () => {
    const result = await handleImageProcess({
      operation: 'resize',
      imageBase64: sampleBase64,
      mimeType: 'image/png',
      options: { width: 50, height: 50 }
    });

    expect(result.mimeType).toBe('image/png');
  });

  it('should pass quality option to convertToBlob', async () => {
    await handleImageProcess({
      operation: 'compress',
      imageBase64: sampleBase64,
      mimeType: 'image/jpeg',
      options: { quality: 0.3 }
    });

    expect(mockConvertToBlob).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image/jpeg', quality: 0.3 })
    );
  });
});
