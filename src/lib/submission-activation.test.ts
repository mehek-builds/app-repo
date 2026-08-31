import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
  EXTENSION_SUBMISSION_ACTIVATION_CLOCK_DIVERGENCE_TOLERANCE_MS,
  EXTENSION_SUBMISSION_ACTIVATION_CONTRACT,
  EXTENSION_SUBMISSION_ACTIVATION_MAX_LEASE_MS,
  EXTENSION_SUBMISSION_ACTIVATION_SAFETY_MARGIN_MS,
  INVALID_SUBMISSION_ACTIVATION_MESSAGE,
  bindExtensionSubmissionActivation,
  bindExtensionSubmissionActivationToDocument,
  runExtensionSubmissionClickAfterBackgroundValidation,
  sameExtensionSubmissionActivation,
  sameExtensionSubmissionActivationIdentity,
  verifyDocumentExtensionSubmissionActivation,
  verifyExtensionSubmissionActivation,
  verifyExtensionSubmissionStartResponse,
  type ExtensionSubmissionActivationIdentity,
  type ExtensionSubmissionActivationMonotonicProof,
  type ExtensionSubmissionActivationRequestClock,
} from './submission-activation';

const applicationId = '123e4567-e89b-42d3-a456-426614174000';
const runtimeId = '623e4567-e89b-42d3-a456-426614174000';
const identity: ExtensionSubmissionActivationIdentity = {
  applicationId,
  claimId: '223e4567-e89b-42d3-a456-426614174000',
  activationId: '323e4567-e89b-52d3-a456-426614174000',
  activationLeaseId: '423e4567-e89b-52d3-a456-426614174000',
  activationExpiresAt: '2026-08-31T10:03:00.000Z',
  activationServerNow: '2026-08-31T10:00:00.000Z',
};
const requestClock: ExtensionSubmissionActivationRequestClock = {
  runtimeId,
  timeOriginMs: 1_000_000,
  requestStartedAtMs: 1_000,
  wallRequestStartedAtMs: 1_800_000_000_000,
};
const documentRuntimeId = '723e4567-e89b-42d3-a456-426614174000';
const documentRequestClock: ExtensionSubmissionActivationRequestClock = {
  runtimeId: documentRuntimeId,
  timeOriginMs: 2_000_000,
  requestStartedAtMs: 500,
  wallRequestStartedAtMs: 1_800_000_000_500,
};
const currentClock = (nowMs: number, overrides: Partial<{
  runtimeId: string;
  timeOriginMs: number;
  wallNowMs: number;
}> = {}) => ({
  runtimeId: overrides.runtimeId ?? runtimeId,
  timeOriginMs: overrides.timeOriginMs ?? requestClock.timeOriginMs,
  nowMs,
  wallNowMs: overrides.wallNowMs
    ?? requestClock.wallRequestStartedAtMs + (nowMs - requestClock.requestStartedAtMs),
});
const documentCurrentClock = (nowMs: number, overrides: Partial<{
  runtimeId: string;
  timeOriginMs: number;
  wallNowMs: number;
}> = {}) => ({
  runtimeId: overrides.runtimeId ?? documentRuntimeId,
  timeOriginMs: overrides.timeOriginMs ?? documentRequestClock.timeOriginMs,
  nowMs,
  wallNowMs: overrides.wallNowMs
    ?? documentRequestClock.wallRequestStartedAtMs + (nowMs - documentRequestClock.requestStartedAtMs),
});
const startResponse = (overrides: Record<string, unknown> = {}) => ({
  activation_contract: EXTENSION_SUBMISSION_ACTIVATION_CONTRACT,
  application_id: identity.applicationId,
  claim_id: identity.claimId,
  activation_id: identity.activationId,
  activation_lease_id: identity.activationLeaseId,
  activation_expires_at: identity.activationExpiresAt,
  activation_server_now: identity.activationServerNow,
  ...overrides,
});

function documentBoundActivation() {
  const background = verifyExtensionSubmissionStartResponse(
    startResponse(),
    applicationId,
    requestClock,
    currentClock(5_000),
  );
  if (!background.ok) throw new Error(background.error);
  const document = bindExtensionSubmissionActivationToDocument(
    background.activation,
    applicationId,
    documentRequestClock,
    documentCurrentClock(4_000),
  );
  if (!document.ok) throw new Error(document.error);
  return { background: background.activation, document: document.activation };
}

