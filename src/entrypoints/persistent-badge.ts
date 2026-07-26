export default defineContentScript({
  // Same job-portal list as content.ts. Was <all_urls>, which forces the
  // "read and change all your data on all websites" install warning and the
  // slowest Chrome Web Store review queue.
  matches: [
    'https://www.linkedin.com/*',
    'https://linkedin.com/*',
    'https://*.greenhouse.io/*',
    'https://*.lever.co/*',
    'https://*.myworkdayjobs.com/*',
    'https://*.workday.com/*',
    'https://*.ashbyhq.com/*',
    'https://www.indeed.com/*',
    'https://app.joinhandshake.com/*',
    'https://joinhandshake.com/*',
  ],
  runAt: 'document_idle',
  main() {
    if (
      window.location.protocol === 'chrome:' ||
      window.location.protocol === 'chrome-extension:' ||
      document.getElementById('litos-persistent')
    ) return;

    const el = document.createElement('div');
    el.id = 'litos-persistent';
    el.innerHTML = `
      <div id="litos-persistent-btn" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483645;
        width: 44px;
        height: 44px;
        border: 1px solid #e8e6e1;
        border-radius: 10px;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 3px 14px rgba(21,20,18,0.16);
        opacity: 0.78;
        transition: opacity 0.2s, transform 0.2s;
        user-select: none;
      " title="Open Litos" aria-label="Open Litos">
        <svg width="24" height="24" viewBox="0 0 100 100" aria-hidden="true">
          <path fill="#12120f" d="M32.81 8 L76.01 8 L75.17 16 L31.97 16 Z M27.53 24 L77.93 24 L77.09 32 L26.69 32 Z M22.25 40 L79.85 40 L79.01 48 L21.41 48 Z M16.97 56 L81.77 56 L80.93 64 L16.13 64 Z M11.69 72 L83.69 72 L81.59 92 L9.59 92 Z" />
        </svg>
      </div>
      <div id="litos-persistent-tip" style="
        display: none;
        position: fixed;
        bottom: 68px;
        right: 16px;
        z-index: 2147483645;
        background: #12120f;
        color: white;
        border-radius: 8px;
        padding: 8px 12px;
        font-family: "Hanken Grotesk Variable", "Hanken Grotesk", sans-serif;
        font-size: 12px;
        max-width: 190px;
        text-align: center;
        line-height: 1.4;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        pointer-events: none;
      ">Open Litos</div>
    `;
    document.body.appendChild(el);

    const btn = el.querySelector<HTMLElement>('#litos-persistent-btn')!;
    const tip = el.querySelector<HTMLElement>('#litos-persistent-tip')!;

    btn.addEventListener('mouseenter', () => {
      btn.style.opacity = '1';
      btn.style.transform = 'scale(1.1)';
      tip.style.display = 'block';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.opacity = '0.78';
      btn.style.transform = 'scale(1)';
      tip.style.display = 'none';
    });
  },
});
