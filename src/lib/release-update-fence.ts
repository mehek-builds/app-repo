export const RELEASE_UPDATE_FENCE_STORAGE_KEY = 'litos_release_update_fence_v2';

export type ReleaseUpdateFencePhase = 'ready' | 'awaiting_update' | 'discovering' | 'reloading';

export type ReleaseUpdateFenceState = {
  schemaVersion: 2;
  active: boolean;
  releaseVersion: string;
  activationId: string;
  phase: ReleaseUpdateFencePhase;
  activatedAt: number;
  pendingTabIds: number[];
  legacyDocumentIdsByTab: Record<string, string[]>;
};

export type ReleaseUpdateFenceRuntimeContext = {
  tabId: number;
  frameId: number;
  documentId?: string;
  persistsAfterReload?: boolean;
};

export type ReleaseUpdateFenceTabSnapshot = {
  tabIds: number[];
  documentIdsByTab: Record<string, string[]>;
  oneShotTabIds: number[];
};

export const RELEASE_UPDATE_FENCE_RECOVERY_DELAYS_MS = [25, 100, 400] as const;

export class StaleReleaseUpdateFenceOperationError extends Error {
  constructor() {
    super('The release update fence activation changed during this operation.');
    this.name = 'StaleReleaseUpdateFenceOperationError';
  }
}

/**
 * The in-memory latch closes synchronously when Chrome announces an activation. Persisted state is
 * still the durable authority, but an older async storage operation may never reopen a newer epoch.
 */
export class ReleaseUpdateFenceActivationGate {
  private epoch = 0;
  private synchronousHold = true;
  private activationLatch = false;

  captureOperationEpoch(): number {
    return this.epoch;
  }

  beginActivation(): number {
    this.epoch += 1;
    this.activationLatch = true;
    this.synchronousHold = true;
    return this.epoch;
  }

  operationIsCurrent(operationEpoch: number): boolean {
    return operationEpoch === this.epoch;
  }

  observePersistedState(operationEpoch: number, ready: boolean): boolean {
    if (!this.operationIsCurrent(operationEpoch)) return false;
    if (ready) this.activationLatch = false;
    this.synchronousHold = !ready;
    return true;
  }

  observeRead(operationEpoch: number, ready: boolean): boolean {
    if (!this.operationIsCurrent(operationEpoch) || this.activationLatch) return false;
    this.synchronousHold = !ready;
    return true;
  }

  hold(operationEpoch?: number): void {
    if (operationEpoch !== undefined && !this.operationIsCurrent(operationEpoch)) return;
    this.synchronousHold = true;
  }

  blocks(ready: boolean): boolean {
    return this.activationLatch || this.synchronousHold || !ready;
  }
}

export async function runBoundedReleaseUpdateFenceRecovery<T>(input: {
  operation: (attempt: number) => Promise<T>;
  operationIsCurrent: () => boolean;
  delaysMs?: readonly number[];
  wait?: (delayMs: number) => Promise<void>;
}): Promise<T> {
  const delays = input.delaysMs ?? RELEASE_UPDATE_FENCE_RECOVERY_DELAYS_MS;
  const wait = input.wait ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let attempt = 0;
  while (true) {
    if (!input.operationIsCurrent()) throw new StaleReleaseUpdateFenceOperationError();
    try {
      const result = await input.operation(attempt);
      if (!input.operationIsCurrent()) throw new StaleReleaseUpdateFenceOperationError();
      return result;
    } catch (error) {
      if (error instanceof StaleReleaseUpdateFenceOperationError || !input.operationIsCurrent()) {
        throw new StaleReleaseUpdateFenceOperationError();
      }
      if (attempt >= delays.length) throw error;
      await wait(delays[attempt]!);
      attempt += 1;
    }
  }
}

export function activeReleaseUpdateFence(
  releaseVersion: string,
  activationId: string,
  phase: Exclude<ReleaseUpdateFencePhase, 'ready'>,
  now: number,
  pendingTabIds: readonly number[] = [],
  legacyDocumentIdsByTab: Readonly<Record<string, readonly string[]>> = {},
): ReleaseUpdateFenceState {
  return {
    schemaVersion: 2,
    active: true,
    releaseVersion,
    activationId,
    phase,
    activatedAt: now,
    pendingTabIds: normalizedTabIds(pendingTabIds),
    legacyDocumentIdsByTab: normalizedDocumentIds(legacyDocumentIdsByTab),
  };
}

