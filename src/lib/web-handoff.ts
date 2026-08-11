/**
 * The bridge between the signed-in website and this extension.
 *
 * Two facts made the attended handoff dead on arrival, and both live here.
 *
 * 1. The extension's session and the website's session were never the same thing. The site keeps a
 *    JWT in localStorage on trylitos.com; the extension keeps one in chrome.storage.local, written
 *    only by its own popup sign-in. Same backend, same token format, same account, and no wire
 *    between them. So an applicant who signed in on the dashboard and then landed on an employer
 *    page got "not signed in" from an extension that was, from its own point of view, telling the
 *    truth. decideAdoption() is the rule for accepting the site's token as the extension's own.
 *
 * 2. "Finish this one" opened the employer's page in a fresh tab, where nothing the earlier managed
 *    run typed survives - that fill happened in a remote browser that no longer exists. The only
 *    thing that can refill it is the extension, on this page, now. armed handoffs are how the
 *    dashboard says "this exact URL is the one they just clicked through to", so the content script
 *    can start filling instead of waiting to be asked a second time.
 *
 * Everything in this file is pure so the decisions can be tested without a browser.
 */

export const ARMED_HANDOFF_KEY = 'litos_armed_handoffs';

/**
 * An arming is a statement about what the applicant is doing right now, so it has to go stale.
 * An hour comfortably covers "clicked Finish this one, read the posting, then applied" and does not
 * leave a page auto-filling itself tomorrow because of a dashboard visit today.
 */
export const ARMED_HANDOFF_TTL_MS = 60 * 60 * 1000;

export interface ArmedHandoff {
  key: string;
  applicationId?: string;
  armedAt: number;
}

/**
 * Reduce a portal URL to the part that identifies the application.
 *
 * Query and hash are dropped: employers append tracking parameters, and the same application
 * reached with and without `?gh_src=` has to be one key. Only https is accepted, matching the
 * website's own safePortalUrl - a non-https portal url is data we do not trust enough to act on.
 */
export function handoffKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

/**
 * Whether an armed key and the page the applicant actually landed on are the same application.
 *
 * Not plain equality, because the last path segment moves under us: Lever stores the posting as
 * `/co/<id>` and the apply form as `/co/<id>/apply`, and Greenhouse does the same trick with
 * `/application`. Both directions of the prefix are accepted for exactly that reason. This is safe
 * because a portal key always carries the posting id, so `/co/<id>` can never prefix a DIFFERENT
 * posting - only its own sub-pages.
 */
export function handoffMatches(armedKey: string, pageKey: string): boolean {
  if (armedKey === pageKey) return true;
  return pageKey.startsWith(`${armedKey}/`) || armedKey.startsWith(`${pageKey}/`);
}

