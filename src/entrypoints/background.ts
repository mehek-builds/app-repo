// Token access goes through lib/storage, so the background reads the exact key the popup
// writes, including the backward-compatible fallback to the legacy Volley-era key name.
import {
  clearAll as clearStoredSession,
  abandonPendingPortalAccount,
  activatePendingPortalAccount,
  getPendingPortalAccount,
  getPortalAccount,
  getToken as getStoredToken,
  migrateLegacyStorage,
  setProfile,
  setToken,
  setAutoSubmitEnabled,
  recordPendingPortalAccount,
  currentAuthEpoch,
  authEpochIsCurrent,
  completeAuthSessionClear,
  pendingPortalAccountClaimIsCurrent,
} from '../lib/storage';
import { overloadWaitMs, overloadBudgetRemains, RESUME_OVERLOAD_BUDGET_MS } from '../lib/overload';
// Pure salary/posting helpers (R-031). adapters/salary is a LEAF module (types only), so this
// import does not pull the DOM-adjacent adapter graph into the service worker bundle.
import { parseAshbyPostingRef, selectPostingCompensation, type PostingCompensation } from '../lib/adapters/salary';
import { PRODUCT_NAME, type ProductMeta } from '../lib/product';
import type { ApplicationProfile, GeneratedResume, PendingDraft, Profile } from '../lib/types';
import {
  ARMED_HANDOFF_KEY,
  armedHandoffMode,
  armHandoffs,
  claimArmed,
  continueSmartRecruitersHandoff,
  applicationFormIdentityKey,
  pruneArmed,
  decideAdoption,
  type AdoptionOutcome,
  type ArmedHandoff,
} from '../lib/web-handoff';
import { gatedAttendedIdentity, newArmingSupersedesContinuation, validGatedAccountNavigationProof } from '../lib/gated-attended-ats';
import { validHandoffVersion } from '../lib/handoff-packet';
import { automaticSubmissionEnabled, groundedDraftAnswer } from '../lib/auto-submit-consent';
import { backendFetch } from '../lib/backend-fetch';
import { API_BASE } from '../lib/config';
import { flushAnalyticsQueue, trackExtensionEvent } from '../lib/analytics';
import { clearStall, readStalls, recordStall } from '../lib/captcha-stalls';
import { badgeState } from '../lib/badge';
import { applicantEmailForGeneratedPacket, atsNameForPortalUrl, resumeContactEmailForProfile } from '../lib/applicant-email';
import {
  clearPacketApplicantIdentity,
  packetIdentityMatchesCurrentRoute,
  peekPacketApplicantIdentity,
  readPacketApplicantIdentity,
  storePacketApplicantIdentity,
} from '../lib/packet-applicant-identity';
import { KeyedMutationQueue, persistOneShotTransition } from '../lib/keyed-mutation-queue';
import { frozenApplicantFillData } from '../lib/handoff-applicant-snapshot';
import { packetAuditForResume } from '../lib/handoff-packet-audit';
import {
  cacheEntitlements,
  clearCachedEntitlements,
  featureEnabled,
  parseEntitlementSnapshot,
  type EntitlementSnapshotV2,
  type LitosFeatureId,
} from '../lib/entitlements';
import {
  apiErrorFromResponse,
  isLitosApiError,
  LitosApiError,
  serializeLitosApiError,
} from '../lib/api-error';
import { createSessionClearMessageHandler } from '../lib/session-clear';
import { needsAutomaticSubmissionEntitlement } from '../lib/submission-entitlement';
import { settleOutreachDraftBatch, type OutreachDraftFailure } from '../lib/outreach-draft-batch';
import { derivedOperationId } from '../lib/operation-id';
import {
  checkoutReturnMismatch,
  parsePendingExtensionCheckout,
  verifiedServerCheckoutExpiry,
  type ServerExtensionCheckoutOffer,
} from '../lib/extension-checkout';
import {
  parsePendingExtensionPremiumAction,
  premiumActionFeatureForTrigger,
  premiumRetryPortalMatches,
  sanitizeExtensionPremiumAction,
  serverPremiumActionMatches,
  verifiedServerPremiumActionExpiry,
  type ExtensionPremiumActionContext,
  type PendingExtensionPremiumAction,
  type ServerPremiumAction,
} from '../lib/extension-premium-action';
import {
  freeFillPortalMatches,
  FreeFillHandoffRequestError,
  isValidFreeFillApplicationId,
  prepareFreeFillHandoff,
} from '../lib/free-fill-handoff';
import {
  bindFreeSubmissionOutcome,
  FREE_SUBMISSION_OUTCOME_TIMEOUT_MS,
  FREE_SUBMISSION_MONITOR_TTL_MS,
  freeSubmissionMonitorDisposition,
  freeSubmissionNavigationMatches,
  type PendingFreeSubmissionMonitor,
} from '../lib/free-submission-monitor';

// Latched off once the backend reports onboarding complete. Service-worker memory is fine for
// this: the worst case on a restart is one wasted 403, which re-latches it immediately.
let harvestStopped = false;

type PendingExtensionSubmission = {
  applicationId: string;
  claimId: string;
  startedAt: number;
  frameId: number;
  packetVersion: string;
  auditDigest: string;
  strictReceipt?: { family: 'jobvite' | 'icims'; startedUrl: string };
};

const PENDING_SUBMISSIONS_KEY = 'litos_pending_extension_submission';
const PENDING_SUBMISSION_MAX_AGE_MS = 5 * 60_000;
const HANDOFF_PACKET_BINDINGS_KEY = 'litos_extension_handoff_packet_bindings';
const GATED_ATTENDED_CONTINUATION_PREFIX = 'litos_gated_attended_continuation';
const GATED_ATTENDED_CONTINUATION_TTL_MS = 60 * 60_000;
const GATED_ATTENDED_ACCOUNT_PROOF_TTL_MS = 5 * 60_000;
const dashboardSubmissionsInFlight = new Set<string>();
const gatedPreparationsInFlight = new Set<string>();
const gatedContinuationMutations = new KeyedMutationQueue();
const armedHandoffMutations = new KeyedMutationQueue();
const handoffPacketBindingMutations = new KeyedMutationQueue();
const pendingSubmissionMutations = new KeyedMutationQueue();
const applicationTabMutations = new KeyedMutationQueue();
const freeSubmissionMonitorMutations = new KeyedMutationQueue();
const freeSubmissionMonitorStartsInFlight = new Map<number, number>();
const ARMED_HANDOFF_MUTATION_KEY = 'armed-handoffs';
const HANDOFF_PACKET_BINDING_MUTATION_KEY = 'handoff-packet-bindings';
const PENDING_SUBMISSION_MUTATION_KEY = 'pending-submissions';
const APPLICATION_TAB_MUTATION_KEY = 'application-tabs';
const FREE_SUBMISSION_MONITOR_PREFIX = 'litos_pending_free_submission';
const PENDING_PREMIUM_ACTION_KEY = 'litos_pending_premium_action';
const PENDING_PREMIUM_RETRY_FOCUS_KEY = 'litos_pending_premium_retry_focus';
const PREMIUM_RETRY_FOCUS_TTL_MS = 5 * 60_000;

type PendingPremiumRetryFocus = {
  actionNonce: string;
  accountId: string;
  featureKey: PendingExtensionPremiumAction['feature_key'];
  portalUrl: string;
  tabId: number;
  createdAt: number;
};

function beginFreeSubmissionMonitorStart(tabId: number): void {
  freeSubmissionMonitorStartsInFlight.set(
    tabId,
    (freeSubmissionMonitorStartsInFlight.get(tabId) ?? 0) + 1,
  );
}

function endFreeSubmissionMonitorStart(tabId: number): void {
  const remaining = (freeSubmissionMonitorStartsInFlight.get(tabId) ?? 1) - 1;
  if (remaining > 0) freeSubmissionMonitorStartsInFlight.set(tabId, remaining);
  else freeSubmissionMonitorStartsInFlight.delete(tabId);
}

async function refreshEntitlementSnapshot(
  token: string,
  expectedAuthEpoch = currentAuthEpoch(),
): Promise<EntitlementSnapshotV2> {
  assertCurrentAuthEpoch(expectedAuthEpoch);
  const response = await timeoutBackendFetch('/billing/state', { cache: 'no-store' }, token);
  assertCurrentAuthEpoch(expectedAuthEpoch);
  if (!response.ok) throw await apiErrorFromResponse(response);
  const snapshot = parseEntitlementSnapshot(await response.json());
  assertCurrentAuthEpoch(expectedAuthEpoch);
  await cacheEntitlements(snapshot);
  if (!authEpochIsCurrent(expectedAuthEpoch)) {
    await clearCachedEntitlements().catch(() => undefined);
    assertCurrentAuthEpoch(expectedAuthEpoch);
  }
  return snapshot;
}

async function requireFeature(token: string, feature: LitosFeatureId): Promise<EntitlementSnapshotV2> {
  const snapshot = await refreshEntitlementSnapshot(token);
  if (!featureEnabled(snapshot, feature)) {
    throw new LitosApiError(402, {
      error: feature === 'automatic_submission'
        ? 'Automatic submission is included in the Litos+ trial and paid plans.'
        : 'This action needs Litos+.',
      code: 'feature_locked',
      feature_id: feature,
      entitlement_revision: snapshot.revision,
      retryable: false,
    });
  }
  return snapshot;
}

type HandoffPacketBinding = {
  applicationId: string;
  tabId: number;
  frameId: number;
  currentUrl: string;
  handoffVersion: string;
  packetVersion: string;
  auditDigest: string;
  pdfSha256: string;
  pdfSizeBytes: number;
};

type GatedAttendedContinuation = {
  applicationId: string;
  tabId: number;
  frameId: number;
  identity: string;
  preparedAt: number;
  handoffVersion: string;
  applicantEmail: string;
  accountLoginProofAt?: number;
  accountLoginProofDocumentId?: string;
  securityCodeProofAt?: number;
  securityCodeProofDocumentId?: string;
};

function gatedContinuationKey(tabId: number, frameId: number): string {
  return `${GATED_ATTENDED_CONTINUATION_PREFIX}:${tabId}:${frameId}`;
}

function withGatedContinuationMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  return gatedContinuationMutations.run(key, operation);
}

async function gatedAttendedContinuation(tabId: number, frameId: number): Promise<GatedAttendedContinuation | null> {
  const key = gatedContinuationKey(tabId, frameId);
  const stored = await chrome.storage.session.get(key);
  return (stored[key] as GatedAttendedContinuation | undefined) ?? null;
}

async function storeGatedAttendedContinuation(continuation: GatedAttendedContinuation): Promise<void> {
  const key = gatedContinuationKey(continuation.tabId, continuation.frameId);
  await withGatedContinuationMutation(key, () => chrome.storage.session.set({ [key]: continuation }));
}

function consumeArmedAndStoreGatedContinuation(
  continuation: GatedAttendedContinuation,
  authEpoch: number,
): Promise<void> {
  return armedHandoffMutations.run(ARMED_HANDOFF_MUTATION_KEY, async () => {
    assertCurrentAuthEpoch(authEpoch);
    const latest = pruneArmed(await readArmedHandoffs(), Date.now());
    const latestIndex = latest.findIndex((entry) => entry.applicationId === continuation.applicationId
      && gatedAttendedIdentity(entry.key)?.key === continuation.identity);
    if (latestIndex < 0) throw new Error('The attended application request expired before it could be prepared.');
    const before = [...latest];
    latest.splice(latestIndex, 1);
    await persistOneShotTransition({
      before,
      after: latest,
      persistSource: writeArmedHandoffs,
      persistDestination: () => storeGatedAttendedContinuation(continuation),
    });
    if (!authEpochIsCurrent(authEpoch)) {
      await withGatedContinuationMutation(
        gatedContinuationKey(continuation.tabId, continuation.frameId),
        () => chrome.storage.session.remove(gatedContinuationKey(continuation.tabId, continuation.frameId)),
      );
      assertCurrentAuthEpoch(authEpoch);
    }
  });
}

async function claimGatedAttendedContinuation(
  tabId: number,
  frameId: number,
  currentUrl: string,
  currentDocumentId?: string,
): Promise<GatedAttendedContinuation | null> {
  const identity = gatedAttendedIdentity(currentUrl);
  if (!identity) return null;
  const key = gatedContinuationKey(tabId, frameId);
  return withGatedContinuationMutation(key, async () => {
    const continuation = await gatedAttendedContinuation(tabId, frameId);
    if (!continuation) return null;
    await chrome.storage.session.remove(key);
    const now = Date.now();
    const accountProofValid = validGatedAccountNavigationProof({
      family: identity.family,
      loginProofAt: continuation.accountLoginProofAt,
      loginProofDocumentId: continuation.accountLoginProofDocumentId,
      securityProofAt: continuation.securityCodeProofAt,
      securityProofDocumentId: continuation.securityCodeProofDocumentId,
      currentDocumentId,
      now,
      ttlMs: GATED_ATTENDED_ACCOUNT_PROOF_TTL_MS,
    });
    return continuation.identity === identity.key
      && now - continuation.preparedAt <= GATED_ATTENDED_CONTINUATION_TTL_MS
      && accountProofValid
      ? continuation
      : null;
  });
}

async function handoffPacketBindings(): Promise<Record<string, HandoffPacketBinding>> {
  const stored = await chrome.storage.session.get(HANDOFF_PACKET_BINDINGS_KEY);
  return (stored[HANDOFF_PACKET_BINDINGS_KEY] ?? {}) as Record<string, HandoffPacketBinding>;
}

function assertCurrentAuthEpoch(epoch: number): void {
  if (!authEpochIsCurrent(epoch)) throw new Error('The Litos account changed while this application was being prepared.');
}

async function storeHandoffPacketBinding(binding: HandoffPacketBinding, authEpoch?: number): Promise<void> {
  await handoffPacketBindingMutations.run(HANDOFF_PACKET_BINDING_MUTATION_KEY, async () => {
    if (authEpoch !== undefined) assertCurrentAuthEpoch(authEpoch);
    const bindings = await handoffPacketBindings();
    if (authEpoch !== undefined) assertCurrentAuthEpoch(authEpoch);
    await chrome.storage.session.set({
      [HANDOFF_PACKET_BINDINGS_KEY]: { ...bindings, [binding.applicationId]: binding },
    });
    if (authEpoch !== undefined && !authEpochIsCurrent(authEpoch)) {
      await chrome.storage.session.remove(HANDOFF_PACKET_BINDINGS_KEY);
      assertCurrentAuthEpoch(authEpoch);
    }
  });
}

async function handoffPacketBinding(
  applicationId: string,
  tabId: number,
  frameId: number,
): Promise<HandoffPacketBinding | null> {
  const binding = (await handoffPacketBindings())[applicationId];
  return binding?.tabId === tabId && binding.frameId === frameId && validHandoffVersion(binding.handoffVersion)
    && validHandoffVersion(binding.packetVersion) && validHandoffVersion(binding.auditDigest)
    && validHandoffVersion(binding.pdfSha256) && Number.isSafeInteger(binding.pdfSizeBytes) && binding.pdfSizeBytes > 0
    ? binding
    : null;
}

async function fetchAndBindHandoffPacket(input: {
  applicationId: string;
  currentUrl: string;
  tabId: number;
  frameId: number;
  token: string;
  publishBinding?: boolean;
  authEpoch?: number;
}): Promise<GeneratedResume> {
  const packetRes = await timeoutBackendFetch(
    `/applications/${input.applicationId}/submission/extension-packet?current_url=${encodeURIComponent(input.currentUrl)}`,
    {},
    input.token,
  );
  if (!packetRes.ok) throw new Error(`The saved application packet is not available (${packetRes.status}).`);
  const resume = await packetRes.json() as GeneratedResume;
  if (input.authEpoch !== undefined) assertCurrentAuthEpoch(input.authEpoch);
  if (resume.resume_id !== input.applicationId || resume.application?.id !== input.applicationId) {
    throw new Error('The downloaded resume does not belong to this application packet.');
  }
  if (!validHandoffVersion(resume.handoff_version)) {
    throw new Error('The saved application packet has no immutable handoff version.');
  }
  const audit = packetAuditForResume(resume);
  if (!audit) {
    throw new Error('The saved application packet has no complete current audit.');
  }
  if (input.publishBinding !== false) {
    await storeHandoffPacketBinding({
      applicationId: input.applicationId,
      tabId: input.tabId,
      frameId: input.frameId,
      currentUrl: input.currentUrl,
      handoffVersion: resume.handoff_version,
      packetVersion: audit.packet_version,
      auditDigest: audit.audit_digest,
      pdfSha256: audit.bindings.pdf.sha256,
      pdfSizeBytes: audit.bindings.pdf.sizeBytes,
    }, input.authEpoch);
  }
  return resume;
}

function pendingSubmissionKey(tabId: number): string {
  return `${PENDING_SUBMISSIONS_KEY}:${tabId}`;
}

async function pendingSubmission(tabId: number): Promise<PendingExtensionSubmission | null> {
  const key = pendingSubmissionKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return (stored[key] as PendingExtensionSubmission | undefined) ?? null;
}

async function setPendingSubmission(tabId: number, pending: PendingExtensionSubmission | null, authEpoch?: number) {
  await pendingSubmissionMutations.run(PENDING_SUBMISSION_MUTATION_KEY, async () => {
    if (authEpoch !== undefined) assertCurrentAuthEpoch(authEpoch);
    const key = pendingSubmissionKey(tabId);
    if (pending) await chrome.storage.session.set({ [key]: pending });
    else await chrome.storage.session.remove(key);
    if (authEpoch !== undefined && !authEpochIsCurrent(authEpoch)) {
      await chrome.storage.session.remove(key);
      assertCurrentAuthEpoch(authEpoch);
    }
  });
}

function freeSubmissionMonitorKey(tabId: number, frameId: number): string {
  return `${FREE_SUBMISSION_MONITOR_PREFIX}:${tabId}:${frameId}`;
}

function safeFreeSubmissionUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const normalized = parsed.toString();
    return normalized.length <= 2048 ? normalized : null;
  } catch {
    return null;
  }
}

function validPremiumActionNonce(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 200;
}

async function pendingExtensionPremiumAction(): Promise<PendingExtensionPremiumAction | null> {
  const stored = await chrome.storage.session.get(PENDING_PREMIUM_ACTION_KEY);
  return parsePendingExtensionPremiumAction(stored[PENDING_PREMIUM_ACTION_KEY]);
}

