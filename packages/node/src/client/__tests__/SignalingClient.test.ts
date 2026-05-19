import { describe, it, expect, vi } from 'vitest';
import { initFlaxiaNode } from '../SignalingClient';

describe('SignalingClient', () => {
  it('should attempt to connect to the correct signaling URL', () => {
    // スパイとして定義
    const MockWebSocket = vi.fn();
    global.WebSocket = MockWebSocket as any;

    initFlaxiaNode({ orchestratorUrl: 'https://flaxia.app' });

    expect(MockWebSocket).toHaveBeenCalledWith('wss://flaxia.app/crowd/signal');
  });
});
