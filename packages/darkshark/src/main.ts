import './index.css';
import { FlaxiaClient } from '@flaxia/sdk';
import { initFlaxiaNode } from '@flaxia/node';

const SYSTEM_PROMPT = 'You are DarkShark, a helpful AI assistant running on the decentralized Flaxia Crowd network. You are concise and accurate in your responses.';
const CHATML_TEMPLATE = '<|im_start|>system\n{{SYSTEM}}<|im_end|>\n{{HISTORY}}<|im_start|>assistant\n';

const defaultOrchestrator = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : 'https://flaxia-worker.remydre8.workers.dev';

const savedOrchestrator = localStorage.getItem('flaxia_orchestrator_url');
const displayOrchestratorUrl = savedOrchestrator || defaultOrchestrator;
const useViteProxy = !savedOrchestrator && window.location.hostname === 'localhost';
const orchestratorUrl = useViteProxy ? window.location.origin : displayOrchestratorUrl;

const client = new FlaxiaClient({
  apiKey: import.meta.env.VITE_FLAXIA_API_KEY || 'fc_live_darkshark_example_key',
  baseUrl: `${orchestratorUrl}/crowd`
});

// UI Elements
const chatMessages = document.getElementById('chat-messages') as HTMLDivElement;
const chatInputForm = document.getElementById('chat-input-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
});

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
let conversationHistory: ChatMessage[] = [];

function buildChatPrompt(userMessage: string): string {
  let historyStr = '';
  for (const msg of conversationHistory) {
    historyStr += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
  }
  historyStr += `<|im_start|>user\n${userMessage}<|im_end|>\n`;
  return CHATML_TEMPLATE.replace('{{SYSTEM}}', SYSTEM_PROMPT).replace('{{HISTORY}}', historyStr);
}

const newChatBtn = document.getElementById('new-chat-btn') as HTMLButtonElement | null;
newChatBtn?.addEventListener('click', () => {
  conversationHistory = [];
  chatMessages.innerHTML = '';
  const welcomeMsg = document.createElement('div');
  welcomeMsg.className = 'message system';
  welcomeMsg.innerHTML = '<div class="message-content">Welcome to <strong>DarkShark</strong>. Start a new conversation!</div>';
  chatMessages.appendChild(welcomeMsg);
});

const consentTrigger = document.getElementById('consent-trigger') as HTMLButtonElement;

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
});

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

