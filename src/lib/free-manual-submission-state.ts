import { FREE_SUBMISSION_MONITOR_TTL_MS } from './free-submission-monitor';

export const FREE_MANUAL_RESERVATION_TTL_MS = 60 * 60_000;

const FREE_MANUAL_RESERVATION_PREFIX = 'litos_pending_free_manual_reservation';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_START_URL_LENGTH = 2048;

export type FreeManualSubmissionBinding = {
  eventId: string;
  applicationId: string;
  tabId: number;
  frameId: number;
  accountId: string;
  authEpoch: number;
  startUrl: string;
};

type FreeManualSubmissionSharedState = FreeManualSubmissionBinding & {
  startedAt: number;
};

export type FreeManualReservedState = FreeManualSubmissionSharedState & {
  phase: 'reserved';
};

export type FreeManualMonitoringState = FreeManualSubmissionSharedState & {
  phase: 'monitoring';
  monitoringStartedAt: number;
  boundaryLeaseId: string | null;
  boundaryActivationId: string | null;
  boundaryExpiresAt: number | null;
};

export type FreeManualSubmissionState = FreeManualReservedState | FreeManualMonitoringState;

export type FreeManualSubmissionStateClassification =
  | { kind: 'valid'; state: FreeManualSubmissionState }
  | { kind: 'expired_reserved'; state: FreeManualReservedState }
  | { kind: 'expired_monitoring'; state: FreeManualMonitoringState }
  | { kind: 'malformed' };

export type FreeManualSubmissionMonitoringTransition = FreeManualSubmissionBinding & {
  now: number;
};

export type FreeManualSubmissionAuthorizationTransition = FreeManualSubmissionBinding & {
  leaseId: string;
  activationId: string;
  expiresAt: number;
  now: number;
};

export type FreeManualReservationWriteDisposition =
  | { kind: 'write' }
  | { kind: 'unchanged' }
  | { kind: 'blocked'; reason: 'malformed' | 'monitoring' | 'conflicting_reservation' };

export type FreeManualSubmissionStartupState = {
  pending: FreeManualReservedState | null;
  blocked: boolean;
};

export type FreeManualAcceptedOutcomeBinding = FreeManualSubmissionBinding & {
  leaseId: string;
  activationId: string;
};

export type FreeManualAcceptedOutcomeDisposition = 'remove' | 'already_removed' | 'blocked';

export type FreeManualSafeNotSentDisposition = 'remove' | 'already_removed' | 'blocked';

const RESERVED_KEYS = new Set([
  'phase',
  'eventId',
  'applicationId',
  'tabId',
  'frameId',
  'accountId',
  'authEpoch',
  'startUrl',
  'startedAt',
]);

const MONITORING_KEYS = new Set([
  ...RESERVED_KEYS,
  'monitoringStartedAt',
  'boundaryLeaseId',
  'boundaryActivationId',
  'boundaryExpiresAt',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_START_URL_LENGTH) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && parsed.toString().length <= MAX_START_URL_LENGTH;
  } catch {
    return false;
  }
}

function validBinding(value: Record<string, unknown>): boolean {
  return typeof value.eventId === 'string'
    && UUID.test(value.eventId)
    && typeof value.applicationId === 'string'
    && UUID.test(value.applicationId)
    && isSafeNonNegativeInteger(value.tabId)
    && isSafeNonNegativeInteger(value.frameId)
    && typeof value.accountId === 'string'
    && UUID.test(value.accountId)
    && isSafeNonNegativeInteger(value.authEpoch)
    && isSafeHttpsUrl(value.startUrl);
}

function validTimestamp(value: unknown, now: number): value is number {
  return isSafeNonNegativeInteger(value) && value <= now;
}

export function freeManualSubmissionStateKey(tabId: number, frameId: number): string {
  if (!isSafeNonNegativeInteger(tabId) || !isSafeNonNegativeInteger(frameId)) {
    throw new Error('Free manual submission storage requires an exact tab and frame');
  }
  return `${FREE_MANUAL_RESERVATION_PREFIX}:${tabId}:${frameId}`;
}

export function classifyFreeManualSubmissionState(
  value: unknown,
  now: number = Date.now(),
): FreeManualSubmissionStateClassification {
  if (!isSafeNonNegativeInteger(now) || !isPlainRecord(value) || !validBinding(value)) {
    return { kind: 'malformed' };
  }
  if (!validTimestamp(value.startedAt, now)) return { kind: 'malformed' };

  if (value.phase === 'reserved') {
    if (!hasExactKeys(value, RESERVED_KEYS)) return { kind: 'malformed' };
    const state = value as FreeManualReservedState;
    return now - value.startedAt > FREE_MANUAL_RESERVATION_TTL_MS
      ? { kind: 'expired_reserved', state }
      : { kind: 'valid', state };
  }

  if (value.phase === 'monitoring') {
    if (!hasExactKeys(value, MONITORING_KEYS)) return { kind: 'malformed' };
    if (!validTimestamp(value.monitoringStartedAt, now)) return { kind: 'malformed' };
    if (value.monitoringStartedAt < value.startedAt) return { kind: 'malformed' };
    const hasNoAuthorization = value.boundaryLeaseId === null
      && value.boundaryActivationId === null
      && value.boundaryExpiresAt === null;
    const hasAuthorization = typeof value.boundaryLeaseId === 'string'
      && UUID.test(value.boundaryLeaseId)
      && typeof value.boundaryActivationId === 'string'
      && UUID.test(value.boundaryActivationId)
      && isSafeNonNegativeInteger(value.boundaryExpiresAt);
    if (!hasNoAuthorization && !hasAuthorization) return { kind: 'malformed' };
    const state = value as FreeManualMonitoringState;
    return now - value.monitoringStartedAt > FREE_SUBMISSION_MONITOR_TTL_MS
      ? { kind: 'expired_monitoring', state }
      : { kind: 'valid', state };
  }

  return { kind: 'malformed' };
}

