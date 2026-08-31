export type ExtensionSubmissionActivation = {
  applicationId: string;
  claimId: string;
  activationId: string;
  activationLeaseId: string;
  activationExpiresAt: string;
};

export const EXTENSION_SUBMISSION_ACTIVATION_CONTRACT = 'server-lease-v1' as const;

export type ExtensionSubmissionActivationVerification =
  | {
    ok: true;
    activation: ExtensionSubmissionActivation;
    expiresAtMs: number;
  }
  | {
    ok: false;
    code: 'submission_activation_invalid' | 'submission_activation_expired';
    error: string;
  };

export const INVALID_SUBMISSION_ACTIVATION_MESSAGE =
  'Litos could not verify a current send permission. Nothing was sent. Try again.';

export const EXPIRED_SUBMISSION_ACTIVATION_MESSAGE =
  'The safe send window expired before Litos could click. Nothing was sent. Try again.';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function exactIsoInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === value ? parsed : null;
}

/**
 * Validate the exact activation delivered by the backend before an employer submit click.
 * The server expiry is the only pre-click deadline. A local pending or confirmation window must
 * never extend it.
 */
export function verifyExtensionSubmissionActivation(
  value: unknown,
  expectedApplicationId: string,
  now = Date.now(),
): ExtensionSubmissionActivationVerification {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      code: 'submission_activation_invalid',
      error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
    };
  }
  const candidate = value as Record<string, unknown>;
  const expiresAtMs = exactIsoInstant(candidate.activationExpiresAt);
  if (
    !exactUuid(expectedApplicationId)
    || candidate.applicationId !== expectedApplicationId
    || !exactUuid(candidate.applicationId)
    || !exactUuid(candidate.claimId)
    || !exactUuid(candidate.activationId)
    || !exactUuid(candidate.activationLeaseId)
    || expiresAtMs === null
  ) {
    return {
      ok: false,
      code: 'submission_activation_invalid',
      error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
    };
  }
  if (expiresAtMs <= now) {
    return {
      ok: false,
      code: 'submission_activation_expired',
      error: EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
    };
  }
  return {
    ok: true,
    activation: {
      applicationId: candidate.applicationId,
      claimId: candidate.claimId,
      activationId: candidate.activationId,
      activationLeaseId: candidate.activationLeaseId,
      activationExpiresAt: candidate.activationExpiresAt as string,
    },
    expiresAtMs,
  };
}

/** Convert the backend's exact snake-case extension-start contract without weakening it. */
export function verifyExtensionSubmissionStartResponse(
  value: unknown,
  expectedApplicationId: string,
  now = Date.now(),
): ExtensionSubmissionActivationVerification {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      code: 'submission_activation_invalid',
      error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
    };
  }
  const response = value as Record<string, unknown>;
  if (response.activation_contract !== EXTENSION_SUBMISSION_ACTIVATION_CONTRACT) {
    return {
      ok: false,
      code: 'submission_activation_invalid',
      error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
    };
  }
  return verifyExtensionSubmissionActivation({
    applicationId: response.application_id,
    claimId: response.claim_id,
    activationId: response.activation_id,
    activationLeaseId: response.activation_lease_id,
    activationExpiresAt: response.activation_expires_at,
  }, expectedApplicationId, now);
}
