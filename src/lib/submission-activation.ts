export type ExtensionSubmissionActivationIdentity = {
  applicationId: string;
  claimId: string;
  activationId: string;
  activationLeaseId: string;
  activationExpiresAt: string;
  activationServerNow: string;
};

export type ExtensionSubmissionActivationMonotonicProof = {
  runtimeId: string;
  timeOriginMs: number;
  requestStartedAtMs: number;
  usableUntilMs: number;
};

export type ExtensionSubmissionActivation = ExtensionSubmissionActivationIdentity & {
  monotonicProof: ExtensionSubmissionActivationMonotonicProof;
};

export type DocumentBoundExtensionSubmissionActivation = ExtensionSubmissionActivation & {
  documentMonotonicProof: ExtensionSubmissionActivationMonotonicProof;
};

export type ExtensionSubmissionActivationRequestClock = {
  runtimeId: string;
  timeOriginMs: number;
  requestStartedAtMs: number;
};

export type ExtensionSubmissionActivationCurrentClock = {
  runtimeId: string;
  timeOriginMs: number;
  nowMs: number;
};

export const EXTENSION_SUBMISSION_ACTIVATION_CONTRACT = 'server-lease-v1' as const;

// Budget one extra second for response parsing, Chrome messaging, and the final synchronous
// safety checks. The request-start anchor already subtracts the complete backend round trip.
export const EXTENSION_SUBMISSION_ACTIVATION_SAFETY_MARGIN_MS = 1_000;
// The backend authority primitive refuses every boundary TTL above five minutes. Keep the browser
// ceiling aligned with that invariant so a malformed response cannot create a longer capability.
export const EXTENSION_SUBMISSION_ACTIVATION_MAX_LEASE_MS = 5 * 60_000;

type ExtensionSubmissionActivationFailure = {
  ok: false;
  code: 'submission_activation_invalid' | 'submission_activation_expired';
  error: string;
};

export type ExtensionSubmissionActivationVerification =
  | {
    ok: true;
    activation: ExtensionSubmissionActivation;
    expiresAtMs: number;
    serverNowMs: number;
    remainingBudgetMs: number;
  }
  | ExtensionSubmissionActivationFailure;

export type DocumentExtensionSubmissionActivationVerification =
  | {
    ok: true;
    activation: DocumentBoundExtensionSubmissionActivation;
    expiresAtMs: number;
    serverNowMs: number;
    remainingBudgetMs: number;
  }
  | ExtensionSubmissionActivationFailure;

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

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function exactIdentity(value: unknown, expectedApplicationId: string): {
  identity: ExtensionSubmissionActivationIdentity;
  expiresAtMs: number;
  serverNowMs: number;
} | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const expiresAtMs = exactIsoInstant(candidate.activationExpiresAt);
  const serverNowMs = exactIsoInstant(candidate.activationServerNow);
  if (
    !exactUuid(expectedApplicationId)
    || candidate.applicationId !== expectedApplicationId
    || !exactUuid(candidate.applicationId)
    || !exactUuid(candidate.claimId)
    || !exactUuid(candidate.activationId)
    || !exactUuid(candidate.activationLeaseId)
    || expiresAtMs === null
    || serverNowMs === null
    || expiresAtMs <= serverNowMs
    || expiresAtMs - serverNowMs > EXTENSION_SUBMISSION_ACTIVATION_MAX_LEASE_MS
  ) return null;
  return {
    identity: {
      applicationId: candidate.applicationId,
      claimId: candidate.claimId,
      activationId: candidate.activationId,
      activationLeaseId: candidate.activationLeaseId,
      activationExpiresAt: candidate.activationExpiresAt as string,
      activationServerNow: candidate.activationServerNow as string,
    },
    expiresAtMs,
    serverNowMs,
  };
}

function validCurrentClock(value: ExtensionSubmissionActivationCurrentClock): boolean {
  return exactUuid(value.runtimeId)
    && finiteNonNegative(value.timeOriginMs)
    && finiteNonNegative(value.nowMs);
}

function exactMonotonicProof(value: unknown): ExtensionSubmissionActivationMonotonicProof | null {
  if (!value || typeof value !== 'object') return null;
  const proof = value as Record<string, unknown>;
  if (
    !exactUuid(proof.runtimeId)
    || !finiteNonNegative(proof.timeOriginMs)
    || !finiteNonNegative(proof.requestStartedAtMs)
    || !finiteNonNegative(proof.usableUntilMs)
    || proof.usableUntilMs <= proof.requestStartedAtMs
  ) return null;
  return {
    runtimeId: proof.runtimeId,
    timeOriginMs: proof.timeOriginMs,
    requestStartedAtMs: proof.requestStartedAtMs,
    usableUntilMs: proof.usableUntilMs,
  };
}

function monotonicProofMatchesLease(
  proof: ExtensionSubmissionActivationMonotonicProof,
  expiresAtMs: number,
  serverNowMs: number,
): boolean {
  const expectedUsableUntilMs = proof.requestStartedAtMs
    + (expiresAtMs - serverNowMs)
    - EXTENSION_SUBMISSION_ACTIVATION_SAFETY_MARGIN_MS;
  return Number.isFinite(expectedUsableUntilMs) && proof.usableUntilMs === expectedUsableUntilMs;
}

