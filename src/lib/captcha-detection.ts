type CaptchaFamily = 'recaptcha' | 'hcaptcha' | 'turnstile' | 'generic';

const RESPONSE_SELECTORS: Record<Exclude<CaptchaFamily, 'generic'>, string> = {
  recaptcha: 'textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]',
  hcaptcha: 'textarea[name="h-captcha-response"], input[name="h-captcha-response"]',
  turnstile: 'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]',
};

const MARKER_SELECTORS: Record<CaptchaFamily, string> = {
  recaptcha: '.g-recaptcha, [data-recaptcha-widget-id], iframe[src*="recaptcha" i], iframe[title*="recaptcha" i]',
  hcaptcha: '.h-captcha, [data-hcaptcha-widget-id], iframe[src*="hcaptcha.com" i], iframe[title*="hcaptcha" i]',
  turnstile: '.cf-turnstile, iframe[src*="challenges.cloudflare.com" i], iframe[title*="turnstile" i]',
  generic: '[data-captcha], [id*="captcha" i]:not(textarea):not(input), [class*="captcha" i]:not(textarea):not(input), iframe[title*="captcha" i]',
};

function responseTokens(root: ParentNode, family?: Exclude<CaptchaFamily, 'generic'>): string[] {
  const selector = family
    ? RESPONSE_SELECTORS[family]
    : Object.values(RESPONSE_SELECTORS).join(', ');
  return [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector)]
    .map((field) => field.value.trim());
}

function isVisible(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') return false;
    const view: Window | null = current.ownerDocument.defaultView;
    const style: CSSStyleDeclaration | undefined = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    current = current.parentElement;
  }
  return true;
}

/**
 * Detects only an on-page CAPTCHA that is both visible and unresolved. The provider's response
 * token is authoritative: widgets often remain mounted after a successful challenge, so a filled
 * token means the CAPTCHA is solved and must not divert an otherwise normal local submission.
 */
export function hasVisibleUnresolvedCaptcha(root: ParentNode = document): boolean {
  for (const family of ['recaptcha', 'hcaptcha', 'turnstile'] as const) {
    const visibleMarker = [...root.querySelectorAll(MARKER_SELECTORS[family])].some(isVisible);
    const tokens = responseTokens(root, family);
    if (visibleMarker && (tokens.length === 0 || tokens.some((token) => token.length === 0))) return true;
  }

  const visibleGenericMarker = [...root.querySelectorAll(MARKER_SELECTORS.generic)].some(isVisible);
  const tokens = responseTokens(root);
  return visibleGenericMarker && (tokens.length === 0 || tokens.some((token) => token.length === 0));
}

export async function waitForVisibleCaptchaResolution(
  root: ParentNode = document,
  timeoutMs = 10 * 60_000,
  pollMs = 500,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!hasVisibleUnresolvedCaptcha(root)) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return !hasVisibleUnresolvedCaptcha(root);
}
