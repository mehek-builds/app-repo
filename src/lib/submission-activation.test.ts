import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
  EXTENSION_SUBMISSION_ACTIVATION_CONTRACT,
  INVALID_SUBMISSION_ACTIVATION_MESSAGE,
  verifyExtensionSubmissionActivation,
  verifyExtensionSubmissionStartResponse,
  type ExtensionSubmissionActivation,
} from './submission-activation';

const applicationId = '123e4567-e89b-42d3-a456-426614174000';
const activation: ExtensionSubmissionActivation = {
  applicationId,
  claimId: '223e4567-e89b-42d3-a456-426614174000',
  activationId: '323e4567-e89b-52d3-a456-426614174000',
  activationLeaseId: '423e4567-e89b-52d3-a456-426614174000',
  activationExpiresAt: '2026-08-31T10:03:00.000Z',
};

describe('extension submission activation', () => {
  it('pins the client request to the server lease contract', () => {
    expect(EXTENSION_SUBMISSION_ACTIVATION_CONTRACT).toBe('server-lease-v1');
  });

  it('accepts and preserves every exact backend identifier', () => {
    const result = verifyExtensionSubmissionStartResponse({
      application_id: activation.applicationId,
      claim_id: activation.claimId,
      activation_id: activation.activationId,
      activation_lease_id: activation.activationLeaseId,
      activation_expires_at: activation.activationExpiresAt,
    }, applicationId, Date.parse('2026-08-31T10:00:00.000Z'));

    expect(result).toEqual({
      ok: true,
      activation,
      expiresAtMs: Date.parse(activation.activationExpiresAt),
    });
  });

  it.each([
    ['missing activation id', { ...activation, activationId: undefined }],
    ['missing lease id', { ...activation, activationLeaseId: undefined }],
    ['wrong activation id', { ...activation, activationId: 'not-an-activation-id' }],
    ['upper-case activation id', { ...activation, activationId: activation.activationId.toUpperCase() }],
    ['mismatched application', { ...activation, applicationId: '523e4567-e89b-42d3-a456-426614174000' }],
    ['non-canonical expiry', { ...activation, activationExpiresAt: '2026-08-31T10:03:00Z' }],
  ])('rejects %s before click', (_label, candidate) => {
    expect(verifyExtensionSubmissionActivation(
      candidate,
      applicationId,
      Date.parse('2026-08-31T10:00:00.000Z'),
    )).toEqual({
      ok: false,
      code: 'submission_activation_invalid',
      error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
    });
  });

  it('rejects at the server expiry and never extends it to the local five-minute window', () => {
    const justBefore = verifyExtensionSubmissionActivation(
      activation,
      applicationId,
      Date.parse('2026-08-31T10:02:59.999Z'),
    );
    expect(justBefore.ok).toBe(true);

    for (const now of [
      '2026-08-31T10:03:00.000Z',
      '2026-08-31T10:04:59.999Z',
    ]) {
      expect(verifyExtensionSubmissionActivation(
        activation,
        applicationId,
        Date.parse(now),
      )).toEqual({
        ok: false,
        code: 'submission_activation_expired',
        error: EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
      });
    }
  });
});

describe('extension activation runtime wiring', () => {
  const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
  const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

  it('requires the full server activation before persisting either start path', () => {
    const directStart = background.slice(
      background.indexOf("case 'EXTENSION_SUBMISSION_START'"),
      background.indexOf("case 'EXTENSION_SUBMISSION_OUTCOME'"),
    );
    const dashboardStart = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));

    expect(directStart).toMatch(/verifyExtensionSubmissionStartResponse\(body, applicationId\)[\s\S]*?\.\.\.activation[\s\S]*?setPendingSubmission/);
    expect(directStart).toMatch(/activation_contract: EXTENSION_SUBMISSION_ACTIVATION_CONTRACT[\s\S]*?authorization/);
    expect(directStart).toMatch(/sendResponse\(\{ ok: true, \.\.\.activation \}\)/);
    expect(dashboardStart).toMatch(/verifyExtensionSubmissionStartResponse\(started, applicationId\)[\s\S]*?payload: \{ applicationId, questions: \[\], activation \}/);
    expect(dashboardStart).toMatch(/activation_contract: EXTENSION_SUBMISSION_ACTIVATION_CONTRACT[\s\S]*?authorization: 'user_initiated'/);
  });

  it('binds every outcome to the same exact activation contract', () => {
    const outcome = background.slice(
      background.indexOf('async function postExtensionOutcome'),
      background.indexOf('async function closePendingSubmission'),
    );

    expect(outcome).toMatch(/activation_contract: EXTENSION_SUBMISSION_ACTIVATION_CONTRACT/);
    expect(outcome).toMatch(/claim_id: pending\.claimId/);
    expect(outcome).toMatch(/activation_id: pending\.activationId/);
    expect(outcome).toMatch(/activation_lease_id: pending\.activationLeaseId/);
    expect(outcome).toMatch(/activation_expires_at: pending\.activationExpiresAt/);
  });

  it('checks the exact server activation immediately before every employer click path', () => {
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

    expect(manual).toMatch(/verifyExtensionSubmissionActivation\(response, applicationId\)[\s\S]*?submitButton\.click\(\)/);
    expect(dashboard).toMatch(/verifyExtensionSubmissionActivation\(activation, resume\.resume_id\)[\s\S]*?clickDashboardSubmitIfAllowed/);
    expect(automatic).toMatch(/verifyExtensionSubmissionActivation\(started, applicationId\)[\s\S]*?clickAtsSubmitIfAllowed/);
  });

  it('uses the five-minute age only for post-click confirmation monitoring', () => {
    expect(background).toContain('SUBMISSION_CONFIRMATION_MAX_AGE_MS');
    expect(background).not.toContain('PENDING_SUBMISSION_MAX_AGE_MS');
    expect(background).toMatch(/bounds post-click confirmation monitoring only/);
  });
});
