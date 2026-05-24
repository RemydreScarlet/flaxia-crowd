import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initFlaxiaNode } from '../SignalingClient';

describe('SignalingClient', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should attempt to connect to the correct signaling URL after consent', () => {
    const MockWebSocket = vi.fn();
    globalThis.WebSocket = MockWebSocket as any;

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

    expect(MockWebSocket).toHaveBeenCalledWith(expect.stringContaining('wss://flaxia.app/crowd/signal?nodeId='));
    expect(MockWebSocket).toHaveBeenCalledWith(expect.stringContaining('capabilities=ai-inference%2Cimage-process'));
  });

  it('should create consent container with correct id', () => {
    globalThis.WebSocket = vi.fn() as any;

    initFlaxiaNode({
      orchestratorUrl: 'https://flaxia.app',
      siteId: 'test-site',
      consent: { brandName: 'Test', position: 'bottom-right' },
    });

    const container = document.getElementById('flaxia-consent-container');
    expect(container).toBeDefined();
  });

  it('should skip consent UI if consent already given', () => {
    localStorage.setItem('flaxia_consent_granted', 'true');
    const MockWebSocket = vi.fn();
    globalThis.WebSocket = MockWebSocket as any;

    initFlaxiaNode({
      orchestratorUrl: 'https://flaxia.app',
      siteId: 'test-site',
      consent: { brandName: 'Test', position: 'bottom-right' },
    });

    const container = document.getElementById('flaxia-consent-container');
    expect(container).toBeNull();
    expect(MockWebSocket).toHaveBeenCalled();
  });

  it('should generate and persist nodeId in localStorage', () => {
    const MockWebSocket = vi.fn();
    globalThis.WebSocket = MockWebSocket as any;
    localStorage.setItem('flaxia_consent_granted', 'true');

    initFlaxiaNode({
      orchestratorUrl: 'https://flaxia.app',
      siteId: 'test-site',
      consent: { brandName: 'Test', position: 'bottom-right' },
    });

    const nodeId = localStorage.getItem('flaxia_node_id');
    expect(nodeId).toBeDefined();
    expect(nodeId!.length).toBeGreaterThan(0);
  });
});
