import { applicationFormIdentityKey } from './web-handoff';

export const SUBMISSION_OUTCOME_OUTBOX_STORAGE_KEY = 'litos:submission-attempt-journal:v2';
export const SUBMISSION_OUTCOME_OUTBOX_LEGACY_STORAGE_KEY = 'litos:submission-attempt-journal:v1';
export const SUBMISSION_OUTCOME_OUTBOX_ALARM = 'litos-submission-outcome-outbox-replay';
export const SUBMISSION_OUTCOME_OUTBOX_VERSION = 2 as const;
export const SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES = 64;
export const SUBMISSION_OUTCOME_OUTBOX_MAX_URL_LENGTH = 2048;
export const SUBMISSION_OUTCOME_OUTBOX_MAX_CONFIRMATION_LENGTH = 2000;
export const SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRY_BYTES = 16 * 1024;
export const SUBMISSION_OUTCOME_REPLAY_LIMIT = 8;
export const SUBMISSION_OUTCOME_LATE_OBSERVATION_MS = 5 * 60_000;
export const WORKABLE_RECEIPT_TEXT = 'Your application has been submitted successfully.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const OUTCOMES = new Set<SubmissionOutcome>(['confirmed', 'failed', 'unknown', 'cancelled']);
const PHASES = new Set<SubmissionAttemptPhase>(['armed', 'pressed', 'outcome', 'awaiting_receipt']);
const ROOT_KEYS = new Set(['version', 'entries', 'quarantined', 'acknowledged']);
const QUARANTINE_KEYS = new Set(['version', 'reason', 'slot']);
const ACKNOWLEDGEMENT_KEYS = new Set([
  'version', 'lane', 'accountId', 'applicationId', 'attemptId', 'tabId', 'frameId', 'startUrl',
  'outcome', 'acknowledgedAt',
]);
const PROOF_KEYS = new Set(['version', 'family', 'state', 'evidence', 'form_still_present']);
const REPAIR_REASONS = new Set<SubmissionOutcomeRepairReason>([
  'permanent_client_error', 'stale_attempt', 'authoritative_mismatch',
]);
const ENTRY_KEYS = new Set([
  'version', 'lane', 'phase', 'accountId', 'applicationId', 'attemptId', 'claimId', 'eventId',
  'leaseId', 'activationId', 'boundaryExpiresAt', 'tabId', 'frameId', 'capturedAuthEpoch',
  'startUrl', 'startedAt', 'pressedAt', 'packetVersion', 'auditDigest', 'outcome', 'finalUrl',
  'confirmationText', 'receiptProof', 'capturedAt', 'retryCount', 'lastAttemptAt',
  'nextAttemptAt', 'lateObservationDeadline', 'repairReason', 'repairStatus', 'repairAt',
  'requestPath', 'serializedBody',
]);
const LEGACY_ROOT_KEYS = new Set(['version', 'entries', 'quarantined']);
const LEGACY_ENTRY_KEYS = new Set([...ENTRY_KEYS].filter((key) => ![
  'pressedAt', 'lateObservationDeadline', 'repairReason', 'repairStatus', 'repairAt',
].includes(key)));

export type SubmissionOutcome = 'confirmed' | 'failed' | 'unknown' | 'cancelled';
export type SubmissionOutcomeLane = 'extension' | 'free';
export type SubmissionAttemptPhase = 'armed' | 'pressed' | 'outcome' | 'awaiting_receipt';
export type SubmissionOutcomeRepairReason = 'permanent_client_error' | 'stale_attempt' | 'authoritative_mismatch';
export type WorkableReceiptProofV1 = {
  version: 1;
  family: 'workable';
  state: 'application_submitted';
  evidence: 'workable_successful_submit';
  form_still_present: false;
};
export type GreenhouseReceiptProofV1 = {
  version: 1;
  family: 'greenhouse';
  state: 'application_submitted';
  evidence: 'greenhouse_confirmation_content';
  form_still_present: false;
};
export type SubmissionReceiptProofV1 = WorkableReceiptProofV1 | GreenhouseReceiptProofV1;

type SharedArmInput = {
  accountId: string;
  applicationId: string;
  tabId: number;
  frameId: number;
  capturedAuthEpoch: number;
  startUrl: string;
  startedAt?: number;
};

export type ExtensionSubmissionAttemptArmInput = SharedArmInput & {
  lane: 'extension';
  claimId: string;
  packetVersion: string;
  auditDigest: string;
};

export type FreeSubmissionAttemptArmInput = SharedArmInput & {
  lane: 'free';
  eventId: string;
};

export type SubmissionAttemptArmInput = ExtensionSubmissionAttemptArmInput | FreeSubmissionAttemptArmInput;

type SharedOutcomeInput = {
  accountId: string;
  applicationId: string;
  tabId: number;
  frameId: number;
  capturedAuthEpoch: number;
  startUrl: string;
  outcome: SubmissionOutcome;
  finalUrl: string;
  confirmationText?: string;
  receiptProof?: SubmissionReceiptProofV1 | null;
  capturedAt?: number;
};

export type ExtensionSubmissionOutcomeInput = SharedOutcomeInput & {
  lane: 'extension';
  claimId: string;
};

export type FreeSubmissionOutcomeInput = SharedOutcomeInput & {
  lane: 'free';
  eventId: string;
  leaseId: string;
  activationId: string;
  outcome: Exclude<SubmissionOutcome, 'cancelled'>;
};

export type SubmissionOutcomeInput = ExtensionSubmissionOutcomeInput | FreeSubmissionOutcomeInput;

export type SubmissionOutcomeOutboxEntry = {
  version: 2;
  lane: SubmissionOutcomeLane;
  phase: SubmissionAttemptPhase;
  accountId: string;
  applicationId: string;
  attemptId: string;
  claimId: string | null;
  eventId: string | null;
  leaseId: string | null;
  activationId: string | null;
  boundaryExpiresAt: number | null;
  tabId: number;
  frameId: number;
  capturedAuthEpoch: number;
  startUrl: string;
  startedAt: number;
  pressedAt: number | null;
  packetVersion: string | null;
  auditDigest: string | null;
  outcome: SubmissionOutcome | null;
  finalUrl: string | null;
  confirmationText: string;
  receiptProof: SubmissionReceiptProofV1 | null;
  capturedAt: number | null;
  retryCount: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number;
  lateObservationDeadline: number | null;
  repairReason: SubmissionOutcomeRepairReason | null;
  repairStatus: number | null;
  repairAt: number | null;
  requestPath: string;
  serializedBody: string;
};

