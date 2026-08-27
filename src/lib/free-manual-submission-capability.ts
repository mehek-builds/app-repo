const SUPPORTED_FREE_MANUAL_SUBMISSION_ATS = new Set([
  'greenhouse',
]);

/**
 * The 0.6.2 Free lane is intentionally narrower than the general adapter registry. Each member
 * here has both a proven application-form adapter and an explicit final-control replay path.
 * Unknown, generic, and newly added adapters stay disabled until they get the same proof.
 */
export function freeManualSubmissionAtsSupported(atsName: unknown): boolean {
  return typeof atsName === 'string'
    && SUPPORTED_FREE_MANUAL_SUBMISSION_ATS.has(atsName.trim().toLowerCase());
}

export function freeManualSubmissionPortalSupported(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const allowedHosts = new Set(['job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io']);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password || url.port || url.hash) {
      return false;
    }
    if (/^\/[^/]+\/jobs\/\d{5,20}\/?$/.test(url.pathname)) return url.search === '';
    if (url.pathname !== '/embed/job_app') return false;
    const keys = [...url.searchParams.keys()];
    const tenant = url.searchParams.getAll('for');
    const token = url.searchParams.getAll('token');
    return keys.length === 2
      && tenant.length === 1
      && /^[A-Za-z0-9_-]+$/.test(tenant[0] ?? '')
      && token.length === 1
      && /^\d{5,20}$/.test(token[0] ?? '');
  } catch {
    return false;
  }
}

export const FREE_MANUAL_SUBMISSION_UNAVAILABLE_COPY =
  'Litos 0.6.2 can safely guard Free submission only on a measured Greenhouse form with an exact durable receipt path. Nothing was filled or submitted here.';
