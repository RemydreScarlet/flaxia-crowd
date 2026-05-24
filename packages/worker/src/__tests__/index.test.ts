import { describe, it, expect } from 'vitest';
import app from '../index';

describe('Worker', () => {
  describe('health', () => {
    it('should respond with OK on /health', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('OK');
    });
  });

  describe('CORS', () => {
    it('should respond to OPTIONS request with CORS headers', async () => {
      const res = await app.request('/crowd/tasks', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,authorization',
        },
      });

      expect([200, 204]).toContain(res.status);
      expect(res.headers.get('access-control-allow-origin')).toBeDefined();
      expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    });
  });

  describe('routing', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await app.request('/unknown');
      expect(res.status).toBe(404);
    });
  });
});
