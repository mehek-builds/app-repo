import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

describe('extension submission synchronization wiring', () => {
  it('isolates pending claims by tab and reconciles closed or stale tabs', () => {
    expect(background).toMatch(/pendingSubmissionKey\(tabId/);
    expect(background).toMatch(/chrome\.tabs\.onRemoved\.addListener/);
    expect(background).toMatch(/PENDING_SUBMISSION_MAX_AGE_MS/);
    expect(background).toMatch(/frameId: sender\.frameId/);
  });

  it('reserves manual submissions before allowing the employer click', () => {
    expect(content).toMatch(/event\.preventDefault\(\)/);
    expect(content).toMatch(/event\.stopImmediatePropagation\(\)/);
    expect(content).toMatch(/submitButton\.removeEventListener[\s\S]*?submitButton\.click\(\)/);
  });

  it('ignores pre-existing and hidden confirmation content', () => {
    expect(content).toMatch(/getClientRects\(\)\.length > 0/);
    expect(content).toMatch(/baselineTexts\.has\(text\)/);
    expect(content).toMatch(/target\.click\(\);[\s\S]*?monitorExtensionSubmission\(applicationId, baselineTexts\)/);
  });
});
