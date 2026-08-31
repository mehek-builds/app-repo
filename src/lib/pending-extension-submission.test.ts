import { describe, expect, it, vi } from 'vitest';
import { KeyedMutationQueue } from './keyed-mutation-queue';
import { settlePendingExtensionSubmission } from './pending-extension-submission';
import type { ExtensionSubmissionActivationIdentity } from './submission-activation';

const applicationId = '123e4567-e89b-42d3-a456-426614174000';

function activation(seed: string): ExtensionSubmissionActivationIdentity {
  return {
    applicationId,
    claimId: `${seed}23e4567-e89b-42d3-a456-426614174000`,
    activationId: `${seed}23e4567-e89b-52d3-a456-426614174001`,
    activationLeaseId: `${seed}23e4567-e89b-52d3-a456-426614174002`,
    activationExpiresAt: '2026-08-31T10:03:00.000Z',
    activationServerNow: '2026-08-31T10:00:00.000Z',
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(initial: ExtensionSubmissionActivationIdentity | null) {
  const queue = new KeyedMutationQueue();
  const mutationKey = 'tab:7';
  let stored = initial;
  return {
    queue,
    mutationKey,
    read: async () => stored,
    clear: async () => { stored = null; },
    set: (value: ExtensionSubmissionActivationIdentity) =>
      queue.run(mutationKey, async () => { stored = value; }),
    current: () => stored,
  };
}

describe('pending extension submission settlement', () => {
  it('preserves B when A outcome is in flight while B starts', async () => {
    const a = activation('2');
    const b = activation('3');
    const state = harness(a);
    const gate = deferred();
    const enteredPost = deferred();
    const settlingA = settlePendingExtensionSubmission({
      ...state,
      expected: a,
      post: async () => {
        enteredPost.resolve();
        await gate.promise;
      },
    });

    await enteredPost.promise;
    await state.set(b);
    gate.resolve();

    await expect(settlingA).resolves.toBe('superseded');
    expect(state.current()).toEqual(b);
  });

  it('rejects a delayed A outcome after B is already pending', async () => {
    const a = activation('2');
    const b = activation('3');
    const state = harness(b);
    const post = vi.fn(async () => {});

    await expect(settlePendingExtensionSubmission({
      ...state,
      expected: a,
      post,
    })).resolves.toBe('stale');
    expect(post).not.toHaveBeenCalled();
    expect(state.current()).toEqual(b);
  });

  it('distinguishes a same-application retry by its complete activation identity', async () => {
    const firstAttempt = activation('2');
    const retry = activation('3');
    const state = harness(retry);

    await expect(settlePendingExtensionSubmission({
      ...state,
      expected: firstAttempt,
      post: async () => {},
    })).resolves.toBe('stale');
    expect(state.current()).toEqual(retry);
  });

  it('lets recovery post and clear the exact persisted activation', async () => {
    const pending = activation('2');
    const state = harness(pending);
    const posted: ExtensionSubmissionActivationIdentity[] = [];

    await expect(settlePendingExtensionSubmission({
      ...state,
      expected: pending,
      post: async (value) => { posted.push(value); },
    })).resolves.toBe('cleared');
    expect(posted).toEqual([pending]);
    expect(state.current()).toBeNull();
  });
});
