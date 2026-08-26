import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../wxt.config.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('./release-update-fence-controller.ts', import.meta.url), 'utf8');
const stateMachine = readFileSync(new URL('./release-update-fence.ts', import.meta.url), 'utf8');

describe('extension update runtime fence', () => {
  it('freezes before accepting a later update and reloads the worker only after cancellation', () => {
    const updateHook = background.match(/chrome\.runtime\.onUpdateAvailable[\s\S]*?\n  \}\);/)?.[0] ?? '';
    const updateWorkflow = controller.slice(
      controller.indexOf('onUpdateAvailable('),
      controller.indexOf('\n  async blocksSubmissions'),
    );
    expect(updateHook).toContain('runReleaseFenceUpdate(details.version)');
    expect(updateWorkflow).toMatch(/activateSynchronously[\s\S]*?cancelAllTabs[\s\S]*?activate[\s\S]*?snapshotBeforeWorkerReload[\s\S]*?cancelTabs[\s\S]*?reloadWorker/);
    expect(background).toMatch(/runReleaseFenceUpdate[\s\S]*?onUpdateAvailable[\s\S]*?setTimeout[\s\S]*?runReleaseFenceUpdate/);
  });

  it('cancels live content before an installed update reads or writes durable state', () => {
    const installedUpdateWorkflow = controller.slice(
      controller.indexOf('private async activateInstalledUpdate('),
      controller.indexOf('\n  private async resumePendingWorkerUpdate'),
    );
    expect(controller).toMatch(/onInstalled[\s\S]*?activateSynchronously[\s\S]*?activateInstalledUpdate/);
    expect(installedUpdateWorkflow).toMatch(/cancelAllTabs[\s\S]*?this\.activate\([\s\S]*?discoverAndReloadLegacyTabs/);
    expect(background).toMatch(/runReleaseFenceInstalled[\s\S]*?onInstalled[\s\S]*?setTimeout[\s\S]*?runReleaseFenceInstalled\('update'\)/);
  });

  it('inventories exact extension tab contexts and waits for exact ready acks', () => {
    expect(background).toContain('chrome.runtime.getContexts');
    expect(background).toContain("contextTypes: ['TAB']");
    expect(controller).toMatch(/releaseUpdateFenceWithPendingTabs[\s\S]*?cancelTabs[\s\S]*?reloadTabs/);
    expect(controller).toContain('discoveryInFlight');
    expect(controller).toContain('releaseUpdateFenceReadyInventoryAllowsAcknowledge');
    expect(background).toMatch(/case 'LITOS_RELEASE_FENCE_READY'[\s\S]*?releaseUpdateFence\.ready/);
    expect(background).toMatch(/documentId: sender\.documentId,[\s\S]*?frameId: sender\.frameId/);
    expect(background).toMatch(/releaseUpdateFence\.ready\([\s\S]*?\.catch\(\(\) => \{[\s\S]*?retryReleaseFenceResume\(\)/);
    expect(background).toContain('contentScriptPersistsAfterReload(');
    const controllerSetup = background.slice(
      background.indexOf('const releaseUpdateFence = new ReleaseUpdateFenceController'),
      background.indexOf('async function releaseUpdateFenceBlocksSubmissions'),
    );
    expect(controllerSetup).toMatch(/getContexts: async[\s\S]*?chrome\.runtime\.getManifest\(\)/);
    expect(background.slice(0, background.indexOf('const releaseUpdateFence = new ReleaseUpdateFenceController')))
      .not.toContain('chrome.runtime.getManifest()');
    expect(controller).toContain('retireCancelledOneShotTabs');
  });

  it('keeps activation latched across persistence failure and transfers replaced tabs', () => {
    expect(stateMachine).toContain('this.activationLatch = true');
    expect(stateMachine).toContain('runBoundedReleaseUpdateFenceRecovery');
    expect(controller).toMatch(/private async persist\([\s\S]*?operationEpoch: number/);
    expect(controller).toMatch(/operationIsCurrent: \(\) => this\.gate\.operationIsCurrent\(operationEpoch\)/);
    expect(controller).not.toMatch(/persist\([^,\n]+\)/);
    expect(controller).not.toContain('frameId !== 0');
    expect(controller).toContain('legacyDocumentIdsByTab');
    expect(controller).toContain('observedTabReplacements');
    expect(background).toMatch(/chrome\.tabs\.onReplaced[\s\S]*?releaseUpdateFence\.replaced/);
    expect(background).toMatch(/chrome\.tabs\.onRemoved[\s\S]*?releaseUpdateFence\.closed[\s\S]*?retryReleaseFenceResume/);
    expect(background).toMatch(/chrome\.tabs\.onReplaced[\s\S]*?releaseUpdateFence\.replaced[\s\S]*?retryReleaseFenceResume/);
    expect(controller).toMatch(/replaceReleaseUpdateFenceTab[\s\S]*?persist[\s\S]*?reloadTabs/);
  });

  it('requires a persisted ready record for this exact installed version', () => {
    expect(controller).toContain('releaseUpdateFenceIsReady(state, this.dependencies.installedVersion)');
    expect(controller).not.toContain('state !== null');
    expect(controller).toContain('readyReleaseUpdateFence(');
    expect(background).not.toContain(`remove(RELEASE_UPDATE_FENCE_STORAGE_KEY)`);
    expect(background).toContain('retryReleaseFenceResume()');
  });

  it('does not request broad tab or browsing-history permission for the one-time sweep', () => {
    const permissions = config.match(/permissions:\s*\[[^\]]*\]/)?.[0] ?? '';
    expect(permissions).not.toContain("'tabs'");
    expect(permissions).not.toContain("'webNavigation'");
  });

  it('holds old countdown starts and website-triggered dashboard sends while fenced', () => {
    const manualPreflight = background.slice(background.indexOf("case 'PREFLIGHT_FREE_MANUAL_SUBMISSION'"), background.indexOf("case 'CANCEL_FREE_MANUAL_SUBMISSION'"));
    const settings = background.slice(background.indexOf("case 'GET_AUTOMATION_SETTINGS'"), background.indexOf("case 'EXTENSION_SUBMISSION_START'"));
    const extensionStart = background.slice(background.indexOf("case 'EXTENSION_SUBMISSION_START'"), background.indexOf("case 'EXTENSION_SUBMISSION_OUTCOME'"));
    const dashboardStart = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));
    expect(manualPreflight.match(/releaseUpdateFenceBlocksSubmissions/g)?.length).toBeGreaterThanOrEqual(2);
    expect(manualPreflight).toContain('closeAndClearPendingFreeManualReservation');
    expect(settings.match(/releaseUpdateFenceBlocksSubmissions/g)?.length).toBeGreaterThanOrEqual(2);
    expect(extensionStart.match(/releaseUpdateFenceBlocksSubmissions/g)?.length).toBeGreaterThanOrEqual(2);
    expect(dashboardStart.match(/releaseUpdateFenceBlocksSubmissions/g)?.length).toBeGreaterThanOrEqual(3);
    expect(dashboardStart).toContain("'cancelled'");
    expect(dashboardStart).toContain('The extension updated after reservation. Nothing was clicked.');
  });

  it('starts the new content script closed and cannot reopen after an update cancel', () => {
    const boundary = content.slice(content.indexOf('let preArmBoundaryShieldActive = true'), content.indexOf('const GENERATED_EXTENSION_SUBMISSION_ENABLED'));
    const currentBoundary = boundary || content.slice(content.indexOf('let preArmBoundaryShield = initialPreArmBoundaryShieldState()'), content.indexOf('const GENERATED_EXTENSION_SUBMISSION_ENABLED'));
    expect(currentBoundary).toContain('initialReleaseUpdateFenceContentState()');
    expect(currentBoundary).toMatch(/releasePreArmBoundaryShield[\s\S]*?requestPreArmBoundaryShieldRelease/);
    expect(currentBoundary).toContain('settlePreArmBoundaryShieldForReleaseFence');
    expect(currentBoundary).toMatch(/LITOS_RELEASE_FENCE_CANCEL[\s\S]*?cancelReleaseUpdateFenceContent[\s\S]*?activatePreArmBoundaryShield[\s\S]*?activeAutoSubmitCancel/);
    expect(currentBoundary).toMatch(/LITOS_RELEASE_FENCE_READY[\s\S]*?EXTENSION_VERSION/);
    expect(currentBoundary).toMatch(/const requestEpoch = releaseUpdateFenceState\.epoch[\s\S]*?settleReleaseUpdateFenceContentReady/);
    expect(currentBoundary).toMatch(/releaseUpdateFenceState\.active[\s\S]*?scheduleReleaseFenceReady\(2_000\)/);
    expect(currentBoundary).toMatch(/void chrome\.runtime\.lastError[\s\S]*?scheduleReleaseFenceReady\(2_000\)/);
  });

  it('retries an unavailable startup manual-reservation inventory without releasing a newer boundary', () => {
    const startup = content.slice(
      content.indexOf('type StartupManualReservationResponse'),
      content.indexOf('const checkPendingFreeSubmissionOutcome'),
    );
    expect(startup).toMatch(/setTimeout\(\(\) => finish\(null\), 25_000\)[\s\S]*?chrome\.runtime\.lastError[\s\S]*?finish\(failed \|\| !response \? null : response\)/);
    expect(startup).toMatch(/catch \{[\s\S]*?finish\(null\)/);
    expect(startup).toMatch(/startupManualReservationBoundaryEpoch[\s\S]*?scheduleStartupManualReservationRetry/);
    expect(startup).toMatch(/response\?\.blocked === false[\s\S]*?releasePreArmBoundaryShield\(startupManualReservationBoundaryEpoch\)[\s\S]*?scheduleStartupManualReservationRetry/);
    expect(startup).toMatch(/preArmBoundaryShield\.epoch !== startupManualReservationBoundaryEpoch/);
    const manualArm = content.slice(
      content.indexOf('function armFreeManualSubmissionOutcomeTracking('),
      content.indexOf('// No top-frame gating'),
    );
    expect(manualArm).toMatch(/ownerEpoch: number[\s\S]*?preArmBoundaryShield\.epoch !== ownerEpoch/);
    expect(content).toMatch(/data\.submission_event_id,[\s\S]*?reservedAtsName,[\s\S]*?statusEl,[\s\S]*?actionBoundaryEpoch/);
  });
});