function expired(): ExtensionSubmissionActivationFailure {
  return {
    ok: false,
    code: 'submission_activation_expired',
    error: EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
  };
}

function invalid(): ExtensionSubmissionActivationFailure {
  return {
    ok: false,
    code: 'submission_activation_invalid',
    error: INVALID_SUBMISSION_ACTIVATION_MESSAGE,
  };
}

/**
 * Bind a server activation to the runtime that initiated the request.
 *
 * The usable monotonic deadline is requestStart + serverLease - margin. Anchoring at request start
 * subtracts the complete request and response latency. It also avoids trusting the device wall
 * clock. The runtime id and performance time origin make a serialized proof unusable after a
 * content-script reload, navigation, or service-worker restart.
 */
export function bindExtensionSubmissionActivation(
  value: unknown,
  expectedApplicationId: string,
  requestClock: ExtensionSubmissionActivationRequestClock | null | undefined,
  currentClock: ExtensionSubmissionActivationCurrentClock,
): ExtensionSubmissionActivationVerification {
  const parsed = exactIdentity(value, expectedApplicationId);
  if (
    !parsed
    || !requestClock
    || !exactUuid(requestClock.runtimeId)
    || requestClock.runtimeId !== currentClock.runtimeId
    || !finiteNonNegative(requestClock.timeOriginMs)
    || requestClock.timeOriginMs !== currentClock.timeOriginMs
    || !finiteNonNegative(requestClock.requestStartedAtMs)
    || !validCurrentClock(currentClock)
    || currentClock.nowMs < requestClock.requestStartedAtMs
  ) return invalid();

  const leaseDurationMs = parsed.expiresAtMs - parsed.serverNowMs;
  const usableUntilMs = requestClock.requestStartedAtMs
    + leaseDurationMs
    - EXTENSION_SUBMISSION_ACTIVATION_SAFETY_MARGIN_MS;
  const remainingBudgetMs = usableUntilMs - currentClock.nowMs;
  if (!Number.isFinite(usableUntilMs) || remainingBudgetMs <= 0) return expired();

  return {
    ok: true,
    activation: {
      ...parsed.identity,
      monotonicProof: {
        runtimeId: requestClock.runtimeId,
        timeOriginMs: requestClock.timeOriginMs,
        requestStartedAtMs: requestClock.requestStartedAtMs,
        usableUntilMs,
      },
    },
    expiresAtMs: parsed.expiresAtMs,
    serverNowMs: parsed.serverNowMs,
    remainingBudgetMs,
  };
}

/** Validate the exact activation and its local monotonic proof at an employer click boundary. */
export function verifyExtensionSubmissionActivation(
  value: unknown,
  expectedApplicationId: string,
  currentClock: ExtensionSubmissionActivationCurrentClock,
): ExtensionSubmissionActivationVerification {
  const parsed = exactIdentity(value, expectedApplicationId);
  if (!parsed || !value || typeof value !== 'object' || !validCurrentClock(currentClock)) return invalid();
  const candidate = value as Record<string, unknown>;
  const monotonic = exactMonotonicProof(candidate.monotonicProof);
  if (
    !monotonic
    || !monotonicProofMatchesLease(monotonic, parsed.expiresAtMs, parsed.serverNowMs)
    || monotonic.runtimeId !== currentClock.runtimeId
    || monotonic.timeOriginMs !== currentClock.timeOriginMs
  ) return invalid();
  const remainingBudgetMs = monotonic.usableUntilMs - currentClock.nowMs;
  if (remainingBudgetMs <= 0) return expired();
  return {
    ok: true,
    activation: {
      ...parsed.identity,
      monotonicProof: {
        runtimeId: monotonic.runtimeId,
        timeOriginMs: monotonic.timeOriginMs,
        requestStartedAtMs: monotonic.requestStartedAtMs,
        usableUntilMs: monotonic.usableUntilMs,
      },
    },
    expiresAtMs: parsed.expiresAtMs,
    serverNowMs: parsed.serverNowMs,
    remainingBudgetMs,
  };
}

/**
 * Preserve the background generation proof while adding the document-local request budget. The
 * background proof remains mandatory so the current worker generation can validate it again at the
 * final click boundary.
 */
export function bindExtensionSubmissionActivationToDocument(
  value: unknown,
  expectedApplicationId: string,
  requestClock: ExtensionSubmissionActivationRequestClock | null | undefined,
  currentClock: ExtensionSubmissionActivationCurrentClock,
): DocumentExtensionSubmissionActivationVerification {
  const parsed = exactIdentity(value, expectedApplicationId);
  const backgroundProof = value && typeof value === 'object'
    ? exactMonotonicProof((value as Record<string, unknown>).monotonicProof)
    : null;
  if (
    !parsed
    || !backgroundProof
    || !monotonicProofMatchesLease(backgroundProof, parsed.expiresAtMs, parsed.serverNowMs)
  ) return invalid();
  const documentBinding = bindExtensionSubmissionActivation(
    parsed.identity,
    expectedApplicationId,
    requestClock,
    currentClock,
  );
  if (!documentBinding.ok) return documentBinding;
  return {
    ...documentBinding,
    activation: {
      ...parsed.identity,
      monotonicProof: backgroundProof,
      documentMonotonicProof: documentBinding.activation.monotonicProof,
    },
  };
}

