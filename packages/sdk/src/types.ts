/**
 * Shared Type Definitions for Flaxia Crowd
 */

export type TaskStatus = 'pending' | 'assigning' | 'processing' | 'done' | 'failed';

export type WorkloadType = 'ai-inference' | 'image-process' | 'file-convert';

// --- AI Inference ---

export interface AiInferencePayload {
  /**
   * Transformer.js pipeline task name (e.g. 'text-classification')
   */
  task: string;
  /**
   * HuggingFace model name (e.g. 'Xenova/distilbert-base-uncased-finetuned-sst-2-english')
   */
  model: string;
  /** Text input (single or array) */
  input: string | string[];
  /** pipeline() options */
  options?: Record<string, unknown>;
}

export interface AiInferenceResult {
  output: unknown;
}

// --- Image Processing ---

export interface ImageProcessPayload {
  operation: 'resize' | 'grayscale' | 'compress' | 'thumbnail';
  /** Base64 encoded image data */
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  options: {
    width?: number;
    height?: number;
    quality?: number;
    outputFormat?: 'jpeg' | 'png' | 'webp';
  };
}

export interface ImageProcessResult {
  imageBase64: string;
  mimeType: string;
  originalSizeBytes: number;
  resultSizeBytes: number;
}

// --- File Conversion (Phase 2) ---

export interface FileConvertPayload {
  operation: 'pdf-to-text' | 'markdown-to-html';
  fileBase64: string;
  mimeType: string;
  options?: Record<string, unknown>;
}

// --- Core Task Types ---

export type TaskPayload = AiInferencePayload | ImageProcessPayload | FileConvertPayload | unknown;

export interface TaskRecord {
  id: string;
  status: TaskStatus;
  workload: WorkloadType;
  payload: TaskPayload;
  createdAt: number;
  assignedAt?: number;
  completedAt?: number;
  assignedNodeId?: string;
  retryCount: number;
  timeoutMs: number;
  callbackUrl?: string;
  result?: unknown;
  error?: string;
}

// --- Node Types ---

export interface NodeConfig {
  orchestratorUrl: string;
  siteId: string;
  consent: {
    brandName: string;
    position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    accentColor?: string;
  };
  maxCpuLoad?: number;
}
