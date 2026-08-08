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

function storedSpec(resume: GeneratedResume): PacketSpec | null {
  const candidate = resume.application?.spec;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as PacketSpec
    : null;
}

/**
 * Returns the email frozen by the backend for this packet.
 *
 * `_applicant_email` is authoritative for new packets. `_contact.email` is the compatibility
 * source for legacy packets because it is also the value rendered into their PDF. The profile
 * fallback is only for old resume-only responses that contain no stored application packet.
 */
export function applicantEmailForGeneratedPacket(
  resume: GeneratedResume,
  legacyProfileEmail?: string,
): string | undefined {
  const spec = storedSpec(resume);
  if (spec?._applicant_email && typeof spec._applicant_email === 'object' && !Array.isArray(spec._applicant_email)) {
    const pinned = validEmail((spec._applicant_email as Record<string, unknown>).address);
    if (pinned) return pinned;
  }
  // An application object means this response came from the packet-generating contract. New
  // packets must contain the explicit frozen decision. Falling back here can put profile.email in
  // the employer form while the PDF contains a different address, so malformed modern packets
  // stop instead. Only old resume-only responses retain the profile fallback below.
  if (resume.application) return undefined;
  return validEmail(legacyProfileEmail) ?? undefined;
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
    return host || 'extension';
  } catch {
    return 'extension';
  }
}
