import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync('src/entrypoints/content.ts', 'utf8');
const background = readFileSync('src/entrypoints/background.ts', 'utf8');
const gated = readFileSync('src/lib/gated-attended-ats.ts', 'utf8');

describe('Jobvite and iCIMS attended runtime wiring', () => {
  it('preserves the one-shot arm until the authoritative packet succeeds', () => {
    const prepare = background.slice(
      background.indexOf("case 'PREPARE_GATED_ATTENDED_HANDOFF'"),
      background.indexOf("case 'CLAIM_GATED_ATTENDED_CONTINUATION'"),
    );
    expect(prepare).toMatch(/fetchAndBindHandoffPacket\([\s\S]*?consumeArmedAndStoreGatedContinuation/);
    expect(prepare).toMatch(/finally \{[\s\S]*?gatedPreparationsInFlight\.delete/);
    expect(prepare.indexOf('fetchAndBindHandoffPacket')).toBeLessThan(prepare.indexOf('consumeArmedAndStoreGatedContinuation'));
  });

  it('returns one existing continuation when a late login input mounts', () => {
    const prepare = background.slice(
      background.indexOf("case 'PREPARE_GATED_ATTENDED_HANDOFF'"),
      background.indexOf("case 'CLAIM_GATED_ATTENDED_CONTINUATION'"),
    );
    expect(prepare).toMatch(/const existing =[\s\S]*?existing\.identity === currentIdentity\.key[\s\S]*?applicantEmail[\s\S]*?return;/);
    expect(content).toMatch(/preparedGatedStages\.delete\(preparationKey\)/);
    expect(content).toMatch(/fillFrozenIcimsLoginEmail\(response\.email\)/);
  });

  it('supports a direct Jobvite form, requires exact iCIMS identity proof, and launches exactly one fill action', () => {
    const initialize = content.slice(
      content.indexOf('function initializeGatedAttendedApplication'),
      content.indexOf('function init()', content.indexOf('function initializeGatedAttendedApplication')),
    );
    expect(initialize).toMatch(/PREPARE_GATED_ATTENDED_HANDOFF[\s\S]*?CLAIM_GATED_ATTENDED_CONTINUATION/);
    expect(initialize).toMatch(/claimed\.handoffVersion !== prepared\.handoffVersion/);
    expect(initialize).toMatch(/injectResumeFillCard\([\s\S]*?claimed\.applicationId/);
    const initialActivation = content.slice(content.indexOf('if (!initialHandoffApplicationId && !initialFreeFillApplicationId)'));
    expect(initialActivation).toMatch(/else if \(initialHandoffApplicationId\) \{[\s\S]*?yesBtn\.click\(\)/);
    expect(background).toMatch(/validGatedAccountNavigationProof\([\s\S]*?continuation\.accountLoginProofAt/);
    expect(gated).toMatch(/event\.isTrusted/);
    expect(content).toMatch(/PROVE_GATED_ATTENDED_ACCOUNT/);
  });

  it('invalidates a mismatched browser email and rechecks the final form before start', () => {
    expect(content).toMatch(/INVALIDATE_GATED_ATTENDED_CONTINUATION[\s\S]*?before === 'mismatch'/);
    expect(content).toMatch(/exactApplicantEmailError[\s\S]*?expectedGatePacket\.applicantEmail\.trim\(\)\.toLowerCase\(\)[\s\S]*?handoffSubmissionGuard/);
    const manual = content.slice(content.indexOf('function armManualSubmissionTracking'));
    expect(manual).toMatch(/const guardError = submissionGuard\(\)[\s\S]*?EXTENSION_SUBMISSION_START/);
  });

  it('carries strict receipt identity across navigation and never uses generic success text for these families', () => {
    const start = background.slice(
      background.indexOf("case 'EXTENSION_SUBMISSION_START'"),
      background.indexOf("case 'EXTENSION_SUBMISSION_OUTCOME'"),
    );
    expect(start).toMatch(/gatedAttendedIdentity\(currentUrl\)[\s\S]*?strictReceipt/);
    expect(content).toMatch(/monitorExtensionSubmission\([\s\S]*?pending,[\s\S]*?pending\.strictReceipt/);
    expect(content).toMatch(/exactGatedAttendedReceipt\([\s\S]*?return receipt \? \{ kind: 'confirmed' \} : null/);
  });

  it('classifies the live DOM stage before reading a gate page as a job', () => {
    const init = content.slice(content.indexOf('function init()'));
    expect(init.indexOf('inspectGatedAttendedStage(window.location.href)')).toBeLessThan(init.indexOf('const job = getJobDetails()'));
    expect(init).toMatch(/stage === 'application'\) initializeGatedAttendedApplication[\s\S]*?gatedStageCanPrepare[\s\S]*?prepareGatedAttendedStage/);
    expect(init).not.toMatch(/else prepareGatedAttendedStage/);
  });

  it('retries a transient preparation or claim failure without requiring navigation', () => {
    expect(content).toMatch(/preparedGatedStages\.delete\(preparationKey\)[\s\S]*?retryGatedStage\(stage, \(\) => prepareGatedAttendedStage\(stage\)\)/);
    expect(content).toMatch(/initializedGatedApplications\.delete\(stage\.identity\)[\s\S]*?retryGatedStage\(stage, \(\) => initializeGatedAttendedApplication\(stage\)\)/);
    expect(content).toMatch(/if \(count >= 3\) return/);
  });

  it('serializes prepare, prove, invalidate, and claim by one tab and frame key', () => {
    expect(background).toMatch(/const gatedContinuationMutations = new KeyedMutationQueue/);
    expect(background).toMatch(/claimGatedAttendedContinuation[\s\S]*?withGatedContinuationMutation\(key/);
    expect(background).toMatch(/case 'PROVE_GATED_ATTENDED_ACCOUNT'[\s\S]*?withGatedContinuationMutation\(key/);
    expect(background).toMatch(/case 'INVALIDATE_GATED_ATTENDED_CONTINUATION'[\s\S]*?withGatedContinuationMutation/);
    expect(background).toMatch(/GATED_ATTENDED_CONTINUATION_PREFIX}:\$\{tabId}:\$\{frameId}/);
  });

  it('binds iCIMS account proof to a trusted login document and requires a later document', () => {
    expect(background).toMatch(/case 'PROVE_GATED_ATTENDED_ACCOUNT'[\s\S]*?sender\.documentId[\s\S]*?accountLoginProofDocumentId: proofDocumentId/);
    expect(background).toMatch(/claimGatedAttendedContinuation\(tabId, frameId, currentUrl, sender\.documentId\)/);
    expect(background).toContain('validGatedAccountNavigationProof');
  });

  it('supports trusted security-code proof without reading or entering the code', () => {
    expect(content).toMatch(/stage\.stage === 'security_code'[\s\S]*?guardTrustedSecurityCodeIntent[\s\S]*?proofKind: 'security_code'/);
    expect(background).toMatch(/proofKind === 'security_code'[\s\S]*?proofKind === 'login_email'/);
    expect(gated).toMatch(/guardTrustedSecurityCodeIntent[\s\S]*?event\.isTrusted/);
    expect(background).toMatch(/proofKind === 'security_code'[\s\S]*?loginProofAt: continuation\.accountLoginProofAt[\s\S]*?securityCodeProofDocumentId: proofDocumentId/);
  });

  it('uses only the version-bound structured snapshot for attended applicant facts', () => {
    const packet = background.slice(
      background.indexOf("case 'GET_APPLICATION_HANDOFF_PACKET'"),
      background.indexOf("case 'GET_WORKDAY_ACCOUNT_STATE'"),
    );
    expect(packet).toContain('frozenApplicantFillData(resume)');
    expect(packet).not.toContain("timeoutBackendFetch('/profile'");
    expect(packet).not.toContain("timeoutBackendFetch('/profile/application'");
    const adoption = content.slice(content.indexOf('const adoptAuthoritativePacketImpl'));
    expect(adoption).toMatch(/frozenApplicantFillData\(exactResume\)[\s\S]*?profile: exactFillData\.profile[\s\S]*?applicationProfile: exactFillData\.applicationProfile/);
  });

  it('propagates armed storage failures and serializes unconditional binding cleanup', () => {
    expect(background).toMatch(/async function writeArmedHandoffs[\s\S]*?await chrome\.storage\.session\.set\(\{ \[ARMED_HANDOFF_KEY\]: entries \}\);/);
    expect(background).toMatch(/async function readArmedHandoffs[\s\S]*?await chrome\.storage\.session\.get\(ARMED_HANDOFF_KEY\);/);
    expect(background).not.toMatch(/writeArmedHandoffs[\s\S]{0,180}?\.catch\(\(\) => \{\}\)/);
    expect(background).toMatch(/persistOneShotTransition\([\s\S]*?persistSource: writeArmedHandoffs[\s\S]*?persistDestination/);
    const cleanup = background.slice(background.indexOf('async function clearApplicationRuntimeState'));
    expect(cleanup).toMatch(/handoffPacketBindingMutations\.run\([\s\S]*?chrome\.storage\.session\.remove\(HANDOFF_PACKET_BINDINGS_KEY\)/);
  });

  it('checks the account epoch around packet, fill, binding, start, click, and outcome work', () => {
    const packet = background.slice(background.indexOf("case 'GET_APPLICATION_HANDOFF_PACKET'"));
    expect(packet).toMatch(/packetAuthEpoch[\s\S]*?authEpoch: packetAuthEpoch[\s\S]*?storeHandoffPacketBinding[\s\S]*?packetAuthEpoch/);
    const dashboard = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));
    expect(dashboard).toMatch(/dashboardAuthEpoch[\s\S]*?fetchAndBindHandoffPacket[\s\S]*?PREPARE_SUBMISSION_FROM_DASHBOARD[\s\S]*?extension-start[\s\S]*?SUBMIT_FROM_DASHBOARD[\s\S]*?settlePendingSubmissionOutcome/);
    expect(dashboard.match(/assertCurrentAuthEpoch\(dashboardAuthEpoch\)/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(background).toMatch(/setPendingSubmission[\s\S]*?pendingSubmissionMutations\.run/);
    expect(background).toMatch(/applicationTabMutations\.run\(APPLICATION_TAB_MUTATION_KEY[\s\S]*?litos_application_tabs/);
    const cleanup = background.slice(background.indexOf('async function clearApplicationRuntimeState'));
    expect(cleanup).toMatch(/pendingSubmissionMutations\.run[\s\S]*?applicationTabMutations\.run/);
  });
});
