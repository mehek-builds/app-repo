import { describe, expect, it } from 'vitest';

import { KeyedMutationQueue } from './keyed-mutation-queue';
import {
  authorizeFreeManualSubmissionState,
  freeManualSafeNotSentDisposition,
  reservedFreeManualSubmissionState,
  transitionFreeManualSubmissionStateToMonitoring,
  type FreeManualSubmissionState,
} from './free-manual-submission-state';

const NOW = 1_760_000_000_000;
const binding = {
  eventId: 'e9e7c7e0-d0ae-4e65-93d4-620e27eac030',
  applicationId: '327291f1-a491-48a4-aa8b-df4233e07f77',
  tabId: 7,
  frameId: 0,
  accountId: '2394efc6-d9e1-46cd-a88c-08f12ea4b809',
  authEpoch: 4,
  startUrl: 'https://job-boards.greenhouse.io/example/jobs/123',
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('queued Free manual submission lifecycle', () => {
  it('serializes a delayed START before ABANDON without deleting the monitor', async () => {
    const queue = new KeyedMutationQueue();
    const gate = deferred();
    const entered = deferred();
    let state: FreeManualSubmissionState | null = reservedFreeManualSubmissionState({
      ...binding,
      startedAt: NOW,
    }, NOW);

    const start = queue.run('free-manual-tab:7', async () => {
      entered.resolve();
      await gate.promise;
      if (!state) throw new Error('missing reservation');
      state = transitionFreeManualSubmissionStateToMonitoring(state, { ...binding, now: NOW + 1 });
      if (!state) throw new Error('transition refused');
    });
    await entered.promise;
    const abandon = queue.run('free-manual-tab:7', async () => state?.phase === 'monitoring');
    gate.resolve();

    await expect(start).resolves.toBeUndefined();
    await expect(abandon).resolves.toBe(true);
    expect(state?.phase).toBe('monitoring');
  });

  it('serializes exact pre-click cancellation after delayed START', async () => {
    const queue = new KeyedMutationQueue();
    const gate = deferred();
    const entered = deferred();
    let state: FreeManualSubmissionState | null = reservedFreeManualSubmissionState({
      ...binding,
      startedAt: NOW,
    }, NOW);

    const start = queue.run('free-manual-tab:7', async () => {
      entered.resolve();
      await gate.promise;
      if (!state) throw new Error('missing reservation');
      state = transitionFreeManualSubmissionStateToMonitoring(state, { ...binding, now: NOW + 1 });
      if (!state) throw new Error('transition refused');
    });
    await entered.promise;
    const cancel = queue.run('free-manual-tab:7', async () => {
      if (state?.eventId !== binding.eventId) throw new Error('wrong attempt');
      state = null;
    });
    gate.resolve();

    await Promise.all([start, cancel]);
    expect(state).toBeNull();
  });

  it('clears an exact lease-less monitor after safe proof but preserves later authorization', async () => {
    const queue = new KeyedMutationQueue();
    const serverProof = deferred();
    const entered = deferred();
    const reserved = reservedFreeManualSubmissionState({
      ...binding,
      startedAt: NOW,
    }, NOW)!;
    const monitoring = transitionFreeManualSubmissionStateToMonitoring(reserved, {
      ...binding,
      now: NOW + 1,
    })!;
    let state: FreeManualSubmissionState | null = monitoring;

    const close = queue.run('free-manual-tab:7', async () => {
      const exact = state;
      if (!exact) throw new Error('missing monitor');
      entered.resolve();
      await serverProof.promise;
      const disposition = freeManualSafeNotSentDisposition(state, exact, NOW + 2);
      if (disposition === 'remove') state = null;
      return disposition;
    });
    await entered.promise;
    state = authorizeFreeManualSubmissionState(monitoring, {
      ...binding,
      leaseId: '323e4567-e89b-42d3-a456-426614174000',
      activationId: '423e4567-e89b-42d3-a456-426614174000',
      expiresAt: NOW + 180_000,
      now: NOW + 1,
    });
    serverProof.resolve();

    await expect(close).resolves.toBe('blocked');
    expect(state).toMatchObject({
      phase: 'monitoring',
      boundaryLeaseId: '323e4567-e89b-42d3-a456-426614174000',
    });
  });
});