async function storeExtensionPremiumAction(
  pending: PendingExtensionPremiumAction,
  authEpoch: number,
): Promise<void> {
  assertCurrentAuthEpoch(authEpoch);
  await chrome.storage.session.set({ [PENDING_PREMIUM_ACTION_KEY]: pending });
  if (!authEpochIsCurrent(authEpoch)) {
    await chrome.storage.session.remove(PENDING_PREMIUM_ACTION_KEY);
    assertCurrentAuthEpoch(authEpoch);
  }
}

async function readServerPremiumAction(
  token: string,
  actionNonce: string,
  authEpoch: number,
): Promise<(ServerPremiumAction & { offer_id?: unknown })> {
  assertCurrentAuthEpoch(authEpoch);
  const response = await timeoutBackendFetch(
    `/billing/actions/${encodeURIComponent(actionNonce)}`,
    { cache: 'no-store' },
    token,
  );
  assertCurrentAuthEpoch(authEpoch);
  if (!response.ok) throw await apiErrorFromResponse(response);
  return await response.json() as ServerPremiumAction & { offer_id?: unknown };
}

async function readServerCheckoutOffer(
  token: string,
  offerId: string,
  authEpoch: number,
): Promise<ServerExtensionCheckoutOffer> {
  assertCurrentAuthEpoch(authEpoch);
  const response = await timeoutBackendFetch(
    `/billing/offers/${encodeURIComponent(offerId)}`,
    { cache: 'no-store' },
    token,
  );
  assertCurrentAuthEpoch(authEpoch);
  if (!response.ok) throw await apiErrorFromResponse(response);
  return await response.json() as ServerExtensionCheckoutOffer;
}

async function storeVerifiedPremiumActionExpiry(
  pending: PendingExtensionPremiumAction,
  server: ServerPremiumAction | null,
  allowedStates: readonly string[],
  authEpoch: number,
): Promise<PendingExtensionPremiumAction | null> {
  const expiresAt = verifiedServerPremiumActionExpiry(pending, server, allowedStates);
  if (expiresAt === null) return null;
  const verified = { ...pending, expires_at: expiresAt };
  await storeExtensionPremiumAction(verified, authEpoch);
  return verified;
}

async function createExtensionPremiumAction(
  token: string,
  accountId: string,
  context: ExtensionPremiumActionContext,
  authEpoch: number,
): Promise<PendingExtensionPremiumAction> {
  const idempotencyKey = crypto.randomUUID();
  assertCurrentAuthEpoch(authEpoch);
  const response = await timeoutBackendFetch('/billing/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feature_key: context.feature_key,
      ...(context.application_id ? { application_id: context.application_id } : {}),
      ...(context.job_id ? { job_id: context.job_id } : {}),
      ...(context.contact_id ? { contact_id: context.contact_id } : {}),
      return_route: '/billing/return?surface=extension',
      idempotency_key: idempotencyKey,
    }),
  }, token);
  assertCurrentAuthEpoch(authEpoch);
  if (!response.ok) throw await apiErrorFromResponse(response);
  const body = await response.json().catch(() => null) as {
    action_nonce?: unknown;
    offer_id?: unknown;
    feature_key?: unknown;
    return_route?: unknown;
    expires_at?: unknown;
  } | null;
  const expiresAt = typeof body?.expires_at === 'string' ? Date.parse(body.expires_at) : NaN;
  if (
    !validPremiumActionNonce(body?.action_nonce)
    || body?.offer_id !== null
    || body?.feature_key !== context.feature_key
    || body?.return_route !== '/billing/return?surface=extension'
    || !Number.isFinite(expiresAt)
    || expiresAt <= Date.now()
  ) throw new Error('Litos could not bind this checkout to the action you were taking.');
  const pending: PendingExtensionPremiumAction = {
    ...context,
    action_nonce: body.action_nonce,
    account_id: accountId,
    return_route: body.return_route,
    created_at: Date.now(),
    expires_at: expiresAt,
  };
  await storeExtensionPremiumAction(pending, authEpoch);
  return pending;
}

function parsePendingPremiumRetryFocus(value: unknown): PendingPremiumRetryFocus | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    !validPremiumActionNonce(candidate.actionNonce)
    || typeof candidate.accountId !== 'string'
    || !candidate.accountId
    || !premiumActionFeatureForTrigger(candidate.featureKey)
    || typeof candidate.portalUrl !== 'string'
    || !safeFreeSubmissionUrl(candidate.portalUrl)
    || typeof candidate.tabId !== 'number'
    || !Number.isInteger(candidate.tabId)
    || typeof candidate.createdAt !== 'number'
    || !Number.isFinite(candidate.createdAt)
  ) return null;
  return candidate as PendingPremiumRetryFocus;
}

async function restoreExtensionPremiumActionControl(
  pending: PendingExtensionPremiumAction,
): Promise<void> {
  if (pending.kind === 'extension_screen') {
    const retryUrl = new URL(chrome.runtime.getURL('/popup.html'));
    retryUrl.searchParams.set('retry_action', pending.feature_key);
    if (pending.feature_key === 'outreach_email_generation') {
      retryUrl.searchParams.set('action_nonce', pending.action_nonce);
    }
    if (pending.screen === 'main' && pending.company && pending.role) {
      retryUrl.searchParams.set('company', pending.company);
      retryUrl.searchParams.set('role', pending.role);
      if (pending.application_id) retryUrl.searchParams.set('application_id', pending.application_id);
    }
    await chrome.tabs.create({
      url: retryUrl.toString(),
      active: true,
    });
    return;
  }
  if (!pending.portal_url) throw new Error('The saved employer page is no longer available.');
  const tabs = await chrome.tabs.query({});
  let target = tabs.find((tab) =>
    typeof tab.id === 'number'
    && typeof tab.url === 'string'
    && premiumRetryPortalMatches(pending, tab.url));
  if (!target?.id) {
    target = await chrome.tabs.create({ url: 'about:blank', active: true });
  }
  if (!target.id) throw new Error('The saved employer tab could not be restored.');
  const focus: PendingPremiumRetryFocus = {
    actionNonce: pending.action_nonce,
    accountId: pending.account_id,
    featureKey: pending.feature_key,
    portalUrl: pending.portal_url,
    tabId: target.id,
    createdAt: Date.now(),
  };
  await chrome.storage.session.set({ [PENDING_PREMIUM_RETRY_FOCUS_KEY]: focus });
  if (target.url === 'about:blank' || !target.url) {
    await chrome.tabs.update(target.id, { url: pending.portal_url, active: true });
  } else {
    await chrome.tabs.update(target.id, { active: true });
    await chrome.tabs.sendMessage(target.id, {
      type: 'FOCUS_PREMIUM_RETRY_CONTROL',
      feature_key: pending.feature_key,
      action_nonce: pending.action_nonce,
    }).catch(() => undefined);
  }
  if (typeof target.windowId === 'number') {
    await chrome.windows.update(target.windowId, { focused: true }).catch(() => undefined);
  }
}

async function pendingFreeSubmissionMonitor(
  tabId: number,
  frameId: number,
): Promise<PendingFreeSubmissionMonitor | null> {
  const key = freeSubmissionMonitorKey(tabId, frameId);
  const stored = await chrome.storage.session.get(key);
  return (stored[key] as PendingFreeSubmissionMonitor | undefined) ?? null;
}

async function pendingFreeSubmissionMonitorForTab(
  tabId: number,
): Promise<PendingFreeSubmissionMonitor | null> {
  const stored = await chrome.storage.session.get(null);
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(`${FREE_SUBMISSION_MONITOR_PREFIX}:${tabId}:`))
    .map(([, value]) => value as PendingFreeSubmissionMonitor)
    .filter((value) => Boolean(value?.eventId && value?.applicationId))
    .sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;
}

async function storePendingFreeSubmissionMonitor(pending: PendingFreeSubmissionMonitor): Promise<void> {
  const key = freeSubmissionMonitorKey(pending.tabId, pending.frameId);
  await freeSubmissionMonitorMutations.run(key, async () => {
    assertCurrentAuthEpoch(pending.authEpoch);
    const existing = await pendingFreeSubmissionMonitor(pending.tabId, pending.frameId);
    if (existing && existing.eventId !== pending.eventId) {
      throw new Error('Another Free submission outcome is still being observed in this frame.');
    }
    await chrome.storage.session.set({ [key]: pending });
    if (!authEpochIsCurrent(pending.authEpoch)) {
      await chrome.storage.session.remove(key);
      assertCurrentAuthEpoch(pending.authEpoch);
    }
  });
}

async function clearPendingFreeSubmissionMonitor(
  tabId: number,
  frameId: number,
  eventId?: string,
): Promise<void> {
  const key = freeSubmissionMonitorKey(tabId, frameId);
  await freeSubmissionMonitorMutations.run(key, async () => {
    if (eventId) {
      const current = await pendingFreeSubmissionMonitor(tabId, frameId);
      if (!current || current.eventId !== eventId) return;
    }
    await chrome.storage.session.remove(key);
  });
}

async function clearPendingFreeSubmissionMonitorForTabEvent(
  tabId: number,
  eventId: string,
): Promise<void> {
  const stored = await chrome.storage.session.get(null);
  const matching = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(`${FREE_SUBMISSION_MONITOR_PREFIX}:${tabId}:`)
      && (value as PendingFreeSubmissionMonitor | undefined)?.eventId === eventId)
    .map(([key]) => key);
  await Promise.all(matching.map((key) =>
    freeSubmissionMonitorMutations.run(key, () => chrome.storage.session.remove(key))));
}

async function postExtensionOutcome(pending: PendingExtensionSubmission, outcome: 'confirmed' | 'failed' | 'unknown' | 'cancelled', finalUrl: string, confirmationText?: string) {
  if (!validHandoffVersion(pending.packetVersion) || !validHandoffVersion(pending.auditDigest)) {
    throw new Error('The audited application packet is no longer available. Nothing was recorded.');
  }
  const token = await getStoredToken();
  if (!token) throw new Error('Sign in to Litos again before updating this application.');
  const response = await timeoutBackendFetch(`/applications/${pending.applicationId}/submission/extension-outcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      claim_id: pending.claimId,
      outcome,
      final_url: finalUrl,
      ...(confirmationText ? { confirmation_text: confirmationText.slice(0, 2000) } : {}),
    }),
  }, token);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not update application (${response.status})`);
  }
  void trackExtensionEvent('application_submission_outcome_recorded', { outcome });
  if (outcome === 'confirmed') void trackExtensionEvent('application_submission_completed');
}

async function closePendingSubmission(tabId: number, finalUrl = 'https://trylitos.com') {
  const pending = await pendingSubmission(tabId);
  if (!pending) return;
  try {
    await postExtensionOutcome(pending, 'unknown', finalUrl);
    await setPendingSubmission(tabId, null);
  } catch {
    // Keep the claim in session storage. A later page wake can retry the safe unknown outcome.
  }
}

/**
 * POST what the student typed by hand to /profile/harvest.
 *
 * The server is the authority on every rule that matters here - it refuses work authorization,
 * sponsorship and self-identification with a hard 400, only fills fields that are empty, and 403s
 * once onboarding is done. This function deliberately re-checks none of that: a second copy of
 * those rules in the client is a second thing to drift. Its only job is carrying the token and
 * translating a 403 into "stop asking".
 */
async function harvestFields(fields: unknown): Promise<{ ok: boolean; stop?: boolean; kept?: string[] }> {
  if (harvestStopped) return { ok: false, stop: true };
  const token = await getStoredToken();
  if (!token) return { ok: false };
  try {
    const res = await timeoutBackendFetch('/profile/harvest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }, token);
    if (res.status === 403) {
      harvestStopped = true;
      return { ok: false, stop: true };
    }
    if (!res.ok) {
      // A 400 here means the classifier produced a field the server refuses - i.e. the R-004
      // guard failed somewhere upstream. Loud in the log, because it should be impossible:
      // ProfileKey has no member for any denied field.
      console.warn('[Litos] harvest rejected', res.status, await res.text().catch(() => ''));
      return { ok: false };
    }
    const body = (await res.json().catch(() => null)) as { kept?: string[] } | null;
    return { ok: true, kept: body?.kept ?? [] };
  } catch {
    return { ok: false };
  }
}

// A hung backend must never leave the caller waiting forever - the resume-fill card awaits
// these responses, so an unbounded fetch strands the student on "Tailoring your resume...".
// Resume generation is a real LLM round trip (tens of seconds), so it gets a longer budget
// than the plain JSON endpoints.
const FETCH_TIMEOUT_MS = 20000;
const RESUME_FETCH_TIMEOUT_MS = 60000;
function timeoutFetch(input: string, init: RequestInit = {}, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
}

function timeoutBackendFetch(
  path: string,
  init: RequestInit = {},
  token?: string,
  ms = FETCH_TIMEOUT_MS,
): Promise<Response> {
  return backendFetch(path, init, { token, timeoutMs: ms });
}

type FreeFillResume = {
  artifact_id: string | null;
  kind: string;
  source: string;
  file_name: string;
  download_url: string;
  requires_authorization: boolean;
};

type FreeFillResumePayload = {
  artifact_id: string | null;
  file_name: string;
  resume_url: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(''));
}

const MAX_FREE_FILL_RESUME_BYTES = 10 * 1024 * 1024;

async function freeFillResumePayload(
  selectedResume: FreeFillResume | null | undefined,
  token: string,
): Promise<FreeFillResumePayload | null> {
  if (!selectedResume?.download_url || !selectedResume.file_name) return null;
  if (!selectedResume.requires_authorization) {
    return {
      artifact_id: selectedResume.artifact_id,
      file_name: selectedResume.file_name,
      resume_url: selectedResume.download_url,
    };
  }

  const resolved = new URL(selectedResume.download_url, API_BASE);
  if (resolved.origin !== new URL(API_BASE).origin) return null;
  const response = await timeoutBackendFetch(
    `${resolved.pathname}${resolved.search}`,
    {},
    token,
    RESUME_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/pdf';
  if (!/^(application\/pdf|application\/octet-stream)$/i.test(contentType)) return null;
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_FREE_FILL_RESUME_BYTES) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FREE_FILL_RESUME_BYTES) return null;
  return {
    artifact_id: selectedResume.artifact_id,
    file_name: selectedResume.file_name,
    resume_url: `data:${contentType};base64,${bytesToBase64(bytes)}`,
  };
}

type VerifiedWorkdayPacket = {
  userId: string;
  applicationId: string;
  email: string;
  host: string;
  routeFingerprint: string;
};

async function verifyWorkdayPacketForTab(token: string, tabId: number, portalUrl: string): Promise<VerifiedWorkdayPacket | null> {
  const candidate = await peekPacketApplicantIdentity({ tabId, portalUrl });
  if (!candidate) return null;
  const response = await timeoutBackendFetch(`/applications/${candidate.applicationId}/workday-account-identity`, {}, token);
  if (!response.ok) return null;
  const owned = await response.json().catch(() => null) as {
    user_id?: unknown;
    application_id?: unknown;
    email?: unknown;
    portal_host?: unknown;
  } | null;
  if (
    typeof owned?.user_id !== 'string'
    || typeof owned.application_id !== 'string'
    || typeof owned.email !== 'string'
    || typeof owned.portal_host !== 'string'
  ) return null;
  const identity = await readPacketApplicantIdentity({ tabId, portalUrl, userId: owned.user_id });
  if (!identity) return null;
  const expectedHost = new URL(portalUrl).hostname.toLowerCase().replace(/^www\./, '');
  if (
    owned.application_id !== identity.applicationId
    || owned.email.trim().toLowerCase() !== identity.email
    || owned.portal_host.trim().toLowerCase().replace(/^www\./, '') !== expectedHost
  ) return null;
  return {
    userId: owned.user_id.toLowerCase(),
    applicationId: identity.applicationId,
    email: identity.email,
    host: expectedHost,
    routeFingerprint: identity.routeFingerprint,
  };
}

// ─── Website → extension session handover ────────────────────────────────────
// See lib/web-handoff.ts for why this exists at all. Short version: being signed in on
// trylitos.com used to tell the extension nothing, so the one path the product puts a button in
// front of ("Finish this one" on the Home screen) ended at an extension that answered
// "not signed in" while the dashboard sat authenticated in the next tab.

/**
 * The one sentence every "we have no session" branch answers with.
 *
 * It used to be the fragment `not signed in`, which the fill card pasted straight in front of its
 * own sentence and rendered as "not signed in Nothing was attached or submitted." A whole sentence
 * here fixes that at the source for every caller, and says what to do rather than what is missing.
 */
const NOT_SIGNED_IN_MESSAGE = 'You are not signed in to the Litos extension. Open Litos from your browser toolbar and sign in.';

/** What the backend says a token is. null means the backend would not honour it. */
async function accountForToken(token: string): Promise<Profile | null> {
  try {
    const res = await timeoutBackendFetch('/profile', {}, token);
    if (!res.ok) return null;
    return (await res.json()) as Profile;
  } catch {
    return null;
  }
}

async function adoptWebSession(incomingToken: string): Promise<{ ok: boolean; outcome: AdoptionOutcome; error?: string }> {
  const incoming = incomingToken.trim();
  const storedToken = await getStoredToken();
  if (storedToken && storedToken === incoming) return { ok: true, outcome: 'already_signed_in' };

  // The website's token is verified against the backend before it is stored. The origin check
  // upstream says the message came from our own page; only the backend can say the token is real,
  // and storing an unverified one would replace a working session with a broken one.
  const incomingProfile = await accountForToken(incoming);
  const storedProfile = storedToken ? await accountForToken(storedToken) : null;
  const outcome = decideAdoption({
    incomingToken: incoming,
    incomingEmail: incomingProfile?.email ?? null,
    storedToken,
    storedEmail: storedProfile?.email ?? null,
  });

  if (outcome !== 'adopted') {
    return {
      ok: outcome === 'already_signed_in',
      outcome,
      error:
        outcome === 'different_account'
          ? 'The Litos extension is signed in to a different account. Sign out of the extension to switch.'
          : outcome === 'rejected'
            ? 'Litos did not accept that sign-in.'
            : undefined,
    };
  }

  try {
    await clearExtensionAccountSession();
    await setToken(incoming);
    if (incomingProfile) await setProfile(incomingProfile);
    return { ok: true, outcome };
  } catch (error) {
    return { ok: false, outcome: 'rejected', error: error instanceof Error ? error.message : 'Could not save the sign-in.' };
  }
}

async function readArmedHandoffs(): Promise<ArmedHandoff[]> {
  const stored = await chrome.storage.session.get(ARMED_HANDOFF_KEY);
  const value = stored?.[ARMED_HANDOFF_KEY];
  return Array.isArray(value) ? (value as ArmedHandoff[]) : [];
}

