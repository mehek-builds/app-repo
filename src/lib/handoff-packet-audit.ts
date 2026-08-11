import type {
  GeneratedResume,
  PacketAudit,
  PacketAuditClause,
  PacketAuditEvidencePointer,
  PacketAuditTerm,
} from './types';
import { applicantEmailForGeneratedPacket } from './applicant-email';

const SHA256 = /^[a-f0-9]{64}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function evidence(value: unknown): value is PacketAuditEvidencePointer {
  const item = record(value);
  return Boolean(item
    && exactKeys(item, ['source', 'path', 'sha256', 'quote'])
    && (item.source === 'resume_spec' || item.source === 'applicant_snapshot')
    && typeof item.path === 'string' && item.path.length > 0
    && typeof item.quote === 'string' && item.quote.trim().length > 0
    && typeof item.sha256 === 'string' && SHA256.test(item.sha256));
}

function term(value: unknown, clauses: readonly PacketAuditClause[], requireEvidence: boolean): value is PacketAuditTerm {
  const item = record(value);
  if (!item) return false;
  const optionalEvidence = Object.prototype.hasOwnProperty.call(item, 'evidence');
  if (!exactKeys(item, optionalEvidence
    ? ['text', 'key', 'start', 'end', 'clauseIndex', 'evidence']
    : ['text', 'key', 'start', 'end', 'clauseIndex'])) return false;
  if (typeof item.text !== 'string' || !item.text.trim()
    || typeof item.key !== 'string' || !item.key.trim()
    || !Number.isInteger(item.start) || !Number.isInteger(item.end)
    || !Number.isInteger(item.clauseIndex)) return false;
  const start = item.start as number;
  const end = item.end as number;
  const clauseIndex = item.clauseIndex as number;
  const clause = clauses[clauseIndex];
  if (!clause || start < clause.start || end > clause.end || end <= start) return false;
  if (clause.text.slice(start - clause.start, end - clause.start) !== item.text) return false;
  if (requireEvidence !== optionalEvidence) return false;
  return !optionalEvidence || evidence(item.evidence);
}

function termIdentity(value: PacketAuditTerm, tone: string): string {
  return `${tone}:${value.start}:${value.end}:${value.clauseIndex}:${value.key}:${value.text}`;
}