export type SubmissionOutcomeQuarantine = { version: 2; reason: 'invalid_entry'; slot: number };
export type SubmissionOutcomeAcknowledgement = {
  version: 2;
  lane: SubmissionOutcomeLane;
  accountId: string;
  applicationId: string;
  attemptId: string;
  tabId: number;
  frameId: number;
  startUrl: string;
  outcome: 'confirmed';
  acknowledgedAt: number;
};
export type SubmissionOutcomeOutboxValue = {
  version: 2;
  entries: SubmissionOutcomeOutboxEntry[];
  quarantined: SubmissionOutcomeQuarantine[];
  acknowledged: SubmissionOutcomeAcknowledgement[];
};
export type SubmissionOutcomeOutboxStorage = {
  read(): Promise<unknown>;
  write(value: SubmissionOutcomeOutboxValue): Promise<void>;
  remove(): Promise<void>;
  readLegacy?(): Promise<unknown>;
  removeLegacy?(): Promise<void>;
};
export type SubmissionOutcomeDeliveryResponse = { ok: boolean; status: number; body: unknown };
export type SubmissionOutcomeDeliveryResult =
  | { acknowledged: true; entry: SubmissionOutcomeOutboxEntry }
  | { acknowledged: false; entry: SubmissionOutcomeOutboxEntry; status?: number };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_ID.test(value);
}

function normalizedUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

function validVersionBinding(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function sanitizeSubmissionOutcomeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > SUBMISSION_OUTCOME_OUTBOX_MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    parsed.hash = '';
    const normalized = parsed.toString();
    return normalized.length <= SUBMISSION_OUTCOME_OUTBOX_MAX_URL_LENGTH ? normalized : null;
  } catch {
    return null;
  }
}

export function sanitizeSubmissionOutcomeConfirmation(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, SUBMISSION_OUTCOME_OUTBOX_MAX_CONFIRMATION_LENGTH)
    : '';
}

export function exactWorkableReceiptProof(value: unknown): WorkableReceiptProofV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, PROOF_KEYS)) return null;
  return value.version === 1
    && value.family === 'workable'
    && value.state === 'application_submitted'
    && value.evidence === 'workable_successful_submit'
    && value.form_still_present === false
    ? value as WorkableReceiptProofV1
    : null;
}

export function exactGreenhouseReceiptProof(value: unknown): GreenhouseReceiptProofV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, PROOF_KEYS)) return null;
  return value.version === 1
    && value.family === 'greenhouse'
    && value.state === 'application_submitted'
    && value.evidence === 'greenhouse_confirmation_content'
    && value.form_still_present === false
    ? value as GreenhouseReceiptProofV1
    : null;
}

export function exactSubmissionReceiptProof(value: unknown): SubmissionReceiptProofV1 | null {
  return exactWorkableReceiptProof(value) ?? exactGreenhouseReceiptProof(value);
}

export function workableReceiptBindingMatches(startUrl: string, finalUrl: string): boolean {
  try {
    const start = new URL(startUrl);
    const final = new URL(finalUrl);
    return start.protocol === 'https:'
      && final.protocol === 'https:'
      && !start.username
      && !start.password
      && !final.username
      && !final.password
      && start.hostname === 'apply.workable.com'
      && /^\/[^/]+\/j\/[0-9a-f]{10}\/apply\/$/i.test(start.pathname)
      && start.origin === final.origin
      && start.pathname === final.pathname
      && final.search === '?success'
      && !final.hash;
  } catch {
    return false;
  }
}

export function greenhouseReceiptBindingMatches(startUrl: string, finalUrl: string): boolean {
  try {
    const start = new URL(startUrl);
    const final = new URL(finalUrl);
    const allowedHosts = new Set(['job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io']);
    const sharedAuthority = start.protocol === 'https:'
      && final.protocol === 'https:'
      && !start.username
      && !start.password
      && !final.username
      && !final.password
      && start.port === ''
      && final.port === ''
      && allowedHosts.has(start.hostname)
      && start.hostname === final.hostname
      && start.hash === ''
      && final.hash === '';
    if (!sharedAuthority) return false;
    const startPath = /^\/([^/]+)\/jobs\/(\d+)\/?$/.exec(start.pathname);
    const finalPath = /^\/([^/]+)\/jobs\/(\d+)\/confirmation\/?$/.exec(final.pathname);
    if (startPath && finalPath) {
      return startPath[1] === finalPath[1]
        && startPath[2] === finalPath[2]
        && start.search === ''
        && final.search === '';
    }
    if (start.pathname !== '/embed/job_app' || final.pathname !== '/embed/job_app/confirmation') return false;
    const exactEmbedQuery = (url: URL) => {
      const keys = [...url.searchParams.keys()];
      const tenant = url.searchParams.getAll('for');
      const token = url.searchParams.getAll('token');
      return keys.length === 2
        && tenant.length === 1
        && /^[A-Za-z0-9_-]+$/.test(tenant[0] ?? '')
        && token.length === 1
        && /^\d{5,20}$/.test(token[0] ?? '')
        ? { tenant: tenant[0]!, token: token[0]! }
        : null;
    };
    const startQuery = exactEmbedQuery(start);
    const finalQuery = exactEmbedQuery(final);
    return Boolean(startQuery && finalQuery
      && startQuery.tenant === finalQuery.tenant
      && startQuery.token === finalQuery.token);
  } catch {
    return false;
  }
}

export function submissionOutcomeAttemptKey(lane: SubmissionOutcomeLane, attemptId: string): string {
  return `${lane}:${attemptId.toLowerCase()}`;
}

function outcomeRank(outcome: SubmissionOutcome | null): number {
  if (outcome === 'confirmed') return 4;
  if (outcome === 'failed') return 3;
  if (outcome === 'cancelled') return 2;
  if (outcome === 'unknown') return 1;
  return 0;
}

function requestForEntryFields(input: {
  lane: SubmissionOutcomeLane;
  applicationId: string;
  claimId: string | null;
  eventId: string | null;
  leaseId: string | null;
  activationId: string | null;
  outcome: SubmissionOutcome;
  finalUrl: string;
  confirmationText: string;
  receiptProof: SubmissionReceiptProofV1 | null;
}): { requestPath: string; serializedBody: string } {
  const shared = {
    outcome: input.outcome,
    final_url: input.finalUrl,
    ...(input.confirmationText ? { confirmation_text: input.confirmationText } : {}),
    ...(input.receiptProof ? { receipt_proof: input.receiptProof } : {}),
  };
  return input.lane === 'extension'
    ? {
      requestPath: `/applications/${input.applicationId}/submission/extension-outcome`,
      serializedBody: JSON.stringify({ claim_id: input.claimId, ...shared }),
    }
    : {
      requestPath: `/applications/${input.applicationId}/manual-submission-outcome`,
      serializedBody: JSON.stringify({
        event_id: input.eventId,
        lease_id: input.leaseId,
        activation_id: input.activationId,
        ...shared,
      }),
    };
}

function assertEntrySize(entry: SubmissionOutcomeOutboxEntry): void {
  if (new TextEncoder().encode(JSON.stringify(entry)).byteLength > SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRY_BYTES) {
    throw new Error('The submission attempt is too large to save safely.');
  }
}

