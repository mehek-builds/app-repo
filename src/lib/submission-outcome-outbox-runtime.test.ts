import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../wxt.config.ts', import.meta.url), 'utf8');
const receiptRenderer = readFileSync(new URL('./submission-receipt-renderer.ts', import.meta.url), 'utf8');

function slice(start: string, end: string): string {
  const from = background.indexOf(start);
  return background.slice(from, background.indexOf(end, from));
}

describe('submission attempt journal runtime wiring', () => {
  it('persists generated and Free outcomes before token, billing, or network', () => {
    const extension = slice('async function postExtensionOutcome(', 'let submissionOutcomeReplayInFlight');
    const extensionPersist = extension.indexOf('submissionOutcomeOutbox.persist({');
    expect(extensionPersist).toBeGreaterThanOrEqual(0);
    expect(extensionPersist).toBeLessThan(extension.indexOf('getStoredToken()'));
    expect(extensionPersist).toBeLessThan(extension.indexOf('refreshEntitlementSnapshot(token, outcomeAuthEpoch)'));
    expect(extension).toContain('receiptProof');

    const free = slice('async function postFreeSubmissionOutcome(', 'async function reconcileFreeManualSubmissionStatesForTab');
    const freePersist = free.indexOf('submissionOutcomeOutbox.persist({');
    expect(freePersist).toBeGreaterThanOrEqual(0);
    expect(freePersist).toBeLessThan(free.indexOf('getStoredToken()'));
    expect(freePersist).toBeLessThan(free.indexOf('refreshEntitlementSnapshot(token, expectedAuthEpoch)'));
    expect(free).toContain('receiptProof');
  });

  it('atomically arms the durable journal before either employer capability is exposed', () => {
    const freeFill = slice("case 'GET_FREE_FILL_DATA'", "case 'REFRESH_FREE_MANUAL_RETRY_SAFETY'");
    expect(freeFill).toMatch(/submissionOutcomeOutbox\.arm\(\{[\s\S]*?lane: 'free'[\s\S]*?reserveFreeManualSubmission[\s\S]*?sendResponse\(\{/);

    const extensionStart = slice("case 'EXTENSION_SUBMISSION_START'", "case 'EXTENSION_SUBMISSION_PRESS_COMMITTED'");
    expect(extensionStart).toMatch(/extension-start[\s\S]*?setPendingSubmission\(tabId, pending[\s\S]*?sendResponse\(\{ ok: true/);
    const setter = slice('async function setPendingSubmission(', 'function freeManualReservationKey');
    expect(setter).toContain('submissionOutcomeOutbox.arm({');

    const freePreflight = slice("case 'PREFLIGHT_FREE_MANUAL_SUBMISSION'", "case 'CANCEL_FREE_MANUAL_SUBMISSION'");
    expect(freePreflight).toMatch(/manual-submission-preflight[\s\S]*?authorizePendingFreeManualSubmissionMonitor[\s\S]*?sendResponse\(\{/);
    const authorize = slice('async function authorizePendingFreeManualSubmissionMonitor(', 'async function closeAuthorizedFreeManualSubmissionBeforeResponse');
    expect(authorize).toMatch(/submissionOutcomeOutbox\.markPressed\([\s\S]*?chrome\.storage\.session\.set/);

    const generatedPress = slice("case 'EXTENSION_SUBMISSION_PRESS_COMMITTED'", "case 'EXTENSION_SUBMISSION_OUTCOME'");
    expect(generatedPress).toContain('submissionOutcomeOutbox.markPressed({');
    expect(content).toMatch(/EXTENSION_SUBMISSION_PRESS_COMMITTED[\s\S]*?pressResponse\?\.ok === true[\s\S]*?submitButton\.click\(\)/);
  });

  it('uses trusted background URLs and exact typed receipt proof', () => {
    const extension = slice("case 'EXTENSION_SUBMISSION_OUTCOME'", "case 'GET_PENDING_EXTENSION_SUBMISSION'");
    expect(extension).toContain("String(sender.url ?? '')");
    expect(extension).not.toContain('message.payload?.finalUrl');
    expect(extension).toContain('exactSubmissionReceiptProof(message.payload?.receiptProof)');

    const free = slice("case 'RECORD_FREE_SUBMISSION_OUTCOME'", "case 'GET_AUTOMATION_SETTINGS'");
    expect(free).toContain('const finalUrl = safeFreeSubmissionUrl(sender.url)');
    expect(free).not.toContain('safeFreeSubmissionUrl(payload?.final_url)');
    expect(free).toContain('exactSubmissionReceiptProof(payload?.receipt_proof)');

    const dashboard = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));
    expect(dashboard).toMatch(/chrome\.tabs\.sendMessage[\s\S]*?chrome\.tabs\.get\(tabId\)[\s\S]*?postExtensionOutcome/);
  });

  it('replays on every required wake without bypassing retry backoff', () => {
    expect(background).toMatch(/defineBackground\([\s\S]*?replaySubmissionOutcomeOutbox\(false\)/);
    expect(background).toMatch(/onStartup\?\.addListener[\s\S]*?replaySubmissionOutcomeOutbox\(false\)/);
    expect(background).toMatch(/onInstalled\.addListener[\s\S]*?replaySubmissionOutcomeOutbox\(false\)/);
    expect(background).toMatch(/storage\.onChanged\.addListener[\s\S]*?changes\.litos_token[\s\S]*?replaySubmissionOutcomeOutbox\(false\)/);
    expect(background).toMatch(/GET_PENDING_FREE_SUBMISSION_OUTCOME[\s\S]*?replaySubmissionOutcomeOutbox\(false\)/);
    expect(background).toMatch(/GET_PENDING_EXTENSION_SUBMISSION[\s\S]*?replaySubmissionOutcomeOutbox\(false\)/);
    expect(background).toMatch(/alarms\.onAlarm\.addListener[\s\S]*?replaySubmissionOutcomeOutbox\(false\)/);
    expect(background).not.toContain('replaySubmissionOutcomeOutbox(true)');
    expect(config).toContain("'alarms'");
  });

  it('rebuilds generated and Free pending state from the local journal after restart or update', () => {
    const generated = slice('async function pendingSubmission(', 'async function setPendingSubmission');
    expect(generated).toContain('submissionOutcomeOutbox.list()');
    expect(generated).toContain("entry.lane === 'extension'");
    expect(generated).toContain('applicationFormIdentityKey(entry.startUrl)');

    const freeStartup = slice('async function pendingFreeManualSubmissionStartupState(', 'async function storePendingFreeManualReservation');
    expect(freeStartup).toContain("entry.lane === 'free'");
    expect(freeStartup).toContain("candidates[0]!.phase !== 'armed'");
    expect(freeStartup).toMatch(/candidates\[0\]!\.phase !== 'armed'[\s\S]*?blocked: true/);
    expect(freeStartup).toContain('submissionOutcomeOutbox.rebindArmedContext({');
    expect(freeStartup).toContain('chrome.storage.session.set');

    const freeMonitor = slice('async function pendingFreeSubmissionMonitor(', 'async function pendingFreeSubmissionMonitorForTab');
    expect(freeMonitor).toContain('submissionOutcomeOutbox.list()');
    expect(background).not.toContain('litos_pending_extension_submission');
    const updateFence = slice('chrome.runtime.onUpdateAvailable.addListener', 'void releaseUpdateFence.resume');
    expect(updateFence).not.toContain('SUBMISSION_OUTCOME_OUTBOX_STORAGE_KEY');
    const shieldRecovery = content.slice(
      content.indexOf('const checkPendingFreeManualReservation'),
      content.indexOf('const checkPendingFreeSubmissionOutcome'),
    );
    expect(shieldRecovery).toMatch(/response\?\.blocked === false[\s\S]*?releasePreArmBoundaryShield/);
  });

  it('never labels an unjournaled native-page text match as a saved receipt', () => {
    const nativeCard = content.slice(
      content.indexOf('function injectSubmitCard('),
      content.indexOf('function resumeFillCardShell(', content.indexOf('function injectSubmitCard(')),
    );
    expect(nativeCard).not.toContain("titleEl.textContent = 'Saving receipt'");
    expect(nativeCard).not.toContain('Employer confirmation found, saving receipt.');
    expect(nativeCard).toContain('receipt not yet saved');

    const durableSaving = content.slice(
      content.indexOf('function renderReceiptSavingState('),
      content.indexOf('function renderReceiptSubmittedState('),
    );
    expect(durableSaving).toContain('submissionReceiptPresentation()');
    expect(durableSaving).toContain('renderBoundSubmissionReceipt({');
    expect(content).toMatch(/journalPhase === 'outcome'[\s\S]*?renderReceiptSavingState\(pending\.startUrl\)/);
  });

  it('closes and drains the start gate before logout reads token, ownership, or journal state', () => {
    const logout = slice('async function clearExtensionAccountSession(): Promise<void>', 'const respondToClearSessionMessage');
    expect(logout).toMatch(/closeSubmissionStartGate\(\)[\s\S]*?clearExtensionAccountSessionWithinClosedGate/);
    const protectedLogout = slice('async function clearExtensionAccountSessionWithinClosedGate()', 'async function clearExtensionAccountSession(): Promise<void>');
    expect(protectedLogout).toMatch(/getStoredToken[\s\S]*?logoutSubmissionState/);
    expect(protectedLogout).toMatch(/activeAttemptAccountIds\.size > 0[\s\S]*?sign out was stopped/);
    expect(protectedLogout).toContain('quarantinedCount > 0');
    expect(logout).toContain('reopenSubmissionStartGate()');
  });

  it('binds every acknowledgement lookup and live wake to the frozen posting identity', () => {
    const lookup = slice('async function acknowledgedSubmissionForContext(', 'async function setPendingSubmission');
    expect(lookup).toContain('applicationFormIdentityKey(entry.startUrl) === currentIdentity');
    expect(lookup).not.toMatch(/entry\.tabId === tabId[\s\S]*?\|\|/);

    const generatedPending = slice('async function pendingSubmission(', 'async function acknowledgedSubmissionForContext');
    expect(generatedPending).toMatch(/currentIdentity[\s\S]*?applicationFormIdentityKey\(entry\.startUrl\) === currentIdentity/);
    expect(generatedPending).toContain(".filter((entry) => currentIdentity\n      ? applicationFormIdentityKey(entry.startUrl) === currentIdentity\n      : entry.tabId === tabId");

    const wake = slice('async function wakeAcknowledgedSubmissionOutcome(', 'async function deliverSavedSubmissionOutcome');
    expect(wake).toContain('start_url: projection.startUrl');
    expect(wake).toMatch(/response\?\.rendered === true[\s\S]*?consumeAcknowledgement\(projection\)/);

    const renderer = content.slice(
      content.indexOf("if (message?.type === 'LITOS_SUBMISSION_RECEIPT_ACKNOWLEDGED')"),
      content.indexOf("if (message?.type === 'FOCUS_PREMIUM_RETRY_CONTROL')"),
    );
    expect(renderer).toContain('renderReceiptSubmittedState(startUrl)');
    expect(receiptRenderer).toMatch(/applicationFormIdentityKey\(input\.frozenStartUrl\)[\s\S]*?applicationFormIdentityKey\(input\.currentUrl\)/);
    expect(receiptRenderer).toMatch(/!frozenIdentity \|\| !currentIdentity \|\| frozenIdentity !== currentIdentity/);
    expect(receiptRenderer).toContain('card.dataset.litosReceiptProvenance !== input.provenance');
    expect(receiptRenderer).toContain('checkVisibility.call(card');
    expect(receiptRenderer).toContain('checkOpacity: true');
    expect(receiptRenderer).toContain('checkVisibilityCSS: true');
    expect(receiptRenderer).toContain("style.getPropertyValue('content-visibility') === 'hidden'");
    expect(receiptRenderer).toMatch(/getClientRects\(\)[\s\S]*?rect\.width > 0 && rect\.height > 0/);
    expect(receiptRenderer).toMatch(/visiblyMeasured\(card\)[\s\S]*?visiblyMeasured\(title\)[\s\S]*?visiblyMeasured\(status\)/);
    expect(content).toContain('const receiptCardProvenance = crypto.randomUUID()');
    expect(content).toContain('const ownedReceiptStatusCards = new WeakSet<HTMLElement>()');
    expect(content).toMatch(/ownedReceiptStatusCards\.has\(existing\)[\s\S]*?existing\.dataset\.litosReceiptProvenance === receiptCardProvenance/);
    expect(content).toContain('provenance: receiptCardProvenance');
  });

  it('lets an acknowledged Free receipt dominate stale session cache until verified rendering', () => {
    const pending = slice("case 'GET_PENDING_FREE_SUBMISSION_OUTCOME'", "case 'ABANDON_FREE_SUBMISSION_OUTCOME_MONITOR'");
    const ackLookup = pending.indexOf("acknowledgedSubmissionForContext('free'");
    const pendingBranch = pending.indexOf('if (!pending)');
    expect(ackLookup).toBeGreaterThanOrEqual(0);
    expect(ackLookup).toBeLessThan(pendingBranch);
    expect(pending).toMatch(/if \(acknowledged\) \{[\s\S]*?clearAcknowledgedFreeSubmissionSessionCache[\s\S]*?pending: null,[\s\S]*?acknowledged/);

    const cleanup = slice('async function clearAcknowledgedFreeSubmissionSessionCache(', 'async function transitionPendingFreeManualReservationToMonitor');
    expect(cleanup).toMatch(/eventId === acknowledgement\.attemptId[\s\S]*?applicationId === acknowledgement\.applicationId[\s\S]*?accountId === acknowledgement\.accountId[\s\S]*?startUrl === acknowledgement\.startUrl/);
    expect(cleanup).toMatch(/chrome\.storage\.session\.remove\(key\)[\s\S]*?chrome\.storage\.session\.get\(null\)[\s\S]*?if \(stillPresent\) throw/);

    const wake = slice('async function wakeAcknowledgedSubmissionOutcome(', 'async function deliverSavedSubmissionOutcome');
    expect(wake).toMatch(/projection\.lane === 'free'[\s\S]*?clearAcknowledgedFreeSubmissionSessionCache\(projection\)[\s\S]*?chrome\.tabs\.sendMessage/);

    const rendered = slice("case 'SUBMISSION_RECEIPT_ACKNOWLEDGED_RENDERED'", "case 'CLEAR_JOB_BADGE'");
    expect(rendered).toMatch(/acknowledged\.lane === 'free'[\s\S]*?clearAcknowledgedFreeSubmissionSessionCache\(acknowledged\)[\s\S]*?consumeAcknowledgement\(acknowledged\)/);
    expect(pending).toMatch(/catch \{[\s\S]*?receipt_cleanup_pending: true[\s\S]*?return;/);
  });

  it('validates trusted Free frame identity before profile release, reservation, or journal arm', () => {
    const freeFill = slice("case 'GET_FREE_FILL_DATA'", "case 'REFRESH_FREE_MANUAL_RETRY_SAFETY'");
    const trusted = freeFill.indexOf('const trustedSenderUrl = safeFreeSubmissionUrl(sender.url)');
    const mismatch = freeFill.indexOf("code: 'free_manual_submission_context_mismatch'");
    const token = freeFill.indexOf('getStoredToken().then');
    const arm = freeFill.indexOf('submissionOutcomeOutbox.arm({');
    const reserve = freeFill.indexOf('const reservation = await reserveFreeManualSubmission(');
    const response = freeFill.indexOf('sendResponse({\n              profile,');
    expect(trusted).toBeGreaterThanOrEqual(0);
    expect(trusted).toBeLessThan(mismatch);
    expect(mismatch).toBeLessThan(token);
    expect(freeFill).toMatch(/candidate\.submission_event_id !== requestedSubmissionEventId[\s\S]*?freeSubmissionNavigationMatches[\s\S]*?applicationFormIdentityKey/);
    expect(freeFill.indexOf('await validatedFillData()')).toBeLessThan(arm);
    expect(arm).toBeLessThan(reserve);
    expect(reserve).toBeLessThan(response);
  });

  it('keeps generated submission capability hard-disabled before any claim or click path', () => {
    expect(background).toContain('const GENERATED_EXTENSION_SUBMISSION_ENABLED = false;');
    const start = slice("case 'EXTENSION_SUBMISSION_START'", "case 'EXTENSION_SUBMISSION_PRESS_COMMITTED'");
    expect(start).toMatch(/if \(!GENERATED_EXTENSION_SUBMISSION_ENABLED\)[\s\S]*?return false;/);
    expect(start.indexOf('if (!GENERATED_EXTENSION_SUBMISSION_ENABLED)')).toBeLessThan(start.indexOf('/extension-start'));
    const dashboard = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));
    expect(dashboard).toMatch(/if \(!GENERATED_EXTENSION_SUBMISSION_ENABLED\)[\s\S]*?sendResponse\(\{[\s\S]*?return true;/);
    expect(content).toContain('const GENERATED_EXTENSION_SUBMISSION_ENABLED = false;');
    expect(content).toMatch(/if \(GENERATED_EXTENSION_SUBMISSION_ENABLED && autoSubmitOn[\s\S]*?runAutoSubmitCountdown/);
    expect(content).toMatch(/if \(finalSubmitBtn && GENERATED_EXTENSION_SUBMISSION_ENABLED\)[\s\S]*?armManualSubmissionTracking/);
  });

  it('surfaces permanent journal repair without re-enabling employer submission', () => {
    expect(content).toMatch(/journalRepairReason[\s\S]*?renderReceiptRepairState\(pending\.startUrl\)/);
    expect(content).toContain('submissionReceiptPresentation(undefined, true)');
    expect(background).toContain('journalRepairReason: journal?.repairReason');
  });

  it('creates identity-bound pending UI and derives dead-letter visibility without journal mutation', () => {
    const generatedRecovery = content.slice(
      content.indexOf('const checkPendingSubmission'),
      content.indexOf('let startupManualReservationRetryTimer'),
    );
    const freeRecovery = content.slice(
      content.indexOf('const checkPendingFreeSubmissionOutcome'),
      content.indexOf('let cardInjected = false'),
    );
    expect(generatedRecovery).toMatch(/journalPhase === 'pressed' \|\| recoveringWeakOutcome[\s\S]*?renderReceiptPendingState\(pending\.startUrl\)/);
    expect(freeRecovery).toMatch(/journalPhase === 'pressed' \|\| recoveringWeakOutcome[\s\S]*?renderReceiptPendingState\(pending\.startUrl\)/);
    expect(content).toMatch(/renderExtensionLateObservationExpiry[\s\S]*?receipt_visibility === 'dead_letter'[\s\S]*?renderReceiptDeadLetterState\(startUrl\)/);
    expect(content).toMatch(/renderFreeLateObservationExpiry[\s\S]*?receipt_visibility === 'dead_letter'[\s\S]*?renderReceiptDeadLetterState\(startUrl\)/);
    expect(content).not.toContain('pending.startUrl ?? window.location.href');
    expect(background).toContain('submissionOutcomeReceiptVisibility');
  });

  it('runs one measured receipt scan even when a recovered weak deadline is already zero', () => {
    const freeRecovery = content.slice(
      content.indexOf('const checkPendingFreeSubmissionOutcome'),
      content.indexOf('let cardInjected = false'),
    );
    expect(freeRecovery).not.toContain('recoveringWeakOutcome && remainingMs === 0) return');
    expect(freeRecovery).toMatch(/lateObservation: recoveringWeakOutcome/);
    const freeMonitor = content.slice(
      content.indexOf('function monitorFreeSubmissionOutcome'),
      content.indexOf('function startFreeSubmissionOutcomeMonitor'),
    );
    expect(freeMonitor).toMatch(/controller\.scan\(\);[\s\S]*?return stopResources/);

    const generatedRecovery = content.slice(
      content.indexOf('const checkPendingSubmission'),
      content.indexOf('let startupManualReservationRetryTimer'),
    );
    expect(generatedRecovery).toMatch(/recoveringWeakOutcome[\s\S]*?monitorExtensionSubmission\([\s\S]*?remainingMs/);
  });

  it('blocks logout and new starts on malformed Free session storage until repair', () => {
    const capacity = slice('async function assertSubmissionOutcomeCapacity(', 'function outcomeEpochAllowsPending');
    expect(capacity).toMatch(/FREE_MANUAL_RESERVATION_PREFIX[\s\S]*?kind === 'malformed'[\s\S]*?needs repair/);
    const logoutState = slice('async function logoutSubmissionState(', 'async function boundedLogoutOutcomeDrain');
    expect(logoutState).toMatch(/classified\.kind === 'malformed'[\s\S]*?malformedFreeSessionCount \+= 1/);
    const logout = slice('async function clearExtensionAccountSessionWithinClosedGate(', 'async function clearExtensionAccountSession()');
    expect(logout).toMatch(/malformedFreeSessionCount > 0[\s\S]*?sign out was stopped/);
    const startup = slice('async function pendingFreeManualSubmissionStartupState(', 'async function storePendingFreeManualReservation');
    expect(startup).toMatch(/kind === 'malformed'[\s\S]*?integrityBlocked: true/);
    expect(content).toMatch(/response\?\.integrity_blocked[\s\S]*?renderReceiptRepairState/);
  });
});