export function readyReleaseUpdateFence(
  releaseVersion: string,
  activationId: string,
  now: number,
): ReleaseUpdateFenceState {
  return {
    schemaVersion: 2,
    active: false,
    releaseVersion,
    activationId,
    phase: 'ready',
    activatedAt: now,
    pendingTabIds: [],
    legacyDocumentIdsByTab: {},
  };
}

export function releaseUpdateFenceIsReady(
  state: ReleaseUpdateFenceState | null,
  releaseVersion: string,
): boolean {
  return Boolean(
    state
    && state.active === false
    && state.phase === 'ready'
    && state.releaseVersion === releaseVersion
    && state.pendingTabIds.length === 0,
  );
}

export function parseReleaseUpdateFenceState(value: unknown): ReleaseUpdateFenceState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ReleaseUpdateFenceState>;
  const phases: ReleaseUpdateFencePhase[] = ['ready', 'awaiting_update', 'discovering', 'reloading'];
  const phase = phases.includes(candidate.phase as ReleaseUpdateFencePhase)
    ? candidate.phase as ReleaseUpdateFencePhase
    : null;
  if (
    candidate.schemaVersion !== 2
    || !phase
    || candidate.active !== (phase !== 'ready')
    || typeof candidate.releaseVersion !== 'string'
    || !candidate.releaseVersion.trim()
    || typeof candidate.activationId !== 'string'
    || !candidate.activationId.trim()
    || typeof candidate.activatedAt !== 'number'
    || !Number.isFinite(candidate.activatedAt)
    || !Array.isArray(candidate.pendingTabIds)
    || candidate.pendingTabIds.some((tabId) => !Number.isInteger(tabId) || tabId < 0)
    || !validDocumentIdMap(candidate.legacyDocumentIdsByTab)
    || (phase === 'ready' && candidate.pendingTabIds.length !== 0)
  ) return null;
  return phase === 'ready'
    ? readyReleaseUpdateFence(candidate.releaseVersion, candidate.activationId, candidate.activatedAt)
    : activeReleaseUpdateFence(
      candidate.releaseVersion,
      candidate.activationId,
      phase,
      candidate.activatedAt,
      candidate.pendingTabIds,
      candidate.legacyDocumentIdsByTab,
    );
}

export function releaseUpdateFenceWithPendingTabs(
  state: ReleaseUpdateFenceState,
  pendingTabIds: readonly number[],
  legacyDocumentIdsByTab: Readonly<Record<string, readonly string[]>> = state.legacyDocumentIdsByTab,
): ReleaseUpdateFenceState | null {
  const normalized = normalizedTabIds(pendingTabIds);
  if (normalized.length === 0) return null;
  return {
    ...state,
    active: true,
    phase: 'reloading',
    pendingTabIds: normalized,
    legacyDocumentIdsByTab: normalizedDocumentIds(legacyDocumentIdsByTab),
  };
}

export function acknowledgeReleaseUpdateFenceTab(
  state: ReleaseUpdateFenceState,
  tabId: number,
): ReleaseUpdateFenceState | null {
  if (state.phase !== 'reloading' || !state.pendingTabIds.includes(tabId)) return state;
  const remaining = state.pendingTabIds.filter((pendingTabId) => pendingTabId !== tabId);
  if (remaining.length === 0) return null;
  const legacyDocumentIdsByTab = { ...state.legacyDocumentIdsByTab };
  delete legacyDocumentIdsByTab[String(tabId)];
  return releaseUpdateFenceWithPendingTabs(state, remaining, legacyDocumentIdsByTab);
}