function buildArmedEntry(input: SubmissionAttemptArmInput, now: number): SubmissionOutcomeOutboxEntry {
  if (!isIdentifier(input.accountId)) throw new Error('The submission attempt has no valid account owner.');
  const applicationId = normalizedUuid(input.applicationId);
  if (!applicationId) throw new Error('The submission attempt has no valid application.');
  if (!isSafeNonNegativeInteger(input.tabId) || !isSafeNonNegativeInteger(input.frameId)) {
    throw new Error('The submission attempt has no exact browser context.');
  }
  if (!isSafeNonNegativeInteger(input.capturedAuthEpoch) || !isSafeNonNegativeInteger(now)) {
    throw new Error('The submission attempt has no valid authentication fence.');
  }
  const startUrl = sanitizeSubmissionOutcomeUrl(input.startUrl);
  if (!startUrl) throw new Error('The submission attempt URL is unsafe.');
  const claimId = input.lane === 'extension' ? normalizedUuid(input.claimId) : null;
  const eventId = input.lane === 'free' ? normalizedUuid(input.eventId) : null;
  if (input.lane === 'extension' && (!claimId || !validVersionBinding(input.packetVersion) || !validVersionBinding(input.auditDigest))) {
    throw new Error('The extension attempt has no exact immutable packet binding.');
  }
  if (input.lane === 'free' && !eventId) throw new Error('The Free attempt has no exact event.');
  const entry: SubmissionOutcomeOutboxEntry = {
    version: 2,
    lane: input.lane,
    phase: 'armed',
    accountId: input.accountId,
    applicationId,
    attemptId: (claimId ?? eventId)!,
    claimId,
    eventId,
    leaseId: null,
    activationId: null,
    boundaryExpiresAt: null,
    tabId: input.tabId,
    frameId: input.frameId,
    capturedAuthEpoch: input.capturedAuthEpoch,
    startUrl,
    startedAt: input.startedAt ?? now,
    pressedAt: null,
    packetVersion: input.lane === 'extension' ? input.packetVersion : null,
    auditDigest: input.lane === 'extension' ? input.auditDigest : null,
    outcome: null,
    finalUrl: null,
    confirmationText: '',
    receiptProof: null,
    capturedAt: null,
    retryCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: now,
    lateObservationDeadline: null,
    repairReason: null,
    repairStatus: null,
    repairAt: null,
    requestPath: '',
    serializedBody: '',
  };
  assertEntrySize(entry);
  return entry;
}

function sameAttemptIdentity(entry: SubmissionOutcomeOutboxEntry, input: SubmissionOutcomeInput): boolean {
  return entry.accountId === input.accountId
    && entry.applicationId === input.applicationId.toLowerCase()
    && entry.tabId === input.tabId
    && entry.frameId === input.frameId
    && entry.capturedAuthEpoch === input.capturedAuthEpoch
    && entry.startUrl === sanitizeSubmissionOutcomeUrl(input.startUrl)
    && (input.lane === 'extension'
      ? entry.claimId === input.claimId.toLowerCase()
      : entry.eventId === input.eventId.toLowerCase()
        && entry.leaseId === input.leaseId.toLowerCase()
        && entry.activationId === input.activationId.toLowerCase());
}

function buildOutcomeEntry(existing: SubmissionOutcomeOutboxEntry, input: SubmissionOutcomeInput, now: number): SubmissionOutcomeOutboxEntry {
  if (!sameAttemptIdentity(existing, input)) throw new Error('The submission outcome identity conflicts with the armed attempt.');
  if (existing.phase === 'armed' || existing.pressedAt === null) {
    throw new Error('The submission outcome has no durable employer press.');
  }
  if (!OUTCOMES.has(input.outcome)) throw new Error('The submission outcome is invalid.');
  const finalUrl = sanitizeSubmissionOutcomeUrl(input.finalUrl);
  if (!finalUrl) throw new Error('The submission outcome URL is unsafe.');
  let confirmationText = sanitizeSubmissionOutcomeConfirmation(input.confirmationText);
  const receiptProof = exactSubmissionReceiptProof(input.receiptProof);
  if (input.outcome === 'confirmed') {
    const exactWorkable = receiptProof?.family === 'workable'
      && confirmationText === WORKABLE_RECEIPT_TEXT
      && workableReceiptBindingMatches(existing.startUrl, finalUrl);
    const exactGreenhouse = receiptProof?.family === 'greenhouse'
      && confirmationText.length > 0
      && greenhouseReceiptBindingMatches(existing.startUrl, finalUrl);
    if (!exactWorkable && !exactGreenhouse) {
      throw new Error('The employer confirmation has no exact supported receipt proof.');
    }
    if (exactWorkable) confirmationText = WORKABLE_RECEIPT_TEXT;
  } else if (input.receiptProof) {
    throw new Error('Only a confirmed outcome can carry receipt proof.');
  }
  const request = requestForEntryFields({
    lane: existing.lane,
    applicationId: existing.applicationId,
    claimId: existing.claimId,
    eventId: existing.eventId,
    leaseId: existing.leaseId,
    activationId: existing.activationId,
    outcome: input.outcome,
    finalUrl,
    confirmationText,
    receiptProof,
  });
  const entry: SubmissionOutcomeOutboxEntry = {
    ...existing,
    phase: 'outcome',
    outcome: input.outcome,
    finalUrl,
    confirmationText,
    receiptProof,
    capturedAt: input.capturedAt ?? now,
    retryCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: input.capturedAt ?? now,
    lateObservationDeadline: input.outcome === 'confirmed'
      ? null
      : existing.lateObservationDeadline
        ?? (input.capturedAt ?? now) + SUBMISSION_OUTCOME_LATE_OBSERVATION_MS,
    repairReason: null,
    repairStatus: null,
    repairAt: null,
    requestPath: request.requestPath,
    serializedBody: request.serializedBody,
  };
  assertEntrySize(entry);
  return entry;
}

