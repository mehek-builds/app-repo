import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync('src/entrypoints/content.ts', 'utf8');

describe('automatic submission runtime wiring', () => {
  it('refreshes server consent before starting and again after the countdown', () => {
    expect(content).toMatch(/const autoSubmitOn = await serverAutoSubmitEnabled\(\)/);
    expect(content).toMatch(/if \(autoSubmitOn && !autoSubmitHeld && finalSubmitBtn\)/);
    expect(content).toMatch(/runAutoSubmitCountdown\(/);
    expect(content).toMatch(/GET_AUTOMATION_SETTINGS/);
  });

  it('enforces the ATS capability gate before starting a countdown', () => {
    expect(content).toMatch(/!atsCanAutoSubmit\(fillResult\.ats_name\)/);
  });

  it('enforces the ATS capability gate inside dashboard submission', () => {
    expect(content).toMatch(/submitFromDashboard = async[\s\S]{0,250}!atsCanAutoSubmit\(fillResult\.ats_name\)/);
    expect(content).toMatch(/clickDashboardSubmitIfAllowed\(fillResult\.ats_name, finalSubmitBtn\)/);
  });

  it('leaves a trusted direct page click on the manual tracking path', () => {
    const manual = content.match(/function armManualSubmissionTracking[\s\S]*?submitButton\.addEventListener\('click', onClick, true\);/)?.[0] ?? '';
    expect(manual).toContain('if (!event.isTrusted) return');
    expect(manual).toContain('submitButton.click()');
    expect(manual).not.toContain('clickAtsSubmitIfAllowed');
    expect(manual).toContain('findProgrammaticFinalSubmitButton(atsName) === submitButton');
    expect(manual).toContain('detectChallenge().waiting');
    expect(manual).toContain('document.hasFocus()');
  });

  it('rechecks live application decisions and the exact final control on every programmatic route', () => {
    const dashboard = content.match(/submitFromDashboard = async[\s\S]*?chrome\.runtime\.sendMessage\(\{\s*type: 'APPLICATION_REVIEW_READY'/)?.[0] ?? '';
    expect(dashboard).toContain('hasApplicationDecisionControls()');
    expect(dashboard).toContain('findProgrammaticFinalSubmitButton(fillResult.ats_name) !== finalSubmitBtn');

    const countdown = content.match(/function runAutoSubmitCountdown[\s\S]*?Workday account-creation speed-up/)?.[0] ?? '';
    expect(countdown.match(/hasApplicationDecisionControls\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(countdown.match(/findProgrammaticFinalSubmitButton\(fillResult\.ats_name\) === target/g)?.length).toBeGreaterThanOrEqual(3);
    expect(countdown).toMatch(/safeAfterReservation[\s\S]*detectChallenge\(\)\.waiting/);
    expect(countdown).toMatch(/safeAfterReservation[\s\S]*outcome: 'cancelled'/);
  });

  it('releases a dashboard reservation when no click occurred and preserves uncertainty after a click', () => {
    const background = readFileSync('src/entrypoints/background.ts', 'utf8');
    expect(background).toContain("result?.ok ? 'confirmed' : result?.clicked ? 'unknown' : 'cancelled'");
    expect(content).toContain("return { ok: false, clicked: true, error: 'The company never confirmed it.");
  });

  it('keeps cancellation listeners active during the final permission request', () => {
    // Anchored on the permission re-check, not on its wording. This used to grep the copy
    // itself, so a copy edit failed a test about listener ordering.
    const anchor = content.indexOf("if (statusEl) statusEl.textContent = 'Checking your settings");
    expect(anchor).toBeGreaterThan(0);
    const finalCheck = content.slice(anchor);
    const callbackAt = finalCheck.indexOf('const finishPermissionCheck');
    expect(callbackAt).toBeGreaterThan(0);
    expect(finalCheck.slice(0, callbackAt)).not.toContain('cleanupChrome()');
    expect(finalCheck).toMatch(/const finishPermissionCheck[\s\S]*cleanupChrome\(\)[\s\S]*chrome\.runtime\.sendMessage/);
  });
});
