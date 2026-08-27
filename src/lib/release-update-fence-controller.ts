import { KeyedMutationQueue } from './keyed-mutation-queue';
import {
  acknowledgeReleaseUpdateFenceTab,
  activeReleaseUpdateFence,
  parseReleaseUpdateFenceState,
  readyReleaseUpdateFence,
  RELEASE_UPDATE_FENCE_RECOVERY_DELAYS_MS,
  releaseUpdateFenceIsReady,
  releaseUpdateFenceReadyInventoryAllowsAcknowledge,
  releaseUpdateFenceSnapshotFromContexts,
  releaseUpdateFenceWithPendingTabs,
  replaceReleaseUpdateFenceTab,
  runBoundedReleaseUpdateFenceRecovery,
  ReleaseUpdateFenceActivationGate,
  StaleReleaseUpdateFenceOperationError,
  type ReleaseUpdateFencePhase,
  type ReleaseUpdateFenceRuntimeContext,
  type ReleaseUpdateFenceState,
  type ReleaseUpdateFenceTabSnapshot,
} from './release-update-fence';

const MUTATION_KEY = 'release-update-fence';

type Activation = {
  activationId: string;
  operationEpoch: number;
};

export type ReleaseUpdateFenceReloadResult = 'reloaded' | 'missing' | 'failed_live';

export type ReleaseUpdateFenceControllerDependencies = {
  installedVersion: string;
  readStoredState: () => Promise<unknown>;
  writeStoredState: (state: ReleaseUpdateFenceState) => Promise<void>;
  getContexts: (tabIds?: readonly number[]) => Promise<ReleaseUpdateFenceRuntimeContext[]>;
  cancelTabs: (tabIds: readonly number[]) => Promise<readonly number[]>;
  cancelAllTabs: () => Promise<readonly number[]>;
  reloadTab: (tabId: number) => Promise<ReleaseUpdateFenceReloadResult>;
  reloadWorker: () => Promise<void> | void;
  disableAutoSubmit: () => Promise<void>;
  now?: () => number;
  randomUUID?: () => string;
  wait?: (delayMs: number) => Promise<void>;
};

/**
 * Owns every release-fence state transition. Chrome event listeners stay synchronous adapters, so
 * tests can pause storage and context inventory at exact event-order boundaries.
 */
export class ReleaseUpdateFenceController {
  private readonly gate = new ReleaseUpdateFenceActivationGate();
  private readonly mutations = new KeyedMutationQueue();
  private readonly observedTabReplacements = new Map<number, {
    addedTabId: number;
    operationEpoch: number;
  }>();
  private discoveryInFlight: {
    activationId: string;
    operationEpoch: number;
    promise: Promise<void>;
  } | null = null;

  constructor(private readonly dependencies: ReleaseUpdateFenceControllerDependencies) {}

  onInstalled(reason: 'install' | 'update'): Promise<void> {
    const activation = this.activateSynchronously();
    if (reason === 'install') {
      return this.mutations.run(MUTATION_KEY, async () => {
        await this.persist(
          readyReleaseUpdateFence(
            this.dependencies.installedVersion,
            activation.activationId,
            this.now(),
          ),
          activation.operationEpoch,
        );
      });
    }
    return this.activateInstalledUpdate(activation);
  }

  async onUpdateAvailable(releaseVersion: string): Promise<void> {
    const activation = this.activateSynchronously();
    await runBoundedReleaseUpdateFenceRecovery({
      operation: () => this.dependencies.cancelAllTabs(),
      operationIsCurrent: () => this.gate.operationIsCurrent(activation.operationEpoch),
      wait: this.dependencies.wait,
    });
    const state = await this.activate(releaseVersion, 'awaiting_update', activation);
    const tabIds = state
      ? await this.snapshotBeforeWorkerReload(state.activationId, activation.operationEpoch)
      : [];
    if (!this.gate.operationIsCurrent(activation.operationEpoch)) return;
    await this.dependencies.cancelTabs(tabIds);
    if (!this.gate.operationIsCurrent(activation.operationEpoch)) return;
    await this.dependencies.reloadWorker();
  }

