import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
  EXTENSION_SUBMISSION_ACTIVATION_CONTRACT,
  EXTENSION_SUBMISSION_ACTIVATION_SAFETY_MARGIN_MS,
  INVALID_SUBMISSION_ACTIVATION_MESSAGE,
  bindExtensionSubmissionActivation,
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
const currentClock = (nowMs: number, overrides: Partial<{
  runtimeId: string;
  timeOriginMs: number;
}> = {}) => ({
  runtimeId: overrides.runtimeId ?? runtimeId,
  timeOriginMs: overrides.timeOriginMs ?? requestClock.timeOriginMs,
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

  it('checks a document-local performance clock immediately before every employer click path', () => {
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

    expect(manual).toMatch(/verifyExtensionSubmissionActivation\([\s\S]*?currentSubmissionActivationClock\(\)[\s\S]*?submitButton\.click\(\)/);
    expect(dashboard).toMatch(/verifyExtensionSubmissionActivation\([\s\S]*?currentSubmissionActivationClock\(\)[\s\S]*?clickDashboardSubmitIfAllowed/);
    expect(automatic).toMatch(/verifyExtensionSubmissionActivation\([\s\S]*?currentSubmissionActivationClock\(\)[\s\S]*?clickAtsSubmitIfAllowed/);
  });

  it('sends complete activation identity on every outcome path', () => {
    const outcomeMessages = [...content.matchAll(/type: 'EXTENSION_SUBMISSION_OUTCOME'/g)];
    expect(outcomeMessages.length).toBeGreaterThanOrEqual(4);
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