function escapeHtml(text: string): string {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function renderContent(text: string, streaming: boolean): string {
  const hasThinkOpen = text.includes('<think>');
  const hasThinkClose = text.includes('</think>');

  if (!hasThinkOpen && !text.includes('<think')) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  if (hasThinkOpen && !hasThinkClose) {
    if (streaming) {
      const before = escapeHtml(text.split('<think>')[0]).replace(/\n/g, '<br>');
      return before + '<span class="think-placeholder">Thinking...</span>';
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  if (!hasThinkOpen && !hasThinkClose) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  const before = escapeHtml(text.split('<think>')[0]).replace(/\n/g, '<br>');
  const match = text.match(/<think>([\s\S]*?)<\/think>/);
  const thinkContent = match ? match[1] : '';
  const after = text.split('</think>')[1] || '';
  const afterHtml = escapeHtml(after).replace(/\n/g, '<br>');
  const thinkHtml = `<details class="think-block"><summary class="think-summary">Thinking...</summary><div class="think-body">${escapeHtml(thinkContent).replace(/\n/g, '<br>')}</div></details>`;

  return before + thinkHtml + afterHtml;
}

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

async function typeReply(element: HTMLElement, text: string) {
  element.innerHTML = '';
  let currentText = '';
  const delay = 8;

  for (const char of text) {
    currentText += char;
    element.innerHTML = renderContent(currentText, true);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    await new Promise(r => setTimeout(r, delay));
  }
  element.innerHTML = renderContent(currentText, false);
}

function resetVisualizer() { }
function updateVisualizer(status: 'pending' | 'processing' | 'done' | 'failed', taskId: string, nodeId = '-', elapsedSec = 0) { }

chatInputForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = chatInput.value.trim();
  if (!prompt) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  chatInput.disabled = true;
  sendBtn.disabled = true;

  appendMessage('user', prompt);

  const systemMsg = appendMessage('system', 'Submitting AI inference task to Flaxia Crowd...');

  try {
    resetVisualizer();
    updateVisualizer('pending', 'Submitting...');

    const chatPrompt = buildChatPrompt(prompt);
    const taskRecord = await client.submit({
      workload: 'ai-inference',
      payload: {
        task: 'text-generation',
        model: 'onnx-community/Qwen3-0.6B-ONNX',
        input: chatPrompt,
        options: {
          dtype: 'q4f16',
          device: 'wasm',
          max_new_tokens: 512,
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

    let finalReply = '';

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
          contentEl.innerHTML = renderContent(streamedText, true);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        } else if (msg.type === 'done') {
          isFinished = true;
          streamWs?.close();
          finalReply = streamedText;
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

    while (!isFinished) {
      await new Promise(r => setTimeout(r, wsActive ? 5000 : 1000));

      const elapsed = (Date.now() - startTime) / 1000;
      const idleSinceLastToken = (Date.now() - lastActivityTime) / 1000;

      if (idleSinceLastToken > 90) {
        isFinished = true;
        streamWs?.close();
        updateVisualizer('failed', taskId);
        systemMsg.querySelector('.message-content')!.innerHTML = 'Task execution timed out after 90 seconds.';
        break;
      }

      if (wsActive) continue;

      const currentTask = await client.getTask(taskId);

      if (currentTask.status === 'processing') {
        updateVisualizer('processing', taskId, currentTask.assignedNodeId || 'Assigned Node', elapsed);
        systemMsg.querySelector('.message-content')!.innerHTML = `Task assigned to node: <code style="font-family: monospace; background: rgba(0,240,255,0.05); color: #00f0ff; padding: 2px 4px; border-radius: 4px;">${currentTask.assignedNodeId}</code>. Generating response...`;
      } else if (currentTask.status === 'done') {
        if (!streamedText) {
          isFinished = true;
          streamWs?.close();
          updateVisualizer('done', taskId, currentTask.assignedNodeId || 'Assigned Node', elapsed);
          systemMsg.remove();

          replyMessage = appendMessage('assistant', '');

          let reply = 'No output returned.';
          const resultPayload = currentTask.result as any;
          if (resultPayload && resultPayload.output) {
            const out = resultPayload.output;
            if (Array.isArray(out) && out[0] && typeof out[0].generated_text === 'string') {
              reply = out[0].generated_text;
              if (reply.startsWith(chatPrompt)) {
                reply = reply.substring(chatPrompt.length).trim();
              }
            } else if (typeof out === 'string') {
              reply = out;
            } else {
              reply = JSON.stringify(out);
            }
          }

          finalReply = reply;
          await typeReply(replyMessage.querySelector('.message-content') as HTMLElement, reply);
        } else {
          isFinished = true;
          streamWs?.close();
          finalReply = streamedText;
          const contentEl = replyMessage?.querySelector('.message-content') as HTMLElement;
          if (contentEl) contentEl.innerHTML = renderContent(streamedText, false);
          updateVisualizer('done', taskId, currentTask.assignedNodeId || 'Assigned Node', elapsed);
        }
      } else if (currentTask.status === 'failed') {
        if (!streamedText) {
          isFinished = true;
          streamWs?.close();
          updateVisualizer('failed', taskId);
          systemMsg.querySelector('.message-content')!.innerHTML = `Task failed: <span style="color: #ff3366;">${currentTask.error || 'Unknown Error'}</span>`;
        }
      }
    }

    if (finalReply) {
      conversationHistory.push({ role: 'assistant', content: finalReply });
    }

  } catch (error: any) {
    systemMsg.querySelector('.message-content')!.innerHTML = `Submission error: <span style="color: #ff3366;">${error.message || error}</span>`;
    updateVisualizer('failed', 'Error');
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
});
