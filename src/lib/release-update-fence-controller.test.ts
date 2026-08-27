import { describe, expect, it } from 'vitest';
import { ReleaseUpdateFenceController } from './release-update-fence-controller';
import {
  activeReleaseUpdateFence,
  readyReleaseUpdateFence,
  type ReleaseUpdateFenceRuntimeContext,
  type ReleaseUpdateFenceState,
} from './release-update-fence';

function deferred<T = void>() {
  let settle!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    settle = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    reject,
    resolve: (value?: T | PromiseLike<T>) => settle(value as T | PromiseLike<T>),
  };
}

type VoidDeferred = ReturnType<typeof deferred<void>>;

function copy<T>(value: T): T {
  return structuredClone(value);
}

function harness(initialState: unknown = null) {
  let stored: unknown = copy(initialState);
  let writeFailuresRemaining = 0;
  let uuid = 0;
  const attemptedWrites: ReleaseUpdateFenceState[] = [];
  const cancelled: number[][] = [];
  const cancelledAll: number[][] = [];
  const reloaded: number[] = [];
  const reloadResults = new Map<number, 'reloaded' | 'missing' | 'failed_live'>();
  const waits: number[] = [];
  const workerReloads: number[] = [];
  const readBarriers: Array<{
    started: VoidDeferred;
    release: VoidDeferred;
  } | null> = [];
  const writeBarriers: Array<{
    started: VoidDeferred;
    release: VoidDeferred;
  }> = [];
  let readIndex = 0;
  let writeIndex = 0;
  let contexts: ReleaseUpdateFenceRuntimeContext[] = [];
  const contextResponses: ReleaseUpdateFenceRuntimeContext[][] = [];

  const controller = () => new ReleaseUpdateFenceController({
    installedVersion: '0.6.2',
    readStoredState: async () => {
      const barrier = readBarriers[readIndex];
      readIndex += 1;
      if (barrier) {
        barrier.started.resolve();
        await barrier.release.promise;
      }
      return copy(stored);
    },
    writeStoredState: async (state) => {
      const barrier = writeBarriers[writeIndex];
      writeIndex += 1;
      attemptedWrites.push(copy(state));
      if (barrier) {
        barrier.started.resolve();
        await barrier.release.promise;
      }
      if (writeFailuresRemaining > 0) {
        writeFailuresRemaining -= 1;
        throw new Error('transient storage failure');
      }
      stored = copy(state);
    },
    getContexts: async (tabIds) => {
      const inventory = contextResponses.length > 0 ? contextResponses.shift()! : contexts;
      return copy(tabIds
        ? inventory.filter((context) => tabIds.includes(context.tabId))
        : inventory);
    },
    cancelTabs: async (tabIds) => {
      cancelled.push([...tabIds]);
      return [...tabIds];
    },
    cancelAllTabs: async () => {
      const tabIds = [...new Set(contexts.map((context) => context.tabId))];
      cancelledAll.push(tabIds);
      return tabIds;
    },
    reloadTab: async (tabId) => {
      reloaded.push(tabId);
      return reloadResults.get(tabId) ?? 'reloaded';
    },
    reloadWorker: async () => { workerReloads.push(workerReloads.length + 1); },
    disableAutoSubmit: async () => {},
    now: () => 123,
    randomUUID: () => `activation-${++uuid}`,
    wait: async (delayMs) => { waits.push(delayMs); },
  });

  return {
    attemptedWrites,
    cancelled,
    cancelledAll,
    controller,
    get stored() { return copy(stored); },
    readBarrier(afterReads = 0) {
      for (let index = 0; index < afterReads; index += 1) readBarriers.push(null);
      const barrier = { started: deferred<void>(), release: deferred<void>() };
      readBarriers.push(barrier);
      return barrier;
    },
    reloaded,
    setReloadResult(tabId: number, result: 'reloaded' | 'missing' | 'failed_live') {
      reloadResults.set(tabId, result);
    },
    setContexts(next: ReleaseUpdateFenceRuntimeContext[]) { contexts = copy(next); },
    setContextResponses(next: ReleaseUpdateFenceRuntimeContext[][]) {
      contextResponses.push(...copy(next));
    },
    setStored(next: unknown) { stored = copy(next); },
    setWriteFailures(count: number) { writeFailuresRemaining = count; },
    waits,
    writeBarrier() {
      const barrier = { started: deferred<void>(), release: deferred<void>() };
      writeBarriers.push(barrier);
      return barrier;
    },
    workerReloads,
  };
}