const employerClickPaths = ['manual', 'dashboard', 'automatic'] as const;
const wallClockFailureModes = [
  {
    label: 'wall time passes expiry while performance time stays fixed',
    monotonicNowMs: (proof: ExtensionSubmissionActivationMonotonicProof) => proof.boundAtMs,
    wallNowMs: (proof: ExtensionSubmissionActivationMonotonicProof, _monotonicNowMs: number) =>
      proof.wallUsableUntilMs,
  },
  {
    label: 'wall time moves backward',
    monotonicNowMs: (proof: ExtensionSubmissionActivationMonotonicProof) => proof.boundAtMs + 1_000,
    wallNowMs: (proof: ExtensionSubmissionActivationMonotonicProof, _monotonicNowMs: number) =>
      proof.wallBoundAtMs - 1,
  },
  {
    label: 'wall and performance elapsed time diverge beyond tolerance',
    monotonicNowMs: (proof: ExtensionSubmissionActivationMonotonicProof) => proof.boundAtMs + 1_000,
    wallNowMs: (proof: ExtensionSubmissionActivationMonotonicProof, monotonicNowMs: number) =>
      proof.wallRequestStartedAtMs
      + (monotonicNowMs - proof.requestStartedAtMs)
      + EXTENSION_SUBMISSION_ACTIVATION_CLOCK_DIVERGENCE_TOLERANCE_MS
      + 1,
  },
] as const;
const clickBoundaryClockFailureCases = employerClickPaths.flatMap((clickPath) =>
  (['background', 'document'] as const).flatMap((proofKind) =>
    wallClockFailureModes.map((failure) => [clickPath, proofKind, failure.label, failure] as const)));

