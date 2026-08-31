import { KeyedMutationQueue } from './keyed-mutation-queue';
import {
  sameExtensionSubmissionActivationIdentity,
  type ExtensionSubmissionActivationIdentity,
} from './submission-activation';

export type PendingExtensionSubmissionSettlement =
  | 'cleared'
  | 'superseded'
  | 'stale';

/**
 * Post an outcome only for the complete activation identity the caller observed, then clear that
 * same identity under the mutation queue. A newer activation may be written while the network
 * request is in flight, but the compare-and-clear step will preserve it.
 */
export async function settlePendingExtensionSubmission<
  T extends ExtensionSubmissionActivationIdentity,
>(input: {
  queue: KeyedMutationQueue;
  mutationKey: string;
  expected: ExtensionSubmissionActivationIdentity;
  read: () => Promise<T | null>;
  clear: () => Promise<void>;
  post: (pending: T) => Promise<void>;
}): Promise<PendingExtensionSubmissionSettlement> {
  const pending = await input.read();
  if (!pending || !sameExtensionSubmissionActivationIdentity(pending, input.expected)) {
    return 'stale';
  }

  await input.post(pending);
  return input.queue.run(input.mutationKey, async () => {
    const current = await input.read();
    if (!current || !sameExtensionSubmissionActivationIdentity(current, pending)) {
      return 'superseded';
    }
    await input.clear();
    return 'cleared';
  });
}