export function replaceReleaseUpdateFenceTab(
  state: ReleaseUpdateFenceState,
  removedTabId: number,
  addedTabId: number,
): ReleaseUpdateFenceState {
  if (state.phase !== 'reloading' || !state.pendingTabIds.includes(removedTabId)) return state;
  const legacyDocumentIdsByTab = { ...state.legacyDocumentIdsByTab };
  const removedDocumentIds = legacyDocumentIdsByTab[String(removedTabId)] ?? [];
  delete legacyDocumentIdsByTab[String(removedTabId)];
  legacyDocumentIdsByTab[String(addedTabId)] = [
    ...(legacyDocumentIdsByTab[String(addedTabId)] ?? []),
    ...removedDocumentIds,
  ];
  return {
    ...state,
    pendingTabIds: normalizedTabIds([
      ...state.pendingTabIds.filter((pendingTabId) => pendingTabId !== removedTabId),
      addedTabId,
    ]),
    legacyDocumentIdsByTab: normalizedDocumentIds(legacyDocumentIdsByTab),
  };
}

export function releaseUpdateFenceSnapshotFromContexts(
  contexts: readonly ReleaseUpdateFenceRuntimeContext[],
): ReleaseUpdateFenceTabSnapshot | null {
  if (contexts.some((context) =>
    !Number.isInteger(context.tabId)
    || context.tabId < 0
    || !Number.isInteger(context.frameId)
    || context.frameId < 0
    || typeof context.documentId !== 'string'
    || !context.documentId.trim())) return null;

  const tabIds = normalizedTabIds(contexts.map((context) => context.tabId));
  const documentIdsByTab: Record<string, string[]> = {};
  for (const context of contexts) {
    const key = String(context.tabId);
    documentIdsByTab[key] = [...new Set([
      ...(documentIdsByTab[key] ?? []),
      context.documentId!,
    ])].sort();
  }
  const oneShotTabIds = tabIds.filter((tabId) => {
    const tabContexts = contexts.filter((context) => context.tabId === tabId);
    return tabContexts.length > 0
      && tabContexts.every((context) => context.persistsAfterReload === false);
  });
  return { tabIds, documentIdsByTab, oneShotTabIds };
}

/**
 * READY is proof about a document, not a frame number. An iframe-only application can acknowledge
 * after Chrome's runtime inventory contains the sender and contains none of the snapshotted legacy
 * documents. A partial, missing, or stale inventory remains blocked and the content script retries.
 */
export function releaseUpdateFenceReadyInventoryAllowsAcknowledge(input: {
  state: ReleaseUpdateFenceState;
  installedVersion: string;
  tabId: number;
  releaseVersion: string;
  documentId?: string;
  frameId?: number;
  contexts: readonly ReleaseUpdateFenceRuntimeContext[];
}): boolean {
  if (
    input.state.active !== true
    || input.state.phase !== 'reloading'
    || input.state.releaseVersion !== input.installedVersion
    || input.releaseVersion !== input.installedVersion
    || !input.state.pendingTabIds.includes(input.tabId)
    || typeof input.documentId !== 'string'
    || !input.documentId.trim()
    || !Number.isInteger(input.frameId)
    || input.frameId! < 0
  ) return false;

  const snapshot = releaseUpdateFenceSnapshotFromContexts(input.contexts);
  if (!snapshot || snapshot.tabIds.some((tabId) => tabId !== input.tabId)) return false;
  const senderPresent = input.contexts.some((context) =>
    context.tabId === input.tabId
    && context.frameId === input.frameId
    && context.documentId === input.documentId);
  if (!senderPresent) return false;

  const legacyDocumentIds = new Set(
    input.state.legacyDocumentIdsByTab[String(input.tabId)] ?? [],
  );
  return !(snapshot.documentIdsByTab[String(input.tabId)] ?? [])
    .some((documentId) => legacyDocumentIds.has(documentId));
}

function validDocumentIdMap(value: unknown): value is Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([tabId, documentIds]) =>
    /^\d+$/.test(tabId)
    && Array.isArray(documentIds)
    && documentIds.every((documentId) => typeof documentId === 'string' && Boolean(documentId.trim())));
}

function normalizedDocumentIds(
  value: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(Object.entries(value)
    .filter(([tabId]) => /^\d+$/.test(tabId))
    .map(([tabId, documentIds]) => [
      tabId,
      [...new Set(documentIds.filter((documentId) => documentId.trim()))].sort(),
    ])
    .filter(([, documentIds]) => documentIds.length > 0));
}

function normalizedTabIds(tabIds: readonly number[]): number[] {
  return [...new Set(tabIds.filter((tabId) => Number.isInteger(tabId) && tabId >= 0))]
    .sort((left, right) => left - right);
}