/** Exact application-form identity used after a packet has been frozen. */
export function applicationFormIdentityKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');
    const clearNoise = () => {
      url.search = '';
      url.hash = '';
      url.pathname = path;
      return url.toString();
    };
    if (host.includes('lever.co') || host.includes('jobs.personio.')) {
      url.pathname = path.replace(/\/apply$/i, '');
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    if (host === 'jobs.jobvite.com') {
      const match = /^\/([a-z0-9._-]+)\/job\/([a-z0-9]+)(?:\/apply)?(?:\/(?:confirmation|thank-you|submitted|application-submitted))?$/i.exec(path);
      return match ? `${url.origin}/${match[1]}/job/${match[2]}` : null;
    }
    if (host.includes('recruitee.com')) {
      url.pathname = path.replace(/\/c\/new$/i, '');
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    if (host.includes('teamtailor.com') || host.includes('pinpointhq.com')) {
      url.pathname = path.replace(/\/applications\/new$/i, '');
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    if (/^(?!(?:www|community|login|api)\.)[a-z0-9-]+\.icims\.com$/i.test(host)) {
      const match = /^\/jobs\/(\d+)\/[a-z0-9%._~-]+\/(?:job|login)(?:\/(?:confirmation|thank-you|submitted|application-submitted))?$/i.exec(path);
      return match ? `${url.origin}/jobs/${match[1]}` : null;
    }
    if (host.includes('smartrecruiters.com') || host.includes('zohorecruit.')) return clearNoise();
    if (host.includes('applytojob.com') || host.includes('bamboohr.com') || host.includes('oraclecloud.com')) return clearNoise();
    if (host.includes('greenhouse.io')) {
      const token = url.searchParams.get('token');
      const board = url.searchParams.get('for');
      if (token) return `${url.origin}${path}?${board ? `for=${encodeURIComponent(board)}&` : ''}token=${encodeURIComponent(token)}`;
      return clearNoise();
    }
    const embeddedGreenhouseJob = url.searchParams.get('gh_jid');
    if (embeddedGreenhouseJob) return `${url.origin}${path}?gh_jid=${encodeURIComponent(embeddedGreenhouseJob)}`;
    if (host.includes('bullhorn') || path.includes('/wp-content/plugins/bullhorn-oscp')) {
      const jobId = url.hash.match(/^#\/jobs\/(\d+)/i)?.[1];
      return jobId ? `${url.origin}/wp-content/plugins/bullhorn-oscp/#/jobs/${jobId}` : null;
    }
    if (host.includes('successfactors.')) {
      const jobId = url.searchParams.get('jobId') ?? url.searchParams.get('career_job_req_id') ?? url.searchParams.get('job_application');
      const company = url.searchParams.get('company');
      return jobId && company ? `${url.origin}/sfcareer/jobreqcareer?jobId=${encodeURIComponent(jobId)}&company=${encodeURIComponent(company)}` : null;
    }
    if (host.includes('taleo.net')) {
      const job = url.searchParams.get('job');
      return job ? `${url.origin}${path}?job=${encodeURIComponent(job)}&lang=en` : null;
    }
    if (host.includes('myjobs.adp.com')) {
      const reqId = url.searchParams.get('reqId');
      return reqId ? `${url.origin}${path}?reqId=${encodeURIComponent(reqId)}` : null;
    }
    if (host.includes('ultipro.com')) {
      const opportunityId = url.searchParams.get('opportunityId');
      return opportunityId ? `${url.origin}${path}?opportunityId=${encodeURIComponent(opportunityId)}` : `${url.origin}${path}`;
    }
    if (host.includes('avature.net')) {
      const jobId = url.searchParams.get('jobId');
      return jobId && !/\/JobDetail\/[^/]+\/\d+$/i.test(path)
        ? `${url.origin}${path}?jobId=${encodeURIComponent(jobId)}`
        : `${url.origin}${path}`;
    }
    // Preserve identity-bearing query keys, but mirror the backend's narrow tracking allowlist.
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    url.pathname = path;
    return url.toString();
  } catch {
    return null;
  }
}

const SMARTRECRUITERS_ONE_CLICK_PATH = /^\/oneclick-ui\/company\/[a-z0-9._-]+\/publication\/[0-9a-f-]{36}\/?$/i;

/**
 * Resolve the application-form link exposed by a SmartRecruiters posting without trusting an
 * arbitrary page link. The public posting and one-click form use unrelated paths, so ordinary
 * prefix handoff matching cannot bridge them.
 */
export function smartRecruitersApplicationUrl(pageUrl: string, hrefs: readonly string[]): string | null {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  if (page.protocol !== 'https:' || page.hostname !== 'jobs.smartrecruiters.com') return null;
  const postingCompany = page.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  if (!postingCompany) return null;
  for (const href of hrefs) {
    try {
      const candidate = new URL(href, page);
      if (candidate.protocol !== 'https:' || candidate.hostname !== page.hostname) continue;
      if (!SMARTRECRUITERS_ONE_CLICK_PATH.test(candidate.pathname)) continue;
      const formCompany = candidate.pathname.match(/^\/oneclick-ui\/company\/([^/]+)\//i)?.[1]?.toLowerCase();
      if (formCompany !== postingCompany) continue;
      candidate.search = '';
      candidate.hash = '';
      return candidate.toString();
    } catch {
      // Ignore malformed employer-page links and keep looking for the exact application route.
    }
  }
  return null;
}

export function smartRecruitersContinuationAllowed(sourceUrl: string, targetUrl: string): boolean {
  return smartRecruitersApplicationUrl(sourceUrl, [targetUrl]) === targetUrl;
}

/**
 * Consume the exact armed SmartRecruiters posting and re-arm only the one-click URL exposed by
 * that page. The application id always comes from the claimed dashboard arming. A content script
 * cannot choose a different packet id while asking the background to continue the handoff.
 */
export function continueSmartRecruitersHandoff(
  entries: readonly ArmedHandoff[],
  sourceUrl: string,
  targetUrl: string,
  now: number,
): { applicationId: string | null; remaining: ArmedHandoff[] } {
  const live = pruneArmed(entries, now);
  if (!smartRecruitersContinuationAllowed(sourceUrl, targetUrl)) {
    return { applicationId: null, remaining: live };
  }
  const claimed = claimArmed(live, sourceUrl, now);
  if (!claimed.claimed?.applicationId) {
    return { applicationId: null, remaining: claimed.remaining };
  }
  return {
    applicationId: claimed.claimed.applicationId,
    remaining: armHandoffs(
      claimed.remaining,
      [{ url: targetUrl, applicationId: claimed.claimed.applicationId }],
      now,
    ),
  };
}

/** Drop armings that have aged out. Called on every read so the store cannot grow without bound. */
export function pruneArmed(entries: readonly ArmedHandoff[], now: number): ArmedHandoff[] {
  return entries.filter((entry) => now - entry.armedAt < ARMED_HANDOFF_TTL_MS);
}

export function armHandoffs(
  existing: readonly ArmedHandoff[],
  incoming: readonly { url: string; applicationId?: string }[],
  now: number,
): ArmedHandoff[] {
  const next = pruneArmed(existing, now);
  for (const item of incoming) {
    const key = handoffKey(item.url);
    if (!key) continue;
    const at = next.findIndex((entry) => entry.key === key);
    const record: ArmedHandoff = { key, applicationId: item.applicationId, armedAt: now };
    if (at === -1) next.push(record);
    else next[at] = record;
  }
  return next;
}

/**
 * One-shot by design. The applicant clicked through to this page once; a fill they did not ask for,
 * on a page they happen to open again next week, is a different product doing a different thing.
 */
export function claimArmed(
  entries: readonly ArmedHandoff[],
  pageUrl: string,
  now: number,
): { claimed: ArmedHandoff | null; remaining: ArmedHandoff[] } {
  const live = pruneArmed(entries, now);
  const pageKey = handoffKey(pageUrl);
  if (!pageKey) return { claimed: null, remaining: live };
  const index = live.findIndex((entry) => handoffMatches(entry.key, pageKey));
  if (index === -1) return { claimed: null, remaining: live };
  const claimed = live[index];
  return { claimed, remaining: [...live.slice(0, index), ...live.slice(index + 1)] };
}

export type AdoptionOutcome = 'adopted' | 'already_signed_in' | 'different_account' | 'rejected';

function sameAccount(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Whether to take the website's token as this extension's session.
 *
 * The conservative half is `different_account`: if the extension is signed in as someone else and
 * that session still works, the site does not get to swap it out from under them. Everything else
 * resolves in favour of the applicant actually being able to apply - no session at all, a session
 * whose token the backend no longer honours, or the same account with a rotated token, all adopt.
 *
 * `incomingEmail` and `storedEmail` are what the BACKEND said each token resolves to, never a
 * claim decoded from the token itself. A JWT payload is base64, not evidence.
 */
export function decideAdoption(input: {
  incomingToken: string;
  incomingEmail: string | null;
  storedToken: string | null;
  storedEmail: string | null;
}): AdoptionOutcome {
  if (!input.incomingToken.trim()) return 'rejected';
  if (!input.incomingEmail) return 'rejected';
  if (!input.storedToken) return 'adopted';
  if (input.storedToken === input.incomingToken) return 'already_signed_in';
  if (!input.storedEmail) return 'adopted';
  return sameAccount(input.storedEmail, input.incomingEmail) ? 'adopted' : 'different_account';
}
