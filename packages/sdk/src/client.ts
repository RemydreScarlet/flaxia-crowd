import { TaskPayload, WorkloadType, TaskRecord } from './types';
import { AuthenticationError, FlaxiaError, ValidationError } from './errors';

export interface FlaxiaClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface SubmitTaskOptions {
  workload: WorkloadType;
  payload: TaskPayload;
  callbackUrl?: string;
}

export class FlaxiaClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: FlaxiaClientConfig) {
    if (!config.apiKey) {
      throw new AuthenticationError('API Key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.flaxia.crowd';
  }

  /**
   * Submit a task to Flaxia Crowd
   */
  async submit(options: SubmitTaskOptions): Promise<TaskRecord> {
    if (!options.workload || !options.payload) {
      throw new ValidationError('workload and payload are required');
    }

    const response = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(options),
    });

    if (!response.ok) {
      throw new FlaxiaError(`Failed to submit task: ${response.statusText}`, 'SUBMIT_ERROR', response.status);
    }

    return response.json();
  }

  /**
   * Get task status and results
   */
  async getTask(taskId: string): Promise<TaskRecord> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (response.status === 404) {
      throw new FlaxiaError(`Task not found: ${taskId}`, 'TASK_NOT_FOUND', 404);
    }

    if (!response.ok) {
      throw new FlaxiaError(`Failed to fetch task: ${response.statusText}`, 'FETCH_ERROR', response.status);
    }

    return response.json();
  }

  /**
   * Poll for task completion
   */
  async waitForTask(taskId: string, intervalMs = 2000, timeoutMs = 60000): Promise<TaskRecord> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const task = await this.getTask(taskId);
      if (task.status === 'done' || task.status === 'failed') {
        return task;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new FlaxiaError('Task polling timed out', 'POLLING_TIMEOUT', 408);
  }
}
