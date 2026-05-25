/**
 * Shared Type Definitions for Flaxia Crowd
 */

export type TaskStatus = 'pending' | 'assigning' | 'processing' | 'done' | 'failed';

export type WorkloadType = 'ai-inference' | 'image-process' | 'file-convert' | 'container';

// --- AI Inference ---

export interface AiInferenceOptions {
  /** Quantization dtype: 'q4f16' (default) | 'q8' | 'fp32' | 'q4' */
  dtype?: string;
  /** Execution device: 'wasm' (default) | 'webgpu' | 'cpu' */
  device?: string;
  /** Maximum number of tokens to generate (default: 128) */
  max_new_tokens?: number;
  /** Whether to sample (default: false = greedy decoding, faster) */
  do_sample?: boolean;
  /** Temperature for sampling (requires do_sample: true) */
  temperature?: number;
  /** Top-p nucleus sampling threshold */
  top_p?: number;
  /** Top-k sampling */
  top_k?: number;
  /** Repetition penalty */
  repetition_penalty?: number;
  /** Buffer tokens and flush in batches (reduces network overhead, default: false) */
  tokenBuffer?: boolean;
  /** Token buffer flush interval in ms (default: 50) */
  tokenBufferIntervalMs?: number;
}

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
  /** pipeline() and generation options */
  options?: AiInferenceOptions;
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

// --- Linux Container (container2wasm) ---

export interface ContainerPayload {
  /** Name of the WASM image to load (e.g. 'alpine-magick.wasm') */
  image: string;
  /** Command and arguments to run (e.g. ['magick', 'input.jpg', '-resize', '50%', 'output.jpg']) */
  command: string[];
  /** Input files to mount into the container (Map of filename -> base64 content) */
  files: Record<string, string>;
  /** Optional memory limit for the WASM runtime (in MB) */
  memoryLimitMb?: number;
}

export interface ContainerResult {
  /** Output files from the container (Map of filename -> base64 content) */
  files: Record<string, string>;
  /** Standard output from the command */
  stdout: string;
  /** Standard error from the command */
  stderr: string;
  /** Exit code of the process */
  exitCode: number;
}

// --- Core Task Types ---

export type TaskPayload = AiInferencePayload | ImageProcessPayload | FileConvertPayload | ContainerPayload;

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
