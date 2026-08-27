import { describe, expect, it } from 'vitest';
import {
  acknowledgeReleaseUpdateFenceTab,
  activeReleaseUpdateFence,
  parseReleaseUpdateFenceState,
  readyReleaseUpdateFence,
  replaceReleaseUpdateFenceTab,
  releaseUpdateFenceIsReady,
  releaseUpdateFenceReadyInventoryAllowsAcknowledge,
  releaseUpdateFenceSnapshotFromContexts,
  releaseUpdateFenceWithPendingTabs,
} from './release-update-fence';

describe('release update fence', () => {
  it('keeps discovery active until the exact legacy tabs are known', () => {
    const discovering = activeReleaseUpdateFence('0.6.2', 'activation-1', 'discovering', 123);
    expect(discovering.active).toBe(true);
    expect(discovering.pendingTabIds).toEqual([]);

    const reloading = releaseUpdateFenceWithPendingTabs(discovering, [9, 2, 9]);
    expect(reloading).toMatchObject({
      active: true,
      phase: 'reloading',
      pendingTabIds: [2, 9],
    });
  });

  it('does not clear for an unrelated or premature ready message', () => {
    const discovering = activeReleaseUpdateFence('0.6.2', 'activation-1', 'discovering', 123);
    expect(acknowledgeReleaseUpdateFenceTab(discovering, 2)).toEqual(discovering);

    const reloading = releaseUpdateFenceWithPendingTabs(discovering, [2, 9])!;
    expect(acknowledgeReleaseUpdateFenceTab(reloading, 7)).toEqual(reloading);
  });

  it('clears only after every probed legacy tab boots the new script', () => {
    const reloading = releaseUpdateFenceWithPendingTabs(
      activeReleaseUpdateFence('0.6.2', 'activation-1', 'discovering', 123),
      [2, 9],
    )!;
    const oneLeft = acknowledgeReleaseUpdateFenceTab(reloading, 2);
    expect(oneLeft?.pendingTabIds).toEqual([9]);
    expect(acknowledgeReleaseUpdateFenceTab(oneLeft!, 9)).toBeNull();
  });

  it('transfers a replaced tab instead of treating replacement as readiness', () => {
    const reloading = releaseUpdateFenceWithPendingTabs(
      activeReleaseUpdateFence('0.6.2', 'activation-1', 'discovering', 123),
      [2, 9],
    )!;
    expect(replaceReleaseUpdateFenceTab(reloading, 2, 7).pendingTabIds).toEqual([7, 9]);
    expect(replaceReleaseUpdateFenceTab(reloading, 4, 7)).toEqual(reloading);
  });

  it('binds iframe readiness to exact runtime inventory, not to frame zero', () => {
    const reloading = releaseUpdateFenceWithPendingTabs(
      activeReleaseUpdateFence('0.6.2', 'activation-1', 'discovering', 123),
      [42],
      { 42: ['old-iframe-doc'] },
    )!;
    const base = {
      state: reloading,
      installedVersion: '0.6.2',
      tabId: 42,
      releaseVersion: '0.6.2',
      frameId: 3,
    };

    expect(releaseUpdateFenceReadyInventoryAllowsAcknowledge({
      ...base,
      documentId: 'old-iframe-doc',
      contexts: [{ tabId: 42, frameId: 3, documentId: 'old-iframe-doc' }],
    })).toBe(false);
    expect(releaseUpdateFenceReadyInventoryAllowsAcknowledge({
      ...base,
      documentId: 'new-iframe-doc',
      contexts: [{ tabId: 42, frameId: 3, documentId: 'new-iframe-doc' }],
    })).toBe(true);
    expect(releaseUpdateFenceReadyInventoryAllowsAcknowledge({
      ...base,
      documentId: 'new-iframe-doc',
      contexts: [
        { tabId: 42, frameId: 3, documentId: 'new-iframe-doc' },
        { tabId: 42, frameId: 7, documentId: 'old-iframe-doc' },
      ],
    })).toBe(false);
  });

  it('refuses a context snapshot with no document proof', () => {
    expect(releaseUpdateFenceSnapshotFromContexts([
      { tabId: 42, frameId: 3, documentId: undefined },
    ])).toBeNull();
  });

  it('marks a tab one-shot only when every inventoried frame lacks a manifest reinjection', () => {
    expect(releaseUpdateFenceSnapshotFromContexts([
      { tabId: 42, frameId: 0, documentId: 'generic-doc', persistsAfterReload: false },
    ])?.oneShotTabIds).toEqual([42]);
    expect(releaseUpdateFenceSnapshotFromContexts([
      { tabId: 42, frameId: 0, documentId: 'generic-doc', persistsAfterReload: false },
      { tabId: 42, frameId: 3, documentId: 'greenhouse-doc', persistsAfterReload: true },
    ])?.oneShotTabIds).toEqual([]);
    expect(releaseUpdateFenceSnapshotFromContexts([
      { tabId: 42, frameId: 0, documentId: 'unknown-doc' },
    ])?.oneShotTabIds).toEqual([]);
  });

  it('fails malformed persisted state closed at the parser boundary', () => {
    expect(parseReleaseUpdateFenceState({
      schemaVersion: 2,
      active: true,
      releaseVersion: '0.6.2',
      activationId: 'activation-1',
      phase: 'reloading',
      activatedAt: 123,
      pendingTabIds: [4, 4, 1],
      legacyDocumentIdsByTab: { 4: ['old-doc'] },
    })?.pendingTabIds).toEqual([1, 4]);
    expect(parseReleaseUpdateFenceState({
      schemaVersion: 2,
      active: true,
      releaseVersion: '0.6.2',
      activationId: 'activation-1',
      phase: 'reloading',
      activatedAt: 123,
      pendingTabIds: ['4'],
      legacyDocumentIdsByTab: {},
    })).toBeNull();
  });

  it('opens only for an explicit ready record on the exact installed version', () => {
    const ready = readyReleaseUpdateFence('0.6.2', 'activation-1', 123);
    expect(releaseUpdateFenceIsReady(ready, '0.6.2')).toBe(true);
    expect(releaseUpdateFenceIsReady(ready, '0.6.3')).toBe(false);
    expect(releaseUpdateFenceIsReady(null, '0.6.2')).toBe(false);
    expect(releaseUpdateFenceIsReady(
      activeReleaseUpdateFence('0.6.2', 'activation-1', 'discovering', 123),
      '0.6.2',
    )).toBe(false);
  });
});
