import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packetAuditForResume, packetAuditPdfMatches, validPacketAudit } from './handoff-packet-audit';
import type { GeneratedResume, PacketAudit } from './types';

const sha = (character: string) => character.repeat(64);
const pdfBytes = new TextEncoder().encode('%PDF-1.7 exact reviewed bytes');

async function pdfSha256(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', pdfBytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function audit(): Promise<PacketAudit> {
  const clause = { text: 'Build reliable systems.', start: 10, end: 33, verdict: 'missing' as const };
  const missing = { text: 'reliable', key: 'reliable', start: 16, end: 24, clauseIndex: 0 };
  return {
    version: 'packet_audit_v1',
    status: 'passed',
    complete: true,
    degraded: false,
    rejectedCount: 0,
    bindings: {
      ownerSha256: sha('1'),
      applicationId: 'application-1',
      jdSha256: sha('2'),
      specSha256: sha('3'),
      jobContextSha256: sha('4'),
      questionsSha256: sha('5'),
      applicantSnapshotSha256: sha('9'),
      resumeContactEmailSha256: sha('a'),
      applicantEmailSha256: sha('b'),
      pdf: { objectKey: 'users/owner/resume.pdf', sha256: await pdfSha256(), sizeBytes: pdfBytes.byteLength },
    },
    packet_version: sha('6'),
    identities: {
      resume_email: 'mehekman@usc.edu',
      applicant_email: 'app-123@applications.trylitos.com',
    },
    clauses: [{ ...clause, highlight_terms: [{ ...missing, tone: 'missing' }] }],
    editedTerms: [],
    terms: { covered: [], missing: [missing], edited: [] },
    audit_digest: sha('7'),
  };
}

function resume(packetAudit: PacketAudit | undefined): GeneratedResume {
  return {
    resume_id: 'application-1',
    resume_url: 'https://api.example/resume.pdf',
    file_name: 'Resume.pdf',
    handoff_version: sha('8'),
    spec: {},
    application: {
      id: 'application-1',
      spec: {
        _contact: { email: 'mehekman@usc.edu' },
        _applicant_email: {
          address: 'app-123@applications.trylitos.com', source: 'litos_alias', tracked: true,
        },
      },
    },
    packet_audit: packetAudit,
    quality: {
      ready_to_attach: true,
      issues: [], warnings: [], ats_keyword_coverage_pct: 100,
      trimmed_for_one_page_fit: false, sparse_add_more_experience: false,
      grounding_removed: [], omissions: [],
    },
  };
}

