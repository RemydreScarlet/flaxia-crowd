import type { TaskPayload, WorkloadType, TaskRecord } from './types';
import { AuthenticationError, FlaxiaError, TaskNotFoundError, ValidationError } from './errors';

export interface FlaxiaClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface SubmitTaskOptions {
  workload: WorkloadType;
  payload: TaskPayload;
  callbackUrl?: string;
}

export interface TaskSubscription {
  onToken: (callback: (token: string) => void) => void;
  onDone: (callback: (result: unknown) => void) => void;
  onError: (callback: (error: string) => void) => void;
  close: () => void;
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
      throw new FlaxiaError(response.statusText || 'Failed to submit task', 'SUBMIT_ERROR', response.status);
    }

    return response.json() as Promise<TaskRecord>;
  }

  async getTask(taskId: string): Promise<TaskRecord> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (response.status === 404) {
      throw new TaskNotFoundError(taskId);
    }

    if (!response.ok) {
      throw new FlaxiaError(response.statusText || 'Failed to fetch task', 'FETCH_ERROR', response.status);
    }

    return response.json() as Promise<TaskRecord>;
  }

  async waitForTask(taskId: string, intervalMs = 2000, timeoutMs = 60000): Promise<TaskRecord> {
    const start = Date.now();

    const ws = await Promise.race([
      this.subscribe(taskId).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), intervalMs)),
    ]);

    if (ws) {
      return await Promise.race([
        this.pollUntilDone(taskId, intervalMs, timeoutMs, start),
        new Promise<TaskRecord>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('fallback'));
          }, timeoutMs - (Date.now() - start));

          const finish = async () => {
            clearTimeout(timer);
            ws.close();
            try { resolve(await this.getTask(taskId)); } catch { reject(); }
          };

          ws.onDone(finish);
          ws.onError(finish);
        }),
      ]);
    }

    return this.pollUntilDone(taskId, intervalMs, timeoutMs, start);
  }

  private async pollUntilDone(
    taskId: string, intervalMs: number, timeoutMs: number, start: number
  ): Promise<TaskRecord> {
    while (Date.now() - start < timeoutMs) {
      const task = await this.getTask(taskId);
      if (task.status === 'done' || task.status === 'failed') return task;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new FlaxiaError('Task polling timed out', 'POLLING_TIMEOUT', 408);
  }

  async subscribe(taskId: string): Promise<TaskSubscription> {
    const wsBase = this.baseUrl.replace('http', 'ws');
    const ws = new WebSocket(`${wsBase}/crowd/subscribe?taskId=${taskId}`);

    let tokenCallback: ((token: string) => void) | null = null;
    let doneCallback: ((result: unknown) => void) | null = null;
    let errorCallback: ((error: string) => void) | null = null;

    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        resolve({
          onToken: (cb) => { tokenCallback = cb; },
          onDone: (cb) => { doneCallback = cb; },
          onError: (cb) => { errorCallback = cb; },
          close: () => { ws.close(); },
        });
      };

      ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === 'token' && tokenCallback) {
            tokenCallback(msg.token);
          } else if (msg.type === 'done' && doneCallback) {
            doneCallback(msg.result);
          } else if (msg.type === 'error' && errorCallback) {
            errorCallback(msg.error);
          }
        } catch {}
      };

      ws.onerror = () => {
        reject(new FlaxiaError('WebSocket connection failed', 'WS_CONNECT_ERROR', 0));
      };
    });
  }
}
