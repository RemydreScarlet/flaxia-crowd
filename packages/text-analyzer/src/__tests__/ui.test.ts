import { describe, it, expect } from 'vitest';

describe('TextAnalyzer UI', () => {
  it('should have the app container', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const app = document.getElementById('app');
    expect(app).not.toBeNull();
  });

  it('should have analysis input', () => {
    document.body.innerHTML = '<textarea id="analysis-input"></textarea>';
    const input = document.getElementById('analysis-input') as HTMLTextAreaElement;
    expect(input).not.toBeNull();
  });

  it('should have analyze button', () => {
    document.body.innerHTML = '<button id="analyze-btn"></button>';
    const btn = document.getElementById('analyze-btn');
    expect(btn).not.toBeNull();
  });
});
