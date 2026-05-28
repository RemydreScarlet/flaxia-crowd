import type { VectorStorePayload, VectorStoreResult, VectorQueryPayload, VectorQueryResult } from '@flaxia/sdk';
import { HNSWIndex, type NodeExport } from './HNSWIndex';

function openDB(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getStore(db: IDBDatabase, name: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
  const tx = db.transaction(name, mode);
  return tx.objectStore(name);
}

function getRecord<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = getStore(db, storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function putRecord(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = getStore(db, storeName, 'readwrite').put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getAllRecords<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = getStore(db, storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

interface ShardInfo {
  key: string;
  rangeStart: number;
  rangeEnd: number;
  nodeId: string;
  assignedAt: number;
}

interface VectorRecord {
  docId: string;
  vector: Float32Array;
  metadata: { title: string; url: string; snippet: string; [key: string]: unknown };
  shardKey: string;
  storedAt: number;
}

interface HNSWGraphRecord {
  nodeId: number;
  docId: string;
  level: number;
  neighbors: Record<number, number[]>;
}

export class VectorStoreEngine {
  private db: IDBDatabase | null = null;
  private hnsw: HNSWIndex | null = null;
  private shardInfo: { rangeStart: number; rangeEnd: number } | null = null;
  private saveCounter = 0;

  async initialize(): Promise<void> {
    this.db = await openDB('flaxia-vector-store', 1, (db) => {
      if (!db.objectStoreNames.contains('vectors')) {
        db.createObjectStore('vectors', { keyPath: 'docId' });
      }
      if (!db.objectStoreNames.contains('hnsw-graph')) {
        db.createObjectStore('hnsw-graph', { keyPath: 'nodeId' });
      }
      if (!db.objectStoreNames.contains('shard-info')) {
        db.createObjectStore('shard-info', { keyPath: 'key' });
      }
    });

    this.hnsw = new HNSWIndex(1024, 'cosine', 16, 200);
    await this.loadGraphFromDB();

    const shardInfo = await getRecord<ShardInfo>(this.db, 'shard-info', 'shard_range');
    if (shardInfo) {
      this.shardInfo = { rangeStart: shardInfo.rangeStart, rangeEnd: shardInfo.rangeEnd };
    }
  }

  async assignShard(rangeStart: number, rangeEnd: number): Promise<void> {
    this.shardInfo = { rangeStart, rangeEnd };
    await putRecord(this.db!, 'shard-info', {
      key: 'shard_range',
      rangeStart,
      rangeEnd,
      nodeId: '',
      assignedAt: Date.now(),
    });
  }

  async store(payload: VectorStorePayload): Promise<VectorStoreResult> {
    if (!this.shardInfo) throw new Error('No shard assigned');

    const shardKey = parseInt(payload.shardKey, 10);
    if (shardKey < this.shardInfo.rangeStart || shardKey > this.shardInfo.rangeEnd) {
      throw new Error(`Shard key ${shardKey} out of range`);
    }

    await putRecord(this.db!, 'vectors', {
      docId: payload.docId,
      vector: new Float32Array(payload.vector),
      metadata: payload.metadata,
      shardKey: payload.shardKey,
      storedAt: Date.now(),
    });

    this.hnsw!.insert(payload.docId, new Float32Array(payload.vector));
    this.saveCounter++;
    if (this.saveCounter % 100 === 0) {
      await this.saveGraphSnapshot();
    }

    return {
      stored: true,
      nodeId: '',
      totalVectors: this.hnsw!.size(),
    };
  }

  async query(payload: VectorQueryPayload): Promise<VectorQueryResult> {
    if (!this.hnsw) throw new Error('HNSW not initialized');

    const startTime = performance.now();
    const queryVec = new Float32Array(payload.queryVector);
    const neighbors = this.hnsw.search(queryVec, payload.topK);

    const results = neighbors.map(n => ({
      docId: n.docId,
      score: 1 - n.distance,
      metadata: n.metadata as { title: string; url: string; snippet: string } || { title: '', url: '', snippet: '' },
    }));

    return {
      results,
      nodeId: '',
      searchDurationMs: Math.round(performance.now() - startTime),
    };
  }

  async getVector(docId: string): Promise<VectorRecord | undefined> {
    return getRecord<VectorRecord>(this.db!, 'vectors', docId);
  }

  async deleteVector(docId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = getStore(this.db!, 'vectors', 'readwrite').delete(docId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  getVectorCount(): number {
    return this.hnsw?.size() || 0;
  }

  private async loadGraphFromDB(): Promise<void> {
    const records = await getAllRecords<HNSWGraphRecord>(this.db!, 'hnsw-graph');
    if (records.length === 0) return;

    const vectors = new Map<number, Float32Array>();
    const nodeExports: NodeExport[] = [];
    for (const rec of records) {
      const vecRecord = await getRecord<VectorRecord>(this.db!, 'vectors', rec.docId);
      if (vecRecord) {
        vectors.set(rec.nodeId, vecRecord.vector);
      }
      nodeExports.push({
        id: rec.nodeId,
        docId: rec.docId,
        level: rec.level,
        neighbors: rec.neighbors,
      });
    }

    this.hnsw!.importNodes(nodeExports, vectors);
  }

  private async saveGraphSnapshot(): Promise<void> {
    const nodes = this.hnsw!.exportNodes();
    for (const [nodeId, data] of nodes) {
      await putRecord(this.db!, 'hnsw-graph', {
        nodeId,
        docId: data.docId,
        level: data.level,
        neighbors: data.neighbors,
      });
    }
  }
}