export function parseSubmissionOutcomeOutboxEntry(value: unknown): SubmissionOutcomeOutboxEntry | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return null;
  const applicationId = normalizedUuid(value.applicationId);
  const attemptId = normalizedUuid(value.attemptId);
  const claimId = value.claimId === null ? null : normalizedUuid(value.claimId);
  const eventId = value.eventId === null ? null : normalizedUuid(value.eventId);
  const leaseId = value.leaseId === null ? null : normalizedUuid(value.leaseId);
  const activationId = value.activationId === null ? null : normalizedUuid(value.activationId);
  if (
    value.version !== 2
    || (value.lane !== 'extension' && value.lane !== 'free')
    || !PHASES.has(value.phase as SubmissionAttemptPhase)
    || !isIdentifier(value.accountId)
    || !applicationId
    || !attemptId
    || !isSafeNonNegativeInteger(value.tabId)
    || !isSafeNonNegativeInteger(value.frameId)
    || !isSafeNonNegativeInteger(value.capturedAuthEpoch)
    || !isSafeNonNegativeInteger(value.startedAt)
    || !(value.pressedAt === null || isSafeNonNegativeInteger(value.pressedAt))
    || !isSafeNonNegativeInteger(value.retryCount)
    || !(value.lastAttemptAt === null || isSafeNonNegativeInteger(value.lastAttemptAt))
    || !isSafeNonNegativeInteger(value.nextAttemptAt)
    || !(value.lateObservationDeadline === null || isSafeNonNegativeInteger(value.lateObservationDeadline))
    || !(value.repairReason === null || REPAIR_REASONS.has(value.repairReason as SubmissionOutcomeRepairReason))
    || !(value.repairStatus === null || (isSafeNonNegativeInteger(value.repairStatus) && value.repairStatus >= 100 && value.repairStatus <= 599))
    || !(value.repairAt === null || isSafeNonNegativeInteger(value.repairAt))
    || ((value.repairReason === null) !== (value.repairStatus === null))
    || ((value.repairReason === null) !== (value.repairAt === null))
    || typeof value.confirmationText !== 'string'
    || sanitizeSubmissionOutcomeConfirmation(value.confirmationText) !== value.confirmationText
    || typeof value.requestPath !== 'string'
    || typeof value.serializedBody !== 'string'
  ) return null;
  const startUrl = sanitizeSubmissionOutcomeUrl(value.startUrl);
  const finalUrl = value.finalUrl === null ? null : sanitizeSubmissionOutcomeUrl(value.finalUrl);
  if (startUrl !== value.startUrl || finalUrl !== value.finalUrl) return null;
  if (value.lane === 'extension') {
    if (!claimId || eventId || leaseId || activationId || attemptId !== claimId
      || !validVersionBinding(value.packetVersion) || !validVersionBinding(value.auditDigest)
      || value.boundaryExpiresAt !== null) return null;
  } else if (claimId || !eventId || attemptId !== eventId || value.packetVersion !== null || value.auditDigest !== null) {
    return null;
  }
  const phase = value.phase as SubmissionAttemptPhase;
  if (phase === 'armed') {
    if (leaseId || activationId || value.boundaryExpiresAt !== null || value.pressedAt !== null
      || value.outcome !== null || finalUrl !== null
      || value.confirmationText !== '' || value.receiptProof !== null || value.capturedAt !== null
      || value.retryCount !== 0 || value.lastAttemptAt !== null || value.repairReason !== null
      || value.lateObservationDeadline !== null || value.repairStatus !== null || value.repairAt !== null
      || value.requestPath !== '' || value.serializedBody !== '') return null;
  } else if (phase === 'pressed') {
    if (!isSafeNonNegativeInteger(value.pressedAt)) return null;
    if (value.lane === 'free' && (!leaseId || !activationId || !isSafeNonNegativeInteger(value.boundaryExpiresAt))) return null;
    if (value.lane === 'extension' && (leaseId || activationId || value.boundaryExpiresAt !== null)) return null;
    if (value.outcome !== null || finalUrl !== null || value.confirmationText !== '' || value.receiptProof !== null
      || value.capturedAt !== null || value.retryCount !== 0 || value.lastAttemptAt !== null
      || value.repairReason !== null || value.repairStatus !== null || value.repairAt !== null
      || value.lateObservationDeadline !== null || value.requestPath !== '' || value.serializedBody !== '') return null;
  } else {
    if (!OUTCOMES.has(value.outcome as SubmissionOutcome) || !finalUrl
      || !isSafeNonNegativeInteger(value.pressedAt) || !isSafeNonNegativeInteger(value.capturedAt)) return null;
    if (phase === 'awaiting_receipt' && value.outcome === 'confirmed') return null;
    if (value.outcome === 'confirmed') {
      if (value.lateObservationDeadline !== null) return null;
    } else if (!isSafeNonNegativeInteger(value.lateObservationDeadline)
      || value.lateObservationDeadline > value.capturedAt + SUBMISSION_OUTCOME_LATE_OBSERVATION_MS) return null;
    if (value.lane === 'free' && (!leaseId || !activationId || !isSafeNonNegativeInteger(value.boundaryExpiresAt))) return null;
    const proof = value.receiptProof === null ? null : exactSubmissionReceiptProof(value.receiptProof);
    if (value.outcome === 'confirmed') {
      const exactWorkable = proof?.family === 'workable'
        && value.confirmationText === WORKABLE_RECEIPT_TEXT
        && workableReceiptBindingMatches(startUrl!, finalUrl);
      const exactGreenhouse = proof?.family === 'greenhouse'
        && value.confirmationText.length > 0
        && greenhouseReceiptBindingMatches(startUrl!, finalUrl);
      if (!exactWorkable && !exactGreenhouse) return null;
    } else if (value.receiptProof !== null) return null;
    const request = requestForEntryFields({
      lane: value.lane,
      applicationId,
      claimId,
      eventId,
      leaseId,
      activationId,
      outcome: value.outcome as SubmissionOutcome,
      finalUrl,
      confirmationText: value.confirmationText,
      receiptProof: proof,
    });
    if (request.requestPath !== value.requestPath || request.serializedBody !== value.serializedBody) return null;
  }
  const entry = value as SubmissionOutcomeOutboxEntry;
  try { assertEntrySize(entry); } catch { return null; }
  return entry;
}

function parseSubmissionOutcomeAcknowledgement(value: unknown): SubmissionOutcomeAcknowledgement | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ACKNOWLEDGEMENT_KEYS) || value.version !== 2) return null;
  const applicationId = normalizedUuid(value.applicationId);
  const attemptId = normalizedUuid(value.attemptId);
  const startUrl = sanitizeSubmissionOutcomeUrl(value.startUrl);
  if ((value.lane !== 'extension' && value.lane !== 'free')
    || !isIdentifier(value.accountId)
    || !applicationId
    || !attemptId
    || !isSafeNonNegativeInteger(value.tabId)
    || !isSafeNonNegativeInteger(value.frameId)
    || !startUrl
    || startUrl !== value.startUrl
    || value.outcome !== 'confirmed'
    || !isSafeNonNegativeInteger(value.acknowledgedAt)) return null;
  return value as SubmissionOutcomeAcknowledgement;
}

export function parseSubmissionOutcomeOutbox(value: unknown): SubmissionOutcomeOutboxValue | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ROOT_KEYS) || value.version !== 2) return null;
  if (!Array.isArray(value.entries) || !Array.isArray(value.quarantined) || !Array.isArray(value.acknowledged)
    || value.entries.length + value.quarantined.length + value.acknowledged.length
      > SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES) return null;
  const entries = value.entries.map(parseSubmissionOutcomeOutboxEntry);
  if (entries.some((entry) => !entry)) return null;
  const quarantined = value.quarantined.map((entry) => isPlainRecord(entry)
    && hasExactKeys(entry, QUARANTINE_KEYS)
    && entry.version === 2
    && entry.reason === 'invalid_entry'
    && isSafeNonNegativeInteger(entry.slot)
    ? entry as SubmissionOutcomeQuarantine
    : null);
  if (quarantined.some((entry) => !entry)) return null;
  const acknowledged = value.acknowledged.map(parseSubmissionOutcomeAcknowledgement);
  if (acknowledged.some((entry) => !entry)) return null;
  const exact = entries as SubmissionOutcomeOutboxEntry[];
  const keys = exact.map((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId));
  const acknowledgementKeys = (acknowledged as SubmissionOutcomeAcknowledgement[])
    .map((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId));
  const allKeys = [...keys, ...acknowledgementKeys];
  return new Set(keys).size === keys.length
    && new Set(acknowledgementKeys).size === acknowledgementKeys.length
    && new Set(allKeys).size === allKeys.length
    ? {
      version: 2,
      entries: exact,
      quarantined: quarantined as SubmissionOutcomeQuarantine[],
      acknowledged: acknowledged as SubmissionOutcomeAcknowledgement[],
    }
    : null;
}

