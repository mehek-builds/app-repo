import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync('src/entrypoints/background.ts', 'utf8');

describe('secure CAPTCHA submission background wiring', () => {
  it('fails closed when automation settings cannot be loaded', () => {
    const settingsCase = background.slice(
      background.indexOf("case 'GET_AUTOMATION_SETTINGS'"),
      background.indexOf("case 'CLEAR_JOB_BADGE'"),
    );
    expect(settingsCase).toMatch(/automatic_captcha_enabled: false/g);
    expect(settingsCase).toMatch(/automatic_captcha_enabled: automaticCaptchaEnabled\(data\)/);
  });

  it('puts the review packet before requesting secure submission', () => {
    const helper = background.slice(
      background.indexOf('async function requestSecureApplicationSubmit'),
      background.indexOf('// ─── Transient model-capacity retry'),
    );
    const reviewAt = helper.indexOf('/review`');
    const submitAt = helper.indexOf('/submit-request`');
    expect(reviewAt).toBeGreaterThan(0);
    expect(submitAt).toBeGreaterThan(reviewAt);
    expect(helper).toMatch(/body: JSON\.stringify\(\{ questions: payload\.questions \}\)/);
    expect(helper).toContain('pollSecureApplicationSubmit');
    expect(background).toContain('/submission`');
    expect(background).toContain("status: 'status_unknown'");
    expect(background).toContain('stopped: false');
  });

  it('does not open a dashboard in the automatic secure path', () => {
    const secureCase = background.slice(
      background.indexOf("case 'APPLICATION_SECURE_SUBMIT_REQUEST'"),
      background.indexOf("case 'HARVEST_FIELDS'"),
    );
    expect(secureCase).toContain('requestSecureApplicationSubmit');
    expect(secureCase).not.toContain('chrome.tabs.create');
  });
});
