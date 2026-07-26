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

  it('keeps cancellation listeners active during the final permission request', () => {
    const finalCheck = content.slice(content.indexOf("if (statusEl) statusEl.textContent = 'Checking your automatic submission permission"));
    const callbackAt = finalCheck.indexOf('const finishPermissionCheck');
    expect(callbackAt).toBeGreaterThan(0);
    expect(finalCheck.slice(0, callbackAt)).not.toContain('cleanupChrome()');
    expect(finalCheck).toMatch(/const finishPermissionCheck[\s\S]*cleanupChrome\(\)[\s\S]*chrome\.runtime\.sendMessage/);
  });
});