export function parseFreeManualSubmissionState(
  value: unknown,
  now: number = Date.now(),
): FreeManualSubmissionState | null {
  const classification = classifyFreeManualSubmissionState(value, now);
  if (classification.kind === 'valid') return classification.state;
  return null;
}

export function reservedFreeManualSubmissionState(
  input: FreeManualSubmissionSharedState,
  now: number = Date.now(),
): FreeManualReservedState | null {
  return freeManualReservedState({ phase: 'reserved', ...input }, now);
}

export function transitionFreeManualSubmissionStateToMonitoring(
  current: FreeManualSubmissionState,
  exactInput: FreeManualSubmissionMonitoringTransition,
): FreeManualMonitoringState | null {
  const reserved = freeManualReservedState(current, exactInput.now);
  if (!reserved) return null;
  if (
    reserved.eventId !== exactInput.eventId
    || reserved.applicationId !== exactInput.applicationId
    || reserved.tabId !== exactInput.tabId
    || reserved.frameId !== exactInput.frameId
    || reserved.accountId !== exactInput.accountId
    || reserved.authEpoch !== exactInput.authEpoch
    || reserved.startUrl !== exactInput.startUrl
  ) return null;
  return freeManualMonitoringState({
    ...reserved,
    phase: 'monitoring',
    monitoringStartedAt: exactInput.now,
    boundaryLeaseId: null,
    boundaryActivationId: null,
    boundaryExpiresAt: null,
  }, exactInput.now);
}

/** Persist the exact server authorization before its acknowledgement can reach page code. */
export function authorizeFreeManualSubmissionState(
  current: FreeManualSubmissionState,
  exactInput: FreeManualSubmissionAuthorizationTransition,
): FreeManualMonitoringState | null {
  const monitoring = freeManualMonitoringState(current, exactInput.now);
  if (!monitoring) return null;
  if (
    monitoring.eventId !== exactInput.eventId
    || monitoring.applicationId !== exactInput.applicationId
    || monitoring.tabId !== exactInput.tabId
    || monitoring.frameId !== exactInput.frameId
    || monitoring.accountId !== exactInput.accountId
    || monitoring.authEpoch !== exactInput.authEpoch
    || monitoring.startUrl !== exactInput.startUrl
    || !UUID.test(exactInput.leaseId)
    || !UUID.test(exactInput.activationId)
    || !isSafeNonNegativeInteger(exactInput.expiresAt)
  ) return null;
  if (
    monitoring.boundaryLeaseId
    && (monitoring.boundaryLeaseId !== exactInput.leaseId
      || monitoring.boundaryActivationId !== exactInput.activationId
      || monitoring.boundaryExpiresAt !== exactInput.expiresAt)
  ) return null;
  return {
    ...monitoring,
    boundaryLeaseId: exactInput.leaseId.toLowerCase(),
    boundaryActivationId: exactInput.activationId.toLowerCase(),
    boundaryExpiresAt: exactInput.expiresAt,
  };
}

/** Remove only the exact authorized monitor after its backend outcome write was accepted. */
export function freeManualAcceptedOutcomeDisposition(
  value: unknown,
  exact: FreeManualAcceptedOutcomeBinding,
  now: number = Date.now(),
): FreeManualAcceptedOutcomeDisposition {
  if (value === undefined) return 'already_removed';
  const classified = classifyFreeManualSubmissionState(value, now);
  const state = classified.kind === 'valid'
    ? classified.state
    : classified.kind === 'expired_monitoring'
      ? classified.state
      : null;
  if (!state || state.phase !== 'monitoring') return 'blocked';
  return sameBinding(state, exact)
    && state.boundaryLeaseId === exact.leaseId.toLowerCase()
    && state.boundaryActivationId === exact.activationId.toLowerCase()
    ? 'remove'
    : 'blocked';
}

/**
 * Remove a locally durable attempt after the server proves that no employer press occurred.
 * The record must still be the exact lease-less state captured before the server request. A newer,
 * different, or authorized monitor remains blocked even when the older server attempt was closed.
 */