export function migrateLegacySubmissionOutcomeOutbox(value: unknown): SubmissionOutcomeOutboxValue {
  const blocked = (): SubmissionOutcomeOutboxValue => ({
    version: 2,
    entries: [],
    quarantined: [{ version: 2, reason: 'invalid_entry', slot: 0 }],
    acknowledged: [],
  });
  if (!isPlainRecord(value)
    || !hasExactKeys(value, LEGACY_ROOT_KEYS)
    || value.version !== 1
    || !Array.isArray(value.entries)
    || !Array.isArray(value.quarantined)
    || value.entries.length + value.quarantined.length > SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES) return blocked();
  const entries: SubmissionOutcomeOutboxEntry[] = [];
  const quarantined: SubmissionOutcomeQuarantine[] = [];
  value.entries.forEach((candidate, slot) => {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, LEGACY_ENTRY_KEYS) || candidate.version !== 1) {
      quarantined.push({ version: 2, reason: 'invalid_entry', slot });
      return;
    }
    const migrated = parseSubmissionOutcomeOutboxEntry({
      ...candidate,
      version: 2,
      pressedAt: candidate.phase === 'armed' ? null : candidate.startedAt,
      lateObservationDeadline: (candidate.phase === 'outcome' || candidate.phase === 'awaiting_receipt')
        && candidate.outcome !== 'confirmed'
        && isSafeNonNegativeInteger(candidate.capturedAt)
        ? candidate.capturedAt + SUBMISSION_OUTCOME_LATE_OBSERVATION_MS
        : null,
      repairReason: null,
      repairStatus: null,
      repairAt: null,
    });
    if (migrated) entries.push(migrated);
    else quarantined.push({ version: 2, reason: 'invalid_entry', slot });
  });
  for (const candidate of value.quarantined) {
    if (isPlainRecord(candidate)
      && hasExactKeys(candidate, QUARANTINE_KEYS)
      && candidate.version === 1
      && candidate.reason === 'invalid_entry'
      && isSafeNonNegativeInteger(candidate.slot)) {
      quarantined.push({ version: 2, reason: 'invalid_entry', slot: candidate.slot });
    } else {
      quarantined.push({ version: 2, reason: 'invalid_entry', slot: value.entries.length + quarantined.length });
    }
  }
  const keys = entries.map((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId));
  if (new Set(keys).size !== keys.length) {
    throw new Error('The legacy submission journal contains duplicate durable attempts and requires repair.');
  }
  return { version: 2, entries, quarantined, acknowledged: [] };
}

export function submissionOutcomeRetryDelayMs(retryCount: number, random: () => number = Math.random): number {
  const boundedCount = Math.min(8, Math.max(0, Math.floor(retryCount)));
  const base = Math.min(5 * 60_000, 1_000 * (2 ** boundedCount));
  const jitter = Math.floor(base * 0.25 * Math.max(0, Math.min(1, random())));
  return Math.min(5 * 60_000, base + jitter);
}

export function submissionOutcomeRepairReason(
  status: number,
  responseMatched: boolean,
): SubmissionOutcomeRepairReason | null {
  if (responseMatched) return null;
  if (status >= 200 && status < 300) return 'authoritative_mismatch';
  if (status === 409 || status === 410) return 'stale_attempt';
  if (status >= 400 && status < 500 && ![401, 403, 408, 425, 429].includes(status)) {
    return 'permanent_client_error';
  }
  return null;
}

export function submissionOutcomeResponseMatches(entry: SubmissionOutcomeOutboxEntry, responseBody: unknown): boolean {
  if (entry.phase !== 'outcome' || !isPlainRecord(responseBody)) return false;
  if (entry.lane === 'extension') {
    if (responseBody.application_id !== entry.applicationId
      || responseBody.attempt_id !== entry.claimId
      || !isPlainRecord(responseBody.resolved_attempt_retry_safety)
      || responseBody.resolved_attempt_retry_safety.attemptId !== entry.claimId) return false;
    if (!isPlainRecord(responseBody.review)) return false;
    if (entry.outcome === 'confirmed') {
      return responseBody.outcome === 'confirmed'
        && responseBody.review.status === 'submitted'
        && responseBody.resolved_attempt_retry_safety.kind === 'blocked_confirmed';
    }
    if (responseBody.outcome !== 'unknown'
      || responseBody.review.status !== 'needs_attention'
      || responseBody.review.submission_claim_id !== entry.claimId
      || !isPlainRecord(responseBody.review.unverified_submission)
      || responseBody.review.unverified_submission.cause !== 'no_confirmation_state'
      || responseBody.review.unverified_submission.resolution !== undefined
      || responseBody.resolved_attempt_retry_safety.kind !== 'blocked_unverified') return false;
    return true;
  }
  if (responseBody.application_id !== entry.applicationId
    || responseBody.event_id !== entry.eventId
    || responseBody.outcome !== entry.outcome
    || !isPlainRecord(responseBody.resolved_attempt_retry_safety)
    || responseBody.resolved_attempt_retry_safety.attemptId !== entry.eventId) return false;
  return responseBody.resolved_attempt_retry_safety.kind === (entry.outcome === 'confirmed'
    ? 'blocked_confirmed'
    : 'blocked_unverified');
}

export function submissionOutcomeLogoutCanPurge(
  entries: readonly SubmissionOutcomeOutboxEntry[],
  accountId: string,
  acknowledgements: readonly SubmissionOutcomeAcknowledgement[] = [],
): boolean {
  return !entries.some((entry) => entry.accountId === accountId)
    && !acknowledgements.some((entry) => entry.accountId === accountId);
}

export function submissionOutcomeReceiptVisibility(
  entry: Pick<SubmissionOutcomeOutboxEntry, 'phase' | 'outcome' | 'lateObservationDeadline'>,
  now: number = Date.now(),
): 'pending' | 'dead_letter' | null {
  if ((entry.phase === 'outcome' || entry.phase === 'awaiting_receipt')
    && entry.outcome !== null
    && entry.outcome !== 'confirmed'
    && entry.lateObservationDeadline !== null
    && entry.lateObservationDeadline <= now) return 'dead_letter';
  if (entry.phase === 'pressed'
    || ((entry.phase === 'outcome' || entry.phase === 'awaiting_receipt')
      && entry.outcome !== 'confirmed')) return 'pending';
  return null;
}

export class SubmissionOutcomeOutbox {
  private mutation: Promise<void> = Promise.resolve();

