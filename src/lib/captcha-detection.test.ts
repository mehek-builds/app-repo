// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { hasVisibleUnresolvedCaptcha, waitForVisibleCaptchaResolution } from './captcha-detection';

describe('CAPTCHA detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds a visible unresolved reCAPTCHA widget', () => {
    document.body.innerHTML = '<div class="g-recaptcha"></div><textarea name="g-recaptcha-response"></textarea>';
    expect(hasVisibleUnresolvedCaptcha(document)).toBe(true);
  });

  it('treats a filled provider response token as solved', () => {
    document.body.innerHTML = '<div class="g-recaptcha"></div><textarea name="g-recaptcha-response">verified-token</textarea>';
    expect(hasVisibleUnresolvedCaptcha(document)).toBe(false);
  });

  it('does not let one solved widget mask another unresolved widget', () => {
    document.body.innerHTML = [
      '<div class="g-recaptcha"></div><textarea name="g-recaptcha-response">verified-token</textarea>',
      '<div class="g-recaptcha"></div><textarea name="g-recaptcha-response"></textarea>',
    ].join('');
    expect(hasVisibleUnresolvedCaptcha(document)).toBe(true);
  });

  it('does not overcount a solved widget wrapper and its nested iframe', () => {
    document.body.innerHTML = [
      '<div class="g-recaptcha" data-sitekey="controlled-key">',
      '<iframe title="reCAPTCHA"></iframe>',
      '<textarea name="g-recaptcha-response">verified-token</textarea>',
      '</div>',
    ].join('');
    expect(hasVisibleUnresolvedCaptcha(document)).toBe(false);
  });

  it('ignores hidden widgets and detects hCaptcha and Turnstile markers', () => {
    document.body.innerHTML = '<div hidden class="g-recaptcha"></div>';
    expect(hasVisibleUnresolvedCaptcha(document)).toBe(false);

    document.body.innerHTML = '<iframe title="hCaptcha checkbox"></iframe>';
    expect(hasVisibleUnresolvedCaptcha(document)).toBe(true);

    document.body.innerHTML = '<div class="cf-turnstile"></div><input name="cf-turnstile-response" value="done">';
    expect(hasVisibleUnresolvedCaptcha(document)).toBe(false);
  });

  it('waits for the applicant to complete the visible challenge', async () => {
    document.body.innerHTML = '<div class="g-recaptcha"></div><textarea name="g-recaptcha-response"></textarea>';
    const response = document.querySelector<HTMLTextAreaElement>('textarea')!;
    setTimeout(() => { response.value = 'applicant-completed-token'; }, 5);
    await expect(waitForVisibleCaptchaResolution(document, 100, 2)).resolves.toBe(true);
  });

  it('times out without modifying or clicking the challenge', async () => {
    document.body.innerHTML = '<div class="g-recaptcha"><button type="button">Challenge</button></div><textarea name="g-recaptcha-response"></textarea>';
    const challenge = document.querySelector<HTMLButtonElement>('button')!;
    let clicked = false;
    challenge.addEventListener('click', () => { clicked = true; });
    await expect(waitForVisibleCaptchaResolution(document, 8, 2)).resolves.toBe(false);
    expect(clicked).toBe(false);
  });
});
