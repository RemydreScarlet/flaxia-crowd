import { FlaxiaClient } from '@flaxia/sdk';
import { initFlaxiaNode } from '@flaxia/node';

// Setup dynamic/configurable Orchestrator URL
const defaultOrchestrator = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : 'https://flaxia-worker.remydre8.workers.dev';

const savedOrchestrator = localStorage.getItem('flaxia_orchestrator_url');
const displayOrchestratorUrl = savedOrchestrator || defaultOrchestrator;
// On localhost with the default orchestrator, use the Vite proxy (same origin)
// to avoid CORS/COEP issues with cross-origin isolation
const useViteProxy = !savedOrchestrator && window.location.hostname === 'localhost';
const orchestratorUrl = useViteProxy ? window.location.origin : displayOrchestratorUrl;

const client = new FlaxiaClient({
  apiKey: 'fc_live_darkshark_example_key',
  baseUrl: `${orchestratorUrl}/crowd`
});

// UI Elements
const chatMessages = document.getElementById('chat-messages') as HTMLDivElement;
const chatInputForm = document.getElementById('chat-input-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;

// Local Node UI Elements
const nodeDot = document.getElementById('node-dot') as HTMLSpanElement;
const nodeStatusText = document.getElementById('node-status-text') as HTMLSpanElement;
const nodeIdVal = document.getElementById('node-id-val') as HTMLSpanElement;
const nodeActivityVal = document.getElementById('node-activity-val') as HTMLSpanElement;
const consentTrigger = document.getElementById('consent-trigger') as HTMLButtonElement;

// Connection Settings UI Elements
const orchestratorUrlInput = document.getElementById('orchestrator-url-input') as HTMLInputElement | null;
const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement | null;

if (orchestratorUrlInput) {
  orchestratorUrlInput.value = displayOrchestratorUrl;
}

if (saveSettingsBtn && orchestratorUrlInput) {
  saveSettingsBtn.addEventListener('click', () => {
    const nextUrl = orchestratorUrlInput.value.trim();
    if (nextUrl) {
      localStorage.setItem('flaxia_orchestrator_url', nextUrl);
      window.location.reload();
    }
  });
}

// Task Visualizer UI Elements
const stepPending = document.getElementById('step-pending') as HTMLDivElement;
const stepProcessing = document.getElementById('step-processing') as HTMLDivElement;
const stepDone = document.getElementById('step-done') as HTMLDivElement;
const taskMetaInfo = document.getElementById('task-meta-info') as HTMLDivElement;
const taskIdVal = document.getElementById('task-id-val') as HTMLSpanElement;
const taskNodeVal = document.getElementById('task-node-val') as HTMLSpanElement;
const taskTimeVal = document.getElementById('task-time-val') as HTMLSpanElement;

// Helper to auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
});

// Monitor Local Node Service status
function updateNodeUI() {
  const consentGranted = localStorage.getItem('flaxia_consent_granted') === 'true';
  const nodeId = localStorage.getItem('flaxia_node_id');

  if (consentGranted && nodeId) {
    nodeDot.className = 'dot connected';
    nodeStatusText.innerText = 'Connected to Network';
    nodeIdVal.innerText = nodeId;
    nodeIdVal.title = nodeId;
    nodeActivityVal.innerText = 'Idle / Waiting';
    consentTrigger.style.display = 'none';
  } else {
    nodeDot.className = 'dot disconnected';
    nodeStatusText.innerText = 'Inactive';
    nodeIdVal.innerText = '-';
    nodeActivityVal.innerText = '-';
    consentTrigger.style.display = 'block';
  }
}

// WebGPU detection for optimal inference device
async function detectBestDevice(): Promise<string> {
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter?.features.has('shader-f16')) return 'webgpu';
    } catch {}
  }
  return 'wasm';
}

// Start Node Service on Consent Click
consentTrigger.addEventListener('click', () => {
  initFlaxiaNode({
    orchestratorUrl,
    siteId: 'darkshark-chat-example',
    consent: {
      brandName: 'DarkShark Node',
      position: 'bottom-right',
      accentColor: '#00f0ff'
    }
  });
  
  // Poll briefly for localstorage updates as consent might be granted
  let attempts = 0;
  const interval = setInterval(() => {
    updateNodeUI();
    attempts++;
    if (attempts > 30 || localStorage.getItem('flaxia_node_id')) {
      clearInterval(interval);
    }
  }, 1000);
});

