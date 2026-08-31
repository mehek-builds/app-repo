import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
  EXTENSION_SUBMISSION_ACTIVATION_CONTRACT,
  EXTENSION_SUBMISSION_ACTIVATION_MAX_LEASE_MS,
  EXTENSION_SUBMISSION_ACTIVATION_SAFETY_MARGIN_MS,
  INVALID_SUBMISSION_ACTIVATION_MESSAGE,
  bindExtensionSubmissionActivation,
  bindExtensionSubmissionActivationToDocument,
  runExtensionSubmissionClickAfterBackgroundValidation,
  sameExtensionSubmissionActivationIdentity,
  verifyExtensionSubmissionActivation,
  verifyExtensionSubmissionStartResponse,
  type ExtensionSubmissionActivationIdentity,
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
};
const documentRuntimeId = '723e4567-e89b-42d3-a456-426614174000';
const documentRequestClock: ExtensionSubmissionActivationRequestClock = {
  runtimeId: documentRuntimeId,
  timeOriginMs: 2_000_000,
  requestStartedAtMs: 500,
};
const currentClock = (nowMs: number, overrides: Partial<{
  runtimeId: string;
  timeOriginMs: number;
}> = {}) => ({
  runtimeId: overrides.runtimeId ?? runtimeId,
  timeOriginMs: overrides.timeOriginMs ?? requestClock.timeOriginMs,
  nowMs,
});
const documentCurrentClock = (nowMs: number, overrides: Partial<{
  runtimeId: string;
  timeOriginMs: number;
}> = {}) => ({
  runtimeId: overrides.runtimeId ?? documentRuntimeId,
  timeOriginMs: overrides.timeOriginMs ?? documentRequestClock.timeOriginMs,
  nowMs,
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
        usableUntilMs: requestClock.requestStartedAtMs
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
});

describe('extension activation runtime wiring', () => {
  const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
  const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

  it('starts a monotonic budget before both backend requests', () => {
    const directStart = background.slice(
      background.indexOf("case 'EXTENSION_SUBMISSION_START'"),
      background.indexOf("case 'EXTENSION_SUBMISSION_OUTCOME'"),
    );
    const dashboardStart = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));

    expect(directStart).toMatch(/activationRequestClock = backgroundActivationRequestClock\(\)[\s\S]*?timeoutBackendFetch[\s\S]*?verifyExtensionSubmissionStartResponse/);
    expect(dashboardStart).toMatch(/GET_SUBMISSION_ACTIVATION_REQUEST_CLOCK[\s\S]*?activationRequestClock = backgroundActivationRequestClock\(\)[\s\S]*?timeoutBackendFetch/);
    expect(dashboardStart).toMatch(/activationRequestClock: contentActivationRequestClock/);
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
    expect(validation).toMatch(/pendingSubmission\(tabId\)[\s\S]*?sameExtensionSubmissionActivationIdentity/);
    expect(validation).toMatch(/verifyExtensionSubmissionActivation\([\s\S]*?backgroundActivationCurrentClock\(\)/);
  });

  it('sends complete activation identity on every outcome path', () => {
    const outcomeMessages = [...content.matchAll(/type: 'EXTENSION_SUBMISSION_OUTCOME'/g)];
    expect(outcomeMessages.length).toBeGreaterThanOrEqual(3);
    for (const match of outcomeMessages) {
      const message = content.slice(match.index, match.index + 900);
      expect(message).toMatch(/\bactivation(?:\s*:|,)/);
    }
    expect(background).toMatch(/extensionSubmissionActivationIdentity\(message\.payload\?\.activation\)/);
    expect(background).toMatch(/settlePendingSubmissionOutcome/);
  });

  it('uses the five-minute age only for post-click confirmation monitoring', () => {
    expect(background).toContain('SUBMISSION_CONFIRMATION_MAX_AGE_MS');
    expect(background).not.toContain('PENDING_SUBMISSION_MAX_AGE_MS');
    expect(background).toMatch(/bounds post-click confirmation monitoring only/);
  });
});
