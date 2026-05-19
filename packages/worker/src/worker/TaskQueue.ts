import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";

export type TaskStatus = 'pending' | 'assigning' | 'processing' | 'done' | 'failed';
export type WorkloadType = 'ai-inference' | 'image-process' | 'file-convert';

export interface TaskRecord {
  id: string;
  status: TaskStatus;
  workload: WorkloadType;
  payload: unknown;
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

export class TaskQueue extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async enqueue(task: TaskRecord): Promise<void> {
    await this.ctx.storage.put(`task:${task.id}`, task);
    const pending = (await this.ctx.storage.get<string[]>("queue:pending")) || [];
    pending.push(task.id);
    await this.ctx.storage.put("queue:pending", pending);
    
    await this.ctx.storage.setAlarm(Date.now() + task.timeoutMs);
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    return await this.ctx.storage.get<TaskRecord>(`task:${taskId}`);
  }

  async getPending(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>("queue:pending")) || [];
  }

  async alarm(): Promise<void> {
    await this.checkTimeouts();
  }

  private async checkTimeouts(): Promise<void> {
    console.log("Checking timeouts...");
  }
}