// Initialize Node UI on Load
updateNodeUI();

// Auto-start node if already consented
if (localStorage.getItem('flaxia_consent_granted') === 'true') {
  initFlaxiaNode({
    orchestratorUrl,
    siteId: 'darkshark-chat-example',
    consent: {
      brandName: 'DarkShark Node',
      position: 'bottom-right',
      accentColor: '#00f0ff'
    }
  });
}

// Render Chat Messages
function appendMessage(sender: 'user' | 'assistant' | 'system', content: string): HTMLDivElement {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = content;
  
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return messageDiv;
}

// Typing Effect for Assistant Reply
async function typeReply(element: HTMLElement, text: string) {
  element.innerHTML = '';
  let currentText = '';
  const delay = 15; // ms per character
  
  for (const char of text) {
    currentText += char;
    // basic line break parsing
    element.innerHTML = currentText.replace(/\n/g, '<br>');
    chatMessages.scrollTop = chatMessages.scrollHeight;
    await new Promise(r => setTimeout(r, delay));
  }
}

// Task Visualization Helpers
function resetVisualizer() {
  stepPending.className = 'step';
  stepProcessing.className = 'step';
  stepDone.className = 'step';
  taskMetaInfo.style.display = 'none';
}

function updateVisualizer(status: 'pending' | 'processing' | 'done' | 'failed', taskId: string, nodeId = '-', elapsedSec = 0) {
  resetVisualizer();
  taskMetaInfo.style.display = 'block';
  taskIdVal.innerText = taskId;
  taskNodeVal.innerText = nodeId;
  taskTimeVal.innerText = `${elapsedSec.toFixed(1)}s`;

  if (status === 'pending') {
    stepPending.className = 'step active';
  } else if (status === 'processing') {
    stepPending.className = 'step complete';
    stepProcessing.className = 'step active';
    // Update local node activity text if this browser ran it
    const localNodeId = localStorage.getItem('flaxia_node_id');
    if (localNodeId && nodeId === localNodeId) {
      nodeDot.className = 'dot busy';
      nodeActivityVal.innerText = 'Processing AI Task';
    }
  } else if (status === 'done') {
    stepPending.className = 'step complete';
    stepProcessing.className = 'step complete';
    stepDone.className = 'step active';
    
    // Restore node state to idle
    updateNodeUI();
  } else if (status === 'failed') {
    stepPending.className = 'step';
    stepProcessing.className = 'step';
    stepDone.className = 'step';
    updateNodeUI();
  }
}

