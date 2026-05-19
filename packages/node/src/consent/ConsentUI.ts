export class ConsentUI {
  private shadow: ShadowRoot;

  constructor(container: HTMLElement, onConsent: () => void) {
    this.shadow = container.attachShadow({ mode: 'open' });
    this.render(onConsent);
  }

  private render(onConsent: () => void) {
    const style = document.createElement('style');
    style.textContent = `
      .overlay {
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 20px;
        background: #fff;
        border: 1px solid #ccc;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        z-index: 9999;
        border-radius: 8px;
        max-width: 300px;
        font-family: sans-serif;
      }
      button {
        background: #6366f1;
        color: white;
        border: none;
        padding: 10px 15px;
        border-radius: 4px;
        cursor: pointer;
        margin-top: 10px;
      }
    `;

    const div = document.createElement('div');
    div.className = 'overlay';
    div.innerHTML = `
      <h3>Flaxia Node</h3>
      <p>このサイトのパフォーマンス向上にご協力ください。</p>
      <button id="consent-btn">同意して開始</button>
    `;

    div.querySelector('#consent-btn')?.addEventListener('click', () => {
      div.remove();
      onConsent();
    });

    this.shadow.appendChild(style);
    this.shadow.appendChild(div);
  }
}
