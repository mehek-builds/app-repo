import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync('src/entrypoints/content.ts', 'utf8');
const background = readFileSync('src/entrypoints/background.ts', 'utf8');
const adapter = readFileSync('src/lib/adapters/ats-2026-07.ts', 'utf8');

describe('SmartRecruiters exact packet attended handoff', () => {
  it('carries the claimed application id to the exact saved packet loader instead of generating again', () => {
    expect(content).toMatch(/handoffApplicationId[\s\S]*?GET_APPLICATION_HANDOFF_PACKET[\s\S]*?applicationId: handoffApplicationId/);
    expect(background).toMatch(/case 'GET_APPLICATION_HANDOFF_PACKET'[\s\S]*?\/applications\/\$\{applicationId\}\/submission\/extension-packet/);
    expect(background).toMatch(/resume\.resume_id !== applicationId \|\| resume\.application\?\.id !== applicationId/);
    expect(content).toMatch(/reviewedQuestionsForHandoff\(resume\)/);
    expect(content).toMatch(/applicantEmailForGeneratedPacket\(resume, profile\.email\)/);
    expect(background).toMatch(/extension-packet\?current_url=\$\{encodeURIComponent\(currentUrl\)\}/);
  });

  it('replays frozen answers and never redrafts an attended packet question', () => {
    expect(content).toMatch(/if \(handoffApplicationId\) \{[\s\S]*?frozenAnswerForQuestion\(frozenHandoffQuestions, question\)/);
    expect(content).toMatch(/replayReviewedAnswers\(document, frozenHandoffQuestions\)/);
    expect(content).toMatch(/reviewedAnswersMatch\(document, frozenHandoffQuestions\)\.failed\.length/);
    expect(content).toMatch(/armManualSubmissionTracking\([^;]*handoffSubmissionGuard\)/);
    expect(content).toMatch(/submitFromDashboard = async[\s\S]*?handoffSubmissionGuard\(\)/);
  });

  it('does not touch a form when the backend rejects the authoritative current URL', () => {
    const rejectedPacketGuard = content.indexOf('if (!result || result.error || !result.profile || !result.applicationProfile || !result.resume)');
    const adapterFill = content.indexOf('fillResult = await withInactivityTimeout');
    expect(rejectedPacketGuard).toBeGreaterThan(-1);
    expect(adapterFill).toBeGreaterThan(rejectedPacketGuard);
  });

  it('uses the same exact-packet loader for non-SmartRecruiters armed forms', () => {
    const claim = content.slice(content.indexOf("{ type: 'CLAIM_HANDOFF'"));
    expect(claim).toMatch(/handoffApplicationId = response\.applicationId[\s\S]*?yesBtn\.click\(\)/);
    expect(claim).not.toMatch(/smartrecruiters[\s\S]*?handoffApplicationId = response\.applicationId/i);
  });

  it('rearms the one-click form before navigating away from the posting', () => {
    expect(content).toMatch(/CONTINUE_SMARTRECRUITERS_HANDOFF[\s\S]*?window\.location\.assign\(targetUrl\)/);
    expect(background).toMatch(/case 'CONTINUE_SMARTRECRUITERS_HANDOFF'[\s\S]*?continueSmartRecruitersHandoff\(entries, sourceUrl, targetUrl/);
    const continuation = content.slice(content.indexOf("type: 'CONTINUE_SMARTRECRUITERS_HANDOFF'"));
    expect(continuation.slice(0, continuation.indexOf('});') + 3)).not.toMatch(/applicationId/);
  });

  it('pins the exact immutable packet version through manual and dashboard starts', () => {
    expect(background).toMatch(/validHandoffVersion\(resume\.handoff_version\)[\s\S]*?storeHandoffPacketBinding/);
    expect(background).toMatch(/case 'EXTENSION_SUBMISSION_START'[\s\S]*?handoff_version: binding\.handoffVersion[\s\S]*?current_url: binding\.currentUrl/);
    const dashboardStart = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));
    expect(dashboardStart).toMatch(/handoff_version: handoffVersion[\s\S]*?current_url: currentUrl/);
    expect(background).toMatch(/if \(!handoffBinding\) \{[\s\S]*?review handoff failed/);
  });

  it('downloads and uploads the exact generated PDF through the SmartRecruiters file control', () => {
    expect(content).toMatch(/fetchResumeBlob\(result\.resume\.resume_url\)/);
    expect(adapter).toMatch(/spl-dropzone\[data-test="resume-upload"\] input\[type="file"\]/);
    expect(adapter).toMatch(/new DataTransfer\(\)[\s\S]*?input\.files = transfer\.files[\s\S]*?dispatchEvent\(new Event\('change'/);
  });
});
