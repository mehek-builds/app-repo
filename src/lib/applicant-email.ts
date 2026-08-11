import type { GeneratedResume } from './types';

type PacketSpec = {
  _applicant_email?: unknown;
  _contact?: unknown;
};

function validEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) ? normalized : null;
}

/** Personal contact rendered into the resume. Account-login email is never a substitute. */
export function resumeContactEmailForProfile(profile: unknown): string | undefined {
  const value = profile && typeof profile === 'object' && !Array.isArray(profile)
    ? (profile as Record<string, unknown>).resume_email
    : undefined;
  return validEmail(value) ?? undefined;
}

function storedSpec(resume: GeneratedResume): PacketSpec | null {
  const candidate = resume.application?.spec;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as PacketSpec
    : null;
}

function containsExactEmail(value: unknown, email: string, seen = new Set<object>()): boolean {
  if (typeof value === 'string') return value.toLowerCase().includes(email);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsExactEmail(entry, email, seen));
  return Object.values(value as Record<string, unknown>)
    .some((entry) => containsExactEmail(entry, email, seen));
}

/**
 * Returns the email frozen by the backend for this packet.
 *
 * `_applicant_email` is authoritative for new packets. `_contact.email` is deliberately ignored:
 * it is the applicant's personal address rendered into the PDF, while the employer form must use
 * the frozen Litos application address. Legacy resume-only responses are deliberately rejected:
 * there is no server-bound proof that a profile address is the routing alias for this application.
 */
export function applicantEmailForGeneratedPacket(
  resume: GeneratedResume,
): string | undefined {
  const spec = storedSpec(resume);
  if (spec?._applicant_email && typeof spec._applicant_email === 'object' && !Array.isArray(spec._applicant_email)) {
    const decision = spec._applicant_email as Record<string, unknown>;
    const contact = spec._contact && typeof spec._contact === 'object' && !Array.isArray(spec._contact)
      ? spec._contact as Record<string, unknown>
      : null;
    const pinned = validEmail(decision.address);
    const personal = validEmail(contact?.email);
    if (pinned && personal && pinned !== personal && !containsExactEmail(resume.spec, pinned)
      && decision.source === 'litos_alias' && decision.tracked === true) return pinned;
  }
  // No application packet means there is no exact routing decision to bind to this form. Falling
  // back to a profile or PDF address can put the personal resume contact into the employer form.
  return undefined;
}

export function atsNameForPortalUrl(value: string | undefined): string {
  if (!value) return 'extension';
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host === 'jobs.lever.co') return 'lever';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('myworkdayjobs.com') || host.includes('workday.com')) return 'workday';
    if (host.includes('workable.com')) return 'workable';
    if (host.includes('rippling.com')) return 'rippling';
    if (host.includes('breezy.hr')) return 'breezy';
    if (host === 'jobs.jobvite.com') return 'jobvite';
    if (host.endsWith('.icims.com')) return 'icims';
    return host || 'extension';
  } catch {
    return 'extension';
  }
}
