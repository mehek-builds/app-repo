import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');

describe('Free manual final-submit outcome runtime', () => {
  it('creates one fill-invocation id and requires both canonical application and reservation ids', () => {
    const freeFill = content.slice(
      content.indexOf('const runFreeFactualFill = async'),
      content.indexOf('if (showUpgrade && statusEl)'),
    );
    expect(freeFill).toContain('const requestedSubmissionEventId = crypto.randomUUID()');
    expect(freeFill).toMatch(/type: 'GET_FREE_FILL_DATA'[\s\S]*?submission_event_id: requestedSubmissionEventId/);
    const reservationGuard = freeFill.indexOf('!isValidFreeFillApplicationId(data.application_id)');
    expect(reservationGuard).toBeGreaterThanOrEqual(0);
    expect(freeFill.slice(reservationGuard, freeFill.indexOf('if (!data.profile')))
      .toContain('!isValidFreeSubmissionEventId(data.submission_event_id)');
    expect(reservationGuard).toBeLessThan(freeFill.indexOf('const resumeBlob ='));
    expect(reservationGuard).toBeLessThan(freeFill.indexOf('fill({'));
    expect(reservationGuard).toBeLessThan(freeFill.indexOf('armFreeManualSubmissionOutcomeWhenAvailable('));
    expect(freeFill.slice(reservationGuard, freeFill.indexOf('if (!data.profile'))).toContain('return;');
  });

  it('arms the exact reserved event before summary and delayed Tracker fill sync', () => {
    const freeFill = content.slice(
      content.indexOf('const resumeAttached = Boolean(resumeBlob)'),
      content.indexOf('if (showUpgrade && statusEl)'),
    );
    const earlyArm = freeFill.indexOf('armFreeManualSubmissionOutcomeWhenAvailable(');
    expect(earlyArm).toBeGreaterThanOrEqual(0);
    expect(freeFill.slice(earlyArm, freeFill.indexOf('renderFillSummary(')))
      .toMatch(/data\.application_id,[\s\S]*?data\.submission_event_id,[\s\S]*?freeFillResult\.ats_name/);
    expect(earlyArm).toBeLessThan(freeFill.indexOf('renderFillSummary('));
    expect(earlyArm).toBeLessThan(freeFill.indexOf('await syncTracker()'));
  });

  it('does not arm a delayed Tracker id that has no acknowledged reservation', () => {
    const freeFill = content.slice(
      content.indexOf('const trackerSync = createFreeFillTrackerSync(trackerPayload)'),
      content.indexOf('if (showUpgrade && statusEl)'),
    );
    expect(freeFill).toMatch(/const result = await trackerSync\.sync\(\)[\s\S]*?if \(result\.application_id\)[\s\S]*?data\.application_id = result\.application_id/);
    expect(freeFill).not.toContain('armFreeManualSubmissionOutcomeWhenAvailable(result.application_id');
  });

  it('intercepts one trusted activation until monitor, exact preflight, and context checks pass', () => {
    const observer = content.slice(
      content.indexOf('function armFreeManualSubmissionOutcomeTracking'),
      content.indexOf('const pendingFreeSubmissionOutcomeApplications'),
    );
    expect(observer).toContain('if (!event.isTrusted) return');
    expect(observer).toContain("document.addEventListener('click', clickListener, true)");
    expect(observer).toContain("document.addEventListener('submit', blockFormSubmission, true)");
    expect(observer).toContain('findFreeManualFinalSubmitButton(atsName)');
    expect(observer).toContain('event.preventDefault()');
    expect(observer).toContain('event.stopImmediatePropagation()');
    expect(observer).toContain('runFreeSubmissionReplayGate({');
    expect(observer).toContain('requestFreeSubmissionPreflight({');
    expect(observer).toContain('freeManualReplayContextIsSafe(');
    expect(observer).toContain('replayFreeManualSubmitIfAllowed(submitButton, atsName)');
    expect(observer).toContain('const activationUrl = window.location.href');
    expect(observer).toContain('const activationFenceEpoch = releaseUpdateFenceState.epoch');
    expect(observer).toMatch(/freeManualReplayContextIsSafe\([\s\S]*?activationFenceEpoch/);
    expect(observer).toContain('const baselineTexts = new Set(visibleSubmissionOutcomeTexts())');
    expect(observer).toMatch(/createFreeSubmissionOutcomeSync\([\s\S]*?applicationId,[\s\S]*?submissionEventId/);
    expect(observer).toContain('const activationId = crypto.randomUUID()');
    expect(observer.indexOf('startMonitor:')).toBeLessThan(observer.indexOf('preflight:'));
    expect(observer.indexOf('preflight:')).toBeLessThan(observer.indexOf('armOutcome:'));
    expect(observer.indexOf('armOutcome:')).toBeLessThan(observer.indexOf('replay:'));
    expect(observer.indexOf('monitorFreeSubmissionOutcome({')).toBeLessThan(observer.indexOf('replayFreeManualSubmitIfAllowed(submitButton, atsName)'));
    expect(observer).not.toMatch(/\.click\(/);
    expect(observer).not.toContain('EXTENSION_SUBMISSION_START');
    expect(observer).not.toContain('automatic_submission');
  });

  it('default-denies unsupported ATS replay with exact cancellation and no click capability', () => {
    const replay = content.slice(
      content.indexOf('function replayFreeManualSubmitIfAllowed'),
      content.indexOf('function findFreeManualFinalSubmitButton'),
    );
    expect(replay).toMatch(/!freeManualSubmissionAtsSupported\(atsName\)[\s\S]*?!atsCanAutoSubmit\(atsName\)[\s\S]*?return 'pre_click_refusal'/);
    expect(replay).toContain('clickAtsSubmitIfAllowed(atsName, submitButton)');
    expect(replay.match(/submitButton\.click\(\)/g)).toHaveLength(1);
    expect(replay).toMatch(/atsName === 'workday'[\s\S]*?workdayProgrammaticFinalSubmitAllowed\(submitButton\)[\s\S]*?submitButton\.click\(\)/);
    expect(replay).toMatch(/!freeManualSubmissionAtsSupported\(atsName\)[\s\S]*?document\.addEventListener\('click', clickListener, true\)[\s\S]*?cancelFreeManualSubmissionBeforeReplay/);

    const cancellation = background.slice(
      background.indexOf("case 'CANCEL_FREE_MANUAL_SUBMISSION'"),
      background.indexOf("case 'START_FREE_SUBMISSION_OUTCOME_MONITOR'"),
    );
    expect(cancellation).toContain('closeAndClearPendingFreeManualReservation({');
    const closeHelper = background.slice(
      background.indexOf('async function closeFreeManualSubmissionBeforeReplay'),
      background.indexOf('async function clearApplicationRuntimeState'),
    );
    expect(closeHelper).toContain('`/applications/${applicationId}/manual-submission-resolution`');
    expect(closeHelper).toMatch(/attempt_id: eventId,[\s\S]*?found: false,[\s\S]*?reason: 'extension_cancelled_before_press'/);
    expect(closeHelper).toMatch(/freeManualRetrySafetyFromUnknown\(body\?\.retry_safety\)[\s\S]*?safety\?\.kind !== 'safe_not_sent'[\s\S]*?safety\.proofKind !== 'extension_cancelled_before_press'/);
  });

  it('reserves with the backend after canonical resolution and before returning any fill data', () => {
    const handler = background.slice(
      background.indexOf("case 'GET_FREE_FILL_DATA'"),
      background.indexOf("case 'REFRESH_FREE_MANUAL_RETRY_SAFETY'"),
    );
    const reservation = handler.indexOf('reserveFreeManualSubmission(');
    const fillResponse = handler.indexOf('submission_event_id: submissionEventId');
    expect(reservation).toBeGreaterThan(handler.indexOf('let applicationId: string | null = null'));
    expect(reservation).toBeLessThan(fillResponse);
    const helper = background.slice(
      background.indexOf('async function reserveFreeManualSubmission'),
      background.indexOf('async function closeFreeManualSubmissionBeforeReplay'),
    );
    expect(helper).toMatch(/'Idempotency-Key': requestedEventId[\s\S]*?event_id: requestedEventId,[\s\S]*?current_url: currentUrl/);
    expect(helper).toMatch(/if \(!reservationResponse\.ok\) throw[\s\S]*?parseFreeSubmissionReservation\([\s\S]*?applicationId/);
    expect(helper).toMatch(/if \(!reservation\)[\s\S]*?Nothing was filled/);
  });

  it('runs the final owner-scoped preflight with the exact event and authoritative sender URL', () => {
    const handler = background.slice(
      background.indexOf("case 'PREFLIGHT_FREE_MANUAL_SUBMISSION'"),
      background.indexOf("case 'CANCEL_FREE_MANUAL_SUBMISSION'"),
    );
    expect(handler).toContain('`/applications/${applicationId}/manual-submission-preflight`');
    expect(handler).toMatch(/'Idempotency-Key': eventId[\s\S]*?event_id: eventId,[\s\S]*?activation_id: activationId,[\s\S]*?current_url: senderUrl/);
    expect(handler).toContain('parseFreeSubmissionPreflight(');
    expect(handler.match(/releaseUpdateFenceBlocksSubmissions\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(handler).toMatch(/authorizePendingFreeManualSubmissionMonitor\([\s\S]*?releaseUpdateFenceBlocksSubmissions\(\)[\s\S]*?closeAuthorizedFreeManualSubmissionBeforeResponse\([\s\S]*?sendResponse\(\{/);
    expect(handler).toMatch(/application_id: acknowledged\.applicationId,[\s\S]*?event_id: acknowledged\.eventId,[\s\S]*?authorized: true/);
    expect(handler).not.toContain('requireFeature');
    expect(handler).not.toContain('automatic_submission');
  });

  it('binds the last content replay check to the exact open release-fence generation', () => {
    const safety = content.slice(
      content.indexOf('function freeManualReplayContextIsSafe'),
      content.indexOf('function replayFreeManualSubmitIfAllowed'),
    );
    expect(safety).toContain('releaseUpdateFenceState.active === false');
    expect(safety).toContain('releaseUpdateFenceState.epoch === activationFenceEpoch');
  });

  it('returns only an error when canonical application creation fails or has no valid id', () => {
    const handler = background.slice(
      background.indexOf("case 'GET_FREE_FILL_DATA'"),
      background.indexOf("case 'REFRESH_FREE_MANUAL_RETRY_SAFETY'"),
    );
    const createStart = handler.indexOf("timeoutBackendFetch('/applications'");
    const reservationStart = handler.indexOf('reserveFreeManualSubmission(');
    const createPath = handler.slice(createStart, reservationStart);
    expect(createPath).toContain('if (!applicationResponse.ok) throw await apiErrorFromResponse(applicationResponse)');
    expect(createPath).toMatch(/if \(!applicationId\) \{[\s\S]*?throw[\s\S]*?Nothing was filled/);
    const catchPath = handler.slice(handler.lastIndexOf('} catch (error)'));
    expect(catchPath).toMatch(/sendResponse\(\{[\s\S]*?error:/);
    expect(catchPath).not.toContain('profile,');
    expect(catchPath).not.toContain('applicationProfile,');
    expect(catchPath).not.toContain('selected_resume:');
  });

  it('uses the exact Workday final control without applying programmatic-click eligibility', () => {
    const finder = content.slice(
      content.indexOf('function findFreeManualFinalSubmitButton'),
      content.indexOf('const pendingFreeSubmissionOutcomeApplications'),
    );
    expect(finder).toContain("atsName === 'workday' ? findWorkdayFinalSubmitButton() : findFinalSubmitButton()");
    expect(finder).not.toContain('workdayProgrammaticFinalSubmitAllowed');
    expect(content).toMatch(/function armFreeManualSubmissionOutcomeTracking[\s\S]*?findFreeManualFinalSubmitButton\(atsName\)/);
  });

  it('maps only classifier confirmation, explicit failure, and timeout unknown to Free outcomes', () => {
    const observer = content.slice(
      content.indexOf('function monitorFreeSubmissionOutcome'),
      content.indexOf('function armFreeManualSubmissionOutcomeTracking'),
    );
    expect(observer).toContain('createSubmissionOutcomeController');
    expect(observer).toMatch(/outcome\.kind === 'failure'[\s\S]*?reportFreeSubmissionOutcomeWithRetry\([\s\S]*?'failed'/);
    expect(observer).toMatch(/reportFreeSubmissionOutcomeWithRetry\([\s\S]*?'confirmed'/);
    expect(observer).toMatch(/onUnknown: \(\) => \{[\s\S]*?reportFreeSubmissionOutcomeWithRetry\([\s\S]*?'unknown'/);
  });

  it('posts the owner-scoped manual endpoint with auth-epoch safety and no premium gate', () => {
    const handler = background.slice(
      background.indexOf("case 'RECORD_FREE_SUBMISSION_OUTCOME'"),
      background.indexOf("case 'GET_AUTOMATION_SETTINGS'"),
    );
    expect(handler).toContain('const finalUrl = safeFreeSubmissionUrl(sender.url)');
    expect(handler).not.toContain('getStoredToken()');
    expect(handler).toMatch(/await postFreeSubmissionOutcome\([\s\S]*?effectiveOutcome,[\s\S]*?effectiveFinalUrl/);
    const persistence = background.slice(
      background.indexOf('async function postFreeSubmissionOutcome('),
      background.indexOf('async function reconcileFreeManualSubmissionStatesForTab'),
    );
    expect(persistence).toContain('submissionOutcomeOutbox.persist({');
    expect(persistence).toMatch(/eventId: pending\.eventId,[\s\S]*?leaseId: pending\.boundaryLeaseId![\s\S]*?activationId: pending\.boundaryActivationId![\s\S]*?outcome,[\s\S]*?finalUrl/);
    expect(persistence.indexOf('submissionOutcomeOutbox.persist({')).toBeLessThan(persistence.indexOf('getStoredToken()'));
    expect(persistence).toContain('refreshEntitlementSnapshot(token, expectedAuthEpoch)');
    const sender = background.slice(
      background.indexOf('async function sendPersistedSubmissionOutcome('),
      background.indexOf('async function deliverSavedSubmissionOutcome('),
    );
    expect(sender).toMatch(/entry\.lane === 'free'[\s\S]*?'Idempotency-Key': entry\.attemptId/);
    expect(handler).not.toContain('requireFeature');
    expect(handler).not.toContain('automatic_submission');
    expect(handler).toMatch(/await postFreeSubmissionOutcome\([\s\S]*?submitted: delivery\.submitted,[\s\S]*?receipt_cleanup_pending: delivery\.receiptCleanupPending/);
  });

  it('reuses the reserved event after hard navigation and forces mismatched bindings to unknown', () => {
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
    expect(getPending).toMatch(/pending \?\? pendingFreeSubmissionMonitorForTab\([\s\S]*?tabId/);
    expect(getPending).toContain("const receiptLocked = journal?.phase === 'outcome' || journal?.phase === 'awaiting_receipt'");
    expect(getPending).toContain("force_unknown: receiptLocked ? false : disposition !== 'resume'");
    expect(getPending).toContain('retry_pending: freeSubmissionMonitorStartsInFlight.has(tabId)');
    expect(recovery).toMatch(/attempt < 20 \|\| \(response\?\.retry_pending && attempt < 100\)/);
  });

  it('uses tab fallback during record and rejects every record without a pending trusted click', () => {
    const handler = background.slice(
      background.indexOf("case 'RECORD_FREE_SUBMISSION_OUTCOME'"),
      background.indexOf("case 'GET_AUTOMATION_SETTINGS'"),
    );
    expect(handler).toMatch(/exact \?\? pendingFreeSubmissionMonitorForTab\([\s\S]*?tabId/);
    expect(handler).toMatch(/if \(!pending \|\| tabId === undefined\)[\s\S]*?submission_monitor_missing[\s\S]*?return;/);
    expect(handler.indexOf('submission_monitor_missing')).toBeLessThan(handler.indexOf('postFreeSubmissionOutcome('));
    expect(handler).toMatch(/bindFreeSubmissionOutcome\(\{[\s\S]*?pending,[\s\S]*?eventId,[\s\S]*?applicationId,[\s\S]*?disposition/);
  });

  it('removes only an accepted exact monitor and preserves it on transport failure', () => {
    const handler = background.slice(
      background.indexOf("case 'RECORD_FREE_SUBMISSION_OUTCOME'"),
      background.indexOf("case 'GET_AUTOMATION_SETTINGS'"),
    );
    expect(handler).toMatch(/await postFreeSubmissionOutcome\([\s\S]*?submitted: delivery\.submitted,[\s\S]*?receipt_cleanup_pending: delivery\.receiptCleanupPending/);
    const delivery = background.slice(
      background.indexOf('async function deliverSavedSubmissionOutcome('),
      background.indexOf('async function postExtensionOutcome('),
    );
    expect(delivery).toContain('deliverPersistedSubmissionOutcome({');
    expect(delivery).toContain('cleanupAcknowledgedSubmissionOutcome(exact)');
    const cleanup = background.slice(
      background.indexOf('async function clearAcceptedFreeSubmissionOutcomeState'),
      background.indexOf('async function transitionPendingFreeManualReservationToMonitor'),
    );
    expect(cleanup).toContain('freeManualSubmissionStateMutations.run(');
    expect(cleanup).toContain('freeManualAcceptedOutcomeDisposition(');
    expect(cleanup).toContain('await chrome.storage.session.remove(key)');
    const reporter = content.slice(
      content.indexOf('function reportFreeSubmissionOutcomeWithRetry'),
      content.indexOf('function monitorFreeSubmissionOutcome'),
    );
    expect(reporter).toMatch(/if \(attempt < 4\)[\s\S]*?return;[\s\S]*?ABANDON_FREE_SUBMISSION_OUTCOME_MONITOR/);
    const abandon = background.slice(
      background.indexOf("case 'ABANDON_FREE_SUBMISSION_OUTCOME_MONITOR'"),
      background.indexOf("case 'RECORD_FREE_SUBMISSION_OUTCOME'"),
    );
    expect(abandon).not.toContain('chrome.storage.session.remove');
  });

  it('does not report submitted or render Sent when acknowledged Free cleanup cannot be verified', () => {
    const delivery = background.slice(
      background.indexOf('async function deliverSavedSubmissionOutcome('),
      background.indexOf('async function postExtensionOutcome('),
    );
    expect(delivery).toMatch(/wakeAcknowledgedSubmissionOutcome\(result\.entry, expectedAuthEpoch\)[\s\S]*?terminalReady: finalization\.terminalReady[\s\S]*?receiptCleanupPending: finalization\.cleanupPending/);
    const freePost = background.slice(
      background.indexOf('async function postFreeSubmissionOutcome('),
      background.indexOf('async function reconcileFreeManualSubmissionStatesForTab'),
    );
    expect(freePost).toMatch(/submitted: result\.entry\.outcome === 'confirmed' && result\.delivery\.terminalReady/);
    const reporter = content.slice(
      content.indexOf('function reportFreeSubmissionOutcomeWithRetry'),
      content.indexOf('function monitorFreeSubmissionOutcome'),
    );
    expect(reporter.indexOf('result.receiptCleanupPending')).toBeLessThan(reporter.indexOf('result.submitted'));
    expect(reporter).toMatch(/result\.receiptCleanupPending[\s\S]*?renderReceiptRepairState\(baselineUrl\)[\s\S]*?return;/);
  });

  it('uses a document-start shield and blocks cross-frame monitoring recovery', () => {
    expect(content).toContain("runAt: 'document_start'");
    const startup = content.slice(
      content.indexOf('let preArmBoundaryShield = initialPreArmBoundaryShieldState()'),
      content.indexOf('async function serverCaptchaResumeEnabled'),
    );
    expect(startup.indexOf("document.addEventListener('click', blockBeforeDelegate, true)"))
      .toBeLessThan(startup.indexOf("await new Promise<void>"));
    expect(startup).toContain("document.addEventListener('submit', blockBeforeDelegate, true)");

    const pending = background.slice(
      background.indexOf("case 'GET_PENDING_FREE_MANUAL_RESERVATION'"),
      background.indexOf("case 'CLEAR_PENDING_FREE_MANUAL_RESERVATION'"),
    );
    expect(pending).toContain('pendingFreeManualSubmissionStartupState(tabId, frameId, currentUrl)');
    expect(pending).toContain('freeManualSubmissionStartupResponse(startup');
    expect(pending).toContain('catch(() => sendResponse({ pending: null, blocked: true }))');
    expect(pending).toMatch(/tabId === undefined \|\| !currentUrl[\s\S]*?blocked: true/);
  });

  it('default-denies generic Free before reservation, fill, arming, or replay', () => {
    const handler = background.slice(
      background.indexOf("case 'GET_FREE_FILL_DATA'"),
      background.indexOf("case 'REFRESH_FREE_MANUAL_RETRY_SAFETY'"),
    );
    const capability = handler.indexOf('freeManualSubmissionAtsSupported(atsNameForPortalUrl(portalUrl))');
    expect(capability).toBeGreaterThanOrEqual(0);
    expect(capability).toBeLessThan(handler.indexOf('getStoredToken().then'));
    expect(capability).toBeLessThan(handler.indexOf('reserveFreeManualSubmission('));
    expect(handler.slice(0, handler.indexOf('getStoredToken().then')))
      .toContain("code: 'free_manual_submission_ats_unavailable'");

    const generic = content.slice(
      content.indexOf('function genericInit()'),
      content.indexOf('w.__litosGenericInit = genericInit'),
    );
    expect(generic).toContain('FREE_MANUAL_SUBMISSION_UNAVAILABLE_COPY');
    expect(generic).not.toContain('GET_FREE_FILL_DATA');
    expect(generic).not.toContain('injectResumeFillCard');
    expect(generic).not.toContain('fillGenericApplication');
  });

  it('prevents a monitoring phase from being rewritten as reserved', () => {
    const store = background.slice(
      background.indexOf('async function storePendingFreeManualReservation'),
      background.indexOf('async function clearPendingFreeManualReservation'),
    );
    expect(store).toContain('freeManualSubmissionStateMutations.run(freeManualSubmissionMutationKey(pending.tabId)');
    expect(store).toContain('freeManualReservationWriteDisposition(tabStateValues, pending)');
    expect(store).toMatch(/reason === 'monitoring'[\s\S]*?cannot be reopened for another click/);
    const startup = background.slice(
      background.indexOf('async function pendingFreeManualSubmissionStartupState'),
      background.indexOf('async function storePendingFreeManualReservation'),
    );
    expect(startup).toContain('freeManualSubmissionStartupState(values, frameId)');
  });

  it('persists the provisional native-submit shield before the reservation POST can lose its response', () => {
    const handler = background.slice(
      background.indexOf("case 'GET_FREE_FILL_DATA'"),
      background.indexOf("case 'REFRESH_FREE_MANUAL_RETRY_SAFETY'"),
    );
    const provisionalWrite = handler.indexOf('await storePendingFreeManualReservation(reservedState)');
    const reservationPost = handler.indexOf('const reservation = await reserveFreeManualSubmission(');
    expect(provisionalWrite).toBeGreaterThanOrEqual(0);
    expect(provisionalWrite).toBeLessThan(reservationPost);
    expect(handler.slice(provisionalWrite, reservationPost)).toMatch(
      /openedReservation = \{[\s\S]*?applicationId,[\s\S]*?eventId: requestedSubmissionEventId,[\s\S]*?accountId: accountSnapshot\.account_id,[\s\S]*?stored: true/,
    );
    expect(handler.slice(provisionalWrite, reservationPost)).toContain('await submissionOutcomeOutbox.arm({');
    expect(handler.slice(handler.lastIndexOf('} catch (error)'))).toMatch(
      /reservationAttempted && cancellationApplicationId[\s\S]*?closeAndClearPendingFreeManualReservationWithCapturedToken/,
    );
    expect(handler.slice(handler.lastIndexOf('} catch (error)'))).toContain("submissionOutcomeOutbox.cancelSafeNotSent(");
  });

  it('closes and clears an update-interrupted lease-less monitor and recovers it on startup', () => {
    const preflight = background.slice(
      background.indexOf("case 'PREFLIGHT_FREE_MANUAL_SUBMISSION'"),
      background.indexOf("case 'CANCEL_FREE_MANUAL_SUBMISSION'"),
    );
    const updateClose = preflight.slice(
      preflight.indexOf('if (await releaseUpdateFenceBlocksSubmissions())'),
      preflight.indexOf('await authorizePendingFreeManualSubmissionMonitor'),
    );
    expect(updateClose).toContain('closeAndClearPendingFreeManualReservation({');
    expect(updateClose).toMatch(/tabId: preflightTabId,[\s\S]*?frameId: preflightFrameId/);

    const closeHelper = background.slice(
      background.indexOf('async function closeAndClearPendingFreeManualReservationWithCapturedToken'),
      background.indexOf('async function reconcileRecoverableFreeManualSubmissionStates'),
    );
    expect(closeHelper).toMatch(/postFreeManualSubmissionBeforeReplayCancellation[\s\S]*?chrome\.storage\.session\.get\(key\)/);
    expect(closeHelper).toContain('freeManualSafeNotSentDisposition(current[key], state)');
    expect(closeHelper).toMatch(/disposition === 'blocked'[\s\S]*?disposition === 'remove'/);

    const startupRecovery = background.slice(
      background.indexOf('async function reconcileRecoverableFreeManualSubmissionStates'),
      background.indexOf('function safeFreeSubmissionUrl'),
    );
    expect(startupRecovery).toContain('chrome.storage.session.get(null)');
    expect(startupRecovery).toContain('key.startsWith(`${FREE_MANUAL_RESERVATION_PREFIX}:${tabId}:`)');
    expect(startupRecovery).toMatch(/state\?\.phase === 'monitoring'[\s\S]*?boundaryLeaseId === null[\s\S]*?boundaryActivationId === null[\s\S]*?boundaryExpiresAt === null/);
    expect(startupRecovery).toContain('closeAndClearPendingFreeManualReservation({');
    expect(startupRecovery).toContain('frameId: candidate.frameId');
    expect(startupRecovery).toContain('expectedState: candidate');
    const startupHandler = background.slice(
      background.indexOf("case 'GET_PENDING_FREE_MANUAL_RESERVATION'"),
      background.indexOf("case 'CLEAR_PENDING_FREE_MANUAL_RESERVATION'"),
    );
    expect(startupHandler).toContain('reconcileRecoverableFreeManualSubmissionStates(tabId)');
  });

  it('keeps lost, invalid, timeout, and typed-error reservation responses shielded with Retry disabled', () => {
    const freeFill = content.slice(
      content.indexOf('const runFreeFactualFill = async'),
      content.indexOf('if (!data.profile || !data.applicationProfile)'),
    );
    const failureBranch = freeFill.slice(freeFill.indexOf('const responseRetrySafety'));
    expect(failureBranch).toContain('freeManualRetrySafetyFromUnknown(data.retry_safety)');
    expect(failureBranch).toMatch(/data\.error[\s\S]*?!isValidFreeFillApplicationId\(data\.application_id\)/);
    expect(freeFill).toContain('actionBoundaryEpoch: number');
    expect(failureBranch).toContain("yesBtn.textContent = exactCancellationProvedSafe ? 'Retry' : 'Retry locked'");
    expect(failureBranch).toContain('yesBtn.disabled = !exactCancellationProvedSafe');
    expect(failureBranch.indexOf('releasePreArmBoundaryShield(actionBoundaryEpoch)'))
      .toBeGreaterThan(failureBranch.indexOf('if (exactCancellationProvedSafe)'));
  });

  it('releases the employer boundary only after exact cancellation or an exact authoritative safe refresh', () => {
    const profileFailure = content.slice(
      content.indexOf('if (!data.profile || !data.applicationProfile)'),
      content.indexOf('const profile = data.profile'),
    );
    expect(profileFailure).toMatch(/if \(cancelled\.ok\) \{[\s\S]*?activeFreeManualBoundaryCleanup\?\.\(\)[\s\S]*?releasePreArmBoundaryShield\(releasedEpoch\)/);
    expect(profileFailure).toContain('yesBtn.disabled = !cancelled.ok');
    expect(profileFailure).toContain("yesBtn.textContent = cancelled.ok ? 'Retry' : 'Retry locked'");

    const refresh = background.slice(
      background.indexOf("case 'REFRESH_FREE_MANUAL_RETRY_SAFETY'"),
      background.indexOf("case 'RECORD_FREE_FILL_RESULT'"),
    );
    expect(refresh).toContain("timeoutBackendFetch('/applications?limit=100', { cache: 'no-store' }, token)");
    expect(refresh).toMatch(/application\.id === applicationId[\s\S]*?freeFillPortalMatches\(owned\.portal_url, senderUrl\)/);
    expect(refresh).toMatch(/freeManualRetrySafetyFromUnknown\(owned\.retry_safety\)[\s\S]*?freeManualRetrySafetyAllowsRetry\(retrySafety\)/);
    expect(refresh).toMatch(/startup\.pending \|\| startup\.blocked[\s\S]*?retry_safe: false/);

    const failureBranch = content.slice(
      content.indexOf('const responseRetrySafety'),
      content.indexOf('// The reservation now exists'),
    );
    expect(failureBranch).toMatch(/const refreshed = await refreshFreeManualRetrySafety[\s\S]*?if \(refreshed\.safe\) \{[\s\S]*?releasePreArmBoundaryShield\(actionBoundaryEpoch\)/);
  });

  it('propagates typed retry safety from reservation and cancellation errors while the paid lane stays disabled', () => {
    const handler = background.slice(
      background.indexOf("case 'GET_FREE_FILL_DATA'"),
      background.indexOf("case 'REFRESH_FREE_MANUAL_RETRY_SAFETY'"),
    );
    const failure = handler.slice(handler.lastIndexOf('} catch (error)'));
    expect(failure).toContain('let retrySafety = freeManualRetrySafetyFromError(error)');
    expect(failure).toContain('retrySafety = freeManualRetrySafetyFromError(failedCancellation) ?? retrySafety');
    expect(failure).toMatch(/retry_safety: retrySafety,[\s\S]*?http_status: error\.status/);
    expect(content).toContain('const GENERATED_EXTENSION_SUBMISSION_ENABLED = false');
    expect(content).not.toContain('const GENERATED_EXTENSION_SUBMISSION_ENABLED = true');
  });
});
