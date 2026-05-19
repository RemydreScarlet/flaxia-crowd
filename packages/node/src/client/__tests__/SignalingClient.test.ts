import { describe, it, expect, vi } from 'vitest';
import { initFlaxiaNode } from '../SignalingClient';

describe('SignalingClient', () => {
  it('should attempt to connect to the correct signaling URL after consent', () => {
    // スパイとして定義
    const MockWebSocket = vi.fn();
    global.WebSocket = MockWebSocket as any;

    initFlaxiaNode({ orchestratorUrl: 'https://flaxia.app' });

    // 同意ボタンをクリック
    const btn = document.querySelector('body')?.shadowRoot?.querySelector('#consent-btn') as HTMLButtonElement;
    // Note: Shadow DOM の構造に注意する必要がある
    const overlay = document.body.firstElementChild?.shadowRoot?.querySelector('#consent-btn') as HTMLButtonElement;
    overlay.click();

    expect(MockWebSocket).toHaveBeenCalledWith('wss://flaxia.app/crowd/signal');
  });
});
