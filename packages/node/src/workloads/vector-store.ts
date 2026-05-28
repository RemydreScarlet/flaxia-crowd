import type { VectorStorePayload, VectorStoreResult } from '@flaxia/sdk';
import { VectorStoreEngine } from '../vector-store/VectorStoreEngine';

let engine: VectorStoreEngine | null = null;

async function getEngine(): Promise<VectorStoreEngine> {
  if (!engine) {
    engine = new VectorStoreEngine();
    await engine.initialize();
  }
  return engine;
}

export async function handleVectorStore(payload: VectorStorePayload): Promise<VectorStoreResult> {
  const eng = await getEngine();
  return eng.store(payload);
}

export async function handleVectorStoreAssignShard(rangeStart: number, rangeEnd: number): Promise<void> {
  const eng = await getEngine();
  await eng.assignShard(rangeStart, rangeEnd);
}
