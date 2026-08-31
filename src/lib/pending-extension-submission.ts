import { KeyedMutationQueue } from './keyed-mutation-queue';
import {
  sameOwnedExtensionSubmissionActivation,
  type OwnedExtensionSubmissionActivation,
} from './submission-activation';

// click_committed remains nonreplaceable through confirmation monitoring and outcome settlement.
export type PendingExtensionSubmissionAuthorityPhase =
  | 'reserved'
  | 'click_committed';

export type PhasedPendingExtensionSubmission<
  T extends OwnedExtensionSubmissionActivation = OwnedExtensionSubmissionActivation,
> = T & {
  submissionAuthorityPhase: PendingExtensionSubmissionAuthorityPhase;
};

export type PendingExtensionSubmissionReservation<
  T extends OwnedExtensionSubmissionActivation,
> =
  | {
    kind: 'reserved';
    pending: PhasedPendingExtensionSubmission<T>;
  }
  | {
    kind: 'occupied';
    pending: PhasedPendingExtensionSubmission<T>;
  }
  | {
    kind: 'revoked';
    pending: PhasedPendingExtensionSubmission<T>;
  };

type PendingSubmissionAuthorization<T> = (pending: T) => boolean;

/**
 * Reserve one authority lane before creating the server activation. Holding the same mutation key
 * through creation and storage means a competing start cannot create or replace another pending
 * activation, regardless of application or frame.
 */
export async function reservePendingExtensionSubmission<
  T extends OwnedExtensionSubmissionActivation,
>(input: {
  queue: KeyedMutationQueue;
  mutationKey: string;
  read: () => Promise<PhasedPendingExtensionSubmission<T> | null>;
  write: (pending: PhasedPendingExtensionSubmission<T>) => Promise<void>;
  clear: () => Promise<void>;
  create: () => Promise<T>;
  authorize: PendingSubmissionAuthorization<T>;
}): Promise<PendingExtensionSubmissionReservation<T>> {
  return input.queue.run(input.mutationKey, async () => {
    const existing = await input.read();
    if (existing) return { kind: 'occupied', pending: existing };

    const created = await input.create();
    const pending = {
      ...created,
      submissionAuthorityPhase: 'reserved' as const,
    };
    if (!input.authorize(pending)) return { kind: 'revoked', pending };
    await input.write(pending);
    if (!input.authorize(pending)) {
      await input.clear();
      return { kind: 'revoked', pending };
    }
    return { kind: 'reserved', pending };
  });
}

export type PendingExtensionSubmissionClickCommit<
  T extends OwnedExtensionSubmissionActivation,
> =
  | {
    kind: 'committed';
    pending: PhasedPendingExtensionSubmission<T>;
  }
  | { kind: 'missing' }
  | {
    kind: 'mismatch' | 'not_reserved';
    pending: PhasedPendingExtensionSubmission<T>;
  }
  | {
    kind: 'invalid';
    pending: PhasedPendingExtensionSubmission<T>;
    error: string;
  }
  | {
    kind: 'revoked';
    pending: PhasedPendingExtensionSubmission<T>;
  };

/**
 * Compare-and-set the exact stored activation from reserved to click_committed. The stored proof,
 * never a caller-provided copy, is the object passed to validation.
 */
export async function commitPendingExtensionSubmissionForClick<
  T extends OwnedExtensionSubmissionActivation,
>(input: {
  queue: KeyedMutationQueue;
  mutationKey: string;
  expected: OwnedExtensionSubmissionActivation;
  read: () => Promise<PhasedPendingExtensionSubmission<T> | null>;
  write: (pending: PhasedPendingExtensionSubmission<T>) => Promise<void>;
  authorize: PendingSubmissionAuthorization<PhasedPendingExtensionSubmission<T>>;
  validate: (
    pending: PhasedPendingExtensionSubmission<T>,
  ) => { ok: true } | { ok: false; error: string };
}): Promise<PendingExtensionSubmissionClickCommit<T>> {
  return input.queue.run(input.mutationKey, async () => {
    const pending = await input.read();
    if (!pending) return { kind: 'missing' };
    if (pending.submissionAuthorityPhase !== 'reserved') {
      return { kind: 'not_reserved', pending };
    }
    if (!input.authorize(pending)) return { kind: 'revoked', pending };

    const validation = input.validate(pending);
    if (!validation.ok) return { kind: 'invalid', pending, error: validation.error };
    if (!sameOwnedExtensionSubmissionActivation(pending, input.expected)) {
      return { kind: 'mismatch', pending };
    }

    const committed = {
      ...pending,
      submissionAuthorityPhase: 'click_committed' as const,
    };
    await input.write(committed);
    if (!input.authorize(committed)) return { kind: 'revoked', pending: committed };
    return { kind: 'committed', pending: committed };
  });
}

