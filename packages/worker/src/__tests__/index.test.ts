import { describe, it, expect } from 'vitest';
import app from '../index';

describe('Worker CORS', () => {
  it('should respond to OPTIONS request with CORS headers', async () => {
    const res = await app.request('/crowd/tasks', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    });

    // CORS preflight requests usually return 204 No Content
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('access-control-allow-origin')).toBeDefined();
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });
});