  async blocksSubmissions(): Promise<boolean> {
    const operationEpoch = this.gate.captureOperationEpoch();
    try {
      const state = await this.storedState(operationEpoch);
      const ready = releaseUpdateFenceIsReady(state, this.dependencies.installedVersion);
      this.gate.observeRead(operationEpoch, ready);
      return this.gate.blocks(ready);
    } catch {
      this.gate.hold(operationEpoch);
      return true;
    }
  }

  async ready(input: {
    tabId: number;
    releaseVersion: string;
    documentId?: string;
    frameId?: number;
  }): Promise<boolean> {
    const operationEpoch = this.gate.captureOperationEpoch();
    let recoveryRequired = false;
    let reloadRequired = false;
    try {
      const blocked = await this.mutations.run(MUTATION_KEY, async () => {
        const current = await this.storedState(operationEpoch);
        if (releaseUpdateFenceIsReady(current, this.dependencies.installedVersion)) {
          if (input.releaseVersion !== this.dependencies.installedVersion) return true;
          this.gate.observeRead(operationEpoch, true);
          return this.gate.blocks(true);
        }
        if (!current || current.phase !== 'reloading') {
          recoveryRequired = true;
          return true;
        }
        const contexts = await this.contexts(operationEpoch, [input.tabId]);
        if (!releaseUpdateFenceReadyInventoryAllowsAcknowledge({
          state: current,
          installedVersion: this.dependencies.installedVersion,
          tabId: input.tabId,
          releaseVersion: input.releaseVersion,
          documentId: input.documentId,
          frameId: input.frameId,
          contexts,
        })) {
          reloadRequired = current.pendingTabIds.includes(input.tabId);
          return true;
        }

        const active = acknowledgeReleaseUpdateFenceTab(current, input.tabId);
        const next = active ?? readyReleaseUpdateFence(
          this.dependencies.installedVersion,
          current.activationId,
          current.activatedAt,
        );
        const committed = await this.persist(next, operationEpoch);
        return !committed || this.gate.blocks(
          releaseUpdateFenceIsReady(next, this.dependencies.installedVersion),
        );
      });
      if (recoveryRequired) {
        await this.resume();
        return true;
      }
      if (reloadRequired) {
        await this.reloadTabs([input.tabId], operationEpoch);
        return true;
      }
      return blocked;
    } catch (error) {
      if (error instanceof StaleReleaseUpdateFenceOperationError) return true;
      throw error;
    }
  }

  async closed(tabId: number): Promise<void> {
    const operationEpoch = this.gate.captureOperationEpoch();
    try {
      await this.closePendingTab(tabId, operationEpoch);
    } catch (error) {
      if (!(error instanceof StaleReleaseUpdateFenceOperationError)) throw error;
    }
  }

  async replaced(removedTabId: number, addedTabId: number): Promise<void> {
    const operationEpoch = this.gate.captureOperationEpoch();
    this.recordTabReplacement(removedTabId, addedTabId, operationEpoch);
    let reloadReplacement = false;
    try {
      await this.mutations.run(MUTATION_KEY, async () => {
        const current = await this.storedState(operationEpoch);
        if (!current) return;
        const next = replaceReleaseUpdateFenceTab(current, removedTabId, addedTabId);
        if (next === current) return;
        if (!await this.persist(next, operationEpoch)) return;
        reloadReplacement = true;
      });
      if (reloadReplacement && this.gate.operationIsCurrent(operationEpoch)) {
        await this.reloadTabs([addedTabId], operationEpoch);
      }
    } catch (error) {
      if (!(error instanceof StaleReleaseUpdateFenceOperationError)) throw error;
    }
  }