async function writeArmedHandoffs(entries: ArmedHandoff[]): Promise<void> {
  await chrome.storage.session.set({ [ARMED_HANDOFF_KEY]: entries });
}

async function ownedFreeFillHandoffData(
  token: string,
  applicationId: string,
  authEpoch: number,
): Promise<unknown> {
  assertCurrentAuthEpoch(authEpoch);
  const response = await timeoutBackendFetch(`/applications/${applicationId}/fill-data`, { cache: 'no-store' }, token);
  assertCurrentAuthEpoch(authEpoch);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new FreeFillHandoffRequestError('authentication_required', 'Sign in to Litos in the extension first.');
    }
    if (response.status === 404) {
      throw new FreeFillHandoffRequestError(
        'application_not_found',
        'This Tracker application is no longer available to this account.',
      );
    }
    const apiError = await apiErrorFromResponse(response);
    if (response.status === 409 && String(apiError.body.code) === 'unsafe_portal_url') {
      throw new FreeFillHandoffRequestError('unsafe_portal_url', 'This application does not have a secure company URL.');
    }
    throw new FreeFillHandoffRequestError('handoff_failed', apiError.message);
  }
  const data = await response.json().catch(() => null);
  assertCurrentAuthEpoch(authEpoch);
  return data;
}

async function clearApplicationRuntimeState(): Promise<void> {
  await armedHandoffMutations.run(ARMED_HANDOFF_MUTATION_KEY, () => chrome.storage.session.remove(ARMED_HANDOFF_KEY));
  const stored = await chrome.storage.session.get(null);
  const continuationKeys = Object.keys(stored).filter((key) => key.startsWith(`${GATED_ATTENDED_CONTINUATION_PREFIX}:`));
  await Promise.all(continuationKeys.map((key) =>
    withGatedContinuationMutation(key, () => chrome.storage.session.remove(key))));
  const otherKeys = Object.keys(stored).filter((key) => key === 'lastDetectedJob' || key === 'pendingDrafts');
  if (otherKeys.length) await chrome.storage.session.remove(otherKeys);
  await handoffPacketBindingMutations.run(
    HANDOFF_PACKET_BINDING_MUTATION_KEY,
    () => chrome.storage.session.remove(HANDOFF_PACKET_BINDINGS_KEY),
  );
  await pendingSubmissionMutations.run(PENDING_SUBMISSION_MUTATION_KEY, async () => {
    const pendingKeys = Object.keys(await chrome.storage.session.get(null))
      .filter((key) => key.startsWith(`${PENDING_SUBMISSIONS_KEY}:`));
    if (pendingKeys.length) await chrome.storage.session.remove(pendingKeys);
  });
  await applicationTabMutations.run(
    APPLICATION_TAB_MUTATION_KEY,
    () => chrome.storage.session.remove('litos_application_tabs'),
  );
  dashboardSubmissionsInFlight.clear();
  gatedPreparationsInFlight.clear();
}

async function clearExtensionAccountSession(): Promise<void> {
  await Promise.all([
    clearStoredSession(),
    clearApplicationRuntimeState(),
    chrome.storage.session.remove([
      'litos_pending_checkout',
      PENDING_PREMIUM_ACTION_KEY,
      PENDING_PREMIUM_RETRY_FOCUS_KEY,
    ]),
  ]);
  completeAuthSessionClear();
}

const respondToClearSessionMessage = createSessionClearMessageHandler(clearExtensionAccountSession);

// ─── Transient model-capacity retry (live QA 2026-07-16, R-003) ──────────────
// A real Anthropic overload incident hard-failed a whole fill: the card said "Failed to generate
// resume spec" and the student's only recovery was re-clicking "Yes, fill it" (6+ times on Global
// Relay, never succeeding while it lasted). It blocked a submission outright.
//
// The retry has to live HERE, on the client, and that is not a stylistic choice. The backend cannot
// retry its way out: Vercel kills the function at 60s (vercel.json maxDuration) and the incident
// needed ~6 attempts over ~2.5 minutes to get a 200. Only a FRESH REQUEST escapes that ceiling, so
// only the client can outlive an incident longer than one function. The backend's job is to say
// which failures are worth coming back for; it now returns 503 + `code: 'llm_overloaded'` for
// exactly those, which is what this loop keys on. Anything else still fails fast: retrying a bad JD
// against a healthy API just reproduces the same error more slowly.
//
// 150s covers the observed incident (the manual poll that eventually got a 200 took ~2.5 min).
// The student is never trapped by it: the card stays dismissable throughout and reports each retry,
// The retry stays visible and cancelable for the entire capacity window. New Free, trial, and
// original Free accounts start generation only from the named action. Paid accounts may pre-warm
// from hover when their live entitlement explicitly allows it. Page detection never starts work.
//
// Known risk, deliberately accepted: an MV3 service worker can be torn down mid-loop. The pending
// sendResponse port keeps it alive in practice (and this file already awaits a 60s fetch the same
// way), and content.ts already treats a dead worker as a recoverable error and offers a manual fill,
// so the worst case degrades to today's behavior rather than to a hang.
// The wait policy itself lives in lib/overload.ts, where it can be unit-tested: background.ts can't
// be imported by a test (chrome.* and defineBackground at module load), and a silently-wrong
// backoff is exactly the kind of bug that only shows up during the next incident.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shape returned by GET /profile (the resume-parsed JSON, sent unwrapped by the backend).
// Must satisfy the /draft route's user_profile schema, so we fall back to a valid empty
// profile when the user hasn't uploaded a resume yet (otherwise /draft 400s).
interface UserProfile {
  full_name?: string;
  email?: string;
  resume_email?: string;
  experience: Array<{ company: string; title: string; start: string; end: string; description: string }>;
  skills: string[];
  school: string;
  grad_year: number;
}

const EMPTY_PROFILE: UserProfile = { experience: [], skills: [], school: '', grad_year: 0 };

// Shape of each item in the /resolve response: { contacts: [{ contact, email_resolution }] }
interface ResolvedContact {
  contact: {
    id: string;
    full_name: string;
    first_name: string;
    last_name: string;
    title: string;
    persona: PendingDraft['contact']['persona'];
    school_match: boolean;
    linkedin_url: string;
    company_domain: string;
  };
  email_resolution: {
    id: string;
    email: string;
    status: string;
    tier: PendingDraft['contact']['tier'];
    source: string;
    pattern_used: string;
  };
}

async function resolveAndDraft(
  title: string,
  company: string,
  url: string,
  token: string,
  resolveOperationId: string,
): Promise<{ drafts: PendingDraft[]; failures: OutreachDraftFailure[] }> {
  // Fetch the user's profile first so we can (a) feed their school into contact
  // resolution for alumni matches and (b) ground the drafts. The backend returns the
  // parsed JSON unwrapped, and 404s when no resume has been uploaded yet.
  const profileRes = await timeoutBackendFetch('/profile', {}, token);
  const userProfile: UserProfile = profileRes.ok ? await profileRes.json() : EMPTY_PROFILE;
  const companyDomain = company.toLowerCase().replace(/\s+/g, '') + '.com';
  const applicationRes = await timeoutBackendFetch('/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company,
      company_domain: companyDomain,
      role: title,
      ...(safeFreeSubmissionUrl(url) ? { portal_url: url } : {}),
      source_surface: 'extension',
    }),
  }, token);
  if (!applicationRes.ok) throw await apiErrorFromResponse(applicationRes);
  const canonicalApplication = await applicationRes.json().catch(() => null) as {
    application?: { id?: unknown };
  } | null;
  const applicationId = isValidFreeFillApplicationId(canonicalApplication?.application?.id)
    ? canonicalApplication.application.id.toLowerCase()
    : null;
  if (!applicationId) throw new Error('Litos could not save this job before finding contacts.');

  // Resolve contacts
  const resolveRes = await timeoutBackendFetch('/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company,
      role: title,
      domain: companyDomain,
      application_id: applicationId,
      operation_id: resolveOperationId,
      ...(userProfile.school ? { user_school: userProfile.school } : {}),
    }),
  }, token);
  if (!resolveRes.ok) throw await apiErrorFromResponse(resolveRes);
  const { contacts }: { contacts: ResolvedContact[] } = await resolveRes.json();

  // We verify all sourced contacts but only draft the best two. For a student, reply
  // likelihood (and referral value) matters more than seniority: alumni and near-peers
  // reply far more than busy execs, so a Head of Eng is a poor cold-email target. Rank by
  // that priority and force the two picks to be DIFFERENT personas (e.g. a near-peer for the
  // referral + a recruiter who owns the req), rather than two of whatever sorts first.
  const DRAFT_PRIORITY = ['alumni', 'near_peer', 'recruiter', 'hiring_manager', 'senior_ic'];
  const rank = (persona: string) => {
    const i = DRAFT_PRIORITY.indexOf(persona);
    return i === -1 ? 99 : i;
  };

  const reachable = (contacts ?? [])
    .filter(c => c.email_resolution.tier === 'green' || c.email_resolution.tier === 'amber')
    .sort((a, b) => rank(a.contact.persona) - rank(b.contact.persona));
  if (reachable.length === 0) return { drafts: [], failures: [] };

  const top = [reachable[0]];
  const second =
    reachable.find(c => c.contact.persona !== reachable[0].contact.persona) ?? reachable[1];
  if (second) top.push(second);

  return settleOutreachDraftBatch(top, async ({ contact, email_resolution }) => {
    const draftOperationId = await derivedOperationId(resolveOperationId, contact.id);
    const draftRes = await timeoutBackendFetch('/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact: {
          id: contact.id,
          full_name: contact.full_name,
          title: contact.title,
          persona: contact.persona,
          company,
          company_domain: contact.company_domain,
          school_match: contact.school_match,
          linkedin_url: contact.linkedin_url,
          ...(email_resolution.email ? { email: email_resolution.email } : {}),
        },
        role: title,
        company,
        company_domain: contact.company_domain,
        application_id: applicationId,
        draft_type: 'first_note',
        operation_id: draftOperationId,
        user_profile: userProfile,
      }),
    }, token);
    if (!draftRes.ok) throw await apiErrorFromResponse(draftRes);
    const draft = await draftRes.json();
    const tier = email_resolution.tier === 'green' ? 'green' as const : 'amber' as const;
    return {
      contact: {
        ...contact,
        email: email_resolution.email,
        tier,
        status: tier === 'green' ? 'verified' as const : 'likely' as const,
      },
      draft,
      job: { application_id: applicationId, company, role: title, domain: companyDomain, url },
    };
  });
}

