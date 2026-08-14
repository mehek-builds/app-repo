import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');

describe('Litos+ extension wiring', () => {
  it('starts hover generation only behind the paid-only live entitlement', () => {
    expect(content).toContain("card.addEventListener('mouseenter'");
    expect(content).toContain('access.hover_generation === true');
    expect(content).toContain('access.can_tailor === true');
    expect(background).toContain("featureEnabled(snapshot, 'hover_generation')");
    expect(content).toContain("startResumeGen('hover')");
    expect(background).toContain("await requireFeature(token, 'hover_generation')");
    expect(content).toContain("type: 'GET_FILL_ACCESS'");
    expect(content).toContain("type: 'GET_FREE_FILL_DATA'");
    expect(background).toContain("initiation === 'hover' ? 'hover_prewarm' : 'explicit_click'");
    const generationStart = background.indexOf('async function generateResumeAndProfile');
    const generation = background.slice(generationStart, background.indexOf('async function renderBadge', generationStart));
    expect(generation).toMatch(/initiation: 'explicit_click' \| 'hover_prewarm'[\s\S]*?JSON\.stringify\(\{[\s\S]*?initiation,/);
  });

  it('enforces automatic submission in both extension and dashboard submission entrances', () => {
    const checks = background.match(/requireFeature\(token, 'automatic_submission'\)/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(2);
    expect(background).toContain("featureEnabled(snapshot, 'automatic_submission')");
  });

  it('keeps Free filling separate from premium generation and creates a Tracker record', () => {
    expect(background).toContain("timeoutBackendFetch('/applications'");
    expect(background).toContain("source: 'extension'");
    expect(background).toContain('/fill-data');
    expect(background).toContain("case 'RECORD_FREE_FILL_RESULT'");
    expect(content).toContain('No paid generation will run.');
    expect(content).toContain('resumeFileName: data.selected_resume?.file_name');
    expect(content).toContain('resume_attached: resumeAttached');
    expect(content).toContain("? data.selected_resume?.artifact_id ? 'artifact' : 'base_resume'");
    expect(content).not.toContain("['resume: attach a resume before you submit']");
  });

  it('meters trial answer drafting by canonical application with retry-safe operations', () => {
    expect(content).toContain('application_id: resume.canonical_application_id');
    expect(content).toContain('answerOperationIdByQuestion');
    expect(content).toContain('operation_id: operationId');
    expect(background).toContain('application_id,');
    expect(background).toContain('operation_id,');
  });

  it('keeps resume and outreach retries on stable operation IDs', () => {
    expect(content).toContain('resumeOperationIdByJob');
    expect(content).toContain('operation_id: operationId');
    expect(content).toContain('operation_id: outreachOperationId');
    expect(background).toContain('operation_id: resolveOperationId');
    expect(background).toContain('operation_id: draftOperationId');
    expect(background).toContain('const draftOperationId = await derivedOperationId(resolveOperationId, contact.id)');
    const outreachStart = background.indexOf('async function resolveAndDraft');
    const outreachEnd = background.indexOf('async function fetchAshbyPostingCompensation', outreachStart);
    const outreach = background.slice(outreachStart, outreachEnd);
    expect(outreach).toContain("timeoutBackendFetch('/applications'");
    expect(outreach).toContain('application_id: applicationId');
    expect(outreach).toContain('id: contact.id');
    expect(outreach).toContain('email: email_resolution.email');
    expect(outreach).toContain("draft_type: 'first_note'");
    const generationStart = background.indexOf('async function generateResumeAndProfile');
    const generationEnd = background.indexOf('async function renderBadge', generationStart);
    const generation = background.slice(generationStart, generationEnd);
    expect(generation).toMatch(/for \(let attempt = 1; ; attempt\+\+\)[\s\S]*?operation_id: operationId/);
  });

  it('creates extension-origin checkout with the extension account token', () => {
    expect(background).toContain("message?.type === 'LITOS_CREATE_CHECKOUT'");
    expect(background).toContain("surface: 'extension'");
    expect(background).toContain("checkoutUrl.hostname !== 'checkout.stripe.com'");
    expect(background).toContain("timeoutBackendFetch('/billing/checkout'");
  });
});