describe('extension submission activation', () => {
  it('pins the client request to the server lease contract', () => {
    expect(EXTENSION_SUBMISSION_ACTIVATION_CONTRACT).toBe('server-lease-v1');
  });

  it('subtracts the complete request time and the documented safety margin', () => {
    const result = verifyExtensionSubmissionStartResponse(
      startResponse(),
      applicationId,
      requestClock,
      currentClock(5_000),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serverLeaseMs = 3 * 60_000;
    expect(result.activation).toEqual({
      ...identity,
      monotonicProof: {
        runtimeId,
        timeOriginMs: requestClock.timeOriginMs,
        requestStartedAtMs: requestClock.requestStartedAtMs,
        boundAtMs: 5_000,
        usableUntilMs: requestClock.requestStartedAtMs
          + serverLeaseMs
          - EXTENSION_SUBMISSION_ACTIVATION_SAFETY_MARGIN_MS,
        wallRequestStartedAtMs: requestClock.wallRequestStartedAtMs,
        wallBoundAtMs: requestClock.wallRequestStartedAtMs
          + (5_000 - requestClock.requestStartedAtMs),
        wallUsableUntilMs: requestClock.wallRequestStartedAtMs
          + serverLeaseMs
          - EXTENSION_SUBMISSION_ACTIVATION_SAFETY_MARGIN_MS,
      },
    });
    expect(result.remainingBudgetMs).toBe(
      serverLeaseMs
      - (5_000 - requestClock.requestStartedAtMs)
      - EXTENSION_SUBMISSION_ACTIVATION_SAFETY_MARGIN_MS,
    );
  });

  it.each([
    ['missing server time', { activation_server_now: undefined }],
    ['non-canonical server time', { activation_server_now: '2026-08-31T10:00:00Z' }],
    ['server time after expiry', { activation_server_now: identity.activationExpiresAt }],
    ['missing activation id', { activation_id: undefined }],
    ['wrong activation id', { activation_id: 'not-an-activation-id' }],
    ['upper-case activation id', { activation_id: identity.activationId.toUpperCase() }],
    ['mismatched application', { application_id: '523e4567-e89b-42d3-a456-426614174000' }],
  ])('rejects %s before creating a click budget', (_label, overrides) => {
    expect(verifyExtensionSubmissionStartResponse(
      startResponse(overrides),
      applicationId,
      requestClock,
      currentClock(5_000),
    )).toEqual({
      ok: false,
      code: 'submission_activation_invalid',
      error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
    });
  });

  it.each([undefined, 'legacy-local-window-v1'])('rejects an unrecognized server contract: %s', (contract) => {
    expect(verifyExtensionSubmissionStartResponse(
      startResponse({ activation_contract: contract }),
      applicationId,
      requestClock,
      currentClock(5_000),
    )).toEqual({
      ok: false,
      code: 'submission_activation_invalid',
      error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
    });
  });

  it('fails closed when the request consumes the conservative lease budget', () => {
    expect(bindExtensionSubmissionActivation(
      identity,
      applicationId,
      requestClock,
      currentClock(180_000),
    )).toEqual({
      ok: false,
      code: 'submission_activation_expired',
      error: EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
    });
  });

  it('fails closed before creating either proof when a response resumes after wall expiry', () => {
    const background = bindExtensionSubmissionActivation(
      identity,
      applicationId,
      requestClock,
      currentClock(requestClock.requestStartedAtMs, {
        wallNowMs: requestClock.wallRequestStartedAtMs + 3 * 60_000,
      }),
    );
    expect(background).toMatchObject({
      ok: false,
      code: 'submission_activation_expired',
    });

    const validBackground = verifyExtensionSubmissionStartResponse(
      startResponse(),
      applicationId,
      requestClock,
      currentClock(5_000),
    );
    expect(validBackground.ok).toBe(true);
    if (!validBackground.ok) return;
    const document = bindExtensionSubmissionActivationToDocument(
      validBackground.activation,
      applicationId,
      documentRequestClock,
      documentCurrentClock(documentRequestClock.requestStartedAtMs, {
        wallNowMs: documentRequestClock.wallRequestStartedAtMs + 3 * 60_000,
      }),
    );
    expect(document).toMatchObject({
      ok: false,
      code: 'submission_activation_expired',
    });
  });

  it('rejects a server lease above the backend maximum', () => {
    const tooLong = new Date(
      Date.parse(identity.activationServerNow) + EXTENSION_SUBMISSION_ACTIVATION_MAX_LEASE_MS + 1,
    ).toISOString();
    expect(verifyExtensionSubmissionStartResponse(
      startResponse({ activation_expires_at: tooLong }),
      applicationId,
      requestClock,
      currentClock(5_000),
    )).toEqual({
      ok: false,
      code: 'submission_activation_invalid',
      error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
    });
  });

  it('preserves the background proof while binding a separate document proof', () => {
    const bound = documentBoundActivation();
    expect(bound.document.monotonicProof).toEqual(bound.background.monotonicProof);
    expect(bound.document.documentMonotonicProof).toMatchObject({
      runtimeId: documentRuntimeId,
      timeOriginMs: documentRequestClock.timeOriginMs,
      requestStartedAtMs: documentRequestClock.requestStartedAtMs,
      boundAtMs: 4_000,
      wallRequestStartedAtMs: documentRequestClock.wallRequestStartedAtMs,
      wallBoundAtMs: documentRequestClock.wallRequestStartedAtMs
        + (4_000 - documentRequestClock.requestStartedAtMs),
    });
  });

  it('rejects legacy background and document proofs that lack the wall-time authority fields', () => {
    const bound = documentBoundActivation();
    const legacyBackgroundProof = {
      runtimeId: bound.background.monotonicProof.runtimeId,
      timeOriginMs: bound.background.monotonicProof.timeOriginMs,
      requestStartedAtMs: bound.background.monotonicProof.requestStartedAtMs,
      usableUntilMs: bound.background.monotonicProof.usableUntilMs,
    };
    const legacyDocumentProof = {
      runtimeId: bound.document.documentMonotonicProof.runtimeId,
      timeOriginMs: bound.document.documentMonotonicProof.timeOriginMs,
      requestStartedAtMs: bound.document.documentMonotonicProof.requestStartedAtMs,
      usableUntilMs: bound.document.documentMonotonicProof.usableUntilMs,
    };

    expect(verifyExtensionSubmissionActivation({
      ...bound.background,
      monotonicProof: legacyBackgroundProof,
    }, applicationId, currentClock(6_000))).toMatchObject({
      ok: false,
      code: 'submission_activation_invalid',
    });
    expect(verifyDocumentExtensionSubmissionActivation({
      ...bound.document,
      documentMonotonicProof: legacyDocumentProof,
    }, applicationId, documentCurrentClock(5_000))).toMatchObject({
      ok: false,
      code: 'submission_activation_invalid',
    });
  });

  it('clicks once only when both current background and document proofs remain valid', () => {
    const bound = documentBoundActivation();
    const click = vi.fn(() => true);
    const backgroundValidation = verifyExtensionSubmissionActivation(
      bound.document,
      applicationId,
      currentClock(6_000),
    );
    const result = runExtensionSubmissionClickAfterBackgroundValidation({
      backgroundValidation,
      activation: bound.document,
      expectedApplicationId: applicationId,
      currentClock: documentCurrentClock(5_000),
      click,
      clickRejectedError: 'Employer control changed.',
    });
    expect(result.ok).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it.each(clickBoundaryClockFailureCases)(
    '%s path performs zero clicks when the %s proof detects that %s',
    (clickPath, proofKind, _failureLabel, failure) => {
      const bound = documentBoundActivation();
      const click = vi.fn(() => true);
      const backgroundNowMs = failure.monotonicNowMs(bound.document.monotonicProof);
      const documentNowMs = failure.monotonicNowMs(bound.document.documentMonotonicProof);
      const backgroundClock = currentClock(backgroundNowMs, proofKind === 'background' ? {
        wallNowMs: failure.wallNowMs(bound.document.monotonicProof, backgroundNowMs),
      } : {});
      const finalDocumentClock = documentCurrentClock(documentNowMs, proofKind === 'document' ? {
        wallNowMs: failure.wallNowMs(bound.document.documentMonotonicProof, documentNowMs),
      } : {});
      const backgroundValidation = verifyExtensionSubmissionActivation(
        bound.document,
        applicationId,
        backgroundClock,
      );
      const result = runExtensionSubmissionClickAfterBackgroundValidation({
        backgroundValidation,
        activation: bound.document,
        expectedApplicationId: applicationId,
        currentClock: finalDocumentClock,
        click,
        clickRejectedError: `${clickPath} employer control changed.`,
      });

      expect(result.ok).toBe(false);
      expect(click).not.toHaveBeenCalled();
    },
  );

  it('uses the earlier deadline when clock drift remains inside tolerance', () => {
    const bound = documentBoundActivation();
    const proof = bound.background.monotonicProof;
    const monotonicNowMs = proof.boundAtMs + 1_000;
    const alignedWallNowMs = proof.wallBoundAtMs + 1_000;

    for (const wallOffsetMs of [
      -EXTENSION_SUBMISSION_ACTIVATION_CLOCK_DIVERGENCE_TOLERANCE_MS,
      EXTENSION_SUBMISSION_ACTIVATION_CLOCK_DIVERGENCE_TOLERANCE_MS,
    ]) {
      const result = verifyExtensionSubmissionActivation(
        bound.background,
        applicationId,
        currentClock(monotonicNowMs, { wallNowMs: alignedWallNowMs + wallOffsetMs }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.remainingBudgetMs).toBe(Math.min(
        proof.usableUntilMs - monotonicNowMs,
        proof.wallUsableUntilMs - alignedWallNowMs - wallOffsetMs,
      ));
    }
  });

  it('rotates the background runtime between activation and click and performs zero clicks', () => {
    const bound = documentBoundActivation();
    const click = vi.fn(() => true);
    const backgroundValidation = verifyExtensionSubmissionActivation(
      bound.document,
      applicationId,
      currentClock(6_000, { runtimeId: '823e4567-e89b-42d3-a456-426614174000' }),
    );
    const result = runExtensionSubmissionClickAfterBackgroundValidation({
      backgroundValidation,
      activation: bound.document,
      expectedApplicationId: applicationId,
      currentClock: documentCurrentClock(5_000),
      click,
      clickRejectedError: 'Employer control changed.',
    });
    expect(result.ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('rotates the document runtime between activation and click and performs zero clicks', () => {
    const bound = documentBoundActivation();
    const click = vi.fn(() => true);
    const backgroundValidation = verifyExtensionSubmissionActivation(
      bound.document,
      applicationId,
      currentClock(6_000),
    );
    const result = runExtensionSubmissionClickAfterBackgroundValidation({
      backgroundValidation,
      activation: bound.document,
      expectedApplicationId: applicationId,
      currentClock: documentCurrentClock(5_000, {
        runtimeId: '823e4567-e89b-42d3-a456-426614174001',
      }),
      click,
      clickRejectedError: 'Employer control changed.',
    });
    expect(result.ok).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('checks performance time immediately against the bound deadline', () => {
    const bound = bindExtensionSubmissionActivation(
      identity,
      applicationId,
      requestClock,
      currentClock(5_000),
    );
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const deadline = bound.activation.monotonicProof.usableUntilMs;

    expect(verifyExtensionSubmissionActivation(
      bound.activation,
      applicationId,
      currentClock(deadline - 0.001),
    ).ok).toBe(true);
    expect(verifyExtensionSubmissionActivation(
      bound.activation,
      applicationId,
      currentClock(deadline),
    )).toEqual({
      ok: false,
      code: 'submission_activation_expired',
      error: EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
    });
  });

  it('fails closed after a reload, navigation, or loss of monotonic runtime state', () => {
    const bound = bindExtensionSubmissionActivation(
      identity,
      applicationId,
      requestClock,
      currentClock(5_000),
    );
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    for (const clock of [
      currentClock(6_000, { runtimeId: '723e4567-e89b-42d3-a456-426614174000' }),
      currentClock(6_000, { timeOriginMs: requestClock.timeOriginMs + 1 }),
    ]) {
      expect(verifyExtensionSubmissionActivation(
        bound.activation,
        applicationId,
        clock,
      )).toEqual({
        ok: false,
        code: 'submission_activation_invalid',
        error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
      });
    }
  });

  it('compares complete activation identity, including same-app retries', () => {
    expect(sameExtensionSubmissionActivationIdentity(identity, { ...identity })).toBe(true);
    expect(sameExtensionSubmissionActivationIdentity(identity, {
      ...identity,
      activationId: '523e4567-e89b-52d3-a456-426614174000',
    })).toBe(false);
    expect(sameExtensionSubmissionActivationIdentity(identity, {
      ...identity,
      activationServerNow: '2026-08-31T10:00:01.000Z',
    })).toBe(false);
  });

  it('compares every immutable identity and background proof field', () => {
    const bound = documentBoundActivation().background;
    expect(sameExtensionSubmissionActivation(bound, { ...bound })).toBe(true);

    for (const identityField of [
      'applicationId',
      'claimId',
      'activationId',
      'activationLeaseId',
      'activationExpiresAt',
      'activationServerNow',
    ] as const) {
      expect(sameExtensionSubmissionActivation(bound, {
        ...bound,
        [identityField]: `${bound[identityField]}-changed`,
      })).toBe(false);
    }
    for (const proofField of Object.keys(bound.monotonicProof) as Array<keyof typeof bound.monotonicProof>) {
      const value = bound.monotonicProof[proofField];
      expect(sameExtensionSubmissionActivation(bound, {
        ...bound,
        monotonicProof: {
          ...bound.monotonicProof,
          [proofField]: typeof value === 'number' ? value + 1 : value.replace('6', '8'),
        },
      })).toBe(false);
    }
  });
});

describe('extension activation runtime wiring', () => {
  const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
  const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
  const activationSource = readFileSync(new URL('./submission-activation.ts', import.meta.url), 'utf8');
  const pendingSource = readFileSync(new URL('./pending-extension-submission.ts', import.meta.url), 'utf8');

  it('starts the paired monotonic and wall budget before both backend requests', () => {
    const directStart = background.slice(
      background.indexOf("case 'EXTENSION_SUBMISSION_START'"),
      background.indexOf("case 'EXTENSION_SUBMISSION_OUTCOME'"),
    );
    const dashboardStart = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));

    expect(directStart).toMatch(/activationRequestClock = backgroundActivationRequestClock\(\)[\s\S]*?timeoutBackendFetch[\s\S]*?verifyExtensionSubmissionStartResponse/);
    expect(dashboardStart).toMatch(/GET_SUBMISSION_ACTIVATION_REQUEST_CLOCK[\s\S]*?activationRequestClock = backgroundActivationRequestClock\(\)[\s\S]*?timeoutBackendFetch/);
    expect(dashboardStart).toMatch(/activationRequestClock: contentActivationRequestClock/);
  });

  it('samples independent wall time with every background and document clock read', () => {
    expect(background).toMatch(/backgroundActivationRequestClock[\s\S]*?requestStartedAtMs: performance\.now\(\)[\s\S]*?wallRequestStartedAtMs: Date\.now\(\)/);
    expect(background).toMatch(/backgroundActivationCurrentClock[\s\S]*?nowMs: performance\.now\(\)[\s\S]*?wallNowMs: Date\.now\(\)/);
    expect(content).toMatch(/beginSubmissionActivationRequest[\s\S]*?requestStartedAtMs: performance\.now\(\)[\s\S]*?wallRequestStartedAtMs: Date\.now\(\)/);
    expect(content).toMatch(/currentSubmissionActivationClock[\s\S]*?nowMs: performance\.now\(\)[\s\S]*?wallNowMs: Date\.now\(\)/);
  });

  it('requires the current background generation and document clock for every employer click path', () => {
    const manual = content.slice(
      content.indexOf('function armManualSubmissionTracking'),
      content.indexOf('const freeSubmissionOutcomeButtons'),
    );
    const dashboard = content.slice(
      content.indexOf('submitFromDashboard = async'),
      content.indexOf('/* The attended handoff'),
    );
    const automatic = content.slice(
      content.indexOf('function runAutoSubmitCountdown'),
      content.indexOf('Workday account-creation speed-up'),
    );

    for (const clickPath of [manual, dashboard, automatic]) {
      expect(clickPath).toMatch(/validateBackgroundGenerationForEmployerClick/);
      expect(clickPath).toMatch(/runExtensionSubmissionClickAfterBackgroundValidation/);
      expect(clickPath).toMatch(/currentSubmissionActivationClock\(\)/);
    }
    expect(manual).toMatch(/runExtensionSubmissionClickAfterBackgroundValidation\([\s\S]*?submitButton\.click\(\)/);
    expect(dashboard).toMatch(/runExtensionSubmissionClickAfterBackgroundValidation\([\s\S]*?clickDashboardSubmitIfAllowed/);
    expect(automatic).toMatch(/runExtensionSubmissionClickAfterBackgroundValidation\([\s\S]*?clickAtsSubmitIfAllowed/);
  });

  it('validates the stored identity and background proof in the current worker generation', () => {
    const validation = background.slice(
      background.indexOf("case 'VALIDATE_SUBMISSION_ACTIVATION_FOR_CLICK'"),
      background.indexOf("case 'EXTENSION_SUBMISSION_OUTCOME'"),
    );
    expect(validation).toMatch(/commitPendingExtensionSubmissionForClick\(\{[\s\S]*?expected: callerActivation/);
    expect(validation).toMatch(/validate: \(storedPending\)[\s\S]*?verifyExtensionSubmissionActivation\(\s*storedPending/);
    expect(validation).not.toMatch(/verifyExtensionSubmissionActivation\(\s*callerActivation/);
    expect(pendingSource).toMatch(/submissionAuthorityPhase: 'reserved'[\s\S]*?submissionAuthorityPhase: 'click_committed'/);
  });

  it('keeps the document validation and DOM click boundary synchronous', () => {
    const boundary = activationSource.slice(
      activationSource.indexOf('export function runExtensionSubmissionClickAfterBackgroundValidation'),
      activationSource.indexOf('/** Convert and bind the backend'),
    );
    expect(boundary).not.toMatch(/\basync\b|\bawait\b/);
    expect(boundary).toMatch(/verifyDocumentExtensionSubmissionActivation[\s\S]*?input\.click\(\)/);
  });

  it('keeps one phased authority lane through click monitoring and exact settlement', () => {
    expect(background.match(/await reservePendingSubmission\(/g)?.length).toBe(2);
    expect(background).toMatch(/outcome !== 'cancelled'[\s\S]*?submissionAuthorityPhase !== 'click_committed'/);
    expect(background).toMatch(/pending\?\.submissionAuthorityPhase === 'reserved'[\s\S]*?'cancelled'/);
    expect(background).toMatch(/pending\.submissionAuthorityPhase === 'reserved' \? 'cancelled' : 'unknown'/);
    expect(background).toMatch(/mutationKey: pendingSubmissionMutationKey\(tabId\)[\s\S]*?expected: callerActivation/);
  });

  it('sends complete activation identity on every outcome path', () => {
    const outcomeMessages = [...content.matchAll(/type: 'EXTENSION_SUBMISSION_OUTCOME'/g)];
    expect(outcomeMessages.length).toBeGreaterThanOrEqual(3);
    for (const match of outcomeMessages) {
      const message = content.slice(match.index, match.index + 900);
      expect(message).toMatch(/\bactivation(?:\s*:|,)/);
    }
    expect(background).toMatch(/callerActivation = message\.payload\?\.activation[\s\S]*?extensionSubmissionActivationIdentity\(callerActivation\)/);
    expect(background).toMatch(/settlePendingSubmissionOutcome/);
  });

  it('uses the five-minute age only for post-click confirmation monitoring', () => {
    expect(background).toContain('SUBMISSION_CONFIRMATION_MAX_AGE_MS');
    expect(background).not.toContain('PENDING_SUBMISSION_MAX_AGE_MS');
    expect(background).toMatch(/bounds post-click confirmation monitoring only/);
  });
});
