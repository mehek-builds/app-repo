import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync('src/entrypoints/content.ts', 'utf8');

describe('automatic submission runtime wiring', () => {
  it('refreshes server consent before starting and again after the countdown', () => {
    expect(content).toMatch(/const automationSettings = await serverAutomationSettings\(\)/);
    expect(content).toMatch(/const autoSubmitOn = automationSettings\.automatic_submission_enabled/);
    expect(content).toMatch(/if \(autoSubmitOn && !autoSubmitHeld && finalSubmitBtn\)/);
    expect(content).toMatch(/runAutoSubmitCountdown\(/);
    expect(content).toMatch(/GET_AUTOMATION_SETTINGS/);
  });

  it('waits for the applicant, refreshes consent, and never clicks the CAPTCHA', () => {
    const captchaBranch = content.slice(content.indexOf('if (hasVisibleUnresolvedCaptcha(document))'));
    expect(captchaBranch).toMatch(/if \(!automationSettings\.automatic_captcha_enabled\)[\s\S]*return/);
    expect(captchaBranch).toMatch(/if \(autoSubmitOn\)[\s\S]*await waitForVisibleCaptchaResolution\(document\)/);
    expect(captchaBranch).toMatch(/const refreshedSettings = await serverAutomationSettings\(\)/);
    expect(captchaBranch).toMatch(/refreshedSettings\.automatic_submission_enabled[\s\S]*refreshedSettings\.automatic_captcha_enabled/);
    expect(captchaBranch).toMatch(/runAutoSubmitCountdown\(/);
    expect(captchaBranch).not.toMatch(/APPLICATION_SECURE_SUBMIT_REQUEST/);
    expect(captchaBranch.slice(0, captchaBranch.indexOf('const autoSubmitHeld'))).not.toMatch(/\.click\(/);
  });

  it('keeps cancellation listeners active during the final permission request', () => {
    const finalCheck = content.slice(content.indexOf("if (statusEl) statusEl.textContent = 'Checking your automatic submission permission"));
    const callbackAt = finalCheck.indexOf('const finishPermissionCheck');
    expect(callbackAt).toBeGreaterThan(0);
    expect(finalCheck.slice(0, callbackAt)).not.toContain('cleanupChrome()');
    expect(finalCheck).toMatch(/const finishPermissionCheck[\s\S]*cleanupChrome\(\)[\s\S]*chrome\.runtime\.sendMessage/);
  });
});
