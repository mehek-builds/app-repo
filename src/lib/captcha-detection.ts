/**
 * Human-verification (CAPTCHA) detection for the in-browser fill.
 *
 * Litos NEVER solves a challenge, never sends one anywhere to be solved, and never moves a response
 * token off the page. This module only answers "is a human being asked to do something here", so the
 * fill can stop cleanly, keep what it filled, and hand the page back to the person whose application
 * it is. They are already sitting in front of it; that is the entire advantage this surface has over
 * the server run, and until now the extension threw it away by stopping silently.
 *
 * Deliberately mirrors the backend's portalSubmission.ts semantics so the two surfaces cannot
 * disagree about whether a page is blocked. The hard-won parts, both of which cost real debugging on
 * the server side, are reproduced here rather than rediscovered:
 *
 *   1. Token state, not markup presence. reCAPTCHA v2 ALWAYS ships a `g-recaptcha-response`
 *      textarea, solved or not, so "the element exists" marks every reCAPTCHA page blocked forever
 *      and never clears once the applicant solves it.
 *   2. The v3 badge is a CONTAINER, excluded with closest(). `div.grecaptcha-badge` wraps an anchor
 *      iframe that matches `iframe[src*="captcha"]` on its own, carries no badge class, and contains
 *      no badge - so a self-or-descendant check still counts it and a v3 page still reports blocked.
 *      v3 asks the human for nothing, so stopping there would strand applications for no reason.
 */

import { isInsideCollapsedRegion } from './adapters/shared/dom';

export type CaptchaProvider =
  | 'recaptcha_v2'
  | 'recaptcha_v3'
  | 'hcaptcha'
  | 'turnstile'
  | 'arkose'
  | 'unknown';

export type ChallengeState = {
  /** True only when a human still has to act. A solved widget is not present. */
  waiting: boolean;
  provider: CaptchaProvider;
};

const RESPONSE_SELECTOR = [
  'textarea[name*="captcha-response" i]',
  'input[name*="captcha-response" i]',
  'textarea[id*="captcha-response" i]',
  'input[id*="captcha-response" i]',
  'textarea[name="cf-turnstile-response"]',
  'input[name="cf-turnstile-response"]',
].join(', ');

const CHALLENGE_SELECTOR = [
  'iframe[src*="captcha" i]',
  'iframe[src*="challenges.cloudflare.com" i]',
  '[class*="captcha" i]',
  '[id*="captcha" i]',
  '[data-sitekey]',
].join(', ');

const BADGE_CLASS = 'grecaptcha-badge';

const PROVIDER_MARKERS: ReadonlyArray<{ provider: CaptchaProvider; selector: string }> = [
  { provider: 'turnstile', selector: '[name="cf-turnstile-response"], iframe[src*="challenges.cloudflare.com" i]' },
  { provider: 'hcaptcha', selector: '[name="h-captcha-response"], iframe[src*="hcaptcha.com" i]' },
  { provider: 'arkose', selector: 'iframe[src*="arkoselabs" i], iframe[src*="funcaptcha" i]' },
  { provider: 'recaptcha_v2', selector: '[name="g-recaptcha-response"], iframe[src*="recaptcha" i]' },
];

/**
 * What counts as an INTERACTIVE reCAPTCHA, i.e. one a human has to clear.
 *
 * The iframe alone is not enough. reCAPTCHA renders its container first and mounts the anchor
 * iframe a moment later, so between those two points a genuinely blocking v2 widget has a container
 * and no iframe. Matching only the iframe labelled that window 'recaptcha_v3', which specifically
 * means "nothing is being asked of a human" - the opposite of the truth, and exactly the window a
 * fill is most likely to observe, since it runs the instant the form is ready.
 *
 * Safe against false v2 on a real v3 page: v3 takes its site key as a script parameter and renders
 * no keyed container. An invisible-v2 container does carry data-sitekey, but it is invisible, so
 * `waiting` is already false and this function never runs.
 */
const INTERACTIVE_RECAPTCHA_SELECTOR = [
  `iframe[src*="recaptcha" i]:not(.${BADGE_CLASS} *)`,
  `.g-recaptcha:not(.${BADGE_CLASS}):not(.${BADGE_CLASS} *)`,
  `[data-sitekey]:not(.${BADGE_CLASS}):not(.${BADGE_CLASS} *)`,
].join(', ');

/**
 * A 0x0 box is not the only way a page hides something, which the honeypot guard learned the hard
 * way: Workday's bot-trap is 1x1 and clipped, and Breezy/BambooHR/Oracle hide a fully-visible 250x40
 * field inside an ancestor with `height: 0; overflow: hidden`. A challenge concealed the same way is
 * not something a human can act on, so it must not stall the fill.
 *
 * The collapsed-ancestor case is IMPORTED from the honeypot guard rather than reimplemented here.
 * An earlier version of this function claimed to handle it with a size check, which cannot work:
 * getBoundingClientRect on a child of a zero-height overflow:hidden ancestor still returns the
 * child's own full box, so the check passed and the comment was simply wrong.
 *
 * Imports the tabIndex-FREE variant. isConcealedByCollapsedAncestor early-returns for anything with
 * tabIndex >= 0, and an <iframe> is focusable by default and reports 0 with no attribute set - so
 * calling that one here would be a silent no-op for every interactive challenge, all of which are
 * iframes.
 */
function isReallyVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  return !isInsideCollapsedRegion(element);
}

function tokens(root: ParentNode): string[] {
  return [...root.querySelectorAll(RESPONSE_SELECTOR)]
    .map((field) => (field as HTMLInputElement | HTMLTextAreaElement).value ?? '');
}

