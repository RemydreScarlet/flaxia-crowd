import { describe, it, expect, vi } from 'vitest';
import { handleContainer } from '../container';
import type { ContainerPayload } from '@flaxia/sdk';

vi.mock('../../executor/container-executor', () => ({
  runContainer: vi.fn().mockResolvedValue({
    files: {},
    stdout: 'hello',
    stderr: '',
    exitCode: 0,
  }),
}));

describe('Container Workload', () => {
  it('should call runContainer and return result', async () => {
    const payload: ContainerPayload = {
      image: 'test.wasm',
      command: ['echo', 'hello'],
      files: {},
    };

    const result = await handleContainer(payload);

    expect(result).toHaveProperty('files');
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('exitCode');
    expect(result.stdout).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('should handle files in payload', async () => {
    const payload: ContainerPayload = {
      image: 'test.wasm',
      command: ['cat', '/input.txt'],
      files: {
        '/input.txt': 'dGVzdCBmaWxlIGNvbnRlbnQ=',
      },
    };

    const result = await handleContainer(payload);
    expect(result.exitCode).toBe(0);
  });
});