  async resume(): Promise<void> {
    const operationEpoch = this.gate.captureOperationEpoch();
    try {
      const current = await this.storedState(operationEpoch);
      if (releaseUpdateFenceIsReady(current, this.dependencies.installedVersion)) {
        this.gate.observeRead(operationEpoch, true);
        return;
      }
      this.gate.hold(operationEpoch);
      if (!this.gate.operationIsCurrent(operationEpoch)) return;

      if (!current) {
        await this.recoverInstalledRelease(operationEpoch);
        return;
      }
      if (current.releaseVersion !== this.dependencies.installedVersion) {
        if (current.active && (current.phase === 'awaiting_update' || current.phase === 'reloading')) {
          await this.resumePendingWorkerUpdate(current, operationEpoch);
        } else {
          await this.recoverInstalledRelease(operationEpoch);
        }
        return;
      }
      if (current.active) {
        await this.discoverAndReloadLegacyTabs(current.activationId, operationEpoch);
        return;
      }
      await this.recoverInstalledRelease(operationEpoch);
    } catch (error) {
      if (!(error instanceof StaleReleaseUpdateFenceOperationError)) throw error;
    }
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  private activateSynchronously(): Activation {
    const operationEpoch = this.gate.beginActivation();
    this.observedTabReplacements.clear();
    return {
      activationId: this.dependencies.randomUUID?.() ?? crypto.randomUUID(),
      operationEpoch,
    };
  }

  private async recoverInstalledRelease(previousOperationEpoch: number): Promise<void> {
    if (!this.gate.operationIsCurrent(previousOperationEpoch)) return;
    const activation = this.activateSynchronously();
    const state = await this.activate(
      this.dependencies.installedVersion,
      'discovering',
      activation,
    );
    if (state) {
      await this.discoverAndReloadLegacyTabs(state.activationId, activation.operationEpoch);
    }
  }

  private async activateInstalledUpdate(activation: Activation): Promise<void> {
    await runBoundedReleaseUpdateFenceRecovery({
      operation: () => this.dependencies.cancelAllTabs(),
      operationIsCurrent: () => this.gate.operationIsCurrent(activation.operationEpoch),
      wait: this.dependencies.wait,
    });
    const state = await this.activate(
      this.dependencies.installedVersion,
      'discovering',
      activation,
    );
    if (state) {
      await this.discoverAndReloadLegacyTabs(state.activationId, activation.operationEpoch);
    }
  }

  private async resumePendingWorkerUpdate(
    current: ReleaseUpdateFenceState,
    operationEpoch: number,
  ): Promise<void> {
    const tabIds = current.phase === 'awaiting_update'
      ? await this.snapshotBeforeWorkerReload(current.activationId, operationEpoch)
      : current.pendingTabIds;
    if (!this.gate.operationIsCurrent(operationEpoch)) return;
        await this.dependencies.cancelTabs(tabIds);
    if (!this.gate.operationIsCurrent(operationEpoch)) return;
    await this.dependencies.reloadWorker();
  }

  private async activate(
    releaseVersion: string,
    phase: Exclude<ReleaseUpdateFencePhase, 'ready'>,
    activation: Activation,
  ): Promise<ReleaseUpdateFenceState | null> {
    const next = await this.mutations.run(MUTATION_KEY, async () => {
      const current = await this.storedState(activation.operationEpoch);
      const state = current?.active === true && current.releaseVersion === releaseVersion
        ? current.phase === 'reloading'
          ? current
          : { ...current, phase }
        : activeReleaseUpdateFence(
          releaseVersion,
          activation.activationId,
          phase,
          this.now(),
        );
      return await this.persist(state, activation.operationEpoch) ? state : null;
    });
    if (!next) return null;
    await this.dependencies.disableAutoSubmit().catch(() => {});
    return next;
  }

  private async discoverAndReloadLegacyTabs(
    activationId: string,
    operationEpoch: number,
  ): Promise<void> {
    if (
      this.discoveryInFlight?.activationId === activationId
      && this.discoveryInFlight.operationEpoch === operationEpoch
    ) return this.discoveryInFlight.promise;

    const discovery = (async () => {
      const discovered = await this.snapshot(operationEpoch);
      let pendingTabIds: number[] = [];
      let oneShotTabIds: number[] = [];
      await this.mutations.run(MUTATION_KEY, async () => {
        const current = await this.storedState(operationEpoch);
        if (!current
          || current.active !== true
          || current.releaseVersion !== this.dependencies.installedVersion
          || current.activationId !== activationId) return;
        const currentDiscovery = this.applyObservedTabReplacements(discovered, operationEpoch);
        const tabIds = current.phase === 'reloading'
          ? [...new Set([...current.pendingTabIds, ...currentDiscovery.tabIds])]
          : currentDiscovery.tabIds;
        const documentIds = mergedDocumentIds(
          current.legacyDocumentIdsByTab,
          currentDiscovery.documentIdsByTab,
        );
        const active = releaseUpdateFenceWithPendingTabs(current, tabIds, documentIds);
        const next = active ?? readyReleaseUpdateFence(
          this.dependencies.installedVersion,
          activationId,
          current.activatedAt,
        );
        if (!await this.persist(next, operationEpoch)) return;
        pendingTabIds = active?.pendingTabIds ?? [];
        oneShotTabIds = currentDiscovery.oneShotTabIds
          .filter((tabId) => pendingTabIds.includes(tabId));
      });
      if (pendingTabIds.length === 0 || !this.gate.operationIsCurrent(operationEpoch)) return;
      const confirmedCancelled = await this.dependencies.cancelTabs(pendingTabIds);
      if (!this.gate.operationIsCurrent(operationEpoch)) return;
      const retiredOneShotTabIds = oneShotTabIds
        .filter((tabId) => confirmedCancelled.includes(tabId));
      if (retiredOneShotTabIds.length > 0) {
        await this.retireCancelledOneShotTabs(retiredOneShotTabIds, operationEpoch);
      }
      if (!this.gate.operationIsCurrent(operationEpoch)) return;
      await this.reloadTabs(
        pendingTabIds.filter((tabId) => !retiredOneShotTabIds.includes(tabId)),
        operationEpoch,
      );
    })();

    this.discoveryInFlight = { activationId, operationEpoch, promise: discovery };
    try {
      await discovery;
    } finally {
      if (this.discoveryInFlight?.promise === discovery) this.discoveryInFlight = null;
    }
  }

  private async snapshotBeforeWorkerReload(
    activationId: string,
    operationEpoch: number,
  ): Promise<number[]> {
    const discovered = await this.snapshot(operationEpoch);
    return this.mutations.run(MUTATION_KEY, async () => {
      const current = await this.storedState(operationEpoch);
      if (!current || current.active !== true || current.activationId !== activationId) {
        throw new StaleReleaseUpdateFenceOperationError();
      }
      const currentDiscovery = this.applyObservedTabReplacements(discovered, operationEpoch);
      const tabIds = current.phase === 'reloading'
        ? [...new Set([...current.pendingTabIds, ...currentDiscovery.tabIds])]
        : currentDiscovery.tabIds;
      const documentIds = mergedDocumentIds(
        current.legacyDocumentIdsByTab,
        currentDiscovery.documentIdsByTab,
      );
      const next = releaseUpdateFenceWithPendingTabs(current, tabIds, documentIds)
        ?? { ...current, phase: 'discovering' as const };
      return await this.persist(next, operationEpoch) ? tabIds : [];
    });
  }

  private async snapshot(operationEpoch: number): Promise<ReleaseUpdateFenceTabSnapshot> {
    return runBoundedReleaseUpdateFenceRecovery({
      operation: async (attempt) => {
        const snapshot = releaseUpdateFenceSnapshotFromContexts(
          await this.dependencies.getContexts(),
        );
        if (!snapshot) {
          throw new Error('Chrome returned an unverifiable Litos tab context inventory.');
        }
        // An empty inventory is indistinguishable from a transient service-worker probe miss.
        // Stabilize it across the bounded recovery window before concluding there are no legacy
        // documents. A positive inventory can be frozen and reloaded immediately.
        if (
          snapshot.tabIds.length === 0
          && attempt < RELEASE_UPDATE_FENCE_RECOVERY_DELAYS_MS.length
        ) {
          throw new Error('Chrome temporarily returned no Litos tab contexts.');
        }
        return snapshot;
      },
      operationIsCurrent: () => this.gate.operationIsCurrent(operationEpoch),
      wait: this.dependencies.wait,
    });
  }

  private async contexts(
    operationEpoch: number,
    tabIds?: readonly number[],
  ): Promise<ReleaseUpdateFenceRuntimeContext[]> {
    return runBoundedReleaseUpdateFenceRecovery({
      operation: () => this.dependencies.getContexts(tabIds),
      operationIsCurrent: () => this.gate.operationIsCurrent(operationEpoch),
      wait: this.dependencies.wait,
    });
  }

  private async storedState(operationEpoch: number): Promise<ReleaseUpdateFenceState | null> {
    const raw = await runBoundedReleaseUpdateFenceRecovery({
      operation: () => this.dependencies.readStoredState(),
      operationIsCurrent: () => this.gate.operationIsCurrent(operationEpoch),
      wait: this.dependencies.wait,
    });
    return parseReleaseUpdateFenceState(raw);
  }

  private async persist(
    state: ReleaseUpdateFenceState,
    operationEpoch: number,
  ): Promise<boolean> {
    try {
      await runBoundedReleaseUpdateFenceRecovery({
        operation: () => this.dependencies.writeStoredState(state),
        operationIsCurrent: () => this.gate.operationIsCurrent(operationEpoch),
        wait: this.dependencies.wait,
      });
    } catch (error) {
      this.gate.hold(operationEpoch);
      if (error instanceof StaleReleaseUpdateFenceOperationError) return false;
      throw error;
    }
    return this.gate.observePersistedState(
      operationEpoch,
      releaseUpdateFenceIsReady(state, this.dependencies.installedVersion),
    );
  }

  private async reloadTabs(tabIds: readonly number[], operationEpoch: number): Promise<void> {
    await Promise.all(tabIds.map(async (tabId) => {
      if (!this.gate.operationIsCurrent(operationEpoch)) return;
      const result = await runBoundedReleaseUpdateFenceRecovery({
        operation: async () => {
          const current = await this.dependencies.reloadTab(tabId);
          if (current === 'failed_live') {
            throw new Error('Chrome could not reload a live Litos application tab.');
          }
          return current;
        },
        operationIsCurrent: () => this.gate.operationIsCurrent(operationEpoch),
        wait: this.dependencies.wait,
      });
      if (result === 'missing') {
        await this.closePendingTab(tabId, operationEpoch);
        return;
      }
      if (await this.reloadedTabHasNoContentContexts(tabId, operationEpoch)) {
        await this.closePendingTab(tabId, operationEpoch);
      }
    }));
  }

  private async reloadedTabHasNoContentContexts(
    tabId: number,
    operationEpoch: number,
  ): Promise<boolean> {
    let consecutiveEmptyInventories = 0;
    return runBoundedReleaseUpdateFenceRecovery({
      operation: async (attempt) => {
        let snapshot: ReleaseUpdateFenceTabSnapshot | null;
        try {
          snapshot = releaseUpdateFenceSnapshotFromContexts(
            await this.dependencies.getContexts([tabId]),
          );
        } catch (error) {
          consecutiveEmptyInventories = 0;
          throw error;
        }
        if (!snapshot) {
          consecutiveEmptyInventories = 0;
          throw new Error('Chrome returned an unverifiable post-reload tab context inventory.');
        }
        consecutiveEmptyInventories = snapshot.tabIds.includes(tabId)
          ? 0
          : consecutiveEmptyInventories + 1;
        // chrome.tabs.reload resolves before every navigation/context lifecycle callback has
        // necessarily settled. Probe for the whole bounded window whether the first read still sees
        // the legacy document or already sees no matching context, then decide from the final read.
        if (attempt < RELEASE_UPDATE_FENCE_RECOVERY_DELAYS_MS.length) {
          throw new Error('Chrome has not stabilized the post-reload Litos tab context inventory.');
        }
        if (consecutiveEmptyInventories < 2 && !snapshot.tabIds.includes(tabId)) {
          throw new Error('Chrome returned only one empty post-reload Litos tab context inventory.');
        }
        return consecutiveEmptyInventories >= 2;
      },
      operationIsCurrent: () => this.gate.operationIsCurrent(operationEpoch),
      wait: this.dependencies.wait,
    });
  }

  private async closePendingTab(tabId: number, operationEpoch: number): Promise<void> {
    if (!this.gate.operationIsCurrent(operationEpoch)) return;
    await this.mutations.run(MUTATION_KEY, async () => {
      const current = await this.storedState(operationEpoch);
      if (!current || current.phase !== 'reloading') return;
      const active = acknowledgeReleaseUpdateFenceTab(current, tabId);
      if (active === current) return;
      await this.persist(active ?? readyReleaseUpdateFence(
        current.releaseVersion,
        current.activationId,
        current.activatedAt,
      ), operationEpoch);
    });
  }

  private async retireCancelledOneShotTabs(
    tabIds: readonly number[],
    operationEpoch: number,
  ): Promise<void> {
    await this.mutations.run(MUTATION_KEY, async () => {
      const current = await this.storedState(operationEpoch);
      if (!current || current.phase !== 'reloading') return;
      const retired = new Set(tabIds);
      const remaining = current.pendingTabIds.filter((tabId) => !retired.has(tabId));
      if (remaining.length === current.pendingTabIds.length) return;
      const documentIds = { ...current.legacyDocumentIdsByTab };
      for (const tabId of retired) delete documentIds[String(tabId)];
      const next = releaseUpdateFenceWithPendingTabs(current, remaining, documentIds)
        ?? readyReleaseUpdateFence(
          current.releaseVersion,
          current.activationId,
          current.activatedAt,
        );
      await this.persist(next, operationEpoch);
    });
  }

  private recordTabReplacement(
    removedTabId: number,
    addedTabId: number,
    operationEpoch: number,
  ): void {
    if (
      !this.gate.operationIsCurrent(operationEpoch)
      || !Number.isInteger(removedTabId)
      || removedTabId < 0
      || !Number.isInteger(addedTabId)
      || addedTabId < 0
      || removedTabId === addedTabId
    ) return;
    this.observedTabReplacements.set(removedTabId, { addedTabId, operationEpoch });
  }

  private replacementTarget(tabId: number, operationEpoch: number): number {
    let current = tabId;
    const visited = new Set<number>();
    while (!visited.has(current)) {
      visited.add(current);
      const replacement = this.observedTabReplacements.get(current);
      if (!replacement || replacement.operationEpoch !== operationEpoch) break;
      current = replacement.addedTabId;
    }
    return current;
  }

  private applyObservedTabReplacements(
    snapshot: ReleaseUpdateFenceTabSnapshot,
    operationEpoch: number,
  ): ReleaseUpdateFenceTabSnapshot {
    const tabIds = [...new Set(snapshot.tabIds.map((tabId) =>
      this.replacementTarget(tabId, operationEpoch)))].sort((left, right) => left - right);
    const documentIdsByTab: Record<string, string[]> = {};
    for (const [tabId, documentIds] of Object.entries(snapshot.documentIdsByTab)) {
      const target = String(this.replacementTarget(Number(tabId), operationEpoch));
      documentIdsByTab[target] = [...new Set([
        ...(documentIdsByTab[target] ?? []),
        ...documentIds,
      ])].sort();
    }
    const oneShotTabIds = [...new Set(snapshot.oneShotTabIds.map((tabId) =>
      this.replacementTarget(tabId, operationEpoch)))].sort((left, right) => left - right);
    return { tabIds, documentIdsByTab, oneShotTabIds };
  }
}

function mergedDocumentIds(
  left: Readonly<Record<string, readonly string[]>>,
  right: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    merged[key] = [...new Set([...(left[key] ?? []), ...(right[key] ?? [])])].sort();
  }
  return merged;
}
