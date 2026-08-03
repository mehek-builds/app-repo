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
  url: string;
  company: string;
  role: string;
  provider: CaptchaProviderName;
  atsName?: string;
  stalledAt: string;
};

const KEY = 'captcha_stalls';

/** Bounded so a pathological loop cannot grow storage without limit. Oldest are dropped. */
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
    .slice(-MAX_STALLS);
}

export function removeStall(existing: CaptchaStall[], url: string): CaptchaStall[] {
  const key = dedupeKey({ url });
  return existing.filter((stall) => dedupeKey(stall) !== key);
}

// The pure functions above are the interesting half and are unit-tested. These three are the thin
// chrome.storage.local wrapper around them.
export async function readStalls(): Promise<CaptchaStall[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEY], (result) => {
      const stored = result?.[KEY];
      resolve(Array.isArray(stored) ? stored as CaptchaStall[] : []);
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

export async function clearStall(url: string): Promise<CaptchaStall[]> {
  return writeStalls(removeStall(await readStalls(), url));
}
