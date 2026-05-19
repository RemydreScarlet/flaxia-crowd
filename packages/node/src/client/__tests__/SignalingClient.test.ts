import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initFlaxiaNode } from '../SignalingClient';

describe('SignalingClient', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('should attempt to connect to the correct signaling URL after consent', () => {
    const MockWebSocket = vi.fn();
    global.WebSocket = MockWebSocket as any;

    initFlaxiaNode({
      orchestratorUrl: 'https://flaxia.app',
      siteId: 'test-site',
      consent: {
        brandName: 'Test Brand',
        position: 'bottom-right',
      },
    });

    const overlay = document.body.firstElementChild?.shadowRoot?.querySelector('#consent-btn') as HTMLButtonElement;
    overlay.click();

    expect(MockWebSocket).toHaveBeenCalledWith('wss://flaxia.app/crowd/signal');
  });
});