  constructor(private readonly storage: SubmissionOutcomeOutboxStorage) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readStrict(): Promise<SubmissionOutcomeOutboxValue> {
    let stored = await this.storage.read();
    if ((stored === undefined || stored === null) && this.storage.readLegacy) {
      const legacy = await this.storage.readLegacy();
      if (legacy !== undefined && legacy !== null) {
        const migrated = migrateLegacySubmissionOutcomeOutbox(legacy);
        await this.writeAndVerify(migrated);
        await this.storage.removeLegacy?.();
        return migrated;
      }
      stored = null;
    }
    if (stored === undefined || stored === null) return {
      version: 2, entries: [], quarantined: [], acknowledged: [],
    };
    const parsed = parseSubmissionOutcomeOutbox(stored);
    if (parsed) return parsed;
    if (!isPlainRecord(stored)
      || !hasExactKeys(stored, ROOT_KEYS)
      || stored.version !== 2
      || !Array.isArray(stored.entries)
      || !Array.isArray(stored.quarantined)
      || !Array.isArray(stored.acknowledged)
      || stored.entries.length > SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES
      || stored.quarantined.length > SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES
      || stored.acknowledged.length > SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES) {
      throw new Error('The saved submission attempt journal is invalid. Submission remains blocked.');
    }
    const entries: SubmissionOutcomeOutboxEntry[] = [];
    const quarantined: SubmissionOutcomeQuarantine[] = [];
    const acknowledged: SubmissionOutcomeAcknowledgement[] = [];
    stored.entries.forEach((entry, slot) => {
      const valid = parseSubmissionOutcomeOutboxEntry(entry);
      if (valid) entries.push(valid);
      else quarantined.push({ version: 2, reason: 'invalid_entry', slot });
    });
    for (const candidate of stored.quarantined) {
      if (isPlainRecord(candidate) && hasExactKeys(candidate, QUARANTINE_KEYS)
        && candidate.version === 2 && candidate.reason === 'invalid_entry' && isSafeNonNegativeInteger(candidate.slot)) {
        quarantined.push(candidate as SubmissionOutcomeQuarantine);
      } else {
        throw new Error('The saved submission attempt quarantine is malformed and requires repair.');
      }
    }
    const existingAcknowledgements = stored.acknowledged;
    for (const candidate of existingAcknowledgements) {
      const valid = parseSubmissionOutcomeAcknowledgement(candidate);
      if (!valid) throw new Error('A saved receipt acknowledgement is malformed and requires repair.');
      acknowledged.push(valid);
    }
    if (entries.length + quarantined.length + acknowledged.length > SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES) {
      throw new Error('The saved submission attempt journal exceeds its safe bound. Submission remains blocked.');
    }
    const keys = entries.map((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId));
    const acknowledgementKeys = acknowledged.map((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId));
    const allKeys = [...keys, ...acknowledgementKeys];
    if (new Set(keys).size !== keys.length
      || new Set(acknowledgementKeys).size !== acknowledgementKeys.length
      || new Set(allKeys).size !== allKeys.length) {
      throw new Error('The saved submission attempt journal contains duplicate durable attempts and requires repair.');
    }
    return { version: 2, entries, quarantined, acknowledged };
  }

  private async writeAndVerify(value: SubmissionOutcomeOutboxValue): Promise<void> {
    await this.storage.write(value);
    const verified = parseSubmissionOutcomeOutbox(await this.storage.read());
    if (!verified || JSON.stringify(verified) !== JSON.stringify(value)) {
      throw new Error('The submission attempt could not be verified in local storage.');
    }
  }

  list(): Promise<SubmissionOutcomeOutboxEntry[]> {
    return this.serialize(async () => [...(await this.readStrict()).entries]);
  }

  hasCapacity(): Promise<boolean> {
    return this.serialize(async () => {
      const current = await this.readStrict();
      return current.quarantined.length === 0
        && current.acknowledged.length === 0
        && current.entries.length + current.quarantined.length + current.acknowledged.length
          < SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES;
    });
  }

  health(): Promise<{ quarantined: number; repairRequired: number; capacityUsed: number; capacityMax: number; integrityBlocked: boolean }> {
    return this.serialize(async () => {
      try {
        const current = await this.readStrict();
        return {
          quarantined: current.quarantined.length,
          repairRequired: current.entries.filter((entry) => entry.repairReason !== null).length,
          capacityUsed: current.entries.length + current.quarantined.length + current.acknowledged.length,
          capacityMax: SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES,
          integrityBlocked: current.quarantined.length > 0,
        };
      } catch {
        return {
          quarantined: 0,
          repairRequired: 0,
          capacityUsed: SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES,
          capacityMax: SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES,
          integrityBlocked: true,
        };
      }
    });
  }

  discardQuarantinedAfterManualRepair(): Promise<void> {
    return this.serialize(async () => {
      const current = await this.readStrict();
      if (current.quarantined.length === 0) return;
      await this.writeAndVerify({ ...current, quarantined: [] });
    });
  }

