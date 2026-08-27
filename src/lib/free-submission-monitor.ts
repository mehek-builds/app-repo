import {
  applicationFormIdentityKey,
} from './web-handoff';

export const FREE_SUBMISSION_MONITOR_TTL_MS = 2 * 60_000;
export const FREE_SUBMISSION_OUTCOME_TIMEOUT_MS = 60_000;

export type PendingFreeSubmissionMonitor = {
  eventId: string;
  applicationId: string;
  tabId: number;
  frameId: number;
  accountId: string;
  authEpoch: number;
  startUrl: string;
  startedAt: number;
  boundaryLeaseId: string | null;
  boundaryActivationId: string | null;
  boundaryExpiresAt: number | null;
};

export type FreeSubmissionMonitorDisposition = 'resume' | 'force_unknown' | 'expired';

export function bindFreeSubmissionOutcome(input: {
  pending: PendingFreeSubmissionMonitor;
  eventId: string;
  applicationId: string;
  outcome: 'confirmed' | 'failed' | 'unknown';
  finalUrl: string;
  confirmationText: string;
  disposition: FreeSubmissionMonitorDisposition;
}) {
  const exactAttempt = input.pending.eventId === input.eventId
    && input.pending.applicationId === input.applicationId;
  if (
    exactAttempt
    && (input.disposition === 'resume'
      || (input.disposition === 'expired' && input.outcome === 'confirmed'))
  ) {
    return {
      eventId: input.eventId,
      applicationId: input.applicationId,
      leaseId: input.pending.boundaryLeaseId,
      activationId: input.pending.boundaryActivationId,
      outcome: input.outcome,
      finalUrl: input.finalUrl,
      confirmationText: input.confirmationText,
    };
  }
  return {
    eventId: input.pending.eventId,
    applicationId: input.pending.applicationId,
    leaseId: input.pending.boundaryLeaseId,
    activationId: input.pending.boundaryActivationId,
    outcome: 'unknown' as const,
    finalUrl: input.pending.startUrl,
    confirmationText: '',
  };
}

export function freeSubmissionNavigationMatches(startUrl: string, currentUrl: string): boolean {
  const startIdentity = applicationFormIdentityKey(startUrl);
  const currentIdentity = applicationFormIdentityKey(currentUrl);
  if (!startIdentity || !currentIdentity) return false;
  // applicationFormIdentityKey contains the explicit provider-specific normalizations. Once both
  // sides produce an exact form identity, a difference is terminal and must never fall through to
  // generic prefix or query-stripping rules.
  return startIdentity === currentIdentity;
}

export function freeSubmissionMonitorDisposition(input: {
  pending: PendingFreeSubmissionMonitor;
  tabId: number;
  frameId: number;
  accountId: string;
  currentAuthEpoch: number;
  currentUrl: string;
  now: number;
}): FreeSubmissionMonitorDisposition {
  const { pending } = input;
  if (input.now - pending.startedAt > FREE_SUBMISSION_MONITOR_TTL_MS) return 'expired';
  if (
    pending.tabId !== input.tabId
    || pending.frameId !== input.frameId
    || pending.accountId !== input.accountId
  ) return 'force_unknown';
  // Service-worker memory can restart at epoch zero while session storage survives. Account id is
  // authoritative in that case. Any live nonzero epoch mismatch is a real in-process account race.
  if (input.currentAuthEpoch !== 0 && pending.authEpoch !== input.currentAuthEpoch) return 'force_unknown';
  if (!freeSubmissionNavigationMatches(pending.startUrl, input.currentUrl)) return 'force_unknown';
  return 'resume';
}
