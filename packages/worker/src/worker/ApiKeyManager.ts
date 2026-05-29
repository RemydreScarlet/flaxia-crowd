import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";

export type ApiKeyStatus = 'active' | 'revoked';

export interface ApiKeyMeta {
  id: string;
  name: string;
  prefix: string;
  status: ApiKeyStatus;
  createdAt: number;
  lastUsedAt: number | null;
  scopes: string[];
}

interface StoredKey {
  id: string;
  name: string;
  prefix: string;
  keyHash: string;
  status: ApiKeyStatus;
  createdAt: number;
  lastUsedAt: number | null;
  scopes: string[];
}

const KEY_PREFIX = 'fc_live_';
const HASH_PREFIX = 'key:hash:';
const META_PREFIX = 'key:meta:';
const ALL_KEYS = 'keys:all';

async function sha256(message: string): Promise<string> {
  const enc = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateApiKey(): { key: string; prefix: string } {
  const token = crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '') +
    crypto.randomUUID().replace(/-/g, '');
  const key = KEY_PREFIX + token;
  const prefix = key.substring(0, 16);
  return { key, prefix };
}

export class ApiKeyManager extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/create") {
      const { name, scopes } = await request.json() as { name: string; scopes?: string[] };
      const { key, id, meta } = await this.createKey(name, scopes);
      return Response.json({ key, id, name: meta.name, scopes: meta.scopes, createdAt: meta.createdAt });
    }

    if (url.pathname === "/validate") {
      const { token } = await request.json() as { token: string };
      const result = await this.validateKey(token);
      return Response.json(result);
    }

    if (url.pathname === "/list") {
      const keys = await this.listKeys();
      return Response.json({ keys });
    }

    if (url.pathname.startsWith("/revoke/")) {
      const id = url.pathname.slice("/revoke/".length);
      await this.revokeKey(id);
      return new Response("OK");
    }

    if (url.pathname.startsWith("/key/")) {
      const id = url.pathname.slice("/key/".length);
      const meta = await this.getKeyMeta(id);
      if (!meta) return new Response("Not found", { status: 404 });
      return Response.json(meta);
    }

    return new Response("Not found", { status: 404 });
  }

  async createKey(name: string, scopes?: string[]): Promise<{ key: string; id: string; meta: ApiKeyMeta }> {
    const { key, prefix } = generateApiKey();
    const keyHash = await sha256(key);
    const id = crypto.randomUUID();

    const stored: StoredKey = {
      id,
      name,
      prefix,
      keyHash,
      status: 'active',
      createdAt: Date.now(),
      lastUsedAt: null,
      scopes: scopes || ['*'],
    };

    await this.ctx.storage.put(HASH_PREFIX + keyHash, stored);
    await this.ctx.storage.put(META_PREFIX + id, stored);

    const allIds = await this.ctx.storage.get<string[]>(ALL_KEYS) || [];
    allIds.push(id);
    await this.ctx.storage.put(ALL_KEYS, allIds);

    const meta: ApiKeyMeta = {
      id, name, prefix, status: 'active',
      createdAt: stored.createdAt, lastUsedAt: null,
      scopes: stored.scopes,
    };

    return { key, id, meta };
  }

  async validateKey(token: string): Promise<{ valid: boolean; meta?: ApiKeyMeta }> {
    const keyHash = await sha256(token);
    const stored = await this.ctx.storage.get<StoredKey>(HASH_PREFIX + keyHash);
    if (!stored || stored.status !== 'active') {
      return { valid: false };
    }

    stored.lastUsedAt = Date.now();
    await this.ctx.storage.put(HASH_PREFIX + keyHash, stored);
    await this.ctx.storage.put(META_PREFIX + stored.id, stored);

    return {
      valid: true,
      meta: {
        id: stored.id,
        name: stored.name,
        prefix: stored.prefix,
        status: stored.status,
        createdAt: stored.createdAt,
        lastUsedAt: stored.lastUsedAt,
        scopes: stored.scopes,
      },
    };
  }

  async revokeKey(id: string): Promise<void> {
    const stored = await this.ctx.storage.get<StoredKey>(META_PREFIX + id);
    if (!stored) return;

    stored.status = 'revoked';
    await this.ctx.storage.put(HASH_PREFIX + stored.keyHash, stored);
    await this.ctx.storage.put(META_PREFIX + id, stored);
  }

  async listKeys(): Promise<ApiKeyMeta[]> {
    const allIds = await this.ctx.storage.get<string[]>(ALL_KEYS) || [];
    const keys = await Promise.all(
      allIds.map(id => this.ctx.storage.get<StoredKey>(META_PREFIX + id))
    );
    return keys
      .filter((k): k is StoredKey => k !== undefined)
      .map(k => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        status: k.status,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        scopes: k.scopes,
      }));
  }

  async getKeyMeta(id: string): Promise<ApiKeyMeta | null> {
    const stored = await this.ctx.storage.get<StoredKey>(META_PREFIX + id);
    if (!stored) return null;
    return {
      id: stored.id,
      name: stored.name,
      prefix: stored.prefix,
      status: stored.status,
      createdAt: stored.createdAt,
      lastUsedAt: stored.lastUsedAt,
      scopes: stored.scopes,
    };
  }
}
