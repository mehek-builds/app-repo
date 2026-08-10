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
  });

  it('uses the same exact-packet loader for non-SmartRecruiters armed forms', () => {
    const claim = content.slice(content.indexOf("{ type: 'CLAIM_HANDOFF'"));
    expect(claim).toMatch(/handoffApplicationId = response\.applicationId[\s\S]*?yesBtn\.click\(\)/);
    expect(claim).not.toMatch(/smartrecruiters[\s\S]*?handoffApplicationId = response\.applicationId/i);
  });

  it('rearms the one-click form before navigating away from the posting', () => {
    expect(content).toMatch(/CONTINUE_SMARTRECRUITERS_HANDOFF[\s\S]*?window\.location\.assign\(targetUrl\)/);
    expect(background).toMatch(/case 'CONTINUE_SMARTRECRUITERS_HANDOFF'[\s\S]*?smartRecruitersContinuationAllowed/);
  });

  it('downloads and uploads the exact generated PDF through the SmartRecruiters file control', () => {
    expect(content).toMatch(/fetchResumeBlob\(result\.resume\.resume_url\)/);
    expect(adapter).toMatch(/spl-dropzone\[data-test="resume-upload"\] input\[type="file"\]/);
    expect(adapter).toMatch(/new DataTransfer\(\)[\s\S]*?input\.files = transfer\.files[\s\S]*?dispatchEvent\(new Event\('change'/);
  });
});