function visibleChallengeCount(root: ParentNode): number {
  return [...root.querySelectorAll(CHALLENGE_SELECTOR)].filter((node) => (
    node.closest(`.${BADGE_CLASS}`) === null && isReallyVisible(node)
  )).length;
}

/**
 * Widget count is deliberately NOT compared to token count: providers render a variable number of
 * visible nodes per widget, so "3 nodes, 1 token" is one solved widget rather than two missing ones.
 * The honest signal is: something interactive is rendered, and at least one response field is empty.
 */
export function snapshotRequiresAttention(responseTokens: string[], challengeCount: number): boolean {
  if (challengeCount === 0) return false;
  if (responseTokens.length === 0) return true;
  return responseTokens.some((token) => token.trim().length === 0);
}

export function identifyProvider(root: ParentNode = document): CaptchaProvider {
  for (const marker of PROVIDER_MARKERS) {
    if (root.querySelector(marker.selector) === null) continue;
    if (marker.provider !== 'recaptcha_v2') return marker.provider;
    // Same split the badge exclusion uses: an interactive widget lives outside the badge, so a page
    // whose only reCAPTCHA markup is the badge is v3 and is asking nothing of anyone.
    return root.querySelector(INTERACTIVE_RECAPTCHA_SELECTOR) === null ? 'recaptcha_v3' : 'recaptcha_v2';
  }
  return 'unknown';
}

export function detectChallenge(root: ParentNode = document): ChallengeState {
  const waiting = snapshotRequiresAttention(tokens(root), visibleChallengeCount(root));
  return { waiting, provider: waiting ? identifyProvider(root) : 'unknown' };
}

/**
 * Watch for a challenge that mounts AFTER the fill, which is the shape that made this silent.
 *
 * The failure users actually hit is not "the page loaded with a CAPTCHA". It is: Litos fills the
 * form, the applicant presses Submit, nothing appears to happen, and a challenge iframe quietly
 * mounts. Polling on a MutationObserver scoped to the form catches that, and the observer is
 * disconnected the moment it fires so a challenge cannot re-trigger the card on every DOM change a
 * provider makes while rendering.
 */
export function watchForChallenge(
  target: Node,
  onChallenge: (state: ChallengeState) => void,
  options: { root?: ParentNode; timeoutMs?: number } = {},
): () => void {
  const root = options.root ?? document;
  const immediate = detectChallenge(root);
  if (immediate.waiting) {
    onChallenge(immediate);
    return () => undefined;
  }

  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
  };
  const observer = new MutationObserver(() => {
    const state = detectChallenge(root);
    if (!state.waiting) return;
    stop();
    onChallenge(state);
  });
  observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class', 'style'] });

  // Bounded. An observer left attached to a job board's form outlives the fill it belonged to and
  // keeps running on every DOM change the page makes for as long as the tab is open.
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(stop, options.timeoutMs);
  return stop;
}

/**
 * Wait for the applicant to clear the challenge, in their own browser, in their own session.
 *
 * This is the only place "resume after solve" can live, and it is worth being precise about why.
 * Litos does not solve anything and never sees the token: it polls its own detection, which reads
 * whether a response field is still empty. What it is really waiting for is a person to finish
 * something only a person can do.
 *
 * Bounded, and the bound is generous rather than tight - a challenge that asks someone to pick out
 * traffic lights can genuinely take a minute or two, and giving up early would leave a form filled,
 * a check passed, and nothing to show for it. It resolves false rather than throwing, so a caller
 * that times out simply leaves the application where the applicant can finish it by hand.
 */
export function waitForChallengeCleared(
  options: { root?: ParentNode; timeoutMs?: number; pollMs?: number } = {},
): { promise: Promise<boolean>; cancel: () => void } {
  const root = options.root ?? document;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const pollMs = options.pollMs ?? 1_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let settle: ((cleared: boolean) => void) | undefined;

  /* "Cleared" requires a TOKEN, not merely the absence of a widget.
   *
   * Detection legitimately flaps: this module documents a window where reCAPTCHA has rendered its
   * container but not yet its iframe, and providers tear widgets down and remount them. Treating
   * any not-waiting reading as success would tell the applicant "that check cleared" when nobody
   * cleared anything - the one claim this feature is not allowed to make - and would permanently
   * drop the stall flag with the observer already disconnected, so it could never re-arm.
   *
   * A challenge the page simply removes therefore times out rather than reporting success. That is
   * the right direction to fail: the application waits for a human instead of lying to one. */
  const cleared = (): boolean => {
    if (detectChallenge(root).waiting) return false;
    return [...root.querySelectorAll(RESPONSE_SELECTOR)]
      .some((field) => ((field as HTMLInputElement | HTMLTextAreaElement).value ?? '').trim().length > 0);
  };

  const promise = new Promise<boolean>((resolve) => {
    const onLeave = () => settle?.(false);
    settle = (result: boolean) => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      window.removeEventListener('pagehide', onLeave);
      resolve(result);
    };
    // A single-page job board never fires an unload, so without this the poll outlives the form it
    // belonged to and can fire against a page the applicant has already navigated away from.
    window.addEventListener('pagehide', onLeave);
    const deadline = Date.now() + timeoutMs;
    timer = setInterval(() => {
      if (cleared()) settle?.(true);
      else if (Date.now() >= deadline) settle?.(false);
    }, pollMs);
  });

  return { promise, cancel: () => settle?.(false) };
}
