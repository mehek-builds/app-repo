// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  detectChallenge,
  identifyProvider,
  snapshotRequiresAttention,
  watchForChallenge,
} from './captcha-detection';

/* Real ATS pages, built as real DOM. Every fixture below is a shape that shipped a bug on the
 * server side, so the extension is tested against the same ones rather than against markup invented
 * to make the code look right. */

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

/** jsdom gives every element a 0x0 box, so visibility has to be stubbed to test it at all. */
function withBox(selector: string, box: { width: number; height: number }): void {
  for (const node of document.querySelectorAll(selector)) {
    (node as HTMLElement).getBoundingClientRect = () => ({
      width: box.width, height: box.height, top: 0, left: 0, right: box.width, bottom: box.height,
      x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
  }
}

describe('snapshotRequiresAttention', () => {
  it('treats a rendered widget with an empty token as waiting', () => {
    expect(snapshotRequiresAttention([''], 1)).toBe(true);
  });

  it('treats a filled token as solved', () => {
    expect(snapshotRequiresAttention(['provider-token'], 1)).toBe(false);
  });

  it('does not let one solved widget mask another that is still waiting', () => {
    expect(snapshotRequiresAttention(['provider-token', ''], 2)).toBe(true);
  });

  it('does not overcount one widget rendered as several nodes', () => {
    expect(snapshotRequiresAttention(['provider-token'], 3)).toBe(false);
  });

  it('reports nothing when no challenge is rendered', () => {
    expect(snapshotRequiresAttention([], 0)).toBe(false);
  });

  it('treats a rendered widget with no response field as waiting', () => {
    expect(snapshotRequiresAttention([], 1)).toBe(true);
  });

  // A provider that writes whitespace has not been cleared by anyone.
  it('does not accept whitespace as a solved token', () => {
    expect(snapshotRequiresAttention(['  \n '], 1)).toBe(true);
  });
});

describe('detectChallenge', () => {
  it('reports an unsolved reCAPTCHA v2 widget as waiting', () => {
    mount(`
      <form>
        <div class="g-recaptcha" data-sitekey="abc"><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>
        <textarea name="g-recaptcha-response"></textarea>
      </form>
    `);
    withBox('.g-recaptcha, iframe', { width: 304, height: 78 });
    const state = detectChallenge();
    expect(state.waiting).toBe(true);
    expect(state.provider).toBe('recaptcha_v2');
  });

  it('reports the same widget as clear once the applicant solves it', () => {
    mount(`
      <form>
        <div class="g-recaptcha" data-sitekey="abc"><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>
        <textarea name="g-recaptcha-response">03AGdBq26...</textarea>
      </form>
    `);
    withBox('.g-recaptcha, iframe', { width: 304, height: 78 });
    expect(detectChallenge().waiting).toBe(false);
  });

  /* The v3 regression. The badge is a CONTAINER: its inner anchor iframe matches
   * iframe[src*="captcha"] on its own, has no badge class, and contains no badge. A self-or-
   * descendant check counts it and the page reports blocked, even though v3 asks nobody anything. */
  it('does not stall on a reCAPTCHA v3 page, badge and inner iframe included', () => {
    mount(`
      <form>
        <div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?..."></iframe></div>
        <textarea name="g-recaptcha-response"></textarea>
      </form>
    `);
    withBox('.grecaptcha-badge, iframe', { width: 256, height: 60 });
    expect(detectChallenge().waiting).toBe(false);
  });

  it('still stalls when a real widget is rendered alongside the v3 badge', () => {
    mount(`
      <form>
        <div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>
        <div class="g-recaptcha" data-sitekey="abc"></div>
        <textarea name="g-recaptcha-response"></textarea>
      </form>
    `);
    withBox('.grecaptcha-badge, .g-recaptcha, iframe', { width: 304, height: 78 });
    expect(detectChallenge().waiting).toBe(true);
  });

  it('identifies hCaptcha', () => {
    mount(`
      <form>
        <div class="h-captcha" data-sitekey="abc"><iframe src="https://newassets.hcaptcha.com/captcha"></iframe></div>
        <textarea name="h-captcha-response"></textarea>
      </form>
    `);
    withBox('.h-captcha, iframe', { width: 303, height: 78 });
    const state = detectChallenge();
    expect(state.waiting).toBe(true);
    expect(state.provider).toBe('hcaptcha');
  });

  it('identifies Cloudflare Turnstile', () => {
    mount(`
      <form>
        <div class="cf-turnstile" data-sitekey="abc"><iframe src="https://challenges.cloudflare.com/turnstile"></iframe></div>
        <input name="cf-turnstile-response" value="">
      </form>
    `);
    withBox('.cf-turnstile, iframe', { width: 300, height: 65 });
    const state = detectChallenge();
    expect(state.waiting).toBe(true);
    expect(state.provider).toBe('turnstile');
  });

  /* Straight from the honeypot guard: a 1x1 clipped node and a 250x40 node inside a collapsed
   * ancestor are both invisible to a human, and neither should stall a fill. */
  it('ignores a challenge node that no human can see', () => {
    mount(`
      <form>
        <div class="captcha-placeholder" data-sitekey="abc"></div>
        <textarea name="g-recaptcha-response"></textarea>
      </form>
    `);
    withBox('.captcha-placeholder', { width: 1, height: 1 });
    expect(detectChallenge().waiting).toBe(false);
  });

  it('reports nothing on an ordinary application form', () => {
    mount('<form><input name="first_name"><input name="email"><button>Submit</button></form>');
    expect(detectChallenge()).toEqual({ waiting: false, provider: 'unknown' });
  });
});

describe('identifyProvider', () => {
  it('reads a badge-only page as v3, which asks nothing of a human', () => {
    mount('<div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>');
    expect(identifyProvider()).toBe('recaptcha_v3');
  });

  it('prefers the newer vendor when a page carries leftover markup from both', () => {
    mount(`
      <div class="cf-turnstile"><iframe src="https://challenges.cloudflare.com/turnstile"></iframe></div>
      <textarea name="g-recaptcha-response"></textarea>
    `);
    expect(identifyProvider()).toBe('turnstile');
  });
});

describe('watchForChallenge', () => {
  it('fires immediately when the page already has a challenge', () => {
    mount(`
      <form>
        <div class="g-recaptcha" data-sitekey="abc"></div>
        <textarea name="g-recaptcha-response"></textarea>
      </form>
    `);
    withBox('.g-recaptcha', { width: 304, height: 78 });
    const onChallenge = vi.fn();
    watchForChallenge(document.body, onChallenge);
    expect(onChallenge).toHaveBeenCalledTimes(1);
  });

  /* The shape that made this silent: the form looks clean, the applicant presses Submit, nothing
   * appears to happen, and a challenge mounts a moment later. */
  it('fires when a challenge mounts after the fill', async () => {
    const form = mount('<form><input name="email"></form>').querySelector('form')!;
    const onChallenge = vi.fn();
    watchForChallenge(form, onChallenge, { root: document });

    const widget = document.createElement('div');
    widget.className = 'g-recaptcha';
    widget.setAttribute('data-sitekey', 'abc');
    form.appendChild(widget);
    const token = document.createElement('textarea');
    token.setAttribute('name', 'g-recaptcha-response');
    form.appendChild(token);
    withBox('.g-recaptcha', { width: 304, height: 78 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChallenge).toHaveBeenCalledTimes(1);
    expect(onChallenge.mock.calls[0]![0].provider).toBe('recaptcha_v2');
  });

  it('stops watching after it fires, so provider re-renders cannot re-trigger it', async () => {
    const form = mount('<form><input name="email"></form>').querySelector('form')!;
    const onChallenge = vi.fn();
    watchForChallenge(form, onChallenge, { root: document });

    const widget = document.createElement('div');
    widget.className = 'g-recaptcha';
    widget.setAttribute('data-sitekey', 'abc');
    form.appendChild(widget);
    withBox('.g-recaptcha', { width: 304, height: 78 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    widget.setAttribute('class', 'g-recaptcha rendered');
    form.appendChild(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChallenge).toHaveBeenCalledTimes(1);
  });

  it('can be stopped, and does not fire afterwards', async () => {
    const form = mount('<form><input name="email"></form>').querySelector('form')!;
    const onChallenge = vi.fn();
    const stop = watchForChallenge(form, onChallenge, { root: document });
    stop();

    const widget = document.createElement('div');
    widget.className = 'g-recaptcha';
    widget.setAttribute('data-sitekey', 'abc');
    form.appendChild(widget);
    withBox('.g-recaptcha', { width: 304, height: 78 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onChallenge).not.toHaveBeenCalled();
  });
});

describe('the container-before-iframe window', () => {
  /* reCAPTCHA renders its container first and mounts the anchor iframe a moment later. A fill runs
   * the instant the form is ready, so this is the window it is most likely to observe. Matching only
   * the iframe labelled it v3, which means "nothing is being asked of a human" - the opposite of the
   * truth. */
  it('reads a keyed container with no iframe yet as the blocking v2, not v3', () => {
    mount(`
      <form>
        <div class="g-recaptcha" data-sitekey="abc"></div>
        <textarea name="g-recaptcha-response"></textarea>
      </form>
    `);
    withBox('.g-recaptcha', { width: 304, height: 78 });
    expect(identifyProvider()).toBe('recaptcha_v2');
  });

  it('still reads a badge-only page as v3 once the container rule is in play', () => {
    mount(`
      <div class="grecaptcha-badge">
        <iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>
      </div>
      <textarea name="g-recaptcha-response"></textarea>
    `);
    expect(identifyProvider()).toBe('recaptcha_v3');
  });
});
