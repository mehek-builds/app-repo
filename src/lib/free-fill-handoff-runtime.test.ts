import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

describe('dashboard Free fill runtime wiring', () => {
  it('implements the exact external contract and arms only after owned backend proof', () => {
    const external = background.slice(
      background.indexOf("message?.type === 'LITOS_START_FREE_FILL'"),
      background.indexOf("message?.type === 'LITOS_CREATE_CHECKOUT'"),
    );
    expect(external).toContain('prepareFreeFillHandoff(message');
    expect(external).toContain("timeoutBackendFetch('/applications?limit=100'");
    expect(external).toContain("body?.applications?.find((item) => item.id === applicationId)");
    expect(external).not.toContain('ownedFreeFillHandoffData');
    expect(external).not.toContain('manual-submission-start');
    expect(external).toMatch(/authEpochIsCurrent\(result\.authEpoch\)[\s\S]*?mode: 'free_fill'/);
    expect(external).toContain('return { ok: true as const, armed: true as const }');
    expect(external.indexOf('prepareFreeFillHandoff(message')).toBeLessThan(external.indexOf('armHandoffs(existing'));
  });

  it('removes a newly written arm if the extension account changes during storage', () => {
    const external = background.slice(
      background.indexOf("message?.type === 'LITOS_START_FREE_FILL'"),
      background.indexOf("message?.type === 'LITOS_CREATE_CHECKOUT'"),
    );
    expect(external.match(/authEpochIsCurrent\(result\.authEpoch\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(external).toMatch(/await writeArmedHandoffs\(next\)[\s\S]*?current\.filter[\s\S]*?armedHandoffMode\(entry\) === 'free_fill'/);
  });

  it('uses the canonical id without creating a duplicate and rechecks the live portal', () => {
    const freeData = background.slice(
      background.indexOf("case 'GET_FREE_FILL_DATA'"),
      background.indexOf("case 'RECORD_FREE_FILL_RESULT'"),
    );
    const canonicalSelection = freeData.slice(
      freeData.indexOf('if (requestedApplicationId)'),
      freeData.indexOf('} else if (company && role && portalUrl)'),
    );
    expect(canonicalSelection).toContain('applicationId = requestedApplicationId');
    expect(canonicalSelection).not.toContain("timeoutBackendFetch('/applications'");
    expect(freeData).toContain('ownedFreeFillHandoffData(');
    expect(freeData).toContain('freeFillPortalMatches(fillData.portal_url, portalUrl)');
    expect(freeData.indexOf('reserveFreeManualSubmission('))
      .toBeLessThan(freeData.indexOf('ownedFreeFillHandoffData('));
    expect(content).toMatch(/type: 'GET_FREE_FILL_DATA'[\s\S]*?application_id: dashboardFreeFillApplicationId/);
  });

  it('settles an ordinary unarmed page before enabling its resolved named action', () => {
    const claim = content.slice(
      content.indexOf("{ type: 'CLAIM_HANDOFF', url: window.location.href }", content.indexOf('The attended handoff from the Litos dashboard')),
      content.indexOf('const AUTO_SUBMIT_COUNTDOWN_SECONDS'),
    );
    expect(claim).toMatch(/settleHandoffClaim\(\);[\s\S]*?!response\?\.armed[\s\S]*?renderResolvedFillAction\(\);[\s\S]*?return;/);
    expect(content).toMatch(/if \(!handoffClaimSettled \|\| !resolvedFillPresentation\) return;/);
  });

  it('routes free_fill to an explicit Free action without packet state or an automatic click', () => {
    const claim = content.slice(
      content.indexOf("{ type: 'CLAIM_HANDOFF', url: window.location.href }", content.indexOf('The attended handoff from the Litos dashboard')),
      content.indexOf("if (response.applicationId) {", content.indexOf('The attended handoff from the Litos dashboard')),
    );
    const freeBranch = claim.slice(claim.indexOf("response.mode === 'free_fill'"));
    expect(freeBranch).toContain('dashboardFreeFillApplicationId = response.applicationId ?? null');
    expect(freeBranch).not.toContain('handoffApplicationId =');
    expect(freeBranch).not.toContain('yesBtn.click()');
    expect(content).toContain('forceFreeFill || Boolean(dashboardFreeFillApplicationId)');
  });

  it('bypasses immutable packet preparation on gated Jobvite and iCIMS Free fills', () => {
    const prepare = background.slice(
      background.indexOf("case 'PREPARE_GATED_ATTENDED_HANDOFF'"),
      background.indexOf("case 'CLAIM_GATED_ATTENDED_CONTINUATION'"),
    );
    expect(prepare.indexOf("armedHandoffMode(armed) === 'free_fill'")).toBeLessThan(prepare.indexOf('fetchAndBindHandoffPacket'));
    const initialize = content.slice(
      content.indexOf('function initializeGatedAttendedApplication'),
      content.indexOf('function init()', content.indexOf('function initializeGatedAttendedApplication')),
    );
    expect(initialize).toMatch(/prepared\.mode === 'free_fill'[\s\S]*?CLAIM_HANDOFF[\s\S]*?claimed\.mode !== 'free_fill'/);
    expect(initialize).toMatch(/injectResumeFillCard\([\s\S]*?undefined,[\s\S]*?undefined,[\s\S]*?claimed\.applicationId/);
  });
});
