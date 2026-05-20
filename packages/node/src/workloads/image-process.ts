import type { ImageProcessPayload, ImageProcessResult } from '@flaxia/sdk';

export const handleImageProcess = async (payload: ImageProcessPayload): Promise<ImageProcessResult> => {
  const { operation, imageBase64, mimeType, options } = payload;

  // Convert Base64 to ImageBitmap
  const response = await fetch(`data:${mimeType};base64,${imageBase64}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(
    options.width || bitmap.width,
    options.height || bitmap.height
  );
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get OffscreenCanvas context');
  }

  // Handle operations
  if (operation === 'grayscale') {
    ctx.filter = 'grayscale(100%)';
  }

  // Draw image (handles resize if canvas size differs from bitmap)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  // Convert back to Base64
  const outputFormat = options.outputFormat || (mimeType.split('/')[1] as any);
  const outputMimeType = `image/${outputFormat}`;
  
  const outputBlob = await canvas.convertToBlob({
    type: outputMimeType,
    quality: options.quality || 0.8
  });

  const reader = new FileReader();
  const resultBase64 = await new Promise<string>((resolve, reject) => {
    reader.onloadend = () => {
      const base64data = (reader.result as string).split(',')[1];
      resolve(base64data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(outputBlob);
  });

  return {
    imageBase64: resultBase64,
    mimeType: outputMimeType,
    originalSizeBytes: blob.size,
    resultSizeBytes: outputBlob.size
  };
};
