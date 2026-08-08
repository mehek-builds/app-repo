export const PENDING_RECOVERY_SETTLE_MS = 1_000;

export interface PendingSubmissionSnapshot {
  applicationId?: string;
  startedAt?: number;
}

export class PendingSubmissionRecoveryGate {
  private readonly localSequences = new Set<string>();

  beginLocal(applicationId: string): void {
    if (applicationId) this.localSequences.add(applicationId);
  }

  endLocal(applicationId: string): void {
    this.localSequences.delete(applicationId);
  }

  shouldRecover(pending: PendingSubmissionSnapshot, now = Date.now()): boolean {
    const applicationId = pending.applicationId;
    if (!applicationId || this.localSequences.has(applicationId)) return false;
    // A fresh reservation may belong to a local or dashboard click whose message has not reached
    // this frame yet. Retry shortly. A reloaded frame has no local marker and recovers after the
    // persisted reservation has settled.
    return pending.startedAt === undefined || now - pending.startedAt >= PENDING_RECOVERY_SETTLE_MS;
  }
}