  arm(input: SubmissionAttemptArmInput, now: number = Date.now()): Promise<SubmissionOutcomeOutboxEntry> {
    return this.serialize(async () => {
      const incoming = buildArmedEntry(input, input.startedAt ?? now);
      const current = await this.readStrict();
      if (current.quarantined.length > 0) {
        throw new Error('The submission attempt journal needs repair before another employer submission can start.');
      }
      if (current.acknowledged.length > 0) {
        throw new Error('A confirmed receipt must finish rendering before another employer submission can start.');
      }
      const key = submissionOutcomeAttemptKey(incoming.lane, incoming.attemptId);
      const existing = current.entries.find((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId) === key);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(incoming)) throw new Error('The submission attempt identity conflicts with the journal.');
        return existing;
      }
      if (current.entries.length + current.quarantined.length + current.acknowledged.length
        >= SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES) {
        throw new Error('The submission attempt journal is full. No employer submission can start until it drains.');
      }
      current.entries.push(incoming);
      await this.writeAndVerify(current);
      return incoming;
    });
  }

  markPressed(input: {
    lane: SubmissionOutcomeLane;
    attemptId: string;
    accountId: string;
    leaseId?: string;
    activationId?: string;
    boundaryExpiresAt?: number;
    pressedAt?: number;
  }): Promise<SubmissionOutcomeOutboxEntry> {
    return this.serialize(async () => {
      const current = await this.readStrict();
      const key = submissionOutcomeAttemptKey(input.lane, input.attemptId);
      const index = current.entries.findIndex((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId) === key);
      if (index < 0) throw new Error('The exact armed submission attempt is missing.');
      const existing = current.entries[index];
      if (existing.accountId !== input.accountId) throw new Error('The armed attempt belongs to a different account.');
      if (existing.phase === 'outcome' || existing.phase === 'awaiting_receipt') return existing;
      const pressedAt = existing.pressedAt ?? input.pressedAt ?? Date.now();
      if (!isSafeNonNegativeInteger(pressedAt)) throw new Error('The employer press time is invalid.');
      let updated: SubmissionOutcomeOutboxEntry;
      if (existing.lane === 'free') {
        const leaseId = normalizedUuid(input.leaseId);
        const activationId = normalizedUuid(input.activationId);
        if (!leaseId || !activationId || !isSafeNonNegativeInteger(input.boundaryExpiresAt)) {
          throw new Error('The Free submission press has no exact boundary authorization.');
        }
        if (existing.phase === 'pressed' && (existing.leaseId !== leaseId || existing.activationId !== activationId)) {
          throw new Error('The Free submission press conflicts with its saved authorization.');
        }
        updated = {
          ...existing,
          phase: 'pressed',
          pressedAt,
          leaseId,
          activationId,
          boundaryExpiresAt: input.boundaryExpiresAt!,
        };
      } else {
        updated = { ...existing, phase: 'pressed', pressedAt };
      }
      current.entries[index] = updated;
      await this.writeAndVerify(current);
      return updated;
    });
  }

  rebindArmedContext(input: {
    lane: SubmissionOutcomeLane;
    attemptId: string;
    accountId: string;
    tabId: number;
    frameId: number;
  }): Promise<SubmissionOutcomeOutboxEntry> {
    return this.serialize(async () => {
      if (!isSafeNonNegativeInteger(input.tabId) || !isSafeNonNegativeInteger(input.frameId)) {
        throw new Error('The recovered browser context is invalid.');
      }
      const current = await this.readStrict();
      const key = submissionOutcomeAttemptKey(input.lane, input.attemptId);
      const index = current.entries.findIndex((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId) === key);
      if (index < 0) throw new Error('The exact armed submission attempt is missing.');
      const existing = current.entries[index];
      if (existing.phase !== 'armed' || existing.accountId !== input.accountId) {
        throw new Error('Only an exact unpressed attempt can be rebound after restart.');
      }
      const updated = { ...existing, tabId: input.tabId, frameId: input.frameId };
      current.entries[index] = updated;
      await this.writeAndVerify(current);
      return updated;
    });
  }

  rebindRecoverableContext(input: {
    lane: SubmissionOutcomeLane;
    accountId: string;
    applicationId: string;
    attemptId: string;
    startUrl: string;
    currentUrl: string;
    tabId: number;
    frameId: number;
  }): Promise<SubmissionOutcomeOutboxEntry> {
    return this.serialize(async () => {
      if (!isSafeNonNegativeInteger(input.tabId) || !isSafeNonNegativeInteger(input.frameId)) {
        throw new Error('The recovered browser context is invalid.');
      }
      const applicationId = normalizedUuid(input.applicationId);
      const attemptId = normalizedUuid(input.attemptId);
      const startUrl = sanitizeSubmissionOutcomeUrl(input.startUrl);
      const currentUrl = sanitizeSubmissionOutcomeUrl(input.currentUrl);
      const frozenIdentity = startUrl ? applicationFormIdentityKey(startUrl) : null;
      const currentIdentity = currentUrl ? applicationFormIdentityKey(currentUrl) : null;
      if (!applicationId || !attemptId || !startUrl || !frozenIdentity || frozenIdentity !== currentIdentity) {
        throw new Error('The recovered submission page does not match the frozen employer posting.');
      }
      const current = await this.readStrict();
      const matches = current.entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.lane === input.lane
          && entry.accountId === input.accountId
          && entry.startUrl === startUrl
          && (entry.phase === 'pressed' || entry.phase === 'outcome' || entry.phase === 'awaiting_receipt'));
      if (matches.length !== 1) {
        throw new Error('The recovered submission page does not have exactly one durable pressed attempt.');
      }
      const { entry, index } = matches[0]!;
      if (entry.applicationId !== applicationId || entry.attemptId !== attemptId) {
        throw new Error('The recovered submission page does not match the exact durable attempt.');
      }
      const updated = { ...entry, tabId: input.tabId, frameId: input.frameId };
      if (updated.tabId === entry.tabId && updated.frameId === entry.frameId) return entry;
      current.entries[index] = updated;
      await this.writeAndVerify(current);
      return updated;
    });
  }

  persist(input: SubmissionOutcomeInput, now: number = Date.now()): Promise<SubmissionOutcomeOutboxEntry> {
    return this.serialize(async () => {
      const current = await this.readStrict();
      const attemptId = input.lane === 'extension' ? input.claimId : input.eventId;
      const key = submissionOutcomeAttemptKey(input.lane, attemptId);
      const index = current.entries.findIndex((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId) === key);
      if (index < 0) throw new Error('The exact armed submission attempt is missing.');
      const existing = current.entries[index];
      const incoming = buildOutcomeEntry(existing, input, input.capturedAt ?? now);
      if ((existing.phase === 'outcome' || existing.phase === 'awaiting_receipt')
        && outcomeRank(existing.outcome) >= outcomeRank(incoming.outcome)) return existing;
      current.entries[index] = incoming;
      await this.writeAndVerify(current);
      return incoming;
    });
  }

  cancelSafeNotSent(lane: SubmissionOutcomeLane, attemptId: string, accountId: string): Promise<boolean> {
    return this.serialize(async () => {
      const current = await this.readStrict();
      const key = submissionOutcomeAttemptKey(lane, attemptId);
      const index = current.entries.findIndex((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId) === key);
      if (index < 0) return false;
      const existing = current.entries[index];
      if (existing.accountId !== accountId || existing.phase === 'outcome' || existing.phase === 'awaiting_receipt') return false;
      current.entries.splice(index, 1);
      await this.writeAndVerify(current);
      return true;
    });
  }

  markRetry(
    exact: SubmissionOutcomeOutboxEntry,
    attemptedAt: number = Date.now(),
    random: () => number = Math.random,
    repair?: { reason: SubmissionOutcomeRepairReason; status: number } | null,
  ): Promise<SubmissionOutcomeOutboxEntry | null> {
    return this.serialize(async () => {
      const current = await this.readStrict();
      const key = submissionOutcomeAttemptKey(exact.lane, exact.attemptId);
      const index = current.entries.findIndex((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId) === key);
      if (index < 0) return null;
      const latest = current.entries[index];
      if (latest.phase !== 'outcome' || latest.accountId !== exact.accountId || latest.serializedBody !== exact.serializedBody) return latest;
      const retryCount = latest.retryCount + 1;
      const updated = {
        ...latest,
        retryCount,
        lastAttemptAt: attemptedAt,
        nextAttemptAt: attemptedAt + submissionOutcomeRetryDelayMs(retryCount, random),
        ...(repair ? { repairReason: repair.reason, repairStatus: repair.status, repairAt: attemptedAt } : {}),
      };
      current.entries[index] = updated;
      await this.writeAndVerify(current);
      return updated;
    });
  }

  acknowledge(exact: SubmissionOutcomeOutboxEntry, acknowledgedAt: number = Date.now()): Promise<boolean> {
    return this.serialize(async () => {
      const current = await this.readStrict();
      const key = submissionOutcomeAttemptKey(exact.lane, exact.attemptId);
      const index = current.entries.findIndex((entry) => submissionOutcomeAttemptKey(entry.lane, entry.attemptId) === key);
      if (index < 0) return false;
      const latest = current.entries[index];
      if (latest.phase !== 'outcome' || latest.accountId !== exact.accountId || latest.serializedBody !== exact.serializedBody) return false;
      if (latest.outcome !== 'confirmed') {
        current.entries[index] = {
          ...latest,
          phase: 'awaiting_receipt',
          nextAttemptAt: Number.MAX_SAFE_INTEGER,
          repairReason: null,
          repairStatus: null,
          repairAt: null,
        };
        await this.writeAndVerify(current);
        return true;
      }
      current.entries.splice(index, 1);
      {
        const projection: SubmissionOutcomeAcknowledgement = {
          version: 2,
          lane: latest.lane,
          accountId: latest.accountId,
          applicationId: latest.applicationId,
          attemptId: latest.attemptId,
          tabId: latest.tabId,
          frameId: latest.frameId,
          startUrl: latest.startUrl,
          outcome: 'confirmed',
          acknowledgedAt,
        };
        const keyIndex = current.acknowledged.findIndex((entry) => entry.lane === projection.lane && entry.attemptId === projection.attemptId);
        if (keyIndex >= 0) current.acknowledged[keyIndex] = projection;
        else {
          if (current.entries.length + current.quarantined.length + current.acknowledged.length
            >= SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES) {
            throw new Error('Confirmed receipt acknowledgements are full and require repair before cleanup.');
          }
          current.acknowledged.push(projection);
        }
      }
      await this.writeAndVerify(current);
      return true;
    });
  }

  listAcknowledgements(): Promise<SubmissionOutcomeAcknowledgement[]> {
    return this.serialize(async () => [...(await this.readStrict()).acknowledged]);
  }

  rebindAcknowledgementContext(input: {
    lane: SubmissionOutcomeLane;
    accountId: string;
    applicationId: string;
    attemptId: string;
    startUrl: string;
    currentUrl: string;
    tabId: number;
    frameId: number;
  }): Promise<SubmissionOutcomeAcknowledgement> {
    return this.serialize(async () => {
      const startUrl = sanitizeSubmissionOutcomeUrl(input.startUrl);
      const currentUrl = sanitizeSubmissionOutcomeUrl(input.currentUrl);
      if (!startUrl
        || !currentUrl
        || !isSafeNonNegativeInteger(input.tabId)
        || !isSafeNonNegativeInteger(input.frameId)
        || applicationFormIdentityKey(startUrl) !== applicationFormIdentityKey(currentUrl)) {
        throw new Error('The acknowledged receipt does not match this employer page.');
      }
      const current = await this.readStrict();
      const matches = current.acknowledged
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.lane === input.lane
          && entry.accountId === input.accountId
          && entry.startUrl === startUrl);
      if (matches.length !== 1) throw new Error('This employer page does not have exactly one acknowledged receipt.');
      const { entry, index } = matches[0]!;
      if (entry.applicationId !== input.applicationId.toLowerCase() || entry.attemptId !== input.attemptId.toLowerCase()) {
        throw new Error('The acknowledged receipt does not match the exact submission attempt.');
      }
      const updated = { ...entry, tabId: input.tabId, frameId: input.frameId };
      current.acknowledged[index] = updated;
      await this.writeAndVerify(current);
      return updated;
    });
  }

  consumeAcknowledgement(exact: SubmissionOutcomeAcknowledgement): Promise<boolean> {
    return this.serialize(async () => {
      const current = await this.readStrict();
      const index = current.acknowledged.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(exact));
      if (index < 0) return false;
      current.acknowledged.splice(index, 1);
      await this.writeAndVerify(current);
      return true;
    });
  }

  due(accountId: string, now: number = Date.now(), _force = false): Promise<SubmissionOutcomeOutboxEntry[]> {
    return this.serialize(async () => (await this.readStrict()).entries
      .filter((entry) => entry.phase === 'outcome' && entry.accountId === accountId && entry.nextAttemptAt <= now)
      .sort((left, right) => Number(right.outcome === 'confirmed') - Number(left.outcome === 'confirmed') || left.startedAt - right.startedAt)
      .slice(0, SUBMISSION_OUTCOME_REPLAY_LIMIT));
  }

  purgeAccount(accountId: string): Promise<void> {
    return this.serialize(async () => {
      const current = await this.readStrict();
      const next = current.entries.filter((entry) => entry.accountId !== accountId);
      const acknowledged = current.acknowledged.filter((entry) => entry.accountId !== accountId);
      if (next.length === current.entries.length && acknowledged.length === current.acknowledged.length) return;
      await this.writeAndVerify({ version: 2, entries: next, quarantined: current.quarantined, acknowledged });
    });
  }

  clear(): Promise<void> {
    return this.serialize(() => this.storage.remove());
  }
}

