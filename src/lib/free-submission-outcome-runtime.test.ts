import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');

describe('Free manual final-submit outcome runtime', () => {
  it('arms from an existing canonical id before summary and delayed Tracker fill sync', () => {
    const freeFill = content.slice(
      content.indexOf('const resumeAttached = Boolean(resumeBlob)'),
      content.indexOf('if (showUpgrade && statusEl)'),
    );
    const earlyArm = freeFill.indexOf('armFreeManualSubmissionOutcomeWhenAvailable(data.application_id, freeFillResult.ats_name)');
    expect(earlyArm).toBeGreaterThanOrEqual(0);
    expect(earlyArm).toBeLessThan(freeFill.indexOf('renderFillSummary('));
    expect(earlyArm).toBeLessThan(freeFill.indexOf('await syncTracker()'));
  });

  it('arms from the canonical id returned by a delayed initial Tracker creation', () => {
    const freeFill = content.slice(
      content.indexOf('const trackerSync = createFreeFillTrackerSync(trackerPayload)'),
      content.indexOf('if (showUpgrade && statusEl)'),
    );
    expect(freeFill).toMatch(/const result = await trackerSync\.sync\(\)[\s\S]*?if \(result\.application_id\)[\s\S]*?armFreeManualSubmissionOutcomeWhenAvailable\(result\.application_id, freeFillResult\.ats_name\)/);
  });

  it('observes only a trusted click on the exact final control without changing native submission', () => {
    const observer = content.slice(
      content.indexOf('function armFreeManualSubmissionOutcomeTracking'),
      content.indexOf('const pendingFreeSubmissionOutcomeApplications'),
    );
    expect(observer).toContain('if (!event.isTrusted) return');
    expect(observer).toContain("submitButton.addEventListener('click', onTrustedClick, true)");
    expect(observer).toContain('const baselineUrl = window.location.href');
    expect(observer).toContain('const baselineTexts = new Set(visibleSubmissionOutcomeTexts())');
    expect(observer).toContain("type: 'START_FREE_SUBMISSION_OUTCOME_MONITOR'");
    expect(observer.indexOf("type: 'START_FREE_SUBMISSION_OUTCOME_MONITOR'")).toBeLessThan(observer.indexOf('monitorFreeSubmissionOutcome({'));
    expect(observer).not.toContain('preventDefault');
    expect(observer).not.toContain('stopPropagation');
    expect(observer).not.toContain('stopImmediatePropagation');
    expect(observer).not.toMatch(/\.click\(/);
    expect(observer).not.toContain('EXTENSION_SUBMISSION_START');
    expect(observer).not.toContain('automatic_submission');
  });

  it('uses the exact Workday final control without applying programmatic-click eligibility', () => {
    const finder = content.slice(
      content.indexOf('function findFreeManualFinalSubmitButton'),
      content.indexOf('const pendingFreeSubmissionOutcomeApplications'),
    );
    expect(finder).toContain("atsName === 'workday' ? findWorkdayFinalSubmitButton() : findFinalSubmitButton()");
    expect(finder).not.toContain('workdayProgrammaticFinalSubmitAllowed');
    const arming = content.slice(
      content.indexOf('function armFreeManualSubmissionOutcomeWhenAvailable'),
      content.indexOf('// No top-frame gating'),
    );
    expect(arming).toContain('findFreeManualFinalSubmitButton(atsName)');
  });

  it('maps only classifier confirmation, explicit failure, and timeout unknown to Free outcomes', () => {
    const observer = content.slice(
      content.indexOf('function monitorFreeSubmissionOutcome'),
      content.indexOf('function armFreeManualSubmissionOutcomeTracking'),
    );
    expect(observer).toContain('createSubmissionOutcomeController');
    expect(observer).toMatch(/outcome\.kind === 'failure'[\s\S]*?reportFreeSubmissionOutcomeWithRetry\([\s\S]*?'failed'/);
    expect(observer).toMatch(/reportFreeSubmissionOutcomeWithRetry\([\s\S]*?'confirmed'/);
    expect(observer).toMatch(/onUnknown: \(\) => reportFreeSubmissionOutcomeWithRetry\([\s\S]*?'unknown'/);
  });

  it('posts the owner-scoped manual endpoint with auth-epoch safety and no premium gate', () => {
    const handler = background.slice(
      background.indexOf("case 'RECORD_FREE_SUBMISSION_OUTCOME'"),
      background.indexOf("case 'GET_AUTOMATION_SETTINGS'"),
    );
    expect(handler).toContain('await refreshEntitlementSnapshot(token, outcomeAuthEpoch)');
    expect(handler.match(/assertCurrentAuthEpoch\(outcomeAuthEpoch\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(handler).toContain('`/applications/${effectiveApplicationId}/manual-submission-outcome`');
    expect(handler).toMatch(/'Idempotency-Key': effectiveEventId[\s\S]*?event_id: effectiveEventId[\s\S]*?outcome: effectiveOutcome,[\s\S]*?final_url: effectiveFinalUrl/);
    expect(handler).not.toContain('requireFeature');
    expect(handler).not.toContain('automatic_submission');
    expect(handler).toMatch(/if \(!response\.ok\)[\s\S]*?sendResponse\(\{ ok: true \}\)/);
  });

  it('recovers the same event after hard navigation and forces mismatched bindings to unknown', () => {
    const recovery = content.slice(
      content.indexOf('const checkPendingFreeSubmissionOutcome'),
      content.indexOf('let cardInjected = false'),
    );
    expect(recovery).toContain("type: 'GET_PENDING_FREE_SUBMISSION_OUTCOME'");
    expect(recovery).toMatch(/pending\.applicationId,[\s\S]*?pending\.eventId/);
    expect(recovery).toMatch(/force_unknown \|\| remainingMs === 0[\s\S]*?'unknown'/);
    expect(recovery).toMatch(/monitorFreeSubmissionOutcome\([\s\S]*?timeoutMs: remainingMs/);

    const getPending = background.slice(
      background.indexOf("case 'GET_PENDING_FREE_SUBMISSION_OUTCOME'"),
      background.indexOf("case 'ABANDON_FREE_SUBMISSION_OUTCOME_MONITOR'"),
    );
    expect(getPending).toContain('pending ?? pendingFreeSubmissionMonitorForTab(tabId)');
    expect(getPending).toContain("force_unknown: disposition !== 'resume'");
    expect(getPending).toContain('retry_pending: freeSubmissionMonitorStartsInFlight.has(tabId)');
    expect(recovery).toMatch(/attempt < 20 \|\| \(response\?\.retry_pending && attempt < 100\)/);
  });

  it('uses tab fallback during record and rejects every record without a pending trusted click', () => {
    const handler = background.slice(
      background.indexOf("case 'RECORD_FREE_SUBMISSION_OUTCOME'"),
      background.indexOf("case 'GET_AUTOMATION_SETTINGS'"),
    );
    expect(handler).toContain('exact ?? pendingFreeSubmissionMonitorForTab(tabId)');
    expect(handler).toMatch(/if \(!pending \|\| tabId === undefined\)[\s\S]*?submission_monitor_missing[\s\S]*?return;/);
    expect(handler.indexOf('submission_monitor_missing')).toBeLessThan(handler.indexOf('manual-submission-outcome`'));
    expect(handler).toMatch(/bindFreeSubmissionOutcome\(\{[\s\S]*?pending,[\s\S]*?eventId,[\s\S]*?applicationId,[\s\S]*?disposition/);
  });

  it('clears pending storage only after backend success or terminal retry exhaustion', () => {
    const handler = background.slice(
      background.indexOf("case 'RECORD_FREE_SUBMISSION_OUTCOME'"),
      background.indexOf("case 'GET_AUTOMATION_SETTINGS'"),
    );
    expect(handler.indexOf('if (!response.ok)')).toBeLessThan(handler.indexOf('clearPendingFreeSubmissionMonitorForTabEvent'));
    const reporter = content.slice(
      content.indexOf('function reportFreeSubmissionOutcomeWithRetry'),
      content.indexOf('function monitorFreeSubmissionOutcome'),
    );
    expect(reporter).toMatch(/if \(attempt < 4\)[\s\S]*?return;[\s\S]*?ABANDON_FREE_SUBMISSION_OUTCOME_MONITOR/);
  });
});
