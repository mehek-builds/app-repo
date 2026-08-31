import { describe, expect, it, vi } from 'vitest';
import { KeyedMutationQueue } from './keyed-mutation-queue';
import {
  commitPendingExtensionSubmissionForClick,
  reservePendingExtensionSubmission,
  settlePendingExtensionSubmission,
  type PhasedPendingExtensionSubmission,
} from './pending-extension-submission';
import {
  EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
  verifyExtensionSubmissionActivation,
  type ExtensionSubmissionActivation,
} from './submission-activation';

const applicationId = '123e4567-e89b-42d3-a456-426614174000';

function activation(seed: string): ExtensionSubmissionActivation {
  return {
    applicationId,
    claimId: `${seed}23e4567-e89b-42d3-a456-426614174000`,
    activationId: `${seed}23e4567-e89b-52d3-a456-426614174001`,
    activationLeaseId: `${seed}23e4567-e89b-52d3-a456-426614174002`,
    activationExpiresAt: '2026-08-31T10:03:00.000Z',
    activationServerNow: '2026-08-31T10:00:00.000Z',
    monotonicProof: {
      runtimeId: '623e4567-e89b-42d3-a456-426614174000',
      timeOriginMs: 1_000_000,
      requestStartedAtMs: 1_000,
      boundAtMs: 2_000,
      usableUntilMs: 180_000,
      wallRequestStartedAtMs: 1_800_000_000_000,
      wallBoundAtMs: 1_800_000_001_000,
      wallUsableUntilMs: 1_800_000_179_000,
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(initial: ExtensionSubmissionActivation | null) {
  const queue = new KeyedMutationQueue();
  const mutationKey = 'tab:7';
  let stored = initial;
  return {
    queue,
    mutationKey,
    read: async () => stored,
    clear: async () => { stored = null; },
    set: (value: ExtensionSubmissionActivation) =>
      queue.run(mutationKey, async () => { stored = value; }),
    current: () => stored,
  };
}

describe('pending extension submission settlement', () => {
  it('does not let B replace A while A outcome is in flight', async () => {
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
    const settingB = state.set(b);
    expect(state.current()).toEqual(a);
    gate.resolve();

    await expect(settlingA).resolves.toBe('cleared');
    await settingB;
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

  it('does not let a proof-rewritten outcome advance or clear the stored activation', async () => {
    const pending = activation('2');
    const rewritten = {
      ...pending,
      monotonicProof: {
        ...pending.monotonicProof,
        boundAtMs: pending.monotonicProof.boundAtMs + 1,
      },
    };
    const state = harness(pending);
    const post = vi.fn(async () => {});

    await expect(settlePendingExtensionSubmission({
      ...state,
      expected: rewritten,
      post,
    })).resolves.toBe('stale');
    expect(post).not.toHaveBeenCalled();
    expect(state.current()).toEqual(pending);
  });

  it('lets recovery post and clear the exact persisted activation', async () => {
    const pending = activation('2');
    const state = harness(pending);
    const posted: ExtensionSubmissionActivation[] = [];

    await expect(settlePendingExtensionSubmission({
      ...state,
      expected: pending,
      post: async (value) => { posted.push(value); },
    })).resolves.toBe('cleared');
    expect(posted).toEqual([pending]);
    expect(state.current()).toBeNull();
  });
});

describe('pending extension submission authority', () => {
  function authorityHarness(initial: PhasedPendingExtensionSubmission | null = null) {
    const queue = new KeyedMutationQueue();
    const mutationKey = 'tab:7';
    let stored = initial;
    return {
      queue,
      mutationKey,
      read: async () => stored,
      write: async (value: PhasedPendingExtensionSubmission) => { stored = value; },
      current: () => stored,
    };
  }

  it('validates the expired stored proof and rejects a caller that rewrites its clock budget', async () => {
    const original = activation('2');
    const stored: PhasedPendingExtensionSubmission = {
      ...original,
      submissionAuthorityPhase: 'reserved',
    };
    const rewrittenCaller: ExtensionSubmissionActivation = {
      ...original,
      monotonicProof: {
        ...original.monotonicProof,
        requestStartedAtMs: 190_000,
        boundAtMs: 195_000,
        usableUntilMs: 369_000,
        wallRequestStartedAtMs: 1_800_000_189_000,
        wallBoundAtMs: 1_800_000_194_000,
        wallUsableUntilMs: 1_800_000_368_000,
      },
    };
    const state = authorityHarness(stored);
    const clickClock = {
      runtimeId: original.monotonicProof.runtimeId,
      timeOriginMs: original.monotonicProof.timeOriginMs,
      nowMs: 200_000,
      wallNowMs: 1_800_000_199_000,
    };
    expect(verifyExtensionSubmissionActivation(
      rewrittenCaller,
      applicationId,
      clickClock,
    )).toMatchObject({ ok: true });
    const validate = vi.fn((pending: PhasedPendingExtensionSubmission) => {
      const verified = verifyExtensionSubmissionActivation(pending, applicationId, clickClock);
      return verified.ok
        ? { ok: true as const }
        : { ok: false as const, error: verified.error };
    });

    await expect(commitPendingExtensionSubmissionForClick({
      ...state,
      expected: rewrittenCaller,
      validate,
    })).resolves.toMatchObject({
      kind: 'invalid',
      error: EXPIRED_SUBMISSION_ACTIVATION_MESSAGE,
    });
    expect(validate).toHaveBeenCalledOnce();
    expect(validate).toHaveBeenCalledWith(stored);
    expect(state.current()).toEqual(stored);
  });

  it('rejects every changed proof field even when the stored proof is current', async () => {
    const original = activation('2');
    const stored: PhasedPendingExtensionSubmission = {
      ...original,
      submissionAuthorityPhase: 'reserved',
    };

    for (const proofField of Object.keys(original.monotonicProof) as Array<keyof typeof original.monotonicProof>) {
      const state = authorityHarness(stored);
      const originalValue = original.monotonicProof[proofField];
      const changedValue = typeof originalValue === 'number' ? originalValue + 1 : originalValue.replace('6', '7');
      const caller = {
        ...original,
        monotonicProof: { ...original.monotonicProof, [proofField]: changedValue },
      };
      await expect(commitPendingExtensionSubmissionForClick({
        ...state,
        expected: caller,
        validate: () => ({ ok: true }),
      })).resolves.toMatchObject({ kind: 'mismatch' });
      expect(state.current()).toEqual(stored);
    }
  });

  it.each(['manual', 'dashboard', 'automatic'])(
    '%s path cannot replace A after validation commits and before A clicks',
    async () => {
      const state = authorityHarness();
      const a = activation('2');
      const b = activation('3');
      const reservedA = await reservePendingExtensionSubmission({
        ...state,
        create: async () => a,
      });
      expect(reservedA.kind).toBe('reserved');

      const responseDelivery = deferred();
      const validationCommitted = deferred();
      const click = vi.fn();
      const aFlow = (async () => {
        const committed = await commitPendingExtensionSubmissionForClick({
          ...state,
          expected: a,
          validate: () => ({ ok: true }),
        });
        expect(committed.kind).toBe('committed');
        validationCommitted.resolve();
        await responseDelivery.promise;
        click();
      })();

      await validationCommitted.promise;
      const createB = vi.fn(async () => b);
      await expect(reservePendingExtensionSubmission({
        ...state,
        create: createB,
      })).resolves.toMatchObject({
        kind: 'occupied',
        pending: {
          activationId: a.activationId,
          submissionAuthorityPhase: 'click_committed',
        },
      });
      expect(createB).not.toHaveBeenCalled();
      expect(state.current()).toMatchObject({
        activationId: a.activationId,
        submissionAuthorityPhase: 'click_committed',
      });

      responseDelivery.resolve();
      await aFlow;
      expect(click).toHaveBeenCalledOnce();
    },
  );
});
