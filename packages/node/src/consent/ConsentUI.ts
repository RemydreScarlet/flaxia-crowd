interface ConsentConfig {
  brandName: string;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  accentColor?: string;
}

export class ConsentUI {
  private shadow: ShadowRoot;

  constructor(container: HTMLElement, config: ConsentConfig, onConsent: () => void) {
    this.shadow = container.attachShadow({ mode: 'open' });
    this.render(config, onConsent);
  }

  private render(config: ConsentConfig, onConsent: () => void) {
    const { brandName, position, accentColor = '#6366f1' } = config;
    const [y, x] = position.split('-');

    const style = document.createElement('style');
    style.textContent = `
      .overlay {
        position: fixed;
        ${y}: 20px;
        ${x}: 20px;
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
        background: ${accentColor};
        color: white;
        border: none;
        padding: 10px 15px;
        border-radius: 4px;
        cursor: pointer;
        margin-top: 10px;
        width: 100%;
      }
    `;

    const div = document.createElement('div');
    div.className = 'overlay';
    div.innerHTML = `
      <h3>${brandName}</h3>
      <p>サイトのパフォーマンス向上にご協力ください。</p>
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