export async function deliverPersistedSubmissionOutcome(input: {
  outbox: SubmissionOutcomeOutbox;
  entry: SubmissionOutcomeOutboxEntry;
  send: (entry: SubmissionOutcomeOutboxEntry) => Promise<SubmissionOutcomeDeliveryResponse>;
  cleanup: (entry: SubmissionOutcomeOutboxEntry) => Promise<void>;
  now?: number;
  random?: () => number;
}): Promise<SubmissionOutcomeDeliveryResult> {
  const attemptedAt = input.now ?? Date.now();
  if (input.entry.phase !== 'outcome' || input.entry.nextAttemptAt > attemptedAt) {
    return { acknowledged: false, entry: input.entry };
  }
  try {
    const response = await input.send(input.entry);
    const responseMatched = response.ok && submissionOutcomeResponseMatches(input.entry, response.body);
    if (!responseMatched) {
      const reason = submissionOutcomeRepairReason(response.status, responseMatched);
      await input.outbox.markRetry(
        input.entry,
        attemptedAt,
        input.random,
        reason ? { reason, status: response.status } : null,
      );
      return { acknowledged: false, entry: input.entry, status: response.status };
    }
    const removed = await input.outbox.acknowledge(input.entry);
    if (!removed) return { acknowledged: false, entry: input.entry };
    if (input.entry.outcome === 'confirmed') await input.cleanup(input.entry).catch(() => undefined);
    return { acknowledged: true, entry: input.entry };
  } catch {
    await input.outbox.markRetry(input.entry, attemptedAt, input.random).catch(() => null);
    return { acknowledged: false, entry: input.entry };
  }
}

export async function persistAndDeliverSubmissionOutcome(input: {
  outbox: SubmissionOutcomeOutbox;
  outcome: SubmissionOutcomeInput;
  send: (entry: SubmissionOutcomeOutboxEntry) => Promise<SubmissionOutcomeDeliveryResponse>;
  cleanup: (entry: SubmissionOutcomeOutboxEntry) => Promise<void>;
  now?: number;
  random?: () => number;
}): Promise<SubmissionOutcomeDeliveryResult> {
  const entry = await input.outbox.persist(input.outcome, input.now ?? Date.now());
  return deliverPersistedSubmissionOutcome({
    outbox: input.outbox,
    entry,
    send: input.send,
    cleanup: input.cleanup,
    now: input.now,
    random: input.random,
  });
}