/** Validate only the document-local proof immediately before an employer click. */
export function verifyDocumentExtensionSubmissionActivation(
  value: unknown,
  expectedApplicationId: string,
  currentClock: ExtensionSubmissionActivationCurrentClock,
): DocumentExtensionSubmissionActivationVerification {
  const parsed = exactIdentity(value, expectedApplicationId);
  if (!parsed || !value || typeof value !== 'object' || !validCurrentClock(currentClock)) return invalid();
  const candidate = value as Record<string, unknown>;
  const backgroundProof = exactMonotonicProof(candidate.monotonicProof);
  if (
    !backgroundProof
    || !monotonicProofMatchesLease(backgroundProof, parsed.expiresAtMs, parsed.serverNowMs)
  ) return invalid();
  const documentProof = exactMonotonicProof(candidate.documentMonotonicProof);
  if (
    !documentProof
    || !monotonicProofMatchesLease(documentProof, parsed.expiresAtMs, parsed.serverNowMs)
    || documentProof.runtimeId !== currentClock.runtimeId
    || documentProof.timeOriginMs !== currentClock.timeOriginMs
  ) return invalid();
  const remainingBudgetMs = documentProof.usableUntilMs - currentClock.nowMs;
  if (remainingBudgetMs <= 0) return expired();
  return {
    ok: true,
    activation: {
      ...parsed.identity,
      monotonicProof: backgroundProof,
      documentMonotonicProof: documentProof,
    },
    expiresAtMs: parsed.expiresAtMs,
    serverNowMs: parsed.serverNowMs,
    remainingBudgetMs,
  };
}

/**
 * Final synchronous document boundary after the current background generation has replied. Keeping
 * the document clock read and click in one non-async function makes the no-await contract testable.
 */
export function runExtensionSubmissionClickAfterBackgroundValidation(input: {
  backgroundValidation: { ok: boolean; error?: string };
  activation: DocumentBoundExtensionSubmissionActivation;
  expectedApplicationId: string;
  currentClock: ExtensionSubmissionActivationCurrentClock;
  click: () => boolean;
  clickRejectedError: string;
}):
  | { ok: true; activation: DocumentBoundExtensionSubmissionActivation }
  | { ok: false; error: string } {
  if (!input.backgroundValidation.ok) {
    return {
      ok: false,
      error: input.backgroundValidation.error
        ?? 'Litos could not verify the current browser send permission. Nothing was sent.',
    };
  }
  const verifiedDocumentActivation = verifyDocumentExtensionSubmissionActivation(
    input.activation,
    input.expectedApplicationId,
    input.currentClock,
  );
  if (!verifiedDocumentActivation.ok) return verifiedDocumentActivation;
  if (!input.click()) return { ok: false, error: input.clickRejectedError };
  return { ok: true, activation: verifiedDocumentActivation.activation };
}

/** Convert and bind the backend's exact snake-case extension-start contract. */
export function verifyExtensionSubmissionStartResponse(
  value: unknown,
  expectedApplicationId: string,
  requestClock: ExtensionSubmissionActivationRequestClock,
  currentClock: ExtensionSubmissionActivationCurrentClock,
): ExtensionSubmissionActivationVerification {
  if (!value || typeof value !== 'object') return invalid();
  const response = value as Record<string, unknown>;
  if (response.activation_contract !== EXTENSION_SUBMISSION_ACTIVATION_CONTRACT) return invalid();
  return bindExtensionSubmissionActivation({
    applicationId: response.application_id,
    claimId: response.claim_id,
    activationId: response.activation_id,
    activationLeaseId: response.activation_lease_id,
    activationExpiresAt: response.activation_expires_at,
    activationServerNow: response.activation_server_now,
  }, expectedApplicationId, requestClock, currentClock);
}

export function extensionSubmissionActivationIdentity(
  value: unknown,
): ExtensionSubmissionActivationIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const expectedApplicationId = typeof candidate.applicationId === 'string'
    ? candidate.applicationId
    : '';
  return exactIdentity(candidate, expectedApplicationId)?.identity ?? null;
}

export function sameExtensionSubmissionActivationIdentity(
  left: unknown,
  right: unknown,
): boolean {
  const a = extensionSubmissionActivationIdentity(left);
  const b = extensionSubmissionActivationIdentity(right);
  return Boolean(a && b
    && a.applicationId === b.applicationId
    && a.claimId === b.claimId
    && a.activationId === b.activationId
    && a.activationLeaseId === b.activationLeaseId
    && a.activationExpiresAt === b.activationExpiresAt
    && a.activationServerNow === b.activationServerNow);
}
