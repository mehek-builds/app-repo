import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync('src/entrypoints/content.ts', 'utf8');
const background = readFileSync('src/entrypoints/background.ts', 'utf8');
const adapter = readFileSync('src/lib/adapters/ats-2026-07.ts', 'utf8');

describe('SmartRecruiters exact packet attended handoff', () => {
  it('carries the claimed application id to the exact saved packet loader instead of generating again', () => {
    expect(content).toMatch(/handoffApplicationId[\s\S]*?GET_APPLICATION_HANDOFF_PACKET[\s\S]*?applicationId: handoffApplicationId/);
    expect(background).toMatch(/fetchAndBindHandoffPacket[\s\S]*?\/applications\/\$\{input\.applicationId\}\/submission\/extension-packet/);
    expect(background).toMatch(/resume\.resume_id !== input\.applicationId \|\| resume\.application\?\.id !== input\.applicationId/);
    expect(content).toMatch(/reviewedQuestionsForHandoff\(resume\)/);
    expect(content).toMatch(/applicantEmailForGeneratedPacket\(resume\)/);
    expect(background).toMatch(/const resumeEmail = resumeContactEmailForProfile\(profile\)[\s\S]*?if \(!resumeEmail\)[\s\S]*?contact: \{[\s\S]*?email: resumeEmail/);
    expect(background).not.toMatch(/contact: \{[\s\S]{0,200}?email: profile\.email/);
    expect(background).toMatch(/extension-packet\?current_url=\$\{encodeURIComponent\(input\.currentUrl\)\}/);
  });

  it('replays frozen answers and never redrafts an attended packet question', () => {
    expect(content).toMatch(/if \(handoffApplicationId\) \{[\s\S]*?frozenAnswerForQuestion\(frozenHandoffQuestions, question\)/);
    expect(content).toMatch(/replayReviewedAnswers\(document, frozenHandoffQuestions, replayOptions\)/);
    expect(content).toMatch(/reviewedAnswersMatch\(document, frozenHandoffQuestions, replayOptions\)\.failed\.length/);
    expect(content).toMatch(/armManualSubmissionTracking\([^;]*handoffSubmissionGuard, Boolean\(handoffApplicationId\)\)/);
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
    expect(background).toMatch(/case 'EXTENSION_SUBMISSION_START'[\s\S]*?handoff_version: binding\.handoffVersion[\s\S]*?current_url: currentUrl/);
    const dashboardStart = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));
    expect(dashboardStart).toMatch(/fetchAndBindHandoffPacket[\s\S]*?PREPARE_SUBMISSION_FROM_DASHBOARD[\s\S]*?handoff_version: exactResume\.handoff_version[\s\S]*?current_url: verifiedCurrentUrl/);
    expect(content).toMatch(/fetchResumeBlob\(exactResume\.resume_url\)[\s\S]*?resumeBlob: exactBlob[\s\S]*?replayReviewedAnswers\(document, frozenHandoffQuestions, replayOptions\)/);
    expect(content).toMatch(/skippedReasonsNeedReview\(refill\.skipped_reasons[\s\S]*?company form changed and now needs another answer/);
  });

  it('refuses every manual or automatic start when its GET-fetched binding is absent', () => {
    const manualStart = background.slice(
      background.indexOf("case 'EXTENSION_SUBMISSION_START'"),
      background.indexOf("case 'EXTENSION_SUBMISSION_OUTCOME'"),
    );
    expect(manualStart).toMatch(/if \(!binding\) throw new Error/);
    expect(manualStart).toMatch(/const currentUrl = sender\.url \?\? ''/);
    expect(content).toMatch(/authorization: 'user_initiated', attendedHandoff/);
    expect(content).toMatch(/authorization: 'standing_consent', attendedHandoff/);

    const dashboardStart = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));
    expect(dashboardStart).toMatch(/GET_CURRENT_APPLICATION_URL[\s\S]*?fetchAndBindHandoffPacket/);
    expect(dashboardStart).toMatch(/if \(!prepared\?\.ok\) throw new Error/);
    expect(background).toMatch(/attendedHandoff: payload\.attendedHandoff === true/);
    expect(background).toMatch(/payload\.attendedHandoff === true && !existingHandoffBinding/);
    expect(background).toMatch(/if \(payload\.attendedHandoff !== true\)[\s\S]*?method: 'PUT'[\s\S]*?fetchAndBindHandoffPacket/);
    expect(content).toMatch(/attendedHandoff: Boolean\(handoffApplicationId\)/);
  });

  it('prepares ordinary auto and manual paths before either can reserve', () => {
    const prepareAt = content.indexOf("type: 'APPLICATION_REVIEW_READY'");
    const countdownAt = content.indexOf('runAutoSubmitCountdown(card');
    const manualAt = content.indexOf('armManualSubmissionTracking(finalSubmitBtn');
    expect(prepareAt).toBeGreaterThan(-1);
    expect(countdownAt).toBeGreaterThan(prepareAt);
    expect(manualAt).toBeGreaterThan(prepareAt);
    expect(content).toMatch(/if \(reviewPreparationError\)[\s\S]*?return;[\s\S]*?runAutoSubmitCountdown/);
  });

  it('keeps dashboard packet versions private until replay and rejects concurrent starts', () => {
    const dashboardStart = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));
    expect(dashboardStart).toMatch(/dashboardSubmissionsInFlight\.has\(applicationId\)[\s\S]*?dashboardSubmissionsInFlight\.add\(applicationId\)/);
    expect(dashboardStart).toMatch(/fetchAndBindHandoffPacket\(\{[\s\S]*?publishBinding: false[\s\S]*?PREPARE_SUBMISSION_FROM_DASHBOARD[\s\S]*?storeHandoffPacketBinding/);
    expect(dashboardStart).toMatch(/handoff_version: exactResume\.handoff_version[\s\S]*?finally\(\(\) => dashboardSubmissionsInFlight\.delete\(applicationId\)\)/);
    expect(dashboardStart).not.toMatch(/PREPARE_SUBMISSION_FROM_DASHBOARD[\s\S]*?handoffPacketBinding\(applicationId/);
  });

  it('requires the exact attached File object through every submission guard', () => {
    expect(content).toMatch(/crypto\.subtle\.digest\('SHA-256'[\s\S]*?sha256\(file\) === expectedDigest/);
    expect(content).toContain('for (const input of resumeFileInputs())');
    expect(content).toContain("!/cover\\s*letter|portfolio/.test(text)");
    expect(content).toMatch(/exactAttachedResume = resumeBlob \? await exactAttachment\(resumeBlob, resume\.file_name\)/);
    expect(content).toMatch(/exactAttachedResume = await exactAttachment\(exactBlob, exactResume\.file_name\)/);
    expect(content).toMatch(/exactAttachedResume\.input\.files[\s\S]*?includes\(exactAttachedResume\.file\)[\s\S]*?exact reviewed resume was removed or replaced/);
    expect(content).toMatch(/runAutoSubmitCountdown\([^;]*handoffSubmissionGuard/);
    expect(content).toMatch(/armManualSubmissionTracking\([^;]*handoffSubmissionGuard/);
    expect(content).toMatch(/submitFromDashboard = async[\s\S]*?handoffSubmissionGuard\(\)/);
  });

  it('serializes authoritative refills and revalidates the live URL before dashboard start', () => {
    expect(content).toMatch(/let adoptionTail: Promise<void> = Promise\.resolve\(\)[\s\S]*?adoptionTail\.then\(\(\) => adoptAuthoritativePacketImpl/);
    expect(content).toMatch(/requestId !== latestAdoptionRequest[\s\S]*?sameApplicationPage\(expectedUrl, window\.location\.href\)/);
    const dashboardStart = background.slice(background.indexOf("if (message?.type !== 'LITOS_SUBMIT_APPLICATION')"));
    expect(dashboardStart).toMatch(/expectedUrl: currentUrl[\s\S]*?verifiedCurrentUrl[\s\S]*?verifiedPageKey !== fetchedPageKey[\s\S]*?verifiedResume\.handoff_version !== exactResume\.handoff_version/);
  });

  it('downloads and uploads the exact generated PDF through the SmartRecruiters file control', () => {
    expect(content).toMatch(/fetchResumeBlob\(result\.resume\.resume_url\)/);
    expect(adapter).toMatch(/spl-dropzone\[data-test="resume-upload"\] input\[type="file"\]/);
    expect(adapter).toMatch(/new DataTransfer\(\)[\s\S]*?input\.files = transfer\.files[\s\S]*?dispatchEvent\(new Event\('change'/);
  });
});