describe('attended handoff packet audit', () => {
  it('accepts the exact complete server contract and exact PDF bytes', async () => {
    const exact = await audit();
    expect(validPacketAudit(exact, 'application-1')).toBe(true);
    expect(packetAuditForResume(resume(exact))).toBe(exact);
    expect(await packetAuditPdfMatches(new Blob([pdfBytes], { type: 'application/pdf' }), exact)).toBe(true);
    const covered = {
      ...exact,
      clauses: [{
        ...exact.clauses[0],
        verdict: 'covered' as const,
        evidence: [
          { source: 'resume_spec' as const, path: '/degree', sha256: sha('a'), quote: 'Bachelor of Science' },
          { source: 'applicant_snapshot' as const, path: '/profile/currently_enrolled', sha256: sha('b'), quote: 'true' },
        ],
        highlight_terms: [],
      }],
      terms: { covered: [], missing: [], edited: [] },
    };
    expect(validPacketAudit(covered, 'application-1')).toBe(true);
  });

  it('fails closed for missing, stale-identity, degraded, rejected, and unscoreable audits', async () => {
    const exact = await audit();
    expect(packetAuditForResume(resume(undefined))).toBeNull();
    expect(validPacketAudit(exact, 'application-2')).toBe(false);
    expect(validPacketAudit({ ...exact, degraded: true }, 'application-1')).toBe(false);
    expect(validPacketAudit({ ...exact, rejectedCount: 1 }, 'application-1')).toBe(false);
    expect(validPacketAudit({ ...exact, clauses: [{ ...exact.clauses[0], verdict: 'unscoreable' }] }, 'application-1')).toBe(false);
    expect(validPacketAudit({ ...exact, packet_version: 'not-a-hash' }, 'application-1')).toBe(false);
    const missingSnapshotBinding = structuredClone(exact) as unknown as { bindings: Record<string, unknown> };
    delete missingSnapshotBinding.bindings.applicantSnapshotSha256;
    expect(validPacketAudit(missingSnapshotBinding, 'application-1')).toBe(false);
    const missingEmailBinding = structuredClone(exact) as unknown as { bindings: Record<string, unknown> };
    delete missingEmailBinding.bindings.resumeContactEmailSha256;
    expect(validPacketAudit(missingEmailBinding, 'application-1')).toBe(false);
  });

  it('rejects swapped, missing, or personal portal identity bindings', async () => {
    const exact = await audit();
    expect(packetAuditForResume(resume({
      ...exact,
      identities: {
        resume_email: exact.identities.applicant_email,
        applicant_email: exact.identities.resume_email,
      },
    }))).toBeNull();
    expect(packetAuditForResume(resume({
      ...exact,
      identities: { ...exact.identities, applicant_email: exact.identities.resume_email },
    }))).toBeNull();
    const missingAlias = resume(exact);
    missingAlias.application = { id: 'application-1', spec: { _contact: { email: 'mehekman@usc.edu' } } };
    expect(packetAuditForResume(missingAlias)).toBeNull();
  });

  it('rejects incomplete clause evidence and highlight maps', async () => {
    const exact = await audit();
    expect(validPacketAudit({ ...exact, clauses: [] }, 'application-1')).toBe(false);
    expect(validPacketAudit({
      ...exact,
      clauses: [{ ...exact.clauses[0], text: 'Wrong exact clause text' }],
    }, 'application-1')).toBe(false);
    expect(validPacketAudit({
      ...exact,
      clauses: [{ ...exact.clauses[0], highlight_terms: [] }],
    }, 'application-1')).toBe(false);
    expect(validPacketAudit({
      ...exact,
      clauses: [{ ...exact.clauses[0], verdict: 'covered', evidence: { source: 'resume_spec', path: '/degree', sha256: sha('a'), quote: 'BS' } }],
    }, 'application-1')).toBe(false);
    expect(validPacketAudit({
      ...exact,
      terms: { ...exact.terms, missing: [{ ...exact.terms.missing[0], evidence: { source: 'resume_spec', path: '/skills/0', sha256: sha('9'), quote: 'reliable' } }] },
    }, 'application-1')).toBe(false);
  });

  it('rejects changed, truncated, and same-size different PDF bytes', async () => {
    const exact = await audit();
    expect(await packetAuditPdfMatches(new Blob([pdfBytes.slice(0, -1)]), exact)).toBe(false);
    const changed = new Uint8Array(pdfBytes);
    changed[changed.length - 1] ^= 1;
    expect(changed.byteLength).toBe(pdfBytes.byteLength);
    expect(await packetAuditPdfMatches(new Blob([changed]), exact)).toBe(false);
  });

  it('gates background binding and content fill on the same exact audit identity', () => {
    const background = readFileSync('src/entrypoints/background.ts', 'utf8');
    const content = readFileSync('src/entrypoints/content.ts', 'utf8');
    const fetchBinding = background.slice(background.indexOf('async function fetchAndBindHandoffPacket'), background.indexOf('function pendingSubmissionKey'));
    expect(fetchBinding).toMatch(/packetAuditForResume\(resume\)[\s\S]*?storeHandoffPacketBinding/);
    expect(fetchBinding).toMatch(/packetVersion: audit\.packet_version[\s\S]*?auditDigest: audit\.audit_digest[\s\S]*?pdfSha256: audit\.bindings\.pdf\.sha256/);
    const dashboard = background.slice(background.indexOf("message?.type !== 'LITOS_SUBMIT_APPLICATION'"));
    expect(dashboard).toMatch(/verifiedResume\.packet_audit\?\.packet_version !== exactResume\.packet_audit\?\.packet_version/);
    expect(dashboard).toMatch(/reservePendingSubmission\([\s\S]*?packetVersion: exactResume\.packet_audit!\.packet_version/);
    const initialFill = content.slice(content.indexOf('const initialPacketAudit'), content.indexOf('const FILL_INACTIVITY_TIMEOUT_MS'));
    expect(initialFill).toMatch(/if \(!handoffApplicationId\)[\s\S]*?APPLICATION_PACKET_REVIEW_REQUIRED[\s\S]*?return;/);
    expect(content.indexOf('APPLICATION_PACKET_REVIEW_REQUIRED'))
      .toBeLessThan(content.indexOf('fetchResumeBlob(result.resume.resume_url)'));
    const reviewRequired = background.slice(
      background.indexOf("case 'APPLICATION_PACKET_REVIEW_REQUIRED'"),
      background.indexOf("case 'APPLICATION_REVIEW_READY'"),
    );
    expect(reviewRequired).toMatch(/chrome\.tabs\.create/);
    expect(reviewRequired).not.toMatch(/method: 'PUT'|questions: \[\]/);
    expect(reviewRequired).not.toMatch(/fetchAndBindHandoffPacket|extension-start|storeHandoffPacketBinding/);
    expect(initialFill).toMatch(/packetAuditPdfMatches\(resumeBlob, initialPacketAudit\)[\s\S]*?return;/);
    expect(content.indexOf('packetAuditPdfMatches(resumeBlob, initialPacketAudit)'))
      .toBeLessThan(content.indexOf('fill({', content.indexOf('const initialPacketAudit')));
    const adoption = content.slice(content.indexOf('const adoptAuthoritativePacketImpl'), content.indexOf('const adoptAuthoritativePacket ='));
    expect(adoption).toMatch(/packetAuditForResume\(exactResume\)[\s\S]*?packetAuditPdfMatches\(exactBlob, exactAudit\)[\s\S]*?fill\(/);
  });
});