// This posting's structured salary range (R-031), when the tab is an Ashby posting whose board
// slug resolves on the public posting API. Ashby's JD extractor always fetched this payload with
// includeCompensation=true and then DROPPED the compensation object on the floor; this is the
// same fetch, keeping only the one slice the salary rule needs. Never fatal and never blocking:
// any failure (non-Ashby URL, 404 slug, malformed payload, timeout) resolves null and the fill
// proceeds exactly as before, with the salary rule on its label/stored-value chain.
async function fetchAshbyPostingCompensation(url: string | undefined): Promise<PostingCompensation | null> {
  if (!url) return null;
  const ref = parseAshbyPostingRef(url);
  if (!ref) return null;
  try {
    const res = await timeoutFetch(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.org)}?includeCompensation=true`,
      { credentials: 'omit' },
    );
    if (!res.ok) return null;
    return selectPostingCompensation(await res.json(), ref.postingId);
  } catch {
    return null;
  }
}

// Fetches everything a client-side autofill adapter needs in one round trip: the resume
// profile (for name/experience), the more-sensitive application profile (Section 4B - phone,
// address, work-auth), and a JD-tailored resume file. Runs in the background script (not the
// content script) because it needs the auth token from chrome.storage.local.
async function generateResumeAndProfile(
  company: string,
  role: string,
  jdText: string,
  token: string,
  operationId: string,
  portalUrl?: string,
  initiation: 'explicit_click' | 'hover_prewarm' = 'explicit_click',
  // Called before each capacity backoff so the caller can tell the student what is happening.
  // "Tailoring your resume..." sitting frozen for two minutes is indistinguishable from a hang, and
  // a student who thinks it hung fills the form by hand or re-clicks (which is what the live
  // incident produced). Optional: a caller that has nowhere to show it still gets the retry.
  onOverloadRetry?: (attempt: number, waitMs: number) => void,
) {
  // The two profile fetches are independent, so run them together instead of one-after-another -
  // this is on the user-started generation path, so a saved round trip is a saved round trip.
  const [profileRes, appProfileRes] = await Promise.all([
    timeoutBackendFetch('/profile', {}, token),
    timeoutBackendFetch('/profile/application', {}, token),
  ]);
  const profile: UserProfile = profileRes.ok ? await profileRes.json() : EMPTY_PROFILE;
  const applicationProfile: ApplicationProfile = appProfileRes.ok ? await appProfileRes.json() : {};
  const resumeEmail = resumeContactEmailForProfile(profile);
  if (!resumeEmail) {
    throw new Error('Add and verify the personal email printed on your resume before generating this application.');
  }

  // Only the resume POST retries. The profile reads above are cheap, already done, and unaffected
  // by a model overload; re-running them per attempt would add round trips to a backend that is
  // already telling us it is busy.
  const overloadDeadline = Date.now() + RESUME_OVERLOAD_BUDGET_MS;
  let resume: GeneratedResume | undefined;
  for (let attempt = 1; ; attempt++) {
    const resumeRes = await timeoutBackendFetch('/resume/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company,
        role,
        jd_text: jdText,
        initiation,
        operation_id: operationId,
        contact: {
          full_name: profile.full_name || 'Applicant',
          email: resumeEmail,
          linkedin_url: applicationProfile.linkedin_url,
          github_url: applicationProfile.github_url,
          portfolio_url: applicationProfile.portfolio_url,
          phone: applicationProfile.phone,
        },
        ...(portalUrl ? {
          application: {
            portal_url: portalUrl,
            ats_name: atsNameForPortalUrl(portalUrl),
          },
        } : {}),
      }),
    }, token, RESUME_FETCH_TIMEOUT_MS);

    if (resumeRes.ok) {
      resume = await resumeRes.json();
      break;
    }

    const body: {
      error?: string;
      detail?: string[];
      code?: string;
      retry_after_ms?: number;
      feature_id?: LitosFeatureId;
      entitlement_revision?: string;
      quota?: {
        dimension: string;
        scope_id: string | null;
        used: number;
        limit: number;
        remaining: number;
        resets_at: string | null;
      };
    } | null =
      await resumeRes.json().catch(() => null);

    if (resumeRes.status === 402) {
      throw new LitosApiError(402, {
        error: body?.error || 'Tailoring this resume needs Litos+.',
        code: body?.code === 'trial_expired' || body?.code === 'quota_exceeded' || body?.code === 'subscription_past_due'
          ? body.code
          : 'feature_locked',
        feature_id: body?.feature_id ?? 'ai_resume_tailoring',
        entitlement_revision: body?.entitlement_revision,
        quota: body?.quota,
        retryable: false,
      });
    }

    // The one retryable case, and it is retryable only because the SERVER said so. Keying on the
    // explicit code rather than the bare 503 matters: the route returns 503 for "taking too long"
    // as well, which is a budget failure that retrying identically would just reproduce.
    const overloaded = resumeRes.status === 503 && body?.code === 'llm_overloaded';
    if (overloaded && overloadBudgetRemains(overloadDeadline)) {
      const waitMs = overloadWaitMs(body?.retry_after_ms);
      onOverloadRetry?.(attempt, waitMs);
      await sleep(waitMs);
      continue;
    }

    const message = body?.detail?.length ? `${body.error}: ${body.detail.join(', ')}` : body?.error;
    if (overloaded) {
      // Budget spent on a still-ongoing incident. Say what actually happened rather than the
      // generic failure: this is a capacity problem that will pass, not a broken resume, and the
      // student should know re-clicking later is worth it.
      throw new Error('The model stayed busy for too long. Try "Yes, fill it" again in a minute, or fill this one manually.');
    }
    throw new Error(message || 'resume generation failed');
  }

  return { profile, applicationProfile, resume };
}


/**
 * The single badge writer. Every source of badge state is read here and the priority decision lives
 * in the pure badgeState(); nothing else in this file may call chrome.action.setBadgeText.
 */
async function renderBadge(): Promise<void> {
  const [stalls, session] = await Promise.all([
    readStalls().catch(() => []),
    chrome.storage.session.get(['pendingDrafts', 'lastDetectedJob']).catch(() => ({} as Record<string, unknown>)),
  ]);
  const drafts = Array.isArray(session?.pendingDrafts) ? session.pendingDrafts.length : 0;
  const state = badgeState({ stalls: stalls.length, drafts, jobDetected: Boolean(session?.lastDetectedJob) });
  chrome.action.setBadgeText({ text: state.text });
  if (state.color) chrome.action.setBadgeBackgroundColor({ color: state.color });
}

export default defineBackground(() => {
  // Retry privacy-sanitized events that were queued through a prior offline or interrupted wake.
  void flushAnalyticsQueue();
  chrome.tabs.onRemoved.addListener((tabId) => {
    closePendingSubmission(tabId).catch(() => {});
  });
  // One-time copy of any legacy Volley-era storage keys to their new litos_* names, so a
  // published update never orphans an existing user's saved token/profile/settings.
  void migrateLegacyStorage();

  // Cache the backend-owned public contract for this service-worker session.
  // Static fallbacks keep the extension usable offline; the live contract lets
  // future releases add compatibility gates without another naming migration.
  void timeoutBackendFetch('/v1/meta')
    .then(async (res) => {
      if (!res.ok) return;
      const meta = (await res.json()) as ProductMeta;
      if (meta.product.name !== PRODUCT_NAME) {
        console.warn(`[${PRODUCT_NAME}] backend product contract mismatch`);
      }
      await chrome.storage.session.set({ litos_product_meta: meta });
    })
    .catch(() => {});

  void getStoredToken()
    .then((token) => token ? refreshEntitlementSnapshot(token) : null)
    .catch(() => {});

  // QA/dev bootstrap: when built with VITE_QA_TOKEN, seed the session once at install/reload so
  // the extension is signed in without driving the popup UI (which automation can't reach).
  // Seeding on onInstalled (not on every service-worker wake) means sign-out tests and the
  // auto-submit toggle hold their state for the rest of the QA run. Keeping it out of store
  // builds is enforced by scripts/ensure-no-qa-token.mjs, which the zip scripts run first.
  // OUTSIDE the QA gate below, deliberately. A stall outlives the service worker, so the badge has
  // to be restored when it wakes, and that matters most in exactly the builds real users run. An
  // earlier version of this sat inside the VITE_QA_TOKEN block, which ensure-no-qa-token.mjs
  // guarantees is false in every shippable build - so the fix was live only where it was not needed.
  void renderBadge();
  chrome.runtime.onStartup?.addListener(() => { void renderBadge(); });

  if (import.meta.env.VITE_QA_TOKEN) {
    chrome.runtime.onInstalled.addListener(() => {
      setToken(import.meta.env.VITE_QA_TOKEN)
        .then(() => setAutoSubmitEnabled(import.meta.env.VITE_QA_AUTOSUBMIT === '1'))
        .catch((e) => console.warn('[Litos QA] storage seed failed:', e));
    });
  }

  let lastDetectedJob: { title: string; company: string; url: string } | null = null;
  let openLitosSurfacePromise: Promise<boolean> | null = null;

  const openLitosSurface = (): Promise<boolean> => {
    if (openLitosSurfacePromise) return openLitosSurfacePromise;

    const openPopup = chrome.action.openPopup;
    const popupAttempt = typeof openPopup === 'function'
      ? Promise.resolve().then(() => chrome.action.openPopup())
      : Promise.reject(new Error('chrome.action.openPopup is unavailable'));

    const request = popupAttempt
      .then(() => true)
      .catch(async (popupError) => {
        try {
          await chrome.windows.create({
            url: chrome.runtime.getURL('popup.html'),
            type: 'popup',
            width: 400,
            height: 620,
            focused: true,
          });
          return true;
        } catch (windowError) {
          console.warn('[Litos] Could not open the extension popup:', popupError, windowError);
          return false;
        }
      });
    openLitosSurfacePromise = request;
    void request.finally(() => {
      if (openLitosSurfacePromise === request) openLitosSurfacePromise = null;
    });
    return request;
  };

  chrome.storage.session.get('lastDetectedJob').then((result) => {
    if (result.lastDetectedJob) lastDetectedJob = result.lastDetectedJob as { title: string; company: string; url: string };
  }).catch(() => {});

  // IMPORTANT: only return true for branches that call sendResponse asynchronously.
  // Returning true from a fire-and-forget handler (or a blanket return at the end) leaves
  // the message channel open with no response coming, which surfaces in the sender (the
  // popup) as "A listener indicated an asynchronous response... but the message channel
  // closed before a response was received" once the popup unmounts.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'LITOS_CLEAR_SESSION':
        return respondToClearSessionMessage(message, sendResponse);

      case 'JOB_DETECTED': {
        // Idempotent: content scripts (notably the Workday stage poll) can re-fire this for the
        // same job repeatedly. Skip the storage write, badge update, and popup broadcast when the
        // payload is unchanged, so a re-detect of the same posting isn't a write/message storm.
        const p = message.payload as { title: string; company: string; url: string };
        const unchanged =
          lastDetectedJob &&
          lastDetectedJob.title === p.title &&
          lastDetectedJob.company === p.company &&
          lastDetectedJob.url === p.url;
        if (unchanged) return false;
        lastDetectedJob = p;
        chrome.storage.session.set({ lastDetectedJob }).then(() => renderBadge()).catch(() => {});
        chrome.runtime.sendMessage(message).catch(() => {});
        void trackExtensionEvent('job_detected');
        return false;
      }

      case 'ANALYTICS_EVENT': {
        void trackExtensionEvent(message.event, message.properties);
        return false;
      }

      case 'GET_LAST_JOB': {
        sendResponse({ job: lastDetectedJob }); // synchronous response
        return false;
      }

      case 'OPEN_LITOS_POPUP': {
        openLitosSurface().then((ok) => sendResponse({ ok }));
        return true;
      }

      case 'GET_ENTITLEMENTS': {
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            sendResponse({ snapshot: await refreshEntitlementSnapshot(token) });
          } catch (error) {
            sendResponse({
              error: error instanceof Error ? error.message : 'Could not check your plan.',
              ...(isLitosApiError(error) ? { api_error: serializeLitosApiError(error) } : {}),
            });
          }
        });
        return true;
      }

      case 'OPEN_BILLING_PORTAL': {
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ ok: false, error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            const response = await timeoutBackendFetch('/billing/portal', { method: 'POST' }, token);
            if (!response.ok) throw await apiErrorFromResponse(response);
            const body = await response.json().catch(() => null) as { provider?: unknown; url?: unknown } | null;
            if (typeof body?.url !== 'string' || (body.provider !== 'stripe' && body.provider !== 'lemonsqueezy')) {
              throw new Error('Billing management returned an invalid destination.');
            }
            const portal = new URL(body.url);
            const safeStripe = body.provider === 'stripe'
              && portal.protocol === 'https:'
              && portal.hostname === 'billing.stripe.com';
            const safeLemon = body.provider === 'lemonsqueezy'
              && portal.protocol === 'https:'
              && (portal.hostname === 'app.lemonsqueezy.com'
                || portal.hostname === 'store.lemonsqueezy.com'
                || portal.hostname.endsWith('.lemonsqueezy.com'))
              && (portal.pathname.startsWith('/my-orders/') || portal.pathname.startsWith('/billing'));
            if (!safeStripe && !safeLemon) throw new Error('Billing management returned an unsafe destination.');
            await chrome.tabs.create({ url: portal.toString() });
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Billing management could not open.' });
          }
        });
        return true;
      }

      case 'OPEN_LITOS_PLANS': {
        const trigger = typeof message.trigger === 'string'
          ? message.trigger.trim().slice(0, 120)
          : 'extension_action';
        const planId = message.plan_id === 'litos_plus_week'
          || message.plan_id === 'litos_plus_month'
          || message.plan_id === 'litos_plus_quarter'
          ? message.plan_id
          : null;
        const feature = premiumActionFeatureForTrigger(trigger);
        const actionContext = sanitizeExtensionPremiumAction(trigger, message.action_context);
        const plansAuthEpoch = currentAuthEpoch();
        Promise.resolve().then(async () => {
          let actionNonce: string | null = null;
          if (feature) {
            if (!actionContext) {
              return {
                ok: false,
                error: 'Litos could not preserve the exact action you were taking.',
                code: 'checkout_action_context_invalid',
              };
            }
            const token = await getStoredToken();
            if (!token) {
              return { ok: false, error: NOT_SIGNED_IN_MESSAGE, code: 'authentication_required' };
            }
            assertCurrentAuthEpoch(plansAuthEpoch);
            const owner = await refreshEntitlementSnapshot(token, plansAuthEpoch);
            assertCurrentAuthEpoch(plansAuthEpoch);
            const pending = await createExtensionPremiumAction(
              token,
              owner.account_id,
              actionContext,
              plansAuthEpoch,
            );
            actionNonce = pending.action_nonce;
          }
          const url = new URL('https://trylitos.com/pricing');
          url.searchParams.set('surface', 'extension');
          url.searchParams.set('trigger', trigger);
          if (planId) url.searchParams.set('plan', planId);
          if (actionNonce) url.searchParams.set('action_nonce', actionNonce);
          await chrome.tabs.create({ url: url.toString() });
          return { ok: true, ...(actionNonce ? { action_nonce: actionNonce } : {}) };
        })
          .then(sendResponse)
          .catch((error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Litos+ options could not open.',
            ...(isLitosApiError(error) ? { code: error.body.code } : {}),
          }));
        return true;
      }

      case 'OPEN_MANUAL_OUTREACH': {
        const company = typeof message.company === 'string' ? message.company.trim().slice(0, 240) : '';
        const role = typeof message.role === 'string' ? message.role.trim().slice(0, 240) : '';
        const url = new URL('https://trylitos.com/dashboard/outreach');
        url.searchParams.set('intent', 'manual');
        if (company) url.searchParams.set('company', company);
        if (role) url.searchParams.set('role', role);
        chrome.tabs.create({ url: url.toString() })
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false, error: 'Manual outreach could not open.' }));
        return true;
      }

      case 'CLAIM_PREMIUM_RETRY_FOCUS': {
        const tabId = sender.tab?.id;
        const currentUrl = safeFreeSubmissionUrl(sender.url);
        chrome.storage.session.get([PENDING_PREMIUM_RETRY_FOCUS_KEY, PENDING_PREMIUM_ACTION_KEY])
          .then(async (stored) => {
            const focus = parsePendingPremiumRetryFocus(stored[PENDING_PREMIUM_RETRY_FOCUS_KEY]);
            const action = parsePendingExtensionPremiumAction(stored[PENDING_PREMIUM_ACTION_KEY]);
            if (!focus || !action) return { ok: false };
            if (Date.now() - focus.createdAt > PREMIUM_RETRY_FOCUS_TTL_MS) {
              await chrome.storage.session.remove(PENDING_PREMIUM_RETRY_FOCUS_KEY);
              return { ok: false };
            }
            if (
              tabId !== focus.tabId
              || !currentUrl
              || focus.actionNonce !== action.action_nonce
              || focus.accountId !== action.account_id
              || focus.featureKey !== action.feature_key
              || !premiumRetryPortalMatches(action, currentUrl)
            ) return { ok: false };
            return {
              ok: true,
              action_nonce: focus.actionNonce,
              feature_key: focus.featureKey,
            };
          })
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

      case 'GET_PREMIUM_RETRY_ACTION_CONTEXT': {
        const actionNonce = validPremiumActionNonce(message.action_nonce) ? message.action_nonce : '';
        const popupUrl = chrome.runtime.getURL('/popup.html');
        if (!actionNonce || typeof sender.url !== 'string' || !sender.url.startsWith(popupUrl)) {
          sendResponse({ ok: false, error: 'This saved action cannot be opened here.' });
          return false;
        }
        const contextAuthEpoch = currentAuthEpoch();
        getStoredToken().then(async (token) => {
          if (!token) return { ok: false, error: NOT_SIGNED_IN_MESSAGE };
          assertCurrentAuthEpoch(contextAuthEpoch);
          const snapshot = await refreshEntitlementSnapshot(token, contextAuthEpoch);
          const pending = await pendingExtensionPremiumAction();
          assertCurrentAuthEpoch(contextAuthEpoch);
          if (
            !pending
            || pending.action_nonce !== actionNonce
            || pending.account_id !== snapshot.account_id
            || pending.kind !== 'extension_screen'
            || pending.screen !== 'draft'
            || pending.feature_key !== 'outreach_email_generation'
            || !pending.consumed_at
            || !pending.contact_id
            || !pending.application_id
            || !pending.contact
            || !pending.operation_id
            || !pending.company
            || !pending.role
            || !featureEnabled(snapshot, 'outreach_email_generation')
          ) return { ok: false, error: 'This saved outreach action is no longer available.' };
          const serverAction = await readServerPremiumAction(token, actionNonce, contextAuthEpoch);
          const verifiedPending = await storeVerifiedPremiumActionExpiry(
            pending,
            serverAction,
            ['consumed'],
            contextAuthEpoch,
          );
          if (!verifiedPending) {
            return { ok: false, error: 'Litos could not verify this saved outreach action.' };
          }
          assertCurrentAuthEpoch(contextAuthEpoch);
          return {
            ok: true,
            action: {
              contact: pending.contact,
              application_id: pending.application_id,
              job: {
                application_id: pending.application_id,
                company: pending.company,
                role: pending.role,
                ...(pending.portal_url ? { url: pending.portal_url } : {}),
              },
              operation_id: pending.operation_id,
              draft_type: pending.draft_type ?? 'first_note',
              draft_subject: pending.draft_subject ?? '',
              draft_body: pending.draft_body ?? '',
            },
          };
        })
          .then(sendResponse)
          .catch((error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'This saved outreach action could not be restored.',
          }));
        return true;
      }

      case 'COMPLETE_PREMIUM_RETRY_FOCUS': {
        const tabId = sender.tab?.id;
        const actionNonce = validPremiumActionNonce(message.action_nonce) ? message.action_nonce : '';
        chrome.storage.session.get(PENDING_PREMIUM_RETRY_FOCUS_KEY)
          .then(async (stored) => {
            const focus = parsePendingPremiumRetryFocus(stored[PENDING_PREMIUM_RETRY_FOCUS_KEY]);
            if (!focus || focus.tabId !== tabId || focus.actionNonce !== actionNonce) return { ok: false };
            await chrome.storage.session.remove(PENDING_PREMIUM_RETRY_FOCUS_KEY);
            return { ok: true };
          })
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

      case 'GET_FILL_ACCESS': {
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ can_tailor: false, automatic_submission: false, error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            const snapshot = await refreshEntitlementSnapshot(token);
            sendResponse({
              can_tailor: featureEnabled(snapshot, 'ai_resume_tailoring'),
              can_draft_answers: featureEnabled(snapshot, 'ai_application_answer_generation'),
              hover_generation: featureEnabled(snapshot, 'hover_generation'),
              automatic_submission: featureEnabled(snapshot, 'automatic_submission'),
              snapshot,
            });
          } catch {
            // Plan lookup failure degrades to the Free lane. It must never turn a form fill into
            // an outage or let stale local state grant a premium generation or submission.
            sendResponse({ can_tailor: false, can_draft_answers: false, hover_generation: false, automatic_submission: false });
          }
        });
        return true;
      }

      case 'GET_FREE_FILL_DATA': {
        const freeFillAuthEpoch = currentAuthEpoch();
        const payload = message.payload as {
          application_id?: unknown;
          company?: unknown;
          role?: unknown;
          portal_url?: unknown;
        } | undefined;
        if (payload?.application_id !== undefined && !isValidFreeFillApplicationId(payload.application_id)) {
          sendResponse({ error: 'This Tracker application could not be identified.', code: 'invalid_application' });
          return false;
        }
        const requestedApplicationId = isValidFreeFillApplicationId(payload?.application_id)
          ? payload.application_id.toLowerCase()
          : null;
        const company = typeof payload?.company === 'string' ? payload.company.trim() : '';
        const role = typeof payload?.role === 'string' ? payload.role.trim() : '';
        const portalUrl = typeof payload?.portal_url === 'string' ? payload.portal_url : '';
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            assertCurrentAuthEpoch(freeFillAuthEpoch);
            const [profileResponse, applicationProfileResponse, postingCompensation] = await Promise.all([
              timeoutBackendFetch('/profile', {}, token),
              timeoutBackendFetch('/profile/application', {}, token),
              fetchAshbyPostingCompensation(portalUrl),
            ]);
            assertCurrentAuthEpoch(freeFillAuthEpoch);
            const profile: UserProfile = profileResponse.ok ? await profileResponse.json() : EMPTY_PROFILE;
            const applicationProfile: ApplicationProfile = applicationProfileResponse.ok
              ? await applicationProfileResponse.json()
              : {};
            let application: unknown = null;
            let applicationId: string | null = null;
            let selectedResume: FreeFillResumePayload | null = null;
            let resume_error: string | undefined;
            let tracking_error: string | undefined;
            if (requestedApplicationId) {
              const fillData = await ownedFreeFillHandoffData(
                token,
                requestedApplicationId,
                freeFillAuthEpoch,
              ) as {
                application_id?: unknown;
                application?: unknown;
                portal_url?: unknown;
                selected_resume?: FreeFillResume | null;
              } | null;
              if (
                typeof fillData?.application_id !== 'string'
                || fillData.application_id.toLowerCase() !== requestedApplicationId
              ) throw new Error('Litos could not verify this saved application.');
              if (!freeFillPortalMatches(fillData.portal_url, portalUrl)) {
                throw new Error('The company page no longer matches this Tracker application. Nothing was filled.');
              }
              application = fillData.application ?? null;
              applicationId = requestedApplicationId;
              try {
                selectedResume = await freeFillResumePayload(fillData.selected_resume, token);
                assertCurrentAuthEpoch(freeFillAuthEpoch);
                if (fillData.selected_resume && !selectedResume) {
                  resume_error = 'Your saved resume could not be attached. Add it yourself before you submit.';
                }
              } catch {
                assertCurrentAuthEpoch(freeFillAuthEpoch);
                resume_error = 'Your saved resume could not be attached. Add it yourself before you submit.';
              }
            } else if (company && role && portalUrl) {
              const applicationResponse = await timeoutBackendFetch('/applications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ company, role, portal_url: portalUrl, source: 'extension' }),
              }, token);
              assertCurrentAuthEpoch(freeFillAuthEpoch);
              if (applicationResponse.ok) {
                application = await applicationResponse.json().catch(() => null);
                const created = application as { application?: { id?: unknown } } | null;
                applicationId = typeof created?.application?.id === 'string' ? created.application.id : null;
                if (applicationId) {
                  try {
                    const fillDataResponse = await timeoutBackendFetch(`/applications/${applicationId}/fill-data`, {}, token);
                    assertCurrentAuthEpoch(freeFillAuthEpoch);
                    if (fillDataResponse.ok) {
                      const fillData = await fillDataResponse.json().catch(() => null) as {
                        selected_resume?: FreeFillResume | null;
                      } | null;
                      selectedResume = await freeFillResumePayload(fillData?.selected_resume, token);
                      if (fillData?.selected_resume && !selectedResume) {
                        resume_error = 'Your saved resume could not be attached. Add it yourself before you submit.';
                      }
                    }
                  } catch {
                    resume_error = 'Your saved resume could not be attached. Add it yourself before you submit.';
                  }
                }
              } else tracking_error = 'This fill could not be added to your Tracker yet.';
            }
            assertCurrentAuthEpoch(freeFillAuthEpoch);
            sendResponse({
              profile,
              applicationProfile,
              application,
              application_id: applicationId,
              selected_resume: selectedResume,
              resume_error,
              tracking_error,
              posting_compensation: postingCompensation,
            });
          } catch (error) {
            sendResponse({ error: error instanceof Error ? error.message : 'Could not load your saved answers.' });
          }
        });
        return true;
      }

      case 'RECORD_FREE_FILL_RESULT': {
        const payload = message.payload as {
          application_id?: unknown;
          application_identity?: {
            company?: unknown;
            role?: unknown;
            portal_url?: unknown;
          };
          selected_resume_artifact_id?: unknown;
          resume_attached?: unknown;
          resume_source?: unknown;
          unanswered_questions?: unknown;
        } | undefined;
        let applicationId = typeof payload?.application_id === 'string' ? payload.application_id : '';
        const company = typeof payload?.application_identity?.company === 'string'
          ? payload.application_identity.company.trim()
          : '';
        const role = typeof payload?.application_identity?.role === 'string'
          ? payload.application_identity.role.trim()
          : '';
        const portalUrl = typeof payload?.application_identity?.portal_url === 'string'
          ? payload.application_identity.portal_url
          : '';
        const selectedResumeArtifactId = typeof payload?.selected_resume_artifact_id === 'string'
          ? payload.selected_resume_artifact_id
          : null;
        const unansweredQuestions = typeof payload?.unanswered_questions === 'number'
          ? Math.max(0, Math.min(200, Math.trunc(payload.unanswered_questions)))
          : 0;
        const resumeAttached = payload?.resume_attached === true;
        const resumeSource = payload?.resume_source === 'artifact' || payload?.resume_source === 'base_resume'
          ? payload.resume_source
          : 'none';
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ ok: false, error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            if (!applicationId) {
              if (!company || !role || !portalUrl) {
                sendResponse({ ok: false, error: 'This fill is missing its Tracker identity.' });
                return;
              }
              const applicationResponse = await timeoutBackendFetch('/applications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ company, role, portal_url: portalUrl, source: 'extension' }),
              }, token);
              if (!applicationResponse.ok) {
                sendResponse({ ok: false, error: 'This fill could not be added to your Tracker yet.' });
                return;
              }
              const applicationBody = await applicationResponse.json().catch(() => null) as {
                application?: { id?: unknown };
              } | null;
              applicationId = typeof applicationBody?.application?.id === 'string'
                ? applicationBody.application.id
                : '';
              if (!applicationId) {
                sendResponse({ ok: false, error: 'Tracker did not return the canonical application.' });
                return;
              }
            }
            const response = await timeoutBackendFetch(`/applications/${applicationId}/fill`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                selected_resume_artifact_id: selectedResumeArtifactId,
                resume_attached: resumeAttached,
                resume_source: resumeSource,
                unanswered_questions: unansweredQuestions,
              }),
            }, token);
            if (!response.ok) {
              sendResponse({ ok: false, application_id: applicationId, error: 'This fill could not update your Tracker yet.' });
              return;
            }
            sendResponse({ ok: true, application_id: applicationId, fill: await response.json().catch(() => null) });
          } catch (error) {
            sendResponse({
              ok: false,
              ...(applicationId ? { application_id: applicationId } : {}),
              error: error instanceof Error ? error.message : 'This fill could not update your Tracker yet.',
            });
          }
        });
        return true;
      }

      case 'START_FREE_SUBMISSION_OUTCOME_MONITOR': {
        const monitorAuthEpoch = currentAuthEpoch();
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        const eventId = isValidFreeFillApplicationId(message.payload?.event_id)
          ? message.payload.event_id.toLowerCase()
          : '';
        const applicationId = isValidFreeFillApplicationId(message.payload?.application_id)
          ? message.payload.application_id.toLowerCase()
          : '';
        const startUrl = safeFreeSubmissionUrl(message.payload?.start_url);
        const senderUrl = safeFreeSubmissionUrl(sender.url);
        if (
          tabId === undefined
          || !eventId
          || !applicationId
          || !startUrl
          || !senderUrl
          || !freeSubmissionNavigationMatches(startUrl, senderUrl)
        ) {
          sendResponse({ ok: false, error: 'This Free submission monitor could not be bound to the current page.' });
          return false;
        }
        beginFreeSubmissionMonitorStart(tabId);
        getStoredToken().then(async (token) => {
          if (!token) throw new Error(NOT_SIGNED_IN_MESSAGE);
          assertCurrentAuthEpoch(monitorAuthEpoch);
          const snapshot = await refreshEntitlementSnapshot(token, monitorAuthEpoch);
          assertCurrentAuthEpoch(monitorAuthEpoch);
          await storePendingFreeSubmissionMonitor({
            eventId,
            applicationId,
            tabId,
            frameId,
            accountId: snapshot.account_id,
            authEpoch: monitorAuthEpoch,
            startUrl,
            startedAt: Date.now(),
          });
          assertCurrentAuthEpoch(monitorAuthEpoch);
          sendResponse({ ok: true });
        }).catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'The Free submission monitor could not start.',
        })).finally(() => endFreeSubmissionMonitorStart(tabId));
        return true;
      }

      case 'GET_PENDING_FREE_SUBMISSION_OUTCOME': {
        const recoveryAuthEpoch = currentAuthEpoch();
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        const currentUrl = safeFreeSubmissionUrl(sender.url);
        if (tabId === undefined || !currentUrl) {
          sendResponse({ pending: null });
          return false;
        }
        Promise.all([
          getStoredToken(),
          pendingFreeSubmissionMonitor(tabId, frameId)
            .then((pending) => pending ?? pendingFreeSubmissionMonitorForTab(tabId)),
        ]).then(async ([token, pending]) => {
          if (!pending) {
            sendResponse({
              pending: null,
              retry_pending: freeSubmissionMonitorStartsInFlight.has(tabId),
            });
            return;
          }
          if (!token) {
            sendResponse({ pending, force_unknown: true, remaining_ms: 0 });
            return;
          }
          assertCurrentAuthEpoch(recoveryAuthEpoch);
          const snapshot = await refreshEntitlementSnapshot(token, recoveryAuthEpoch);
          assertCurrentAuthEpoch(recoveryAuthEpoch);
          const disposition = freeSubmissionMonitorDisposition({
            pending,
            tabId,
            frameId,
            accountId: snapshot.account_id,
            currentAuthEpoch: recoveryAuthEpoch,
            currentUrl,
            now: Date.now(),
          });
          const elapsed = Date.now() - pending.startedAt;
          sendResponse({
            pending,
            force_unknown: disposition !== 'resume',
            remaining_ms: disposition === 'resume'
              ? Math.max(0, Math.min(
                FREE_SUBMISSION_MONITOR_TTL_MS - elapsed,
                FREE_SUBMISSION_OUTCOME_TIMEOUT_MS - elapsed,
              ))
              : 0,
          });
        }).catch(async () => {
          const pending = await pendingFreeSubmissionMonitor(tabId, frameId)
            .then((exact) => exact ?? pendingFreeSubmissionMonitorForTab(tabId))
            .catch(() => null);
          sendResponse({
            pending,
            force_unknown: Boolean(pending),
            remaining_ms: 0,
            retry_pending: !pending && freeSubmissionMonitorStartsInFlight.has(tabId),
          });
        });
        return true;
      }

      case 'ABANDON_FREE_SUBMISSION_OUTCOME_MONITOR': {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        const eventId = isValidFreeFillApplicationId(message.event_id)
          ? message.event_id.toLowerCase()
          : '';
        if (tabId === undefined || !eventId) {
          sendResponse({ ok: false });
          return false;
        }
        clearPendingFreeSubmissionMonitorForTabEvent(tabId, eventId)
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

      case 'RECORD_FREE_SUBMISSION_OUTCOME': {
        const outcomeAuthEpoch = currentAuthEpoch();
        const payload = message.payload as {
          event_id?: unknown;
          application_id?: unknown;
          outcome?: unknown;
          final_url?: unknown;
          confirmation_text?: unknown;
        } | undefined;
        const eventId = isValidFreeFillApplicationId(payload?.event_id)
          ? payload.event_id.toLowerCase()
          : '';
        const applicationId = isValidFreeFillApplicationId(payload?.application_id)
          ? payload.application_id.toLowerCase()
          : '';
        const outcome = payload?.outcome === 'confirmed'
          || payload?.outcome === 'failed'
          || payload?.outcome === 'unknown'
          ? payload.outcome
          : null;
        const finalUrl = safeFreeSubmissionUrl(payload?.final_url) ?? '';
        if (!eventId || !applicationId || !outcome || !finalUrl) {
          sendResponse({
            ok: false,
            error: 'This Free submission outcome is incomplete or unsafe.',
            code: 'invalid_submission_outcome',
          });
          return false;
        }
        const confirmationText = typeof payload?.confirmation_text === 'string'
          ? payload.confirmation_text.replace(/\s+/g, ' ').trim().slice(0, 1000)
          : '';
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ ok: false, error: NOT_SIGNED_IN_MESSAGE, code: 'authentication_required' });
            return;
          }
          try {
            assertCurrentAuthEpoch(outcomeAuthEpoch);
            const snapshot = await refreshEntitlementSnapshot(token, outcomeAuthEpoch);
            assertCurrentAuthEpoch(outcomeAuthEpoch);
            const tabId = sender.tab?.id;
            const frameId = sender.frameId ?? 0;
            const pending = tabId === undefined
              ? null
              : await pendingFreeSubmissionMonitor(tabId, frameId)
                .then((exact) => exact ?? pendingFreeSubmissionMonitorForTab(tabId));
            if (!pending || tabId === undefined) {
              sendResponse({
                ok: false,
                error: 'This Free submission outcome no longer has its trusted-click monitor.',
                code: 'submission_monitor_missing',
              });
              return;
            }
            const currentUrl = safeFreeSubmissionUrl(sender.url) ?? finalUrl;
            const disposition = freeSubmissionMonitorDisposition({
              pending,
              tabId,
              frameId,
              accountId: snapshot.account_id,
              currentAuthEpoch: outcomeAuthEpoch,
              currentUrl,
              now: Date.now(),
            });
            const {
              eventId: effectiveEventId,
              applicationId: effectiveApplicationId,
              outcome: effectiveOutcome,
              finalUrl: effectiveFinalUrl,
              confirmationText: effectiveConfirmationText,
            } = bindFreeSubmissionOutcome({
              pending,
              eventId,
              applicationId,
              outcome,
              finalUrl,
              confirmationText,
              disposition,
            });
            const response = await timeoutBackendFetch(
              `/applications/${effectiveApplicationId}/manual-submission-outcome`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Idempotency-Key': effectiveEventId,
                },
                body: JSON.stringify({
                  event_id: effectiveEventId,
                  outcome: effectiveOutcome,
                  final_url: effectiveFinalUrl,
                  ...(effectiveConfirmationText ? { confirmation_text: effectiveConfirmationText } : {}),
                }),
              },
              token,
            );
            assertCurrentAuthEpoch(outcomeAuthEpoch);
            if (!response.ok) throw await apiErrorFromResponse(response);
            if (tabId !== undefined) {
              await clearPendingFreeSubmissionMonitorForTabEvent(tabId, effectiveEventId);
            }
            sendResponse({ ok: true });
            void trackExtensionEvent('free_submission_outcome_recorded', { outcome: effectiveOutcome });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : 'The Tracker outcome could not be recorded yet.',
              ...(isLitosApiError(error) ? { code: error.body.code } : {}),
            });
          }
        });
        return true;
      }

      case 'GET_AUTOMATION_SETTINGS': {
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ automatic_submission_enabled: false, automatic_verification_enabled: false, automatic_captcha_enabled: false });
            return;
          }
          try {
            const [res, snapshot] = await Promise.all([
              timeoutBackendFetch('/onboarding/state', {}, token),
              refreshEntitlementSnapshot(token),
            ]);
            if (!res.ok) throw new Error(`settings failed (${res.status})`);
            const data: {
              automatic_submission_enabled?: boolean;
              automatic_verification_enabled?: boolean;
              automatic_captcha_enabled?: boolean;
            } = await res.json();
            const automaticSubmission = automaticSubmissionEnabled(data)
              && featureEnabled(snapshot, 'automatic_submission');
            await setAutoSubmitEnabled(automaticSubmission);
            sendResponse({
              automatic_submission_enabled: automaticSubmission,
              automatic_verification_enabled: data.automatic_verification_enabled === true,
              // Already version-checked by the backend. The extension deliberately does not
              // re-derive that rule; a second implementation of a consent check is a second thing
              // that can be wrong about consent.
              automatic_captcha_enabled: data.automatic_captcha_enabled === true,
            });
          } catch {
            // A failed revocation check is a hold, never permission to submit from stale storage.
            sendResponse({ automatic_submission_enabled: false, automatic_verification_enabled: false, automatic_captcha_enabled: false });
          }
        });
        return true;
      }

      case 'EXTENSION_SUBMISSION_START': {
        const submissionAuthEpoch = currentAuthEpoch();
        Promise.all([getStoredToken(), Promise.resolve(sender.tab?.id)])
          .then(async ([token, tabId]) => {
            if (!token || tabId === undefined) throw new Error('Litos could not identify this application tab.');
            assertCurrentAuthEpoch(submissionAuthEpoch);
            const authorization = message.payload?.authorization === 'user_initiated'
              ? 'user_initiated'
              : 'standing_consent';
            if (needsAutomaticSubmissionEntitlement(authorization)) {
              await requireFeature(token, 'automatic_submission');
              assertCurrentAuthEpoch(submissionAuthEpoch);
            }
            const applicationId = String(message.payload?.applicationId ?? '');
            const frameId = sender.frameId ?? 0;
            const binding = await handoffPacketBinding(applicationId, tabId, frameId);
            assertCurrentAuthEpoch(submissionAuthEpoch);
            if (!binding) throw new Error('Reload this saved application before submitting from Chrome.');
            const currentUrl = sender.url ?? '';
            if (!currentUrl) throw new Error('Litos could not verify the current application page.');
            assertCurrentAuthEpoch(submissionAuthEpoch);
            const response = await timeoutBackendFetch(`/applications/${applicationId}/submission/extension-start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                authorization,
                handoff_version: binding.handoffVersion,
                current_url: currentUrl,
              }),
            }, token);
            const body = await response.json().catch(() => null) as { claim_id?: string; error?: string; already_submitted?: boolean } | null;
            assertCurrentAuthEpoch(submissionAuthEpoch);
            if (!response.ok || !body?.claim_id) throw new Error(body?.error ?? 'Litos could not reserve this application.');
            const gatedIdentity = gatedAttendedIdentity(currentUrl);
            const pending: PendingExtensionSubmission = {
              applicationId,
              claimId: body.claim_id,
              startedAt: Date.now(),
              frameId: sender.frameId ?? 0,
              packetVersion: binding.packetVersion,
              auditDigest: binding.auditDigest,
              ...(gatedIdentity ? { strictReceipt: { family: gatedIdentity.family, startedUrl: currentUrl } } : {}),
            };
            assertCurrentAuthEpoch(submissionAuthEpoch);
            await setPendingSubmission(tabId, pending, submissionAuthEpoch);
            assertCurrentAuthEpoch(submissionAuthEpoch);
            void trackExtensionEvent('application_submission_requested', { authorization });
            sendResponse({ ok: true, claimId: body.claim_id });
          })
          .catch((error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Submission could not start.',
            ...(isLitosApiError(error) ? { api_error: serializeLitosApiError(error) } : {}),
          }));
        return true;
      }

      case 'EXTENSION_SUBMISSION_OUTCOME': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          sendResponse({ ok: false, error: 'Litos could not identify this application tab.' });
          return false;
        }
        pendingSubmission(tabId).then(async (pending) => {
          if (!pending || pending.applicationId !== String(message.payload?.applicationId ?? '')) {
            throw new Error('This application is no longer waiting for a confirmation.');
          }
          if (pending.frameId !== (sender.frameId ?? 0)) throw new Error('This confirmation came from a different page frame.');
          if (Date.now() - pending.startedAt > PENDING_SUBMISSION_MAX_AGE_MS) {
            await postExtensionOutcome(pending, 'unknown', String(sender.tab?.url ?? 'https://trylitos.com'));
            await setPendingSubmission(tabId, null);
            sendResponse({ ok: false, error: 'The confirmation window expired. Check the employer portal.' });
            return;
          }
          await postExtensionOutcome(
            pending,
            message.payload?.outcome === 'confirmed'
              ? 'confirmed'
              : message.payload?.outcome === 'failed'
                ? 'failed'
                : message.payload?.outcome === 'cancelled'
                  ? 'cancelled'
                  : 'unknown',
            String(message.payload?.finalUrl ?? sender.tab?.url ?? 'https://trylitos.com'),
            typeof message.payload?.confirmationText === 'string' ? message.payload.confirmationText : undefined,
          );
          await setPendingSubmission(tabId, null);
          sendResponse({ ok: true });
        }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Could not record the outcome.' }));
        return true;
      }

      case 'GET_PENDING_EXTENSION_SUBMISSION': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          sendResponse({ pending: null });
          return false;
        }
        pendingSubmission(tabId).then((pending) => {
          if (pending && Date.now() - pending.startedAt > PENDING_SUBMISSION_MAX_AGE_MS) {
            closePendingSubmission(tabId, String(sender.tab?.url ?? 'https://trylitos.com'))
              .finally(() => sendResponse({ pending: null }));
            return;
          }
          sendResponse({ pending: pending?.frameId === (sender.frameId ?? 0) ? pending : null });
        });
        return true;
      }

      case 'CLEAR_JOB_BADGE': {
        lastDetectedJob = null;
        // Clears the JOB signal only. Clearing the badge outright here is what let an unrelated
        // dismissal erase a stall count that nothing would have restored.
        chrome.storage.session.remove('lastDetectedJob').then(() => renderBadge()).catch(() => {});
        return false;
      }

      case 'GET_PENDING_DRAFTS': {
        chrome.storage.session.get('pendingDrafts').then((r) => {
          sendResponse({ drafts: r.pendingDrafts ?? [] });
        });
        return true; // responding asynchronously - keep the channel open
      }

      case 'CLEAR_PENDING_DRAFTS': {
        chrome.storage.session.remove('pendingDrafts').then(() => renderBadge()).catch(() => {});
        return false;
      }

      case 'JOB_APPROVED': {
        const { title, company, url, operation_id } = message.payload;
        const resolveOperationId = isValidFreeFillApplicationId(operation_id)
          ? operation_id.toLowerCase()
          : crypto.randomUUID();
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ ok: false, error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            const snapshot = await refreshEntitlementSnapshot(token);
            if (!featureEnabled(snapshot, 'contact_discovery') || !featureEnabled(snapshot, 'outreach_email_generation')) {
              throw new LitosApiError(402, {
                error: 'Finding contacts and drafting outreach is part of Litos+.',
                code: 'feature_locked',
                feature_id: !featureEnabled(snapshot, 'contact_discovery')
                  ? 'contact_discovery'
                  : 'outreach_email_generation',
                entitlement_revision: snapshot.revision,
                retryable: false,
              });
            }
            const { drafts, failures } = await resolveAndDraft(
              title,
              company,
              url,
              token,
              resolveOperationId,
            );
            if (drafts.length > 0) {
              await chrome.storage.session.set({ pendingDrafts: drafts });
              await renderBadge();
              // Notify popup if open
              chrome.runtime.sendMessage({ type: 'DRAFTS_READY', payload: { count: drafts.length } }).catch(() => {});
              void trackExtensionEvent('outreach_draft_created', { draft_count: drafts.length });
            }
            if (drafts.length === 0 && failures.length > 0) {
              sendResponse({
                ok: false,
                count: 0,
                failures,
                error: 'No outreach draft finished. The contacts were found, but each draft failed.',
              });
              return;
            }
            sendResponse({ ok: true, count: drafts.length, failures });
          } catch (error) {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : 'Could not find people for this job.',
              ...(isLitosApiError(error) ? { api_error: serializeLitosApiError(error) } : {}),
            });
          }
        });
        return true;
      }

      case 'GENERATE_RESUME_AND_FILL_DATA': {
        // `url` is the sending tab's posting URL, used only to fetch Ashby's structured
        // compensation range (R-031). Older callers that omit it just get no payload.
        const { company, role, jd_text, url, initiation, operation_id } = message.payload;
        const resumeOperationId = isValidFreeFillApplicationId(operation_id)
          ? operation_id.toLowerCase()
          : crypto.randomUUID();
        // The card lives in the sending tab, so a capacity-retry notice has to go back to that tab
        // specifically: chrome.runtime.sendMessage from the background reaches the popup, never a
        // content script (that is why DRAFTS_READY works but this would not). Best-effort by
        // design - a closed tab or a card already dismissed just means nobody is listening, which
        // must never take down the generation itself.
        const tabId = sender.tab?.id;
        const notifyRetry = (attempt: number, waitMs: number) => {
          if (tabId === undefined) return;
          chrome.tabs
            .sendMessage(tabId, { type: 'RESUME_GEN_RETRYING', payload: { company, role, attempt, waitMs } })
            .catch(() => {});
        };
        const requestAuthEpoch = currentAuthEpoch();
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            if (initiation === 'hover') {
              await requireFeature(token, 'hover_generation');
              assertCurrentAuthEpoch(requestAuthEpoch);
            }
            if (tabId !== undefined) await clearPacketApplicantIdentity(tabId);
            // Started alongside the (much slower) resume generation, awaited only at the end;
            // internally caught, so a compensation miss can never sink the fill data.
            const compensationPromise = fetchAshbyPostingCompensation(url);
            const result = await generateResumeAndProfile(
              company,
              role,
              jd_text,
              token,
              resumeOperationId,
              url,
              initiation === 'hover' ? 'hover_prewarm' : 'explicit_click',
              notifyRetry,
            );
            if (!result.resume || !result.profile) {
              throw new Error('Litos did not return a complete application packet. Nothing was filled. Try again.');
            }
            const packetEmail = applicantEmailForGeneratedPacket(result.resume);
            const applicationId = result.resume.application?.id;
            if (!packetEmail || !applicationId || tabId === undefined || typeof url !== 'string') {
              throw new Error('Litos could not verify the tracked application routing email, so nothing was filled. Try again.');
            }
            const routeResponse = await timeoutBackendFetch('/application-email', {}, token);
            const route = routeResponse.ok
              ? await routeResponse.json().catch(() => null) as {
                tracking_active?: unknown;
                domain?: unknown;
                route_generation_fingerprint?: unknown;
              } | null
              : null;
            const routeFingerprint = route?.route_generation_fingerprint;
            if (
              typeof routeFingerprint !== 'string'
              || !packetIdentityMatchesCurrentRoute({
                applicationId,
                email: packetEmail,
                routeFingerprint,
              }, route ?? {})
            ) {
              throw new Error('Litos could not verify the current application email route, so nothing was filled. Try again.');
            }
            if (atsNameForPortalUrl(url) === 'workday') {
              const ownedResponse = await timeoutBackendFetch(`/applications/${applicationId}/workday-account-identity`, {}, token);
              const owned = ownedResponse.ok
                ? await ownedResponse.json().catch(() => null) as { user_id?: unknown; application_id?: unknown; email?: unknown; portal_host?: unknown } | null
                : null;
              const portalHost = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
              if (
                typeof owned?.user_id !== 'string'
                || owned.application_id !== applicationId
                || typeof owned.email !== 'string'
                || owned.email.trim().toLowerCase() !== packetEmail.trim().toLowerCase()
                || owned.portal_host !== portalHost
              ) {
                throw new Error('Litos could not verify that this application packet belongs to the signed-in account. Nothing was filled.');
              }
              await storePacketApplicantIdentity({
                tabId,
                userId: owned.user_id,
                applicationId,
                email: packetEmail,
                portalUrl: url,
                routeFingerprint,
                expectedAuthEpoch: requestAuthEpoch,
              });
            }
            void trackExtensionEvent('application_generation_completed');
            sendResponse({ ...result, posting_compensation: await compensationPromise });
          } catch (err) {
            sendResponse({
              error: err instanceof Error ? err.message : 'resume generation failed',
              ...(isLitosApiError(err) ? { api_error: serializeLitosApiError(err) } : {}),
            });
          }
        });
        return true; // responding asynchronously
      }

      case 'ANSWER_QUESTION': {
        // Drafts one open-ended application answer from the backend. The generic adapter calls
        // this per textarea; the field it fills is flagged for review, so this is a first draft
        // in the student's voice, never a silent final answer.
        const { company, role, jd_text, question, application_id, operation_id } = message.payload;
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            const res = await timeoutBackendFetch('/application/answer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                company,
                role,
                jd_text,
                question,
                application_id,
                operation_id,
              }),
            }, token, RESUME_FETCH_TIMEOUT_MS);
            if (!res.ok) {
              const apiError = await apiErrorFromResponse(res);
              sendResponse({ error: apiError.message, api_error: serializeLitosApiError(apiError) });
              return;
            }
            const data: unknown = await res.json();
            sendResponse({ answer: groundedDraftAnswer(data) });
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : 'draft failed' });
          }
        });
        return true; // responding asynchronously
      }

      case 'GET_ACCOUNT_CREATION_DATA': {
        // Lighter than GENERATE_RESUME_AND_FILL_DATA - the Workday signup screen only needs the
        // account email, not a resume, so this skips the /resume/generate call entirely (no
        // point spending a resume-gen quota unit on a step before there's even an application to
        // tailor one for). Password is deliberately not fetched here - the student types their
        // own (2026-07-03 product decision), Litos never touches that field.
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            const tabId = sender.tab?.id;
            const portalUrl = sender.tab?.url;
            const identity = tabId === undefined || !portalUrl
              ? null
              : await verifyWorkdayPacketForTab(token, tabId, portalUrl);
            if (!identity) {
              sendResponse({ error: 'Litos has not prepared this application email yet. Return to the job page and prepare the application first.' });
              return;
            }
            const routeResponse = await timeoutBackendFetch('/application-email', {}, token);
            const route = routeResponse.ok
              ? await routeResponse.json().catch(() => null) as {
                tracking_active?: unknown;
                domain?: unknown;
                route_generation_fingerprint?: unknown;
              } | null
              : null;
            if (!route || !packetIdentityMatchesCurrentRoute(identity, route)) {
              sendResponse({ error: 'The Litos application email route changed after this application was prepared. Regenerate it before creating the employer account.' });
              return;
            }
            sendResponse({ email: identity.email, applicationId: identity.applicationId });
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : 'could not load account data' });
          }
        });
        return true;
      }

      case 'GET_APPLICATION_HANDOFF_PACKET': {
        const packetAuthEpoch = currentAuthEpoch();
        const applicationId = String(message.applicationId ?? '');
        const currentUrl = sender.url ?? '';
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        if (!/^[0-9a-f-]{36}$/i.test(applicationId)) {
          sendResponse({ error: 'The saved application packet could not be identified.' });
          return false;
        }
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            if (tabId === undefined) throw new Error('The application tab is no longer available.');
            const resume = await fetchAndBindHandoffPacket({
              applicationId,
              currentUrl,
              tabId,
              frameId,
              token,
              publishBinding: false,
              authEpoch: packetAuthEpoch,
            });
            assertCurrentAuthEpoch(packetAuthEpoch);
            const frozen = frozenApplicantFillData(resume);
            if (!frozen) throw new Error('The saved application packet has no complete frozen applicant data.');
            await storeHandoffPacketBinding({
              applicationId,
              tabId,
              frameId,
              currentUrl,
              handoffVersion: resume.handoff_version!,
              packetVersion: resume.packet_audit!.packet_version,
              auditDigest: resume.packet_audit!.audit_digest,
              pdfSha256: resume.packet_audit!.bindings.pdf.sha256,
              pdfSizeBytes: resume.packet_audit!.bindings.pdf.sizeBytes,
            }, packetAuthEpoch);
            assertCurrentAuthEpoch(packetAuthEpoch);
            sendResponse({ ...frozen, resume });
          } catch (error) {
            sendResponse({ error: error instanceof Error ? error.message : 'The saved application packet could not be loaded.' });
          }
        });
        return true;
      }

      case 'GET_WORKDAY_ACCOUNT_STATE':
      case 'CLAIM_WORKDAY_ACCOUNT':
      case 'VALIDATE_WORKDAY_ACCOUNT_ACTION':
      case 'ABANDON_WORKDAY_ACCOUNT_CLAIM':
      case 'ACTIVATE_WORKDAY_ACCOUNT': {
        const operationAuthEpoch = currentAuthEpoch();
        getStoredToken().then(async (token) => {
          if (!token) throw new Error(NOT_SIGNED_IN_MESSAGE);
          assertCurrentAuthEpoch(operationAuthEpoch);
          const tabId = sender.tab?.id;
          const portalUrl = sender.tab?.url;
          if (tabId === undefined || !portalUrl) throw new Error('The Workday account tab is unavailable.');
          const identity = await verifyWorkdayPacketForTab(token, tabId, portalUrl);
          if (!identity) throw new Error('The Workday account identity does not belong to the signed-in Litos account.');
          const { userId, host, email, applicationId } = identity;
          const requestedHost = String(message.payload?.host ?? '').trim().toLowerCase().replace(/^www\./, '');
          if (requestedHost && requestedHost !== host) throw new Error('The Workday account identity is invalid.');

          if (message.type === 'GET_WORKDAY_ACCOUNT_STATE') {
            const [active, pending] = await Promise.all([
              getPortalAccount(userId, host, applicationId, email),
              getPendingPortalAccount(userId, host, applicationId, email),
            ]);
            sendResponse({ active, pending, authEpoch: operationAuthEpoch });
            return;
          }
          if (message.type === 'VALIDATE_WORKDAY_ACCOUNT_ACTION') {
            const claimedEpoch = Number(message.payload?.authEpoch);
            const action = message.payload?.action === 'sign_in' ? 'sign_in' : 'create';
            const valid = claimedEpoch === operationAuthEpoch
              && authEpochIsCurrent(claimedEpoch)
              && (action === 'create'
                ? await pendingPortalAccountClaimIsCurrent(claimedEpoch, userId, host, applicationId, email)
                : Boolean(await getPortalAccount(userId, host, applicationId, email)));
            sendResponse({ valid });
            return;
          }
          if (message.type === 'CLAIM_WORKDAY_ACCOUNT') {
            const saltFingerprint = String(message.payload?.saltFingerprint ?? '');
            const requestedAt = Number(message.payload?.requestedAt);
            if (!saltFingerprint || !Number.isFinite(requestedAt)) throw new Error('The Workday account claim is incomplete.');
            const claimed = await recordPendingPortalAccount(
              { userId, host, email, applicationId, saltFingerprint, requestedAt },
              operationAuthEpoch,
            );
            sendResponse({ claimed, ...(claimed ? { authEpoch: operationAuthEpoch } : {}) });
            return;
          }
          if (message.type === 'ABANDON_WORKDAY_ACCOUNT_CLAIM') {
            sendResponse({ abandoned: await abandonPendingPortalAccount(userId, host, email, applicationId) });
            return;
          }
          sendResponse({ activated: await activatePendingPortalAccount(userId, host, email, applicationId) });
        }).catch((error) => sendResponse({
          error: error instanceof Error ? error.message : 'The Workday account operation failed.',
        }));
        return true;
      }

      case 'GET_WORKDAY_VERIFICATION_CODE': {
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          const tabId = sender.tab?.id;
          const portalUrl = sender.tab?.url;
          const identity = tabId === undefined || !portalUrl ? null : await verifyWorkdayPacketForTab(token, tabId, portalUrl);
          if (!identity) {
            sendResponse({ error: 'The Workday verification session is incomplete.' });
            return;
          }
          const pending = await getPendingPortalAccount(identity.userId, identity.host, identity.applicationId, identity.email);
          if (!pending) {
            sendResponse({ error: 'The Workday verification session is no longer active.' });
            return;
          }
          const applicationId = identity.applicationId;
          const requestedAt = new Date(pending.requestedAt).toISOString();
          try {
            for (let attempt = 0; attempt < 10; attempt += 1) {
              const response = await timeoutBackendFetch(`/applications/${applicationId}/workday-verification-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requested_at: requestedAt }),
              }, token);
              const body = await response.json().catch(() => null) as { status?: unknown; code?: unknown; provider?: unknown; error?: unknown } | null;
              if (response.ok && body?.status === 'ready' && typeof body.code === 'string') {
                sendResponse({ code: body.code, provider: body.provider });
                return;
              }
              if (response.status !== 202) {
                sendResponse({ error: typeof body?.error === 'string' ? body.error : 'Could not read the Workday verification email.' });
                return;
              }
              if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 3_000));
            }
            sendResponse({ error: 'The Workday verification email has not arrived yet. Try again when it does.' });
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : 'Could not read the Workday verification email.' });
          }
        });
        return true;
      }

      case 'CAPTCHA_STALL': {
        // Recorded locally, for the applicant. A human-verification check asks whether the person
        // in THIS session is human, so it can only be answered here, by them - there is nothing to
        // forward and nobody to forward it to.
        void recordStall({
          // The tab is the durable identity. A submission redirects to a confirmation page on a
          // different path, and the stall is cleared from THAT document, so a URL-keyed clear never
          // matches and the count only ever grows.
          tabId: sender.tab?.id,
          url: message.payload?.url ?? '',
          company: message.payload?.job_context?.company ?? '',
          role: message.payload?.job_context?.role ?? '',
          provider: message.payload?.provider ?? 'unknown',
          atsName: message.payload?.ats_name,
          stalledAt: message.payload?.stalled_at ?? new Date().toISOString(),
        }).then(() => renderBadge()).catch(() => {});
        return false;
      }

      case 'CAPTCHA_STALL_RESOLVED': {
        // The application went through, so it is no longer waiting on anyone. Without this the
        // count only ever grows and the badge becomes a number people learn to ignore.
        clearStall({ tabId: sender.tab?.id, url: message.payload?.url ?? '' })
          .then(() => renderBadge())
          .catch(() => {});
        return false;
      }

      case 'AUTOFILL_EVENT': {
        void trackExtensionEvent('application_fill_completed', message.payload);
        getStoredToken().then((token) => {
          if (!token) return;
          timeoutBackendFetch('/autofill/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.payload),
          }, token).catch(() => {});
        });
        return false;
      }

      case 'APPLICATION_PACKET_REVIEW_REQUIRED': {
        const reviewAuthEpoch = currentAuthEpoch();
        const payload = message.payload as {
          applicationId?: string;
        };
        getStoredToken().then(async (token) => {
          if (!token) throw new Error(NOT_SIGNED_IN_MESSAGE);
          const applicationId = String(payload.applicationId ?? '');
          if (!/^[0-9a-f-]{36}$/i.test(applicationId) || !sender.url) {
            throw new Error('The saved application packet could not be identified.');
          }
          assertCurrentAuthEpoch(reviewAuthEpoch);
          await chrome.tabs.create({
            url: `https://trylitos.com/dashboard/applications?application=${encodeURIComponent(applicationId)}`,
            active: true,
          });
          assertCurrentAuthEpoch(reviewAuthEpoch);
          sendResponse({ ok: true });
        }).catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'The exact packet review could not open.',
        }));
        return true;
      }

      case 'APPLICATION_REVIEW_READY': {
        const reviewAuthEpoch = currentAuthEpoch();
        const tabId = sender.tab?.id;
        getStoredToken().then(async (token) => {
          if (!token || tabId === undefined) {
            sendResponse({ error: 'The application tab is no longer available.' });
            return;
          }
          const payload = message.payload as {
            applicationId: string;
            atsName: string;
            portalUrl: string;
            attendedHandoff?: boolean;
            openDashboard?: boolean;
            questions: Array<{ id: string; question: string; answer: string; kind: 'essay' | 'required'; required: boolean }>;
            skippedReasons: string[];
          };
          try {
            assertCurrentAuthEpoch(reviewAuthEpoch);
            const frameId = sender.frameId ?? 0;
            const existingHandoffBinding = await handoffPacketBinding(payload.applicationId, tabId, frameId);
            if (payload.attendedHandoff === true && !existingHandoffBinding) throw new Error('Reload this saved application before reviewing it from Chrome.');
            // An attended handoff is already a frozen, reviewed packet. Writing its form state back
            // through PUT /review here would mutate the packet after GET and invalidate the exact
            // PDF/spec/answer version that must be echoed at extension-start.
            if (payload.attendedHandoff !== true) {
              const res = await timeoutBackendFetch(`/applications/${payload.applicationId}/review`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ats_name: payload.atsName,
                  portal_url: payload.portalUrl,
                  questions: payload.questions,
                  skipped_reasons: payload.skippedReasons,
                }),
              }, token);
              assertCurrentAuthEpoch(reviewAuthEpoch);
              if (!res.ok) throw new Error(`review handoff failed (${res.status})`);
            }
            const currentUrl = sender.url ?? '';
            if (!currentUrl) throw new Error('Litos could not verify the current application page.');
            const exactResume = payload.attendedHandoff === true
              ? undefined
              : await fetchAndBindHandoffPacket({
                applicationId: payload.applicationId,
                currentUrl,
                tabId,
                frameId,
                token,
                authEpoch: reviewAuthEpoch,
              });
            assertCurrentAuthEpoch(reviewAuthEpoch);
            const handoffBinding = await handoffPacketBinding(payload.applicationId, tabId, frameId);
            if (!handoffBinding) throw new Error('The exact application packet binding was not saved.');
            await applicationTabMutations.run(APPLICATION_TAB_MUTATION_KEY, async () => {
              assertCurrentAuthEpoch(reviewAuthEpoch);
              const stored = await chrome.storage.session.get('litos_application_tabs');
              assertCurrentAuthEpoch(reviewAuthEpoch);
              const tabs = (stored.litos_application_tabs ?? {}) as Record<string, number | {
                tabId: number;
                frameId: number;
                currentUrl?: string;
                handoffVersion?: string;
                attendedHandoff?: boolean;
              }>;
              await chrome.storage.session.set({
                litos_application_tabs: {
                  ...tabs,
                  [payload.applicationId]: {
                    tabId,
                    frameId,
                    currentUrl: handoffBinding.currentUrl,
                    handoffVersion: handoffBinding.handoffVersion,
                    attendedHandoff: payload.attendedHandoff === true,
                  },
                },
              });
              if (!authEpochIsCurrent(reviewAuthEpoch)) {
                await chrome.storage.session.remove('litos_application_tabs');
                assertCurrentAuthEpoch(reviewAuthEpoch);
              }
            });
            assertCurrentAuthEpoch(reviewAuthEpoch);
            if (payload.openDashboard !== false) {
              assertCurrentAuthEpoch(reviewAuthEpoch);
              await chrome.tabs.create({
                url: `https://trylitos.com/dashboard/applications?application=${encodeURIComponent(payload.applicationId)}`,
                active: true,
              });
            }
            sendResponse({ ok: true, resume: exactResume });
          } catch (error) {
            sendResponse({ error: error instanceof Error ? error.message : 'Could not prepare dashboard review.' });
          }
        });
        return true;
      }

      // Fields the student typed by hand into a real application during onboarding. The content
      // script has no token and no host_permissions, so every write goes through here.
      //
      // Answers { stop: true } when the backend says harvest is over (403 = onboarding complete),
      // which latches the content script off for the page's lifetime. Without that the extension
      // would keep POSTing into a 403 on every keystroke of every application, forever.
      case 'HARVEST_FIELDS': {
        harvestFields(message.fields).then(sendResponse);
        return true; // async: see the convention note above - only async branches return true.
      }

      case 'PREPARE_GATED_ATTENDED_HANDOFF': {
        const preparationAuthEpoch = currentAuthEpoch();
        const currentUrl = sender.url ?? '';
        const currentIdentity = gatedAttendedIdentity(currentUrl);
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        if (!currentIdentity || tabId === undefined) {
          sendResponse({ ok: false, error: 'This is not an exact supported Jobvite or iCIMS application route.' });
          return false;
        }
        getStoredToken().then(async (token) => {
          if (!token) throw new Error(NOT_SIGNED_IN_MESSAGE);
          assertCurrentAuthEpoch(preparationAuthEpoch);
          const armed = await armedHandoffMutations.run(ARMED_HANDOFF_MUTATION_KEY, async () => {
            const entries = pruneArmed(await readArmedHandoffs(), Date.now());
            return entries.find((entry) => {
              const armedIdentity = gatedAttendedIdentity(entry.key);
              return Boolean(entry.applicationId && armedIdentity?.family === currentIdentity.family && armedIdentity.key === currentIdentity.key);
            }) ?? null;
          });
          // Dashboard Free fill is a saved factual-fill request, not an immutable paid packet.
          // Keep the one-shot arm available through any Jobvite or iCIMS account gate, and let the
          // application-stage content script claim it only when the real form is ready.
          if (armed && armedHandoffMode(armed) === 'free_fill') {
            // A packet continuation from an older dashboard action must not survive and wake up
            // after this newer Free fill has been consumed.
            await withGatedContinuationMutation(gatedContinuationKey(tabId, frameId), () =>
              chrome.storage.session.remove(gatedContinuationKey(tabId, frameId)));
            assertCurrentAuthEpoch(preparationAuthEpoch);
            sendResponse({ ok: true, mode: 'free_fill', applicationId: armed.applicationId });
            return;
          }
          const existing = await gatedAttendedContinuation(tabId, frameId);
          if (
            existing
            && existing.identity === currentIdentity.key
            && Date.now() - existing.preparedAt <= GATED_ATTENDED_CONTINUATION_TTL_MS
            && !newArmingSupersedesContinuation(existing.applicationId, armed?.applicationId)
          ) {
            assertCurrentAuthEpoch(preparationAuthEpoch);
            sendResponse({
              ok: true,
              applicationId: existing.applicationId,
              email: existing.applicantEmail,
              handoffVersion: existing.handoffVersion,
            });
            return;
          }
          if (existing && newArmingSupersedesContinuation(existing.applicationId, armed?.applicationId)) {
            await withGatedContinuationMutation(gatedContinuationKey(tabId, frameId), () =>
              chrome.storage.session.remove(gatedContinuationKey(tabId, frameId)));
          }
          const preparationKey = `${tabId}:${frameId}:${currentIdentity.key}`;
          if (gatedPreparationsInFlight.has(preparationKey)) throw new Error('This exact application is already being prepared.');
          gatedPreparationsInFlight.add(preparationKey);
          try {
            const claimed = armed;
            if (!claimed?.applicationId) throw new Error('Open this exact application from your Litos Tracker before continuing.');
            const applicationId = claimed.applicationId;
            const resume = await fetchAndBindHandoffPacket({
              applicationId,
              currentUrl,
              tabId,
              frameId,
              token,
              publishBinding: false,
              authEpoch: preparationAuthEpoch,
            });
            const email = applicantEmailForGeneratedPacket(resume);
            if (!email) throw new Error('The saved application packet has no verified applicant email.');
            assertCurrentAuthEpoch(preparationAuthEpoch);
            await consumeArmedAndStoreGatedContinuation({
              applicationId,
              tabId,
              frameId,
              identity: currentIdentity.key,
              preparedAt: Date.now(),
              handoffVersion: resume.handoff_version!,
              applicantEmail: email,
            }, preparationAuthEpoch);
            assertCurrentAuthEpoch(preparationAuthEpoch);
            sendResponse({ ok: true, applicationId, email, handoffVersion: resume.handoff_version });
          } finally {
            gatedPreparationsInFlight.delete(preparationKey);
          }
        }).catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'The exact attended application could not be prepared.',
        }));
        return true;
      }

      case 'CLAIM_GATED_ATTENDED_CONTINUATION': {
        const claimAuthEpoch = currentAuthEpoch();
        const currentUrl = sender.url ?? '';
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        if (tabId === undefined) {
          sendResponse({ armed: false });
          return false;
        }
        Promise.all([
          getStoredToken(),
          claimGatedAttendedContinuation(tabId, frameId, currentUrl, sender.documentId),
        ])
          .then(([token, continuation]) => {
            if (!token) throw new Error(NOT_SIGNED_IN_MESSAGE);
            assertCurrentAuthEpoch(claimAuthEpoch);
            sendResponse({
            armed: Boolean(continuation),
            applicationId: continuation?.applicationId,
            handoffVersion: continuation?.handoffVersion,
            applicantEmail: continuation?.applicantEmail,
            });
          })
          .catch(() => sendResponse({ armed: false }));
        return true;
      }

      case 'PROVE_GATED_ATTENDED_ACCOUNT': {
        const proofAuthEpoch = currentAuthEpoch();
        const currentUrl = sender.url ?? '';
        const identity = gatedAttendedIdentity(currentUrl);
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        const proofKind = message.proofKind === 'security_code' ? 'security_code' : 'login_email';
        const email = String(message.email ?? '').trim().toLowerCase();
        const proofDocumentId = sender.documentId;
        if (!identity || identity.family !== 'icims' || tabId === undefined || !proofDocumentId) {
          sendResponse({ ok: false });
          return false;
        }
        const key = gatedContinuationKey(tabId, frameId);
        withGatedContinuationMutation(key, async () => {
          const continuation = await gatedAttendedContinuation(tabId, frameId);
          if (
            !continuation
            || continuation.identity !== identity.key
            || (proofKind === 'login_email' && continuation.applicantEmail.trim().toLowerCase() !== email)
            || (proofKind === 'security_code' && !validGatedAccountNavigationProof({
              family: 'icims',
              loginProofAt: continuation.accountLoginProofAt,
              loginProofDocumentId: continuation.accountLoginProofDocumentId,
              currentDocumentId: proofDocumentId,
              now: Date.now(),
              ttlMs: GATED_ATTENDED_ACCOUNT_PROOF_TTL_MS,
            }))
            || Date.now() - continuation.preparedAt > GATED_ATTENDED_CONTINUATION_TTL_MS
            || !authEpochIsCurrent(proofAuthEpoch)
          ) throw new Error('The exact iCIMS account proof no longer matches this application.');
          const proofAt = Date.now();
          await chrome.storage.session.set({
            [key]: proofKind === 'login_email'
              ? {
                ...continuation,
                accountLoginProofAt: proofAt,
                accountLoginProofDocumentId: proofDocumentId,
                securityCodeProofAt: undefined,
                securityCodeProofDocumentId: undefined,
              }
              : {
                ...continuation,
                securityCodeProofAt: proofAt,
                securityCodeProofDocumentId: proofDocumentId,
              },
          });
          if (!authEpochIsCurrent(proofAuthEpoch)) {
            await chrome.storage.session.remove(key);
            assertCurrentAuthEpoch(proofAuthEpoch);
          }
        }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;
      }

      case 'INVALIDATE_GATED_ATTENDED_CONTINUATION': {
        const tabId = sender.tab?.id;
        const frameId = sender.frameId ?? 0;
        if (tabId === undefined) {
          sendResponse({ ok: false });
          return false;
        }
        withGatedContinuationMutation(gatedContinuationKey(tabId, frameId), async () => {
          await chrome.storage.session.remove(gatedContinuationKey(tabId, frameId));
        }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;
      }

      // "Did the applicant arrive here by clicking Finish this one?" Answered once and then
      // forgotten (claimArmed removes the entry), so a later visit to the same posting is an
      // ordinary visit and the card asks before touching anything.
      case 'CLAIM_HANDOFF': {
        // Two candidates, because the content script runs in all frames and the frame that finds
        // the form is often not the page the applicant navigated to (Greenhouse and Workday both
        // embed the application in a cross-origin iframe, where location.href is the ATS's url and
        // the employer's is unreachable from script). The sender's TAB url is the one the dashboard
        // armed, and only the background can see it.
        const candidates = [
          typeof message.url === 'string' ? message.url : '',
          sender.tab?.url ?? '',
        ].filter(Boolean);
        armedHandoffMutations.run(ARMED_HANDOFF_MUTATION_KEY, async () => {
            const entries = await readArmedHandoffs();
            let pool = entries;
            let hit: ReturnType<typeof claimArmed>['claimed'] = null;
            for (const candidate of candidates) {
              const { claimed, remaining } = claimArmed(pool, candidate, Date.now());
              pool = remaining;
              if (claimed) {
                hit = claimed;
                break;
              }
            }
            if (pool.length !== entries.length) await writeArmedHandoffs(pool);
            return {
              armed: Boolean(hit),
              applicationId: hit?.applicationId,
              mode: hit ? armedHandoffMode(hit) : undefined,
            };
          })
          .then(sendResponse)
          .catch(() => sendResponse({ armed: false }));
        return true;
      }

      case 'CONTINUE_SMARTRECRUITERS_HANDOFF': {
        const sourceUrl = sender.tab?.url ?? '';
        const targetUrl = String(message.targetUrl ?? '');
        armedHandoffMutations.run(ARMED_HANDOFF_MUTATION_KEY, async () => {
            const entries = await readArmedHandoffs();
            const continued = continueSmartRecruitersHandoff(entries, sourceUrl, targetUrl, Date.now());
            await writeArmedHandoffs(continued.remaining);
            return { ok: Boolean(continued.applicationId) };
          })
          .then(sendResponse)
          .catch(() => sendResponse({ ok: false }));
        return true;
      }

      default:
        return false;
    }
  });

  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    const origin = (() => {
      try {
        return sender.url ? new URL(sender.url).origin : '';
      } catch {
        return '';
      }
    })();
    const allowed =
      origin === 'https://trylitos.com' ||
      origin === 'https://www.trylitos.com' ||
      (import.meta.env.DEV && /^http:\/\/localhost(?::\d+)?$/.test(origin));
    if (!allowed) {
      sendResponse({ error: 'This page is not allowed to control Litos.' });
      return false;
    }
    if (respondToClearSessionMessage(message, sendResponse)) return true;
    if (message?.type === 'LITOS_START_FREE_FILL') {
      prepareFreeFillHandoff(message, {
        currentAuthEpoch,
        authEpochIsCurrent,
        getToken: getStoredToken,
        readAccount: async (token, authEpoch) => {
          try {
            return await refreshEntitlementSnapshot(token, authEpoch);
          } catch (error) {
            if (isLitosApiError(error) && (error.status === 401 || error.status === 403)) {
              throw new FreeFillHandoffRequestError(
                'authentication_required',
                'Sign in to Litos in the extension first.',
              );
            }
            throw error;
          }
        },
        readFillData: ownedFreeFillHandoffData,
      })
        .then(async (result) => {
          if (!result.ok) return result;
          return armedHandoffMutations.run(ARMED_HANDOFF_MUTATION_KEY, async () => {
            if (!authEpochIsCurrent(result.authEpoch)) {
              return {
                ok: false as const,
                error: 'The Litos account changed while this application was being opened.',
                code: 'account_changed' as const,
              };
            }
            const existing = await readArmedHandoffs();
            if (!authEpochIsCurrent(result.authEpoch)) {
              return {
                ok: false as const,
                error: 'The Litos account changed while this application was being opened.',
                code: 'account_changed' as const,
              };
            }
            const next = armHandoffs(existing, [{
              url: result.portalUrl,
              applicationId: result.applicationId,
              mode: 'free_fill',
            }], Date.now());
            await writeArmedHandoffs(next);
            if (!authEpochIsCurrent(result.authEpoch)) {
              const current = await readArmedHandoffs();
              await writeArmedHandoffs(current.filter((entry) => !(
                entry.applicationId === result.applicationId
                && armedHandoffMode(entry) === 'free_fill'
              )));
              return {
                ok: false as const,
                error: 'The Litos account changed while this application was being opened.',
                code: 'account_changed' as const,
              };
            }
            return { ok: true as const, armed: true as const };
          });
        })
        .then(sendResponse)
        .catch(() => sendResponse({
          ok: false,
          error: 'Litos could not open this saved application. Try again.',
          code: 'handoff_failed',
        }));
      return true;
    }
    if (message?.type === 'LITOS_CREATE_CHECKOUT') {
      const planId = typeof message.plan_id === 'string' ? message.plan_id : '';
      const validPlan = planId === 'litos_plus_week'
        || planId === 'litos_plus_month'
        || planId === 'litos_plus_quarter';
      const trigger = typeof message.trigger === 'string'
        ? message.trigger.trim().slice(0, 120)
        : 'extension_pricing';
      const placement = typeof message.placement === 'string'
        ? message.placement.trim().slice(0, 120)
        : 'public_pricing';
      const actionNonce = validPremiumActionNonce(message.action_nonce) ? message.action_nonce : null;
      const actionFeature = premiumActionFeatureForTrigger(trigger);
      if (!validPlan || message.surface !== 'extension') {
        sendResponse({ ok: false, error: 'The selected Litos+ term is invalid.', code: 'invalid_plan' });
        return false;
      }
      const checkoutAuthEpoch = currentAuthEpoch();
      getStoredToken()
        .then(async (token) => {
          if (!token) return { ok: false, error: 'Sign in to Litos in the extension first.', code: 'authentication_required' };
          assertCurrentAuthEpoch(checkoutAuthEpoch);
          const checkoutOwner = await refreshEntitlementSnapshot(token, checkoutAuthEpoch);
          assertCurrentAuthEpoch(checkoutAuthEpoch);
          if (actionFeature && !actionNonce) {
            return {
              ok: false,
              error: 'This checkout lost the action that opened it. Return to the extension and try again.',
              code: 'checkout_action_missing',
            };
          }
          let pendingAction: PendingExtensionPremiumAction | null = null;
          if (actionNonce) {
            pendingAction = await pendingExtensionPremiumAction();
            if (
              !pendingAction
              || pendingAction.action_nonce !== actionNonce
              || pendingAction.account_id !== checkoutOwner.account_id
              || (actionFeature !== null && pendingAction.feature_key !== actionFeature)
            ) {
              return {
                ok: false,
                error: 'This checkout no longer matches the saved extension action.',
                code: 'checkout_action_mismatch',
              };
            }
            const serverAction = await readServerPremiumAction(token, actionNonce, checkoutAuthEpoch);
            pendingAction = await storeVerifiedPremiumActionExpiry(
              pendingAction,
              serverAction,
              ['pending'],
              checkoutAuthEpoch,
            );
            if (!pendingAction) {
              return {
                ok: false,
                error: 'Litos could not verify the saved extension action.',
                code: 'checkout_action_mismatch',
              };
            }
          }
          const idempotencyKey = crypto.randomUUID();
          const response = await timeoutBackendFetch('/billing/checkout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
              plan_id: planId,
              surface: 'extension',
              placement,
              trigger,
              idempotency_key: idempotencyKey,
              ...(actionNonce ? { action_nonce: actionNonce } : {}),
            }),
          }, token);
          assertCurrentAuthEpoch(checkoutAuthEpoch);
          if (response.status === 202) {
            return {
              ok: false,
              error: 'Stripe checkout is still being prepared. Try again in a moment.',
              code: 'checkout_creating',
            };
          }
          if (!response.ok) {
            const error = await apiErrorFromResponse(response);
            return { ok: false, error: error.message, code: error.body.code };
          }
          const body = await response.json().catch(() => null) as { checkout_url?: unknown; offer_id?: unknown } | null;
          if (typeof body?.checkout_url !== 'string' || typeof body.offer_id !== 'string' || !body.offer_id) {
            return { ok: false, error: 'Stripe checkout did not return a secure URL.', code: 'unsafe_checkout_url' };
          }
          const checkoutUrl = new URL(body.checkout_url);
          if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
            return { ok: false, error: 'Stripe checkout returned an unsafe URL.', code: 'unsafe_checkout_url' };
          }
          const serverOffer = await readServerCheckoutOffer(token, body.offer_id, checkoutAuthEpoch);
          const checkoutExpiresAt = verifiedServerCheckoutExpiry(
            serverOffer,
            body.offer_id,
            planId,
          );
          if (checkoutExpiresAt === null) {
            return {
              ok: false,
              error: 'Litos could not verify the checkout expiry.',
              code: 'checkout_context_mismatch',
            };
          }
          if (pendingAction && actionNonce) {
            const serverAction = await readServerPremiumAction(token, actionNonce, checkoutAuthEpoch);
            const actionExpiresAt = verifiedServerPremiumActionExpiry(pendingAction, serverAction, ['pending']);
            if (serverAction.offer_id !== body.offer_id || actionExpiresAt !== checkoutExpiresAt) {
              return {
                ok: false,
                error: 'Litos could not verify the checkout action expiry.',
                code: 'checkout_action_mismatch',
              };
            }
            pendingAction = { ...pendingAction, expires_at: actionExpiresAt };
            await storeExtensionPremiumAction(pendingAction, checkoutAuthEpoch);
          }
          await chrome.storage.session.set({
            litos_pending_checkout: {
              plan_id: planId,
              trigger,
              offer_id: body.offer_id,
              account_id: checkoutOwner.account_id,
              ...(actionNonce ? { action_nonce: actionNonce } : {}),
              created_at: Date.now(),
              expires_at: checkoutExpiresAt,
            },
          });
          if (!authEpochIsCurrent(checkoutAuthEpoch)) {
            await chrome.storage.session.remove('litos_pending_checkout');
          }
          assertCurrentAuthEpoch(checkoutAuthEpoch);
          return {
            ok: true,
            checkout_url: checkoutUrl.toString(),
            expires_at: new Date(checkoutExpiresAt).toISOString(),
          };
        })
        .then(sendResponse)
        .catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Checkout could not open.',
          code: 'checkout_failed',
        }));
      return true;
    }
    if (message?.type === 'LITOS_RETRY_PREMIUM_ACTION') {
      const actionNonce = validPremiumActionNonce(message.action_nonce) ? message.action_nonce : '';
      if (!actionNonce) {
        sendResponse({ ok: false, error: 'This saved action is invalid.', code: 'invalid_action_nonce' });
        return false;
      }
      const retryAuthEpoch = currentAuthEpoch();
      getStoredToken()
        .then(async (token) => {
          if (!token) {
            return { ok: false, error: 'Sign in to Litos in the extension first.', code: 'authentication_required' };
          }
          assertCurrentAuthEpoch(retryAuthEpoch);
          const snapshot = await refreshEntitlementSnapshot(token, retryAuthEpoch);
          assertCurrentAuthEpoch(retryAuthEpoch);
          const [pendingAction, checkoutStored] = await Promise.all([
            pendingExtensionPremiumAction(),
            chrome.storage.session.get('litos_pending_checkout'),
          ]);
          const pendingCheckout = parsePendingExtensionCheckout(checkoutStored.litos_pending_checkout);
          if (
            !pendingAction
            || pendingAction.action_nonce !== actionNonce
            || pendingAction.account_id !== snapshot.account_id
            || !pendingCheckout
            || pendingCheckout.action_nonce !== actionNonce
            || pendingCheckout.account_id !== snapshot.account_id
          ) {
            return {
              ok: false,
              error: 'This paid action is no longer bound to the extension account that started it.',
              code: 'checkout_action_mismatch',
            };
          }
          const [serverAction, serverOffer] = await Promise.all([
            readServerPremiumAction(token, actionNonce, retryAuthEpoch),
            readServerCheckoutOffer(token, pendingCheckout.offer_id, retryAuthEpoch),
          ]);
          const checkoutExpiresAt = verifiedServerCheckoutExpiry(
            serverOffer,
            pendingCheckout.offer_id,
            pendingCheckout.plan_id,
          );
          const actionExpiresAt = verifiedServerPremiumActionExpiry(
            pendingAction,
            serverAction,
            ['pending', 'consumed'],
          );
          if (
            serverAction.offer_id !== pendingCheckout.offer_id
            || checkoutExpiresAt === null
            || actionExpiresAt !== checkoutExpiresAt
          ) {
            return {
              ok: false,
              error: 'This paid offer does not match the saved extension action.',
              code: 'checkout_action_mismatch',
            };
          }
          const verifiedPendingAction = { ...pendingAction, expires_at: actionExpiresAt };
          const verifiedPendingCheckout = { ...pendingCheckout, expires_at: checkoutExpiresAt };
          await Promise.all([
            storeExtensionPremiumAction(verifiedPendingAction, retryAuthEpoch),
            chrome.storage.session.set({ litos_pending_checkout: verifiedPendingCheckout }),
          ]);
          assertCurrentAuthEpoch(retryAuthEpoch);
          if (!featureEnabled(snapshot, verifiedPendingAction.feature_key)) {
            return {
              ok: false,
              error: 'Litos+ is not active for this saved action yet.',
              code: 'action_not_entitled',
            };
          }
          const consumeResponse = await timeoutBackendFetch(
            `/billing/actions/${encodeURIComponent(actionNonce)}/consume`,
            { method: 'POST' },
            token,
          );
          assertCurrentAuthEpoch(retryAuthEpoch);
          if (!consumeResponse.ok) throw await apiErrorFromResponse(consumeResponse);
          const consumed = await consumeResponse.json().catch(() => null) as {
            consumed?: unknown;
            offer_id?: unknown;
            feature_key?: unknown;
            application_id?: unknown;
            job_id?: unknown;
            contact_id?: unknown;
          } | null;
          if (
            consumed?.consumed !== true
            || consumed.offer_id !== verifiedPendingCheckout.offer_id
            || consumed.feature_key !== verifiedPendingAction.feature_key
            || (typeof consumed.application_id === 'string'
              ? consumed.application_id.toLowerCase()
              : undefined) !== verifiedPendingAction.application_id
            || (typeof consumed.job_id === 'string'
              ? consumed.job_id.toLowerCase()
              : undefined) !== verifiedPendingAction.job_id
            || (typeof consumed.contact_id === 'string'
              ? consumed.contact_id.toLowerCase()
              : undefined) !== verifiedPendingAction.contact_id
          ) {
            return {
              ok: false,
              error: 'Litos returned a different action than the one you confirmed.',
              code: 'checkout_action_mismatch',
            };
          }
          const consumedPending = { ...verifiedPendingAction, consumed_at: Date.now() };
          await storeExtensionPremiumAction(consumedPending, retryAuthEpoch);
          await restoreExtensionPremiumActionControl(consumedPending);
          assertCurrentAuthEpoch(retryAuthEpoch);
          await chrome.storage.session.remove('litos_pending_checkout');
          return { ok: true, opened: true };
        })
        .then(sendResponse)
        .catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'The saved action could not be reopened.',
          ...(isLitosApiError(error) ? { code: error.body.code } : {}),
        }));
      return true;
    }
    if (
      message?.type === 'LITOS_ENTITLEMENTS_CHANGED'
      || message?.type === 'LITOS_CHECKOUT_RETURN'
      || message?.type === 'LITOS_LINKEDIN_RETURN'
    ) {
      const externalRefreshAuthEpoch = currentAuthEpoch();
      getStoredToken()
        .then(async (token) => {
          if (!token) return { ok: false, error: 'Sign in to refresh this account.' };
          const snapshot = await refreshEntitlementSnapshot(token, externalRefreshAuthEpoch);
          assertCurrentAuthEpoch(externalRefreshAuthEpoch);
          let checkoutActionReady = false;
          if (message?.type === 'LITOS_CHECKOUT_RETURN') {
            const stored = await chrome.storage.session.get('litos_pending_checkout');
            const pending = parsePendingExtensionCheckout(stored.litos_pending_checkout);
            const mismatch = checkoutReturnMismatch(
              pending,
              message.context,
              message.action_nonce,
              snapshot.account_id,
            );
            if (mismatch) return { ok: false, ...mismatch };
            const cancelled = typeof message.status === 'string'
              && ['cancelled', 'canceled', 'cancel'].includes(message.status.toLowerCase());
            const active = snapshot.access_class === 'plus_paid' || snapshot.access_class === 'legacy_paid';
            const serverOffer = await readServerCheckoutOffer(
              token,
              pending!.offer_id,
              externalRefreshAuthEpoch,
            );
            const checkoutExpiresAt = verifiedServerCheckoutExpiry(
              serverOffer,
              pending!.offer_id,
              pending!.plan_id,
            );
            if (checkoutExpiresAt === null) {
              return {
                ok: false,
                error: 'Litos could not verify this checkout expiry.',
                code: 'checkout_context_mismatch',
              };
            }
            const verifiedCheckout = { ...pending!, expires_at: checkoutExpiresAt };
            await chrome.storage.session.set({ litos_pending_checkout: verifiedCheckout });
            if (pending?.action_nonce) {
              const pendingAction = await pendingExtensionPremiumAction();
              if (
                !pendingAction
                || pendingAction.action_nonce !== pending.action_nonce
                || pendingAction.account_id !== snapshot.account_id
              ) {
                return {
                  ok: false,
                  error: 'This checkout no longer matches the saved extension action.',
                  code: 'checkout_action_mismatch',
                };
              }
              const serverAction = await readServerPremiumAction(
                token,
                pending.action_nonce,
                externalRefreshAuthEpoch,
              );
              const actionExpiresAt = verifiedServerPremiumActionExpiry(
                pendingAction,
                serverAction,
                ['pending', 'consumed'],
              );
              if (serverAction.offer_id !== pending.offer_id || actionExpiresAt !== checkoutExpiresAt) {
                return {
                  ok: false,
                  error: 'This paid offer does not match the saved extension action.',
                  code: 'checkout_action_mismatch',
                };
              }
              const verifiedPendingAction = { ...pendingAction, expires_at: actionExpiresAt };
              await storeExtensionPremiumAction(verifiedPendingAction, externalRefreshAuthEpoch);
              checkoutActionReady = !cancelled
                && active
                && featureEnabled(snapshot, verifiedPendingAction.feature_key);
            }
            // Cancellation clears only the offer context. The blocked action remains owner-bound
            // and restorable until its own server expiry. Paid action checkout remains until the
            // explicit Retry so repeated return verification cannot lose the offer binding.
            if (cancelled || (active && !pending?.action_nonce)) {
              await chrome.storage.session.remove('litos_pending_checkout');
            }
          }
          await chrome.runtime.sendMessage({ type: 'ENTITLEMENTS_UPDATED', snapshot }).catch(() => {});
          return {
            ok: true,
            active: snapshot.access_class === 'plus_paid' || snapshot.access_class === 'legacy_paid',
            access_class: snapshot.access_class,
            revision: snapshot.revision,
            account_id: snapshot.account_id,
            ...(message?.type === 'LITOS_CHECKOUT_RETURN'
              ? { action_ready: checkoutActionReady }
              : {}),
          };
        })
        .then(sendResponse)
        .catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Could not refresh access.',
          ...(isLitosApiError(error) ? { code: error.body.code } : {}),
        }));
      return true;
    }
    if (message?.type === 'LITOS_PING') {
      // `signedIn` is the whole point of the ping now: the website cannot see chrome.storage, so
      // without an answer here it has no way to know the extension is sitting there logged out.
      getStoredToken()
        .then((token) => sendResponse({ ok: true, signedIn: Boolean(token), version: chrome.runtime.getManifest().version }))
        .catch(() => sendResponse({ ok: true, signedIn: false, version: chrome.runtime.getManifest().version }));
      return true;
    }

    if (message?.type === 'LITOS_ADOPT_SESSION') {
      const token = typeof message.token === 'string' ? message.token : '';
      if (!token.trim()) {
        sendResponse({ ok: false, outcome: 'rejected', error: 'No sign-in was sent.' });
        return false;
      }
      adoptWebSession(token)
        .then(async (response) => {
          const storedToken = await getStoredToken();
          if (storedToken) await refreshEntitlementSnapshot(storedToken).catch(() => null);
          return response;
        })
        .then(sendResponse)
        .catch((error) =>
          sendResponse({ ok: false, outcome: 'rejected', error: error instanceof Error ? error.message : 'Could not sign in.' }),
        );
      return true;
    }

    if (message?.type === 'LITOS_ARM_HANDOFF') {
      const items: unknown[] = Array.isArray(message.applications) ? message.applications : [];
      const incoming = items
        .map((item) => item as { url?: unknown; applicationId?: unknown })
        .filter((item) => typeof item?.url === 'string')
        .map((item) => ({
          url: item.url as string,
          applicationId: typeof item.applicationId === 'string' ? item.applicationId : undefined,
        }));
      armedHandoffMutations.run(ARMED_HANDOFF_MUTATION_KEY, async () => {
          const existing = await readArmedHandoffs();
          const next = armHandoffs(existing, incoming, Date.now());
          await writeArmedHandoffs(next);
          return { ok: true, armed: next.length };
        })
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message?.type !== 'LITOS_SUBMIT_APPLICATION') return false;

    const dashboardAuthEpoch = currentAuthEpoch();
    const applicationId = String(message.applicationId ?? '');
    if (dashboardSubmissionsInFlight.has(applicationId)) {
      sendResponse({ error: 'This application is already being prepared for submission.' });
      return false;
    }
    dashboardSubmissionsInFlight.add(applicationId);
    Promise.all([getStoredToken(), chrome.storage.session.get('litos_application_tabs')])
      .then(async ([token, stored]) => {
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        const storedTarget = ((stored.litos_application_tabs ?? {}) as Record<string, number | {
          tabId: number;
          frameId: number;
          currentUrl?: string;
          handoffVersion?: string;
          attendedHandoff?: boolean;
        }>)[applicationId];
        const tabId = typeof storedTarget === 'number' ? storedTarget : storedTarget?.tabId;
        const frameId = typeof storedTarget === 'number' ? 0 : storedTarget?.frameId ?? 0;
        if (!token || tabId === undefined) throw new Error('That tab is no longer open. Go back to the job and start it again.');
        await requireFeature(token, 'automatic_submission');
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        const livePage = await chrome.tabs.sendMessage(tabId, {
          type: 'GET_CURRENT_APPLICATION_URL',
        }, { frameId }) as { url?: string };
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        const currentUrl = livePage?.url ?? '';
        if (!currentUrl) throw new Error('Litos could not verify the current application page.');
        const exactResume = await fetchAndBindHandoffPacket({
          applicationId,
          currentUrl,
          tabId,
          frameId,
          token,
          publishBinding: false,
          authEpoch: dashboardAuthEpoch,
        });
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        const prepared = await chrome.tabs.sendMessage(tabId, {
          type: 'PREPARE_SUBMISSION_FROM_DASHBOARD',
          payload: { applicationId, resume: exactResume, expectedUrl: currentUrl },
        }, { frameId }) as { ok?: boolean; error?: string };
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        if (!prepared?.ok) throw new Error(prepared?.error ?? 'The saved answers could not be replayed on the company form.');
        const verifiedPage = await chrome.tabs.sendMessage(tabId, {
          type: 'GET_CURRENT_APPLICATION_URL',
        }, { frameId }) as { url?: string };
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        const verifiedCurrentUrl = verifiedPage?.url ?? '';
        const fetchedPageKey = applicationFormIdentityKey(currentUrl);
        const verifiedPageKey = applicationFormIdentityKey(verifiedCurrentUrl);
        if (
          !verifiedCurrentUrl
          || !fetchedPageKey
          || !verifiedPageKey
          || verifiedPageKey !== fetchedPageKey
        ) throw new Error('The company form changed while the exact packet was being replayed. Nothing was sent.');
        const verifiedResume = await fetchAndBindHandoffPacket({
          applicationId,
          currentUrl: verifiedCurrentUrl,
          tabId,
          frameId,
          token,
          publishBinding: false,
          authEpoch: dashboardAuthEpoch,
        });
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        if (verifiedResume.handoff_version !== exactResume.handoff_version
          || verifiedResume.packet_audit?.packet_version !== exactResume.packet_audit?.packet_version
          || verifiedResume.packet_audit?.audit_digest !== exactResume.packet_audit?.audit_digest
          || verifiedResume.packet_audit?.bindings.pdf.sha256 !== exactResume.packet_audit?.bindings.pdf.sha256
          || verifiedResume.packet_audit?.bindings.pdf.sizeBytes !== exactResume.packet_audit?.bindings.pdf.sizeBytes) {
          throw new Error('The saved application changed while it was being replayed. Nothing was sent.');
        }
        await storeHandoffPacketBinding({
          applicationId,
          tabId,
          frameId,
          currentUrl: verifiedCurrentUrl,
          handoffVersion: exactResume.handoff_version!,
          packetVersion: exactResume.packet_audit!.packet_version,
          auditDigest: exactResume.packet_audit!.audit_digest,
          pdfSha256: exactResume.packet_audit!.bindings.pdf.sha256,
          pdfSizeBytes: exactResume.packet_audit!.bindings.pdf.sizeBytes,
        }, dashboardAuthEpoch);
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        const startResponse = await timeoutBackendFetch(`/applications/${applicationId}/submission/extension-start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authorization: 'user_initiated',
            handoff_version: exactResume.handoff_version,
            current_url: verifiedCurrentUrl,
          }),
        }, token);
        const started = await startResponse.json().catch(() => null) as { claim_id?: string; error?: string } | null;
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        if (!startResponse.ok || !started?.claim_id) throw new Error(started?.error ?? 'Could not reserve this application.');
        const pending: PendingExtensionSubmission = {
          applicationId,
          claimId: started.claim_id,
          startedAt: Date.now(),
          frameId,
          packetVersion: exactResume.packet_audit!.packet_version,
          auditDigest: exactResume.packet_audit!.audit_digest,
        };
        await setPendingSubmission(tabId, pending, dashboardAuthEpoch);
        assertCurrentAuthEpoch(dashboardAuthEpoch);
        try {
          assertCurrentAuthEpoch(dashboardAuthEpoch);
          const result = await chrome.tabs.sendMessage(tabId, {
            type: 'SUBMIT_FROM_DASHBOARD',
            payload: { applicationId, questions: [] },
          }, { frameId }) as { ok?: boolean; clicked?: boolean; error?: string; finalUrl?: string; confirmationText?: string };
          assertCurrentAuthEpoch(dashboardAuthEpoch);
          await postExtensionOutcome(
            pending,
            result?.ok ? 'confirmed' : result?.clicked ? 'unknown' : 'cancelled',
            result?.finalUrl ?? sender.url ?? 'https://trylitos.com',
            result?.confirmationText ?? result?.error,
          );
          assertCurrentAuthEpoch(dashboardAuthEpoch);
          await setPendingSubmission(tabId, null);
          if (!result?.ok) {
            sendResponse({ error: result?.error ?? 'The company never confirmed it arrived.' });
            return;
          }
          sendResponse({ ok: true });
        } catch (error) {
          try {
            await postExtensionOutcome(pending, 'unknown', sender.url ?? 'https://trylitos.com');
            await setPendingSubmission(tabId, null);
          } catch {
            // Retain the pending claim so a later tab wake can safely reconcile it.
          }
          throw error;
        }
      })
      .catch((error) => sendResponse({
        error: error instanceof Error ? error.message : 'Submission failed.',
        ...(isLitosApiError(error) ? { api_error: serializeLitosApiError(error) } : {}),
      }))
      .finally(() => dashboardSubmissionsInFlight.delete(applicationId));
    return true;
  });
});
