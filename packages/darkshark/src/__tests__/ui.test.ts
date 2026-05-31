import { describe, it, expect } from 'vitest';

describe('DarkShark UI', () => {
  it('should have chat messages container', () => {
    document.body.innerHTML = '<div id="chat-messages"></div>';
    const el = document.getElementById('chat-messages');
    expect(el).not.toBeNull();
  });

  it('should have chat input form', () => {
    document.body.innerHTML = '<form id="chat-input-form"><textarea id="chat-input"></textarea><button id="send-btn"></button></form>';
    expect(document.getElementById('chat-input-form')).not.toBeNull();
    expect(document.getElementById('chat-input')).not.toBeNull();
    expect(document.getElementById('send-btn')).not.toBeNull();
  });
});