// Handle Form Submission
chatInputForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = chatInput.value.trim();
  if (!prompt) return;

  // UI state updates
  chatInput.value = '';
  chatInput.style.height = 'auto';
  chatInput.disabled = true;
  sendBtn.disabled = true;

  appendMessage('user', prompt);

  const systemMsg = appendMessage('system', 'Submitting AI inference task to Flaxia Crowd...');

  try {
    resetVisualizer();
    updateVisualizer('pending', 'Submitting...');

    // 1. Submit task to Worker Orchestrator via SDK Client
    // Using onnx-community/Qwen3-0.6B-ONNX model with optimizations:
    // - webgpu/wasm: auto-detect best available device
    // - do_sample: false: greedy decoding (2-5x faster than sampling)
    // - dtype: q4f16: 4-bit quantization
    const device = await detectBestDevice();
    const taskRecord = await client.submit({
      workload: 'ai-inference',
      payload: {
        task: 'text-generation',
        model: 'onnx-community/Qwen3-0.6B-ONNX',
        input: prompt,
        options: {
          dtype: 'q4f16',
          device,
          max_new_tokens: 128,
          do_sample: false,
        } as any
      }
    });

    const taskId = taskRecord.id || (taskRecord as any).taskId;
    const startTime = Date.now();
    let lastActivityTime = startTime;
    let pollInterval = 1000;
    let isFinished = false;
    let streamedText = '';

    updateVisualizer('pending', taskId, '-', 0);
    systemMsg.querySelector('.message-content')!.innerHTML = `Task queued. Task ID: <code style="font-family: monospace; background: rgba(255,255,255,0.05); padding: 2px 4px; border-radius: 4px;">${taskId}</code>`;

    // 2a. Connect streaming WebSocket (primary)
    let streamWs: WebSocket | null = null;
    let replyMessage: HTMLDivElement | null = null;
    let wsActive = false;
    try {
      const wsUrl = orchestratorUrl.replace('http', 'ws');
      streamWs = new WebSocket(`${wsUrl}/crowd/subscribe?taskId=${taskId}`);
      streamWs.onopen = () => { wsActive = true; };
      streamWs.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'subscribed') {
          console.log('[Stream] subscribed to task', taskId);
        } else if (msg.type === 'token') {
          lastActivityTime = Date.now();
          if (!replyMessage) {
            systemMsg.remove();
            replyMessage = appendMessage('assistant', '');
          }
          streamedText += msg.token;
          const contentEl = replyMessage.querySelector('.message-content') as HTMLElement;
          contentEl.innerHTML = streamedText.replace(/\n/g, '<br>');
          chatMessages.scrollTop = chatMessages.scrollHeight;
        } else if (msg.type === 'done') {
          isFinished = true;
          streamWs?.close();
        } else if (msg.type === 'error') {
          isFinished = true;
          streamWs?.close();
          if (replyMessage) {
            const contentEl = replyMessage.querySelector('.message-content') as HTMLElement;
            contentEl.innerHTML += `<br><span style="color:#ff3366;">Error: ${msg.error}</span>`;
          } else {
            systemMsg.querySelector('.message-content')!.innerHTML = `Task failed: <span style="color: #ff3366;">${msg.error || 'Unknown Error'}</span>`;
          }
        }
      };
      streamWs.onerror = () => {
        wsActive = false;
        console.log('[Stream] WebSocket error, falling back to polling');
      };
    } catch {
      console.log('[Stream] Could not connect, falling back to polling');
    }

    // 2b. Poll orchestrator (fallback: only used when WS is unavailable)
    while (!isFinished) {
      await new Promise(r => setTimeout(r, wsActive ? 5000 : 1000));

      const elapsed = (Date.now() - startTime) / 1000;
      const idleSinceLastToken = (Date.now() - lastActivityTime) / 1000;

      if (idleSinceLastToken > 90) {
        isFinished = true;
        streamWs?.close();
        updateVisualizer('failed', taskId);
        systemMsg.querySelector('.message-content')!.innerHTML = 'Task execution timed out after 90 seconds.';
        updateNodeUI();
        break;
      }

      if (wsActive) continue;

      const currentTask = await client.getTask(taskId);

      if (currentTask.status === 'processing') {
        updateVisualizer('processing', taskId, currentTask.assignedNodeId || 'Assigned Node', elapsed);
        systemMsg.querySelector('.message-content')!.innerHTML = `Task assigned to node: <code style="font-family: monospace; background: rgba(0,240,255,0.05); color: #00f0ff; padding: 2px 4px; border-radius: 4px;">${currentTask.assignedNodeId}</code>. Generating response...`;
      } 
      
      else if (currentTask.status === 'done') {
        if (!streamedText) {
          isFinished = true;
          streamWs?.close();
          updateVisualizer('done', taskId, currentTask.assignedNodeId || 'Assigned Node', elapsed);
          systemMsg.remove();

          replyMessage = appendMessage('assistant', 'Generating reply...');

          let reply = 'No output returned.';
          const resultPayload = currentTask.result as any;
          if (resultPayload && resultPayload.output) {
            const out = resultPayload.output;
            if (Array.isArray(out) && out[0] && typeof out[0].generated_text === 'string') {
              reply = out[0].generated_text;
              if (reply.startsWith(prompt)) {
                reply = reply.substring(prompt.length).trim();
              }
            } else if (typeof out === 'string') {
              reply = out;
            } else {
              reply = JSON.stringify(out);
            }
          }

          await typeReply(replyMessage.querySelector('.message-content') as HTMLElement, reply);
        } else {
          isFinished = true;
          streamWs?.close();
          updateVisualizer('done', taskId, currentTask.assignedNodeId || 'Assigned Node', elapsed);
        }
      } 
      
      else if (currentTask.status === 'failed') {
        if (!streamedText) {
          isFinished = true;
          streamWs?.close();
          updateVisualizer('failed', taskId);
          systemMsg.querySelector('.message-content')!.innerHTML = `Task failed: <span style="color: #ff3366;">${currentTask.error || 'Unknown Error'}</span>`;
          updateNodeUI();
        }
      }
    }

  } catch (error: any) {
    systemMsg.querySelector('.message-content')!.innerHTML = `Submission error: <span style="color: #ff3366;">${error.message || error}</span>`;
    updateVisualizer('failed', 'Error');
    updateNodeUI();
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
});
