import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { clickAtsSubmitIfAllowed } from './adapters/ats-2026-07';
import { PENDING_RECOVERY_SETTLE_MS, PendingSubmissionRecoveryGate } from './submission-recovery';

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
  });

  it('starts monitoring immediately after a successful gated click', () => {
    const events: string[] = [];
    const clicked = clickAtsSubmitIfAllowed(
      'recruitee',
      { click: () => events.push('click') } as Pick<HTMLElement, 'click'>,
      () => events.push('monitor'),
    );
    expect(clicked).toBe(true);
    expect(events).toEqual(['click', 'monitor']);
  });

  it('never clicks or monitors a denied Teamtailor submission', () => {
    const events: string[] = [];
    const clicked = clickAtsSubmitIfAllowed(
      'teamtailor',
      { click: () => events.push('click') } as Pick<HTMLElement, 'click'>,
      () => events.push('monitor'),
    );
    expect(clicked).toBe(false);
    expect(events).toEqual([]);
  });

  it('suppresses a pending poll between persistence and click, then monitors once with baseline', () => {
    const applicationId = 'application-race';
    const persistedAt = 10_000;
    const gate = new PendingSubmissionRecoveryGate();
    const monitors: Array<{ applicationId: string; baseline: string[] }> = [];
    const monitor = (id: string, baseline: ReadonlySet<string> = new Set()) => {
      monitors.push({ applicationId: id, baseline: [...baseline] });
    };

    gate.beginLocal(applicationId);
    const pending = { applicationId, startedAt: persistedAt };
    if (gate.shouldRecover(pending, persistedAt + 10)) monitor(applicationId);
    expect(monitors).toEqual([]);

    const baseline = new Set(['Apply now']);
    const clicked = clickAtsSubmitIfAllowed(
      'recruitee',
      { click: () => undefined } as Pick<HTMLElement, 'click'>,
      () => monitor(applicationId, baseline),
    );
    gate.endLocal(applicationId);

    expect(clicked).toBe(true);
    expect(monitors).toEqual([{ applicationId, baseline: ['Apply now'] }]);
  });

  it('recovers a persisted reservation after reload once it settles', () => {
    const reloadedFrameGate = new PendingSubmissionRecoveryGate();
    const pending = { applicationId: 'application-reload', startedAt: 20_000 };
    expect(reloadedFrameGate.shouldRecover(pending, 20_000 + PENDING_RECOVERY_SETTLE_MS - 1)).toBe(false);
    expect(reloadedFrameGate.shouldRecover(pending, 20_000 + PENDING_RECOVERY_SETTLE_MS)).toBe(true);
  });

  it('wires the local gate around reservation and pending recovery', () => {
    expect(content).toMatch(/pendingRecoveryGate\.beginLocal\(applicationId\)[\s\S]*?EXTENSION_SUBMISSION_START/);
    expect(content).toMatch(/pendingRecoveryGate\.shouldRecover\(pending\)/);
  });
});
