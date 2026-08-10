// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { detectChallenge } from './captcha-detection';
import { manualSubmissionPreflightError } from './manual-submission-preflight';

function smartRecruitersShadowCaptcha(token = ''): HTMLTextAreaElement {
  document.body.innerHTML = '<spl-input id="human-check"></spl-input>';
  const shadow = document.querySelector('spl-input')!.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div class="h-captcha" data-sitekey="abc"></div><textarea name="h-captcha-response"></textarea>';
  const challenge = shadow.querySelector('.h-captcha') as HTMLElement;
  challenge.getBoundingClientRect = () => ({
    width: 303, height: 78, top: 0, left: 0, right: 303, bottom: 78,
    x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect;
  const response = shadow.querySelector('[name="h-captcha-response"]') as HTMLTextAreaElement;
  response.value = token;
  return response;
}

describe('manual attended submission preflight', () => {
  it('sends no start and replays no click while SmartRecruiters shadow hCaptcha is unresolved', () => {
    smartRecruitersShadowCaptcha();
    let starts = 0;
    let clicks = 0;
    const error = manualSubmissionPreflightError({
      guardError: null,
      requiredFieldMissing: false,
      challengeWaiting: detectChallenge().waiting,
    });
    if (!error) {
      starts += 1;
      clicks += 1;
    }
    expect(error).toMatch(/human check/i);
    expect(starts).toBe(0);
    expect(clicks).toBe(0);
  });

  it('allows the reservation path only after a human-populated token', () => {
    smartRecruitersShadowCaptcha('human-solved-token');
    let starts = 0;
    const error = manualSubmissionPreflightError({
      guardError: null,
      requiredFieldMissing: false,
      challengeWaiting: detectChallenge().waiting,
    });
    if (!error) starts += 1;
    expect(error).toBeNull();
    expect(starts).toBe(1);
  });
});