describe('release update fence controller', () => {
  it('never opens a stale content version after global state is ready', async () => {
    const test = harness(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
    const controller = test.controller();

    expect(await controller.ready({
      tabId: 42,
      releaseVersion: '0.6.1',
      documentId: 'stale-doc',
      frameId: 0,
    })).toBe(true);
    expect(await controller.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'current-doc',
      frameId: 0,
    })).toBe(false);
  });

  it('does not commit a stale READY after a newer activation latches', async () => {
    const old = activeReleaseUpdateFence(
      '0.6.2',
      'old-activation',
      'discovering',
      100,
      [42],
      { 42: ['old-doc'] },
    );
    old.phase = 'reloading';
    const test = harness(old);
    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'new-doc' }]);
    const oldRead = test.readBarrier();
    const newActivationRead = test.readBarrier();
    const controller = test.controller();

    const ready = controller.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'new-doc',
      frameId: 0,
    });
    await oldRead.started.promise;

    const update = controller.onUpdateAvailable('0.6.3');
    oldRead.release.resolve();
    expect(await ready).toBe(true);
    await newActivationRead.started.promise;

    expect(test.attemptedWrites).not.toContainEqual(expect.objectContaining({
      releaseVersion: '0.6.2',
      phase: 'ready',
    }));
    expect(await controller.blocksSubmissions()).toBe(true);

    newActivationRead.release.resolve();
    await update;
    expect(test.stored).toMatchObject({
      active: true,
      releaseVersion: '0.6.3',
      phase: 'reloading',
      pendingTabIds: [42],
    });
    expect(test.workerReloads).toHaveLength(1);
  });

  it('keeps submissions held when activation begins during an already-started stale write', async () => {
    const old = activeReleaseUpdateFence(
      '0.6.2',
      'old-activation',
      'reloading',
      100,
      [42],
      { 42: ['old-doc'] },
    );
    const test = harness(old);
    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'new-doc' }]);
    const readyRead = test.readBarrier();
    const newActivationRead = test.readBarrier();
    const staleWrite = test.writeBarrier();
    readyRead.release.resolve();
    const controller = test.controller();

    const ready = controller.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'new-doc',
      frameId: 0,
    });
    await staleWrite.started.promise;
    const update = controller.onUpdateAvailable('0.6.3');
    staleWrite.release.resolve();

    expect(await ready).toBe(true);
    await newActivationRead.started.promise;
    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'old-activation', 100));
    expect(await controller.blocksSubmissions()).toBe(true);

    newActivationRead.release.resolve();
    await update;
    expect(test.stored).toMatchObject({ active: true, releaseVersion: '0.6.3' });
  });

  it('accepts iframe-only READY only after inventory proves the old document is gone', async () => {
    const test = harness();
    test.setContexts([{ tabId: 42, frameId: 3, documentId: 'old-iframe-doc' }]);
    const controller = test.controller();

    await controller.onInstalled('update');
    expect(test.stored).toMatchObject({
      active: true,
      phase: 'reloading',
      pendingTabIds: [42],
      legacyDocumentIdsByTab: { 42: ['old-iframe-doc'] },
    });
    expect(test.cancelled).toEqual([[42]]);
    expect(test.reloaded).toEqual([42]);

    expect(await controller.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'old-iframe-doc',
      frameId: 3,
    })).toBe(true);

    test.setContexts([{ tabId: 42, frameId: 3, documentId: 'new-iframe-doc' }]);
    expect(await controller.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'new-iframe-doc',
      frameId: 3,
    })).toBe(false);
    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
    expect(await controller.blocksSubmissions()).toBe(false);
  });

  it('retries a transient persistence failure with a bounded schedule and stays held', async () => {
    const test = harness();
    test.setWriteFailures(1);
    const controller = test.controller();

    const installing = controller.onInstalled('update');
    expect(await controller.blocksSubmissions()).toBe(true);
    await installing;

    expect(test.waits).toEqual([25, 25, 100, 400]);
    expect(test.attemptedWrites.filter((state) => state.phase === 'discovering')).toHaveLength(2);
    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
    expect(await controller.blocksSubmissions()).toBe(false);
  });

  it('recovers a transient empty discovery inventory before declaring the release ready', async () => {
    const test = harness();
    test.setContexts([{ tabId: 42, frameId: 3, documentId: 'old-iframe-doc' }]);
    test.setContextResponses([
      [],
      [{ tabId: 42, frameId: 3, documentId: 'old-iframe-doc' }],
    ]);
    const controller = test.controller();

    await controller.onInstalled('update');

    expect(test.waits).toEqual([25, 25, 100, 400]);
    expect(test.stored).toMatchObject({
      active: true,
      phase: 'reloading',
      pendingTabIds: [42],
      legacyDocumentIdsByTab: { 42: ['old-iframe-doc'] },
    });
    expect(test.cancelled).toEqual([[42]]);
    expect(test.reloaded).toEqual([42]);
    expect(await controller.blocksSubmissions()).toBe(true);
  });

  it.each([
    ['missing storage', null],
    ['interrupted discovery', activeReleaseUpdateFence('0.6.2', 'activation-1', 'discovering', 123)],
  ])('uses a later READY ping to recover %s without a worker restart', async (_name, initial) => {
    const test = harness(initial);
    test.setContexts([{ tabId: -1, frameId: 0, documentId: 'invalid-doc' }]);
    const controller = test.controller();

    if (initial) await expect(controller.resume()).rejects.toThrow(/unverifiable/);
    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'old-doc' }]);
    expect(await controller.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'old-doc',
      frameId: 0,
    })).toBe(true);
    expect(test.stored).toMatchObject({
      active: true,
      phase: 'reloading',
      pendingTabIds: [42],
    });
    expect(test.reloaded).toContain(42);

    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'new-doc' }]);
    expect(await controller.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'new-doc',
      frameId: 0,
    })).toBe(false);
  });

  it('applies a tab replacement observed after snapshot but before pending state commits', async () => {
    const test = harness();
    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'old-doc' }]);
    const postSnapshotRead = test.readBarrier(1);
    const controller = test.controller();

    const installing = controller.onInstalled('update');
    await postSnapshotRead.started.promise;
    test.setContexts([{ tabId: 77, frameId: 0, documentId: 'old-doc' }]);
    const replacing = controller.replaced(42, 77);
    postSnapshotRead.release.resolve();
    await Promise.all([installing, replacing]);

    expect(test.stored).toMatchObject({
      active: true,
      phase: 'reloading',
      pendingTabIds: [77],
      legacyDocumentIdsByTab: { 77: ['old-doc'] },
    });
    expect(test.cancelled).toEqual([[77]]);
    expect(test.reloaded).toEqual([77]);
  });

  it('retires a confirmed-cancelled one-shot generic context without reloading or stranding the fence', async () => {
    const test = harness();
    test.setContexts([{
      tabId: 42,
      frameId: 0,
      documentId: 'one-shot-doc',
      persistsAfterReload: false,
    }]);
    const controller = test.controller();

    await controller.onInstalled('update');

    expect(test.cancelled).toEqual([[42]]);
    expect(test.reloaded).toEqual([]);
    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
    expect(await controller.blocksSubmissions()).toBe(false);
  });

  it('retries a failed live reload now and again on the old document READY ping', async () => {
    const test = harness();
    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'old-doc' }]);
    test.setReloadResult(42, 'failed_live');
    const controller = test.controller();

    await expect(controller.onInstalled('update')).rejects.toThrow(/could not reload/);
    expect(test.reloaded).toHaveLength(4);
    expect(test.stored).toMatchObject({ phase: 'reloading', pendingTabIds: [42] });

    test.setReloadResult(42, 'reloaded');
    expect(await controller.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'old-doc',
      frameId: 0,
    })).toBe(true);
    expect(test.reloaded).toHaveLength(5);
  });

  it('cancels every live content script before update state persistence can fail', async () => {
    const test = harness();
    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'old-doc' }]);
    test.setWriteFailures(4);
    const controller = test.controller();

    await expect(controller.onUpdateAvailable('0.6.3')).rejects.toThrow(/storage failure/);

    expect(test.cancelledAll[0]).toEqual([42]);
    expect(test.workerReloads).toEqual([]);
    expect(await controller.blocksSubmissions()).toBe(true);
  });

  it('cancels every live content script before installed-update persistence can fail', async () => {
    const test = harness();
    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'old-doc' }]);
    test.setWriteFailures(4);
    const controller = test.controller();

    await expect(controller.onInstalled('update')).rejects.toThrow(/storage failure/);

    expect(test.cancelledAll).toEqual([[42]]);
    expect(test.cancelled).toEqual([]);
    expect(await controller.blocksSubmissions()).toBe(true);
  });

  it('retires a reloaded tab after a stable empty content-context inventory', async () => {
    const test = harness();
    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'old-doc' }]);
    test.setContextResponses([
      [{ tabId: 42, frameId: 0, documentId: 'old-doc' }],
      [],
      [],
      [],
      [],
    ]);
    const controller = test.controller();

    await controller.onInstalled('update');

    expect(test.reloaded).toEqual([42]);
    expect(test.waits).toEqual([25, 100, 400]);
    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
    expect(await controller.blocksSubmissions()).toBe(false);
  });

  it('retires a tab that leaves the allowlist after the first post-reload probe', async () => {
    const test = harness();
    test.setContexts([]);
    test.setContextResponses([
      [{ tabId: 42, frameId: 0, documentId: 'old-doc' }],
      [{ tabId: 42, frameId: 0, documentId: 'old-doc' }],
      [],
      [],
      [],
    ]);
    const controller = test.controller();

    await controller.onInstalled('update');

    expect(test.reloaded).toEqual([42]);
    expect(test.waits).toEqual([25, 100, 400]);
    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
  });

  it('does not retire a reloaded tab when a content context appears during stabilization', async () => {
    const test = harness();
    test.setContexts([{ tabId: 42, frameId: 0, documentId: 'new-doc' }]);
    test.setContextResponses([
      [{ tabId: 42, frameId: 0, documentId: 'old-doc' }],
      [],
      [{ tabId: 42, frameId: 0, documentId: 'new-doc' }],
    ]);
    const controller = test.controller();

    await controller.onInstalled('update');

    expect(test.waits).toEqual([25, 100, 400]);
    expect(test.stored).toMatchObject({
      active: true,
      phase: 'reloading',
      pendingTabIds: [42],
    });
    expect(await controller.blocksSubmissions()).toBe(true);
  });

  it('does not retire a reloaded tab from one final empty inventory sample', async () => {
    const test = harness();
    test.setContexts([]);
    test.setContextResponses([
      [{ tabId: 42, frameId: 0, documentId: 'old-doc' }],
      [{ tabId: 42, frameId: 0, documentId: 'new-doc' }],
      [{ tabId: 42, frameId: 0, documentId: 'new-doc' }],
      [{ tabId: 42, frameId: 0, documentId: 'new-doc' }],
      [],
    ]);
    const controller = test.controller();

    await expect(controller.onInstalled('update')).rejects.toThrow(/only one empty/);

    expect(test.stored).toMatchObject({
      active: true,
      phase: 'reloading',
      pendingTabIds: [42],
    });
    expect(await controller.blocksSubmissions()).toBe(true);
  });

  it('propagates READY reload exhaustion and recovers its missing tab on resume', async () => {
    const state = activeReleaseUpdateFence(
      '0.6.2',
      'activation-1',
      'reloading',
      123,
      [42],
      { 42: ['old-doc'] },
    );
    const test = harness(state);
    test.setContexts([]);
    test.setContextResponses([
      [{ tabId: 42, frameId: 0, documentId: 'old-doc' }],
      [],
      [],
      [],
      [],
    ]);
    test.setWriteFailures(4);
    const controller = test.controller();

    await expect(controller.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'old-doc',
      frameId: 0,
    })).rejects.toThrow(/storage failure/);
    expect(test.stored).toEqual(state);

    test.setWriteFailures(0);
    test.setReloadResult(42, 'missing');
    await controller.resume();

    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
    expect(await controller.blocksSubmissions()).toBe(false);
  });

  it('transfers a replaced tab before reload and closes a missing replacement without deadlock', async () => {
    const state = activeReleaseUpdateFence(
      '0.6.2',
      'activation-1',
      'reloading',
      123,
      [42],
      { 42: ['old-doc'] },
    );
    const test = harness(state);
    test.setReloadResult(77, 'missing');
    const controller = test.controller();

    await controller.replaced(42, 77);

    expect(test.reloaded).toEqual([77]);
    expect(test.attemptedWrites[0]).toMatchObject({
      phase: 'reloading',
      pendingTabIds: [77],
      legacyDocumentIdsByTab: { 77: ['old-doc'] },
    });
    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
    expect(await controller.blocksSubmissions()).toBe(false);
  });

  it('recovers a missing pending tab after close persistence exhausts', async () => {
    const state = activeReleaseUpdateFence(
      '0.6.2',
      'activation-1',
      'reloading',
      123,
      [42],
      { 42: ['old-doc'] },
    );
    const test = harness(state);
    test.setWriteFailures(4);
    test.setReloadResult(42, 'missing');
    const controller = test.controller();

    await expect(controller.closed(42)).rejects.toThrow(/storage failure/);
    expect(test.stored).toEqual(state);

    test.setWriteFailures(0);
    test.setContexts([]);
    await controller.resume();

    expect(test.reloaded).toEqual([42]);
    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
    expect(await controller.blocksSubmissions()).toBe(false);
  });

  it('recovers added and removed tab IDs after replacement persistence exhausts', async () => {
    const state = activeReleaseUpdateFence(
      '0.6.2',
      'activation-1',
      'reloading',
      123,
      [42],
      { 42: ['old-doc'] },
    );
    const test = harness(state);
    test.setWriteFailures(4);
    test.setReloadResult(42, 'missing');
    test.setReloadResult(77, 'missing');
    const controller = test.controller();

    await expect(controller.replaced(42, 77)).rejects.toThrow(/storage failure/);
    expect(test.stored).toEqual(state);

    test.setWriteFailures(0);
    test.setContexts([{ tabId: 77, frameId: 0, documentId: 'replacement-doc' }]);
    await controller.resume();

    expect(test.reloaded.sort((left, right) => left - right)).toEqual([42, 77]);
    expect(test.stored).toEqual(readyReleaseUpdateFence('0.6.2', 'activation-1', 123));
    expect(await controller.blocksSubmissions()).toBe(false);
  });

  it.each([
    ['missing', null],
    ['corrupt', { schemaVersion: 2, active: false, phase: 'ready' }],
  ])('reconstructs %s storage after bounded write failure and worker restart', async (_name, broken) => {
    const test = harness(broken);
    test.setWriteFailures(4);
    const failedWorker = test.controller();
    await expect(failedWorker.onInstalled('update')).rejects.toThrow(/storage failure/);
    expect(test.waits).toEqual([25, 100, 400]);
    expect(await failedWorker.blocksSubmissions()).toBe(true);

    test.setWriteFailures(0);
    test.setContexts([{ tabId: 42, frameId: 3, documentId: 'old-doc' }]);
    const restartedWorker = test.controller();
    await restartedWorker.resume();
    expect(test.stored).toMatchObject({
      active: true,
      releaseVersion: '0.6.2',
      phase: 'reloading',
      pendingTabIds: [42],
      legacyDocumentIdsByTab: { 42: ['old-doc'] },
    });
    expect(await restartedWorker.blocksSubmissions()).toBe(true);

    test.setContexts([{ tabId: 42, frameId: 3, documentId: 'new-doc' }]);
    expect(await restartedWorker.ready({
      tabId: 42,
      releaseVersion: '0.6.2',
      documentId: 'new-doc',
      frameId: 3,
    })).toBe(false);
    expect(await restartedWorker.blocksSubmissions()).toBe(false);
  });
});
