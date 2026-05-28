interface HNSWNode {
  id: number;
  docId: string;
  vector: Float32Array;
  level: number;
  neighbors: Map<number, number[]>;
}

interface Candidate {
  nodeId: number;
  distance: number;
}

export interface SearchResult {
  docId: string;
  distance: number;
  metadata?: Record<string, unknown>;
}

export interface NodeExport {
  id: number;
  docId: string;
  level: number;
  neighbors: Record<number, number[]>;
}

export class HNSWIndex {
  private nodes: Map<number, HNSWNode> = new Map();
  private docIdMap: Map<string, number> = new Map();
  private enterPoint: number | null = null;
  private nextNodeId = 0;
  private maxLevel = 0;

  constructor(
    private dimensions: number,
    private metric: 'cosine' | 'l2' = 'cosine',
    private M: number = 16,
    private efConstruction: number = 200,
  ) {}

  insert(docId: string, vector: Float32Array): void {
    const nodeId = this.nextNodeId++;
    const level = this.randomLevel();
    const node: HNSWNode = {
      id: nodeId,
      docId,
      vector,
      level,
      neighbors: new Map(),
    };

    this.nodes.set(nodeId, node);
    this.docIdMap.set(docId, nodeId);

    if (this.enterPoint === null) {
      this.enterPoint = nodeId;
      this.maxLevel = level;
      return;
    }

    let currNode = this.nodes.get(this.enterPoint)!;
    let currDist = this.distance(vector, currNode.vector);

    for (let l = this.maxLevel; l > level; l--) {
      let changed = true;
      while (changed) {
        changed = false;
        const neighbors = currNode.neighbors.get(l) || [];
        for (const nId of neighbors) {
          const nNode = this.nodes.get(nId);
          if (!nNode) continue;
          const d = this.distance(vector, nNode.vector);
          if (d < currDist) {
            currDist = d;
            currNode = nNode;
            changed = true;
          }
        }
      }
    }

    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const candidates = this.searchLayer(vector, currNode, l, this.efConstruction);
      const selected = this.selectNeighbors(candidates, this.M);

      const neighbors = currNode.neighbors.get(l) || [];
      for (const s of selected) {
        if (!neighbors.includes(s.nodeId)) {
          neighbors.push(s.nodeId);
        }
      }
      currNode.neighbors.set(l, neighbors);

      for (const s of selected) {
        const sNode = this.nodes.get(s.nodeId);
        if (sNode) {
          const sNeighbors = sNode.neighbors.get(l) || [];
          if (!sNeighbors.includes(nodeId)) {
            sNeighbors.push(nodeId);
          }
          sNode.neighbors.set(l, sNeighbors.slice(-this.M));
        }
      }
    }

    if (level > this.maxLevel) {
      this.enterPoint = nodeId;
      this.maxLevel = level;
    }
  }

  search(query: Float32Array, k: number): SearchResult[] {
    if (this.nodes.size === 0 || this.enterPoint === null) return [];

    let currNode = this.nodes.get(this.enterPoint)!;
    let currDist = this.distance(query, currNode.vector);

    for (let l = this.maxLevel; l > 0; l--) {
      let changed = true;
      while (changed) {
        changed = false;
        const neighbors = currNode.neighbors.get(l) || [];
        for (const nId of neighbors) {
          const nNode = this.nodes.get(nId);
          if (!nNode) continue;
          const d = this.distance(query, nNode.vector);
          if (d < currDist) {
            currDist = d;
            currNode = nNode;
            changed = true;
          }
        }
      }
    }

    const candidates = this.searchLayer(query, currNode, 0, k);
    return candidates
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k)
      .map(c => ({
        docId: this.nodes.get(c.nodeId)!.docId,
        distance: c.distance,
        metadata: {},
      }));
  }

  private searchLayer(
    query: Float32Array,
    entry: HNSWNode,
    level: number,
    ef: number,
  ): Candidate[] {
    const visited = new Set<number>([entry.id]);
    const candidates: Candidate[] = [{ nodeId: entry.id, distance: this.distance(query, entry.vector) }];
    const result: Candidate[] = [...candidates];
    const distMap = new Map<number, number>();
    distMap.set(entry.id, candidates[0].distance);

    while (candidates.length > 0) {
      let nearestIdx = 0;
      for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].distance < candidates[nearestIdx].distance) {
          nearestIdx = i;
        }
      }
      const nearest = candidates[nearestIdx];

      const farthestDist = result.length > 0
        ? Math.max(...result.map(r => r.distance))
        : Infinity;

      if (nearest.distance > farthestDist && result.length >= ef) break;

      candidates.splice(nearestIdx, 1);
      const node = this.nodes.get(nearest.nodeId);
      if (!node) continue;

      const neighbors = node.neighbors.get(level) || [];
      for (const nId of neighbors) {
        if (visited.has(nId)) continue;
        visited.add(nId);
        const nNode = this.nodes.get(nId);
        if (!nNode) continue;
        const d = this.distance(query, nNode.vector);
        distMap.set(nId, d);

        const farthestInResult = result.length > 0
          ? Math.max(...result.map(r => r.distance))
          : Infinity;

        if (result.length < ef || d < farthestInResult) {
          candidates.push({ nodeId: nId, distance: d });
          result.push({ nodeId: nId, distance: d });

          if (result.length > ef) {
            result.sort((a, b) => b.distance - a.distance);
            result.pop();
          }
        }
      }
    }

    result.sort((a, b) => a.distance - b.distance);
    return result.slice(0, ef);
  }

  private selectNeighbors(candidates: Candidate[], M: number): Candidate[] {
    return candidates.sort((a, b) => a.distance - b.distance).slice(0, M);
  }

  private distance(a: Float32Array, b: Float32Array): number {
    if (this.metric === 'cosine') {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      return denom === 0 ? 1 : 1 - dot / denom;
    }
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
  }

  private randomLevel(): number {
    let level = 0;
    while (Math.random() < 0.5 && level < 16) level++;
    return level;
  }

  size(): number { return this.nodes.size; }

  exportNodes(): Map<number, NodeExport> {
    const exported = new Map<number, NodeExport>();
    for (const [id, node] of this.nodes) {
      const neighbors: Record<number, number[]> = {};
      for (const [level, nIds] of node.neighbors) {
        neighbors[level] = nIds;
      }
      exported.set(id, {
        id: node.id,
        docId: node.docId,
        level: node.level,
        neighbors,
      });
    }
    return exported;
  }

  importNodes(exported: NodeExport[], vectors: Map<number, Float32Array>): void {
    for (const data of exported) {
      const neighbors = new Map<number, number[]>();
      for (const [level, nIds] of Object.entries(data.neighbors)) {
        neighbors.set(Number(level), nIds);
      }
      const node: HNSWNode = {
        id: data.id,
        docId: data.docId,
        vector: vectors.get(data.id) || new Float32Array(this.dimensions),
        level: data.level,
        neighbors,
      };
      this.nodes.set(data.id, node);
      this.docIdMap.set(data.docId, data.id);
      if (data.id >= this.nextNodeId) this.nextNodeId = data.id + 1;
      if (data.level > this.maxLevel) this.maxLevel = data.level;
    }
    if (this.nodes.size > 0 && this.enterPoint === null) {
      this.enterPoint = this.nodes.keys().next().value!;
    }
  }
}
