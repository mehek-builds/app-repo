import { KeyedMutationQueue } from './keyed-mutation-queue';
import {
  sameExtensionSubmissionActivation,
  type ExtensionSubmissionActivation,
} from './submission-activation';

// click_committed remains nonreplaceable through confirmation monitoring and outcome settlement.
export type PendingExtensionSubmissionAuthorityPhase =
  | 'reserved'
  | 'click_committed';

export type PhasedPendingExtensionSubmission<
  T extends ExtensionSubmissionActivation = ExtensionSubmissionActivation,
> = T & {
  submissionAuthorityPhase: PendingExtensionSubmissionAuthorityPhase;
};

export type PendingExtensionSubmissionReservation<
  T extends ExtensionSubmissionActivation,
> =
  | {
    kind: 'reserved';
    pending: PhasedPendingExtensionSubmission<T>;
  }
  | {
    kind: 'occupied';
    pending: PhasedPendingExtensionSubmission<T>;
  };

/**
 * Reserve one authority lane before creating the server activation. Holding the same mutation key
 * through creation and storage means a competing start cannot create or replace another pending
 * activation, regardless of application or frame.
 */
export async function reservePendingExtensionSubmission<
  T extends ExtensionSubmissionActivation,
>(input: {
  queue: KeyedMutationQueue;
  mutationKey: string;
  read: () => Promise<PhasedPendingExtensionSubmission<T> | null>;
  write: (pending: PhasedPendingExtensionSubmission<T>) => Promise<void>;
  create: () => Promise<T>;
}): Promise<PendingExtensionSubmissionReservation<T>> {
  return input.queue.run(input.mutationKey, async () => {
    const existing = await input.read();
    if (existing) return { kind: 'occupied', pending: existing };

    const created = await input.create();
    const pending = {
      ...created,
      submissionAuthorityPhase: 'reserved' as const,
    };
    await input.write(pending);
    return { kind: 'reserved', pending };
  });
}

export type PendingExtensionSubmissionClickCommit<
  T extends ExtensionSubmissionActivation,
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
  };

/**
 * Compare-and-set the exact stored activation from reserved to click_committed. The stored proof,
 * never a caller-provided copy, is the object passed to validation.
 */
export async function commitPendingExtensionSubmissionForClick<
  T extends ExtensionSubmissionActivation,
>(input: {
  queue: KeyedMutationQueue;
  mutationKey: string;
  expected: ExtensionSubmissionActivation;
  read: () => Promise<PhasedPendingExtensionSubmission<T> | null>;
  write: (pending: PhasedPendingExtensionSubmission<T>) => Promise<void>;
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

    const validation = input.validate(pending);
    if (!validation.ok) return { kind: 'invalid', pending, error: validation.error };
    if (!sameExtensionSubmissionActivation(pending, input.expected)) {
      return { kind: 'mismatch', pending };
    }

    const committed = {
      ...pending,
      submissionAuthorityPhase: 'click_committed' as const,
    };
    await input.write(committed);
    return { kind: 'committed', pending: committed };
  });
}

export type PendingExtensionSubmissionSettlement =
  | 'cleared'
  | 'superseded'
  | 'stale';

/**
 * Post an outcome only for the complete immutable activation the caller observed, then clear that
 * same activation under the mutation queue. A different proof with the same identity is stale.
 */
export async function settlePendingExtensionSubmission<
  T extends ExtensionSubmissionActivation,
>(input: {
  queue: KeyedMutationQueue;
  mutationKey: string;
  expected: ExtensionSubmissionActivation;
  read: () => Promise<T | null>;
  clear: () => Promise<void>;
  post: (pending: T) => Promise<void>;
}): Promise<PendingExtensionSubmissionSettlement> {
  return input.queue.run(input.mutationKey, async () => {
    const pending = await input.read();
    if (!pending || !sameExtensionSubmissionActivation(pending, input.expected)) {
      return 'stale';
    }

    await input.post(pending);
    const current = await input.read();
    if (!current || !sameExtensionSubmissionActivation(current, pending)) {
      return 'superseded';
    }
    await input.clear();
    return 'cleared';
  });
}