export function freeManualSafeNotSentDisposition(
  value: unknown,
  exact: FreeManualSubmissionState,
  now: number = Date.now(),
): FreeManualSafeNotSentDisposition {
  const exactClassified = classifyFreeManualSubmissionState(exact, now);
  const exactState = exactClassified.kind === 'valid'
    ? exactClassified.state
    : exactClassified.kind === 'expired_reserved' || exactClassified.kind === 'expired_monitoring'
      ? exactClassified.state
      : null;
  if (
    !exactState
    || (exactState.phase === 'monitoring'
      && (exactState.boundaryLeaseId !== null
        || exactState.boundaryActivationId !== null
        || exactState.boundaryExpiresAt !== null))
  ) return 'blocked';
  if (value === undefined) return 'already_removed';
  const classified = classifyFreeManualSubmissionState(value, now);
  const state = classified.kind === 'valid'
    ? classified.state
    : classified.kind === 'expired_reserved' || classified.kind === 'expired_monitoring'
      ? classified.state
      : null;
  if (
    !state
    || !sameBinding(state, exactState)
    || state.phase !== exactState.phase
    || state.startedAt !== exactState.startedAt
  ) return 'blocked';
  if (state.phase === 'reserved') return 'remove';
  if (
    exactState.phase !== 'monitoring'
    || state.monitoringStartedAt !== exactState.monitoringStartedAt
    || state.boundaryLeaseId !== null
    || state.boundaryActivationId !== null
    || state.boundaryExpiresAt !== null
  ) return 'blocked';
  return 'remove';
}

export function freeManualReservedState(
  value: unknown,
  now: number = Date.now(),
): FreeManualReservedState | null {
  const parsed = parseFreeManualSubmissionState(value, now);
  return parsed?.phase === 'reserved' ? parsed : null;
}

export function freeManualMonitoringState(
  value: unknown,
  now: number = Date.now(),
): FreeManualMonitoringState | null {
  const parsed = parseFreeManualSubmissionState(value, now);
  return parsed?.phase === 'monitoring' ? parsed : null;
}

function sameBinding(
  left: FreeManualSubmissionBinding,
  right: FreeManualSubmissionBinding,
): boolean {
  return left.eventId === right.eventId
    && left.applicationId === right.applicationId
    && left.tabId === right.tabId
    && left.frameId === right.frameId
    && left.accountId === right.accountId
    && left.authEpoch === right.authEpoch
    && left.startUrl === right.startUrl;
}

/** Decides a queued storage write without ever allowing monitoring to become reserved again. */
export function freeManualReservationWriteDisposition(
  currentValues: readonly unknown[],
  pending: FreeManualReservedState,
  now: number = Date.now(),
): FreeManualReservationWriteDisposition {
  if (!freeManualReservedState(pending, now)) return { kind: 'blocked', reason: 'malformed' };
  const classified = currentValues.map((value) => classifyFreeManualSubmissionState(value, now));
  if (classified.some((entry) => entry.kind === 'malformed')) {
    return { kind: 'blocked', reason: 'malformed' };
  }
  const states = classified.flatMap((entry) => entry.kind === 'valid'
    || entry.kind === 'expired_reserved'
    || entry.kind === 'expired_monitoring'
    ? [entry.state]
    : []);
  if (states.some((state) => state.phase === 'monitoring')) {
    return { kind: 'blocked', reason: 'monitoring' };
  }
  const reservations = states.filter((state): state is FreeManualReservedState => state.phase === 'reserved');
  if (reservations.length === 0) return { kind: 'write' };
  if (reservations.length === 1 && sameBinding(reservations[0]!, pending)) {
    return { kind: 'unchanged' };
  }
  return { kind: 'blocked', reason: 'conflicting_reservation' };
}

/** Folds every tab-scoped record into one fail-closed document-start decision. */
export function freeManualSubmissionStartupState(
  currentValues: readonly unknown[],
  frameId: number,
  now: number = Date.now(),
): FreeManualSubmissionStartupState {
  const classified = currentValues.map((value) => classifyFreeManualSubmissionState(value, now));
  const malformed = classified.some((entry) => entry.kind === 'malformed');
  const states = classified.flatMap((entry) => entry.kind === 'valid'
    || entry.kind === 'expired_reserved'
    || entry.kind === 'expired_monitoring'
    ? [entry.state]
    : []);
  const monitoring = states.some((state) => state.phase === 'monitoring');
  const expired = classified.some((entry) => entry.kind === 'expired_reserved');
  const reservations = states.filter((state): state is FreeManualReservedState => state.phase === 'reserved');
  const exact = reservations.find((state) => state.frameId === frameId) ?? null;
  const crossFrame = reservations.some((state) => state.frameId !== frameId);
  const pending = !malformed && !monitoring && !expired && !crossFrame ? exact : null;
  return {
    pending,
    blocked: malformed || monitoring || expired || crossFrame || (reservations.length > 0 && !pending),
  };
}

export function freeManualSubmissionStartupResponse(
  startup: FreeManualSubmissionStartupState,
  input: { tokenPresent: boolean; navigationMatches: boolean },
): FreeManualSubmissionStartupState {
  if (!input.tokenPresent || !startup.pending || !input.navigationMatches) {
    return { pending: null, blocked: startup.blocked || Boolean(startup.pending) };
  }
  return startup;
}
