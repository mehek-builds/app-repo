/**
 * The applicant's own stall list, kept in extension storage.
 *
 * This is the "line them all up in order" queue, and it belongs to the person whose applications
 * they are. Nothing here is ever routed to anyone else to act on: a human-verification check asks
 * whether the person in this session is human, so it can only be answered by them, in this browser.
 *
 * Ordered oldest-first, the same rule the backend queue uses. The application nobody has dealt with
 * is precisely the one that keeps being re-observed, so a list that reordered on each sighting would
 * bury the worst case forever.
 */

export type CaptchaProviderName =
  | 'recaptcha_v2'
  | 'recaptcha_v3'
  | 'hcaptcha'
  | 'turnstile'
  | 'arkose'
  | 'unknown';

export type CaptchaStall = {
  /**
   * The tab the application is open in, when it is known.
   *
   * The DURABLE identity, and the url is only a fallback. A submission redirects to a confirmation
   * page on a different path (Greenhouse `/confirmation`, Lever `/thanks`), and the resolution is
   * reported from that page - so matching on url alone never clears the entry and the count grows
   * forever, which is precisely how a badge becomes a number people learn to ignore.
   */
  tabId?: number;
  url: string;
  company: string;
  role: string;
  provider: CaptchaProviderName;
  atsName?: string;
  stalledAt: string;
};

const KEY = 'captcha_stalls';

/**
 * Bounded so a pathological loop cannot grow storage without limit.
 *
 * The NEWEST are dropped, not the oldest. The list is sorted oldest-first and mergeStall goes out of
 * its way to protect a long-waiting entry's place in it; evicting from that end would discard
 * exactly the applications the queue exists to surface, which is the opposite of the point.
 */
const MAX_STALLS = 50;

export function dedupeKey(stall: Pick<CaptchaStall, 'url'>): string {
  // Query strings on ATS apply links carry tracking and session junk that changes between visits,
  // so the same application would otherwise enter the list once per visit.
  try {
    const url = new URL(stall.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return stall.url;
  }
}

/**
 * Add a stall, or refresh an existing one WITHOUT moving its place in the queue.
 *
 * Re-observing the same application does not restart its wait: same rule, and same reason, as the
 * backend's beginStall.
 */
export function mergeStall(existing: CaptchaStall[], incoming: CaptchaStall): CaptchaStall[] {
  const key = dedupeKey(incoming);
  const previous = existing.find((stall) => dedupeKey(stall) === key);
  const merged: CaptchaStall = previous
    ? { ...incoming, stalledAt: previous.stalledAt }
    : incoming;
  const others = existing.filter((stall) => dedupeKey(stall) !== key);
  return [...others, merged]
    .sort((left, right) => (left.stalledAt < right.stalledAt ? -1 : left.stalledAt > right.stalledAt ? 1 : 0))
    .slice(0, MAX_STALLS);
}

export function removeStall(existing: CaptchaStall[], target: { tabId?: number; url?: string }): CaptchaStall[] {
  const key = target.url ? dedupeKey({ url: target.url }) : null;
  return existing.filter((stall) => {
    if (target.tabId !== undefined && stall.tabId === target.tabId) return false;
    return key === null || dedupeKey(stall) !== key;
  });
}

/**
 * Applications nobody ever came back to.
 *
 * Without this the list only grows: the clear path fires on a confirmed submission, and the common
 * endings are not that - the applicant solves the check and submits without Litos seeing the click,
 * the outcome reads as unknown, or they simply close the tab. A stall a week old is not information,
 * it is a number that never goes down.
 */
export const STALL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function dropExpired(existing: CaptchaStall[], now: number): CaptchaStall[] {
  return existing.filter((stall) => {
    const started = Date.parse(stall.stalledAt);
    // An unparseable timestamp is kept rather than silently discarded: dropping an entry because a
    // date failed to parse would hide the application instead of surfacing it.
    return Number.isNaN(started) || now - started < STALL_TTL_MS;
  });
}

// The pure functions above are the interesting half and are unit-tested. These three are the thin
// chrome.storage.local wrapper around them.
export async function readStalls(): Promise<CaptchaStall[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEY], (result) => {
      const stored = result?.[KEY];
      // Expiry is applied at READ time rather than on a background alarm: it needs no scheduling,
      // no new permission, and cannot drift out of sync with what the badge shows.
      resolve(dropExpired(Array.isArray(stored) ? stored as CaptchaStall[] : [], Date.now()));
    });
  });
}

async function writeStalls(stalls: CaptchaStall[]): Promise<CaptchaStall[]> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [KEY]: stalls }, () => resolve(stalls));
  });
}

export async function recordStall(stall: CaptchaStall): Promise<CaptchaStall[]> {
  return writeStalls(mergeStall(await readStalls(), stall));
}

export async function clearStall(target: { tabId?: number; url?: string }): Promise<CaptchaStall[]> {
  return writeStalls(removeStall(await readStalls(), target));
}
