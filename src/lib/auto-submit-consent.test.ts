import { describe, expect, it } from 'vitest';
import { automaticCaptchaEnabled, automaticSubmissionEnabled, groundedDraftAnswer } from './auto-submit-consent';

describe('automatic submission consent', () => {
  it('fails closed for missing, malformed, and disabled responses', () => {
    expect(automaticSubmissionEnabled(undefined)).toBe(false);
    expect(automaticSubmissionEnabled({})).toBe(false);
    expect(automaticSubmissionEnabled({ automatic_submission_enabled: 'true' })).toBe(false);
    expect(automaticSubmissionEnabled({ automatic_submission_enabled: false })).toBe(false);
  });

  it('accepts only an explicit server boolean', () => {
    expect(automaticSubmissionEnabled({ automatic_submission_enabled: true })).toBe(true);
  });
});

describe('automatic CAPTCHA consent', () => {
  it('fails closed unless the server returns an explicit true boolean', () => {
    expect(automaticCaptchaEnabled(undefined)).toBe(false);
    expect(automaticCaptchaEnabled({})).toBe(false);
    expect(automaticCaptchaEnabled({ automatic_captcha_enabled: 'true' })).toBe(false);
    expect(automaticCaptchaEnabled({ automatic_captcha_enabled: false })).toBe(false);
    expect(automaticCaptchaEnabled({ automatic_captcha_enabled: true })).toBe(true);
  });
});

describe('grounded drafts', () => {
  it('rejects prose without an affirmative grounding result', () => {
    expect(groundedDraftAnswer({ answer: 'Draft' })).toBeNull();
    expect(groundedDraftAnswer({ answer: 'Draft', grounded: false })).toBeNull();
    expect(groundedDraftAnswer({ answer: '', grounded: true })).toBeNull();
  });

  it('returns prose only when the server verified grounding', () => {
    expect(groundedDraftAnswer({ answer: 'Grounded draft', grounded: true })).toBe('Grounded draft');
  });
});