export function validPacketAudit(value: unknown, applicationId: string): value is PacketAudit {
  const audit = record(value);
  if (!audit || !exactKeys(audit, [
    'version', 'status', 'complete', 'degraded', 'rejectedCount', 'bindings',
    'packet_version', 'identities', 'clauses', 'editedTerms', 'terms', 'audit_digest',
  ])) return false;
  if (audit.version !== 'packet_audit_v1' || audit.status !== 'passed'
    || audit.complete !== true || audit.degraded !== false || audit.rejectedCount !== 0
    || typeof audit.packet_version !== 'string' || !SHA256.test(audit.packet_version)
    || typeof audit.audit_digest !== 'string' || !SHA256.test(audit.audit_digest)) return false;

  const bindings = record(audit.bindings);
  const pdf = record(bindings?.pdf);
  if (!bindings || !pdf
    || !exactKeys(bindings, ['ownerSha256', 'applicationId', 'jdSha256', 'specSha256', 'jobContextSha256', 'questionsSha256', 'applicantSnapshotSha256', 'resumeContactEmailSha256', 'applicantEmailSha256', 'pdf'])
    || !exactKeys(pdf, ['objectKey', 'sha256', 'sizeBytes'])
    || bindings.applicationId !== applicationId
    || typeof bindings.ownerSha256 !== 'string' || !SHA256.test(bindings.ownerSha256)
    || typeof bindings.jdSha256 !== 'string' || !SHA256.test(bindings.jdSha256)
    || typeof bindings.specSha256 !== 'string' || !SHA256.test(bindings.specSha256)
    || typeof bindings.jobContextSha256 !== 'string' || !SHA256.test(bindings.jobContextSha256)
    || typeof bindings.questionsSha256 !== 'string' || !SHA256.test(bindings.questionsSha256)
    || typeof bindings.applicantSnapshotSha256 !== 'string' || !SHA256.test(bindings.applicantSnapshotSha256)
    || typeof bindings.resumeContactEmailSha256 !== 'string' || !SHA256.test(bindings.resumeContactEmailSha256)
    || typeof bindings.applicantEmailSha256 !== 'string' || !SHA256.test(bindings.applicantEmailSha256)
    || typeof pdf.objectKey !== 'string' || !pdf.objectKey
    || typeof pdf.sha256 !== 'string' || !SHA256.test(pdf.sha256)
    || !Number.isSafeInteger(pdf.sizeBytes) || (pdf.sizeBytes as number) <= 0) return false;

  const identities = record(audit.identities);
  if (!identities || !exactKeys(identities, ['resume_email', 'applicant_email'])
    || typeof identities.resume_email !== 'string' || !EMAIL.test(identities.resume_email)
    || identities.resume_email !== identities.resume_email.trim().toLowerCase()
    || typeof identities.applicant_email !== 'string' || !EMAIL.test(identities.applicant_email)
    || identities.applicant_email !== identities.applicant_email.trim().toLowerCase()
    || identities.resume_email === identities.applicant_email) return false;

  if (!Array.isArray(audit.clauses) || audit.clauses.length === 0) return false;
  const clauses: PacketAuditClause[] = [];
  let previousEnd = -1;
  for (const value of audit.clauses) {
    const clause = record(value);
    if (!clause) return false;
    const hasEvidence = Object.prototype.hasOwnProperty.call(clause, 'evidence');
    if (!exactKeys(clause, hasEvidence
      ? ['text', 'start', 'end', 'verdict', 'evidence', 'highlight_terms']
      : ['text', 'start', 'end', 'verdict', 'highlight_terms'])) return false;
    if (typeof clause.text !== 'string' || !clause.text.trim()
      || !Number.isInteger(clause.start) || !Number.isInteger(clause.end)
      || (clause.start as number) < 0 || (clause.end as number) <= (clause.start as number)
      || (clause.start as number) < previousEnd
      || (clause.end as number) - (clause.start as number) !== clause.text.length
      || (clause.verdict !== 'covered' && clause.verdict !== 'missing')
      || !Array.isArray(clause.highlight_terms)) return false;
    if ((clause.verdict === 'covered') !== hasEvidence) return false;
    if (hasEvidence && (!Array.isArray(clause.evidence) || clause.evidence.length === 0
      || !clause.evidence.every(evidence))) return false;
    clauses.push(clause as unknown as PacketAuditClause);
    previousEnd = clause.end as number;
  }

  const terms = record(audit.terms);
  if (!terms || !exactKeys(terms, ['covered', 'missing', 'edited'])
    || !Array.isArray(terms.covered) || !Array.isArray(terms.missing) || !Array.isArray(terms.edited)
    || !Array.isArray(audit.editedTerms)
    || !audit.editedTerms.every((item) => typeof item === 'string' && item.trim().length > 0)
    || new Set(audit.editedTerms).size !== audit.editedTerms.length) return false;

  const expectedHighlights = new Set<string>();
  for (const tone of ['covered', 'missing', 'edited'] as const) {
    const values = terms[tone] as unknown[];
    for (const value of values) {
      const requireEvidence = tone !== 'missing';
      if (!term(value, clauses, requireEvidence)) return false;
      const clause = clauses[value.clauseIndex];
      if ((tone === 'missing' && clause.verdict !== 'missing')
        || (tone !== 'missing' && clause.verdict !== 'covered')) return false;
      const identity = termIdentity(value, tone);
      if (expectedHighlights.has(identity)) return false;
      expectedHighlights.add(identity);
    }
  }
  const editedKeys = new Set((terms.edited as PacketAuditTerm[]).map((item) => item.key));
  if (audit.editedTerms.length !== editedKeys.size || !audit.editedTerms.every((item) => editedKeys.has(item))) return false;

  const actualHighlights = new Set<string>();
  for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
    for (const value of clauses[clauseIndex].highlight_terms) {
      const highlight = record(value);
      if (!highlight || !Object.prototype.hasOwnProperty.call(highlight, 'tone')) return false;
      const { tone, ...plain } = highlight;
      if (tone !== 'covered' && tone !== 'missing' && tone !== 'edited') return false;
      if (!term(plain, clauses, tone !== 'missing') || plain.clauseIndex !== clauseIndex) return false;
      const identity = termIdentity(plain, tone);
      if (actualHighlights.has(identity)) return false;
      actualHighlights.add(identity);
    }
  }
  return actualHighlights.size === expectedHighlights.size
    && [...actualHighlights].every((identity) => expectedHighlights.has(identity));
}

export function packetAuditForResume(resume: GeneratedResume): PacketAudit | null {
  if (!validPacketAudit(resume.packet_audit, resume.resume_id)) return null;
  const stored = resume.application?.spec;
  const contact = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)._contact
    : null;
  const personal = contact && typeof contact === 'object' && !Array.isArray(contact)
    && typeof (contact as Record<string, unknown>).email === 'string'
    ? String((contact as Record<string, unknown>).email).trim().toLowerCase()
    : null;
  const routing = applicantEmailForGeneratedPacket(resume);
  return personal
    && routing
    && resume.packet_audit.identities.resume_email === personal
    && resume.packet_audit.identities.applicant_email === routing
    ? resume.packet_audit
    : null;
}

export async function packetAuditPdfMatches(blob: Blob, audit: PacketAudit): Promise<boolean> {
  if (blob.size !== audit.bindings.pdf.sizeBytes) return false;
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return sha256 === audit.bindings.pdf.sha256;
}