export type PendingExtensionSubmissionSettlement =
  | 'cleared'
  | 'superseded'
  | 'stale'
  | 'revoked';

/**
 * Post an outcome only for the complete immutable activation the caller observed, then clear that
 * same activation under the mutation queue. A different proof with the same identity is stale.
 */
export async function settlePendingExtensionSubmission<
  T extends OwnedExtensionSubmissionActivation,
>(input: {
  queue: KeyedMutationQueue;
  mutationKey: string;
  expected: OwnedExtensionSubmissionActivation;
  read: () => Promise<T | null>;
  clear: () => Promise<void>;
  post: (pending: T) => Promise<void>;
  authorize: PendingSubmissionAuthorization<T>;
}): Promise<PendingExtensionSubmissionSettlement> {
  return input.queue.run(input.mutationKey, async () => {
    const pending = await input.read();
    if (!pending || !sameOwnedExtensionSubmissionActivation(pending, input.expected)) {
      return 'stale';
    }
    if (!input.authorize(pending)) return 'revoked';

    await input.post(pending);
    if (!input.authorize(pending)) return 'revoked';
    const current = await input.read();
    if (!current || !sameOwnedExtensionSubmissionActivation(current, pending)) {
      return 'superseded';
    }
    if (!input.authorize(current)) return 'revoked';
    await input.clear();
    return 'cleared';
  });
}

export type PendingExtensionSubmissionRecovery<
  T extends OwnedExtensionSubmissionActivation,
> =
  | { kind: 'missing' }
  | { kind: 'foreign'; pending: PhasedPendingExtensionSubmission<T> }
  | { kind: 'live_reserved'; pending: PhasedPendingExtensionSubmission<T> }
  | { kind: 'cancelled_stale'; pending: PhasedPendingExtensionSubmission<T> }
  | { kind: 'recoverable'; pending: PhasedPendingExtensionSubmission<T> }
  | { kind: 'rebound'; pending: PhasedPendingExtensionSubmission<T> }
  | { kind: 'revoked'; pending: PhasedPendingExtensionSubmission<T> };

/**
 * Inspect one persisted authority from a content document. A sibling frame is always foreign. A
 * reserved authority is live only for its exact document runtime and the worker generation that
 * created its background proof. A committed click may transfer monitoring to a replacement
 * document in the same frame, but its pending generation rotates so the old document cannot settle
 * the replacement's outcome.
 */
export async function recoverPendingExtensionSubmission<
  T extends OwnedExtensionSubmissionActivation,
>(input: {
  queue: KeyedMutationQueue;
  mutationKey: string;
  read: () => Promise<PhasedPendingExtensionSubmission<T> | null>;
  write: (pending: PhasedPendingExtensionSubmission<T>) => Promise<void>;
  clear: () => Promise<void>;
  cancel: (pending: PhasedPendingExtensionSubmission<T>) => Promise<void>;
  authorize: PendingSubmissionAuthorization<PhasedPendingExtensionSubmission<T>>;
  owner: {
    tabId: number;
    frameId: number;
    documentId: string;
    documentRuntimeId: string;
  };
  currentWorkerRuntimeId: string;
  nextPendingGeneration: () => string;
}): Promise<PendingExtensionSubmissionRecovery<T>> {
  return input.queue.run(input.mutationKey, async () => {
    const pending = await input.read();
    if (!pending) return { kind: 'missing' };
    if (!input.authorize(pending)) return { kind: 'revoked', pending };

    const authority = pending.pendingAuthority;
    if (
      authority.tabId !== input.owner.tabId
      || authority.frameId !== input.owner.frameId
    ) return { kind: 'foreign', pending };

    const sameDocument = authority.documentId === input.owner.documentId
      && authority.documentRuntimeId === input.owner.documentRuntimeId;
    if (pending.submissionAuthorityPhase === 'reserved') {
      if (sameDocument && pending.monotonicProof.runtimeId === input.currentWorkerRuntimeId) {
        return { kind: 'live_reserved', pending };
      }
      await input.cancel(pending);
      if (!input.authorize(pending)) return { kind: 'revoked', pending };
      const current = await input.read();
      if (!current || !sameOwnedExtensionSubmissionActivation(current, pending)) {
        return { kind: 'foreign', pending };
      }
      await input.clear();
      return { kind: 'cancelled_stale', pending };
    }

    if (sameDocument) return { kind: 'recoverable', pending };

    const rebound = {
      ...pending,
      pendingAuthority: {
        ...authority,
        documentId: input.owner.documentId,
        documentRuntimeId: input.owner.documentRuntimeId,
        pendingGeneration: input.nextPendingGeneration(),
      },
    };
    await input.write(rebound);
    if (!input.authorize(rebound)) return { kind: 'revoked', pending: rebound };
    return { kind: 'rebound', pending: rebound };
  });
}
