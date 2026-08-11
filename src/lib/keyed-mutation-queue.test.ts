import { describe, expect, it } from 'vitest';
import { KeyedMutationQueue, persistOneShotTransition } from './keyed-mutation-queue';
import { armHandoffs, claimArmed, type ArmedHandoff } from './web-handoff';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('keyed continuation mutation queue', () => {
  it('allows exactly one of two concurrent claims to consume one continuation', async () => {
    const queue = new KeyedMutationQueue();
    const gate = deferred();
    let continuation = 'packet';
    const claim = () => queue.run('tab:frame', async () => {
      await gate.promise;
      const claimed = continuation;
      continuation = '';
      return claimed;
    });
    const first = claim();
    const second = claim();
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual(['packet', '']);
  });

  it('does not clobber simultaneous continuations for different tabs', async () => {
    const queue = new KeyedMutationQueue();
    const gate = deferred();
    const stored: Record<string, string> = {};
    const first = queue.run('one', async () => { await gate.promise; stored.one = 'packet-one'; });
    const second = queue.run('two', async () => { stored.two = 'packet-two'; });
    await second;
    gate.resolve();
    await first;
    expect(stored).toEqual({ one: 'packet-one', two: 'packet-two' });
  });

  it('orders proof before a later invalidation so invalidation always wins', async () => {
    const queue = new KeyedMutationQueue();
    const gate = deferred();
    let value: { proof?: number } | null = {};
    const prove = queue.run('same', async () => { await gate.promise; value = { proof: 1 }; });
    const invalidate = queue.run('same', async () => { value = null; });
    gate.resolve();
    await Promise.all([prove, invalidate]);
    expect(value).toBeNull();
  });

  it('serializes arm then consume without resurrecting the consumed arm', async () => {
    const queue = new KeyedMutationQueue();
    let entries: ArmedHandoff[] = [];
    const arm = queue.run('armed', async () => {
      entries = armHandoffs(entries, [{ url: 'https://jobs.jobvite.com/acme/job/CaseId/apply', applicationId: 'packet' }], 1_000);
    });
    const consume = queue.run('armed', async () => {
      entries = claimArmed(entries, 'https://jobs.jobvite.com/acme/job/CaseId/apply', 1_001).remaining;
    });
    await Promise.all([arm, consume]);
    expect(entries).toEqual([]);
  });

  it('serializes consume then arm without losing the new arm', async () => {
    const queue = new KeyedMutationQueue();
    let entries: ArmedHandoff[] = [];
    const consume = queue.run('armed', async () => {
      entries = claimArmed(entries, 'https://jobs.jobvite.com/acme/job/CaseId/apply', 1_000).remaining;
    });
    const arm = queue.run('armed', async () => {
      entries = armHandoffs(entries, [{ url: 'https://jobs.jobvite.com/acme/job/CaseId/apply', applicationId: 'packet' }], 1_001);
    });
    await Promise.all([consume, arm]);
    expect(entries).toHaveLength(1);
    expect(entries[0].applicationId).toBe('packet');
  });

  it('does not report success when the persisted mutation rejects', async () => {
    const queue = new KeyedMutationQueue();
    const mutation = queue.run('armed', async () => {
      throw new Error('storage failed');
    });
    await expect(mutation).rejects.toThrow('storage failed');
    await expect(queue.run('armed', async () => 'retry succeeded')).resolves.toBe('retry succeeded');
  });

  it('lets a queued logout remove a binding whose delayed set finishes after logout begins', async () => {
    const queue = new KeyedMutationQueue();
    const delayedSet = deferred();
    let binding: string | null = null;
    const staleWrite = queue.run('bindings', async () => {
      await delayedSet.promise;
      binding = 'old-account';
    });
    const logout = queue.run('bindings', async () => { binding = null; });
    delayedSet.resolve();
    await Promise.all([staleWrite, logout]);
    expect(binding).toBeNull();
  });

  it('does not publish a continuation when the arm-removal write fails', async () => {
    let armed = ['packet'];
    let continuation = false;
    await expect(persistOneShotTransition({
      before: ['packet'],
      after: [],
      persistSource: async () => { throw new Error('arm write failed'); },
      persistDestination: async () => { continuation = true; },
    })).rejects.toThrow('arm write failed');
    expect(armed).toEqual(['packet']);
    expect(continuation).toBe(false);
  });

  it('restores the arm when the continuation write fails', async () => {
    let armed = ['packet'];
    const writes: string[][] = [];
    await expect(persistOneShotTransition({
      before: ['packet'],
      after: [],
      persistSource: async (value) => { armed = [...value]; writes.push([...value]); },
      persistDestination: async () => { throw new Error('continuation write failed'); },
    })).rejects.toThrow('continuation write failed');
    expect(writes).toEqual([[], ['packet']]);
    expect(armed).toEqual(['packet']);
  });
});
