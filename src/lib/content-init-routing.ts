import { gatedPortalNotice, specForLocation } from './adapters/ats-2026-07';

export type ContentInitRoute = 'ats' | 'gated' | 'generic' | 'ignore';

// This list mirrors the manifest families. The matcher below enforces label boundaries, so a host
// merely containing one of these strings is not treated as an ATS.
export const KNOWN_ATS_HOSTS = [
  'linkedin.com',
  'greenhouse.io',
  'lever.co',
  'myworkdayjobs.com',
  'workday.com',
  'ashbyhq.com',
  'indeed.com',
  'joinhandshake.com',
  'ats.rippling.com',
  'breezy.hr',
  'bamboohr.com',
  'jobs.personio.de',
  'jobs.personio.com',
  'pinpointhq.com',
  'comeet.co',
  'recruitee.com',
  'teamtailor.com',
  'zohorecruit.com',
  'zohorecruit.eu',
  'zohorecruit.in',
  'www.serverlogic.com',
  'www.staffingsolutionsenterprises.com',
  'successfactors.com',
  'successfactors.eu',
  'jobs.jobvite.com',
  'icims.com',
  'oraclecloud.com',
  'enterpriseplatform.dell.com',
  'recruiting.ultipro.com',
  'fa007.taleo.net',
  'aa270.taleo.net',
  'myjobs.adp.com',
  'utilidata.applytojob.com',
  'foundationai.applytojob.com',
  'avature.net',
  'jobs.ea.com',
] as const;

const EXACT_HOSTS = new Set([
  'ats.rippling.com',
  'www.serverlogic.com',
  'www.staffingsolutionsenterprises.com',
  'jobs.jobvite.com',
  'recruiting.ultipro.com',
  'fa007.taleo.net',
  'aa270.taleo.net',
  'myjobs.adp.com',
  'utilidata.applytojob.com',
  'foundationai.applytojob.com',
  'enterpriseplatform.dell.com',
  'jobs.ea.com',
]);

function matchesKnownHost(hostname: string, known: string): boolean {
  return EXACT_HOSTS.has(known)
    ? hostname === known
    : hostname === known || hostname.endsWith(`.${known}`);
}

export function isKnownAtsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return KNOWN_ATS_HOSTS.some((known) => matchesKnownHost(host, known));
}

function isSuccessFactorsHost(hostname: string): boolean {
  return /(?:^|\.)successfactors\.(?:com|eu)$/i.test(hostname);
}

function isZohoRecruitHost(hostname: string): boolean {
  return /(?:^|\.)zohorecruit\.(?:com|eu|in)$/i.test(hostname);
}

function isExactRouteOnlyHost(hostname: string): boolean {
  return (hostname.endsWith('.bamboohr.com') && hostname !== 'www.bamboohr.com')
    || hostname.endsWith('.oraclecloud.com')
    || hostname === 'enterpriseplatform.dell.com'
    || hostname === 'recruiting.ultipro.com'
    || hostname === 'jobs.ea.com'
    || /^(?!www\.)[a-z0-9-]+\.avature\.net$/i.test(hostname);
}

function isVendorProductOrLoginHost(hostname: string, pathname: string): boolean {
  return hostname === 'jobs.personio.de'
    || hostname === 'jobs.personio.com'
    || hostname === 'accounts.zoho.com'
    || (hostname === 'www.zoho.com' && /^\/recruit(?:\/|$)/i.test(pathname))
    || /(?:^|\.)bullhornstaffing\.com$/i.test(hostname)
    || /^(?:www\.)?bullhorn\.com$/i.test(hostname);
}

const BULLHORN_EMPLOYERS: Readonly<Record<string, string>> = {
  'www.serverlogic.com': 'ServerLogic',
  'www.staffingsolutionsenterprises.com': 'Staffing Solutions Enterprises',
};

export function bullhornEmployerName(hostname: string): string | null {
  return BULLHORN_EMPLOYERS[hostname.toLowerCase()] ?? null;
}

const APPLICATION_SCOPED_ADAPTERS = new Set([
  'bamboohr',
  'recruitee',
  'teamtailor',
  'personio',
  'zoho_recruit',
  'bullhorn',
  'jazzhr',
]);

/** The one routing decision used by both automatic and popup-triggered initialization. */
export function contentInitRoute(
  location: Pick<Location, 'hostname' | 'pathname' | 'hash' | 'search'>,
): ContentInitRoute {
  const host = location.hostname.toLowerCase();
  if (isVendorProductOrLoginHost(host, location.pathname)) return 'ignore';
  if (gatedPortalNotice(host, location.pathname, location.search)) return 'gated';
  if (host === 'fa007.taleo.net' || host === 'aa270.taleo.net' || host === 'myjobs.adp.com') return 'ignore';

  // The manifest must cover SuccessFactors wildcard hosts, but only the exact career route above
  // is relevant. Every other product, login, and administrative page stays untouched.
  if (isSuccessFactorsHost(host)) return 'ignore';

  const spec = specForLocation(location);
  if (spec) {
    if (APPLICATION_SCOPED_ADAPTERS.has(spec.id)
      && !spec.isApplicationPath(location.pathname, location.search, location.hash, host)) return 'ignore';
    return 'ats';
  }

  // Zoho account and marketing hosts are not tenant application hosts. They remain known so a
  // popup-triggered injection cannot fall through to the generic form engine.
  if (isZohoRecruitHost(host)) return 'ignore';
  if (isExactRouteOnlyHost(host)) return 'ignore';
  if (isKnownAtsHost(host)) return 'ats';
  return 'generic';
}
