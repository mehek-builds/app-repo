const EXACT_HOSTS = new Set([
  'linkedin.com',
  'www.linkedin.com',
  'www.indeed.com',
  'app.joinhandshake.com',
  'joinhandshake.com',
]);

const HOST_SUFFIXES = [
  '.greenhouse.io',
  '.lever.co',
  '.myworkdayjobs.com',
  '.workday.com',
  '.ashbyhq.com',
];

export function supportsPersistentBadge(hostname: string): boolean {
  return EXACT_HOSTS.has(hostname) || HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

type PersistentBadgeFrameContext = {
  isTopFrame: boolean;
  ancestorHostnames: string[];
};

function currentFrameContext(): PersistentBadgeFrameContext {
  if (window.top === window) return { isTopFrame: true, ancestorHostnames: [] };

  const origins = window.location.ancestorOrigins;
  const ancestorHostnames: string[] = [];
  for (let index = 0; index < (origins?.length ?? 0); index += 1) {
    const origin = origins.item(index);
    if (!origin) continue;
    try {
      ancestorHostnames.push(new URL(origin).hostname);
    } catch {
      // Ignore a malformed browser-provided origin and preserve the only launcher.
    }
  }
  if (!ancestorHostnames.length && document.referrer) {
    try {
      ancestorHostnames.push(new URL(document.referrer).hostname);
    } catch {
      // Ignore a malformed referrer and preserve the only launcher.
    }
  }
  return { isTopFrame: false, ancestorHostnames };
}

export function shouldInstallPersistentBadge(
  hostname: string,
  frame: PersistentBadgeFrameContext,
): boolean {
  if (!supportsPersistentBadge(hostname)) return false;
  if (frame.isTopFrame) return true;
  return !frame.ancestorHostnames.some(supportsPersistentBadge);
}

/** Mount one launcher unless a supported top document already owns it. */
export function installPersistentBadge(
  hostname = window.location.hostname,
  frame = currentFrameContext(),
): void {
    if (!shouldInstallPersistentBadge(hostname, frame)) return;
    if (
      window.location.protocol === 'chrome:' ||
      window.location.protocol === 'chrome-extension:' ||
      document.getElementById('litos-persistent')
    ) return;

    const el = document.createElement('div');
    el.id = 'litos-persistent';
    el.style.setProperty('--litos-card-stack-clearance', '0px');
    el.innerHTML = `
      <button id="litos-persistent-btn" type="button" style="
        position: fixed;
        bottom: calc(20px + var(--litos-card-stack-clearance));
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
        padding: 0;
      " title="Open Litos" aria-label="Open Litos">
        <svg width="24" height="24" viewBox="0 0 100 100" aria-hidden="true">
          <path fill="#12120f" d="M32.81 8 L76.01 8 L75.17 16 L31.97 16 Z M27.53 24 L77.93 24 L77.09 32 L26.69 32 Z M22.25 40 L79.85 40 L79.01 48 L21.41 48 Z M16.97 56 L81.77 56 L80.93 64 L16.13 64 Z M11.69 72 L83.69 72 L81.59 92 L9.59 92 Z" />
        </svg>
      </button>
      <div id="litos-persistent-tip" style="
        display: none;
        position: fixed;
        bottom: calc(68px + var(--litos-card-stack-clearance));
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

    const showTip = () => {
      btn.style.opacity = '1';
      btn.style.transform = 'scale(1.1)';
      tip.style.display = 'block';
    };
    const hideTip = () => {
      btn.style.opacity = '0.78';
      btn.style.transform = 'scale(1)';
      tip.style.display = 'none';
    };

    btn.addEventListener('mouseenter', showTip);
    btn.addEventListener('mouseleave', hideTip);
    btn.addEventListener('focus', () => {
      showTip();
      btn.style.outline = '2px solid #3157d5';
      btn.style.outlineOffset = '2px';
    });
    btn.addEventListener('blur', () => {
      hideTip();
      btn.style.outline = '';
      btn.style.outlineOffset = '';
    });
    btn.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      chrome.runtime.sendMessage({ type: 'OPEN_LITOS_POPUP' }, (response: { ok?: boolean } | undefined) => {
        if (!chrome.runtime.lastError && response?.ok === true) return;
        tip.textContent = 'Open Litos from the browser toolbar';
        showTip();
      });
    });
}
