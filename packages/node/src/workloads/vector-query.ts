import type { VectorQueryPayload, VectorQueryResult } from '@flaxia/sdk';
import { VectorStoreEngine } from '../vector-store/VectorStoreEngine';

let engine: VectorStoreEngine | null = null;

async function getEngine(): Promise<VectorStoreEngine> {
  if (!engine) {
    engine = new VectorStoreEngine();
    await engine.initialize();
  }
  return engine;
}

export async function handleVectorQuery(payload: VectorQueryPayload): Promise<VectorQueryResult> {
  const eng = await getEngine();
  return eng.query(payload);
}
