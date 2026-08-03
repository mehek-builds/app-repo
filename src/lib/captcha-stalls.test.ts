import { describe, it, expect } from 'vitest';
import { dedupeKey, dropExpired, mergeStall, removeStall, STALL_TTL_MS, type CaptchaStall } from './captcha-stalls';

function stall(patch: Partial<CaptchaStall> = {}): CaptchaStall {
  return {
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    company: 'Acme',
    role: 'Analyst',
    provider: 'recaptcha_v2',
    stalledAt: '2026-08-04T09:00:00.000Z',
    ...patch,
  };
}

describe('dedupeKey', () => {
  /* ATS apply links carry tracking and session parameters that change between visits, so the same
   * application would otherwise enter the queue once per visit and the count would climb on its
   * own. */
  it('treats the same posting with different tracking parameters as one application', () => {
    expect(dedupeKey({ url: 'https://boards.greenhouse.io/acme/jobs/1?gh_src=abc' }))
      .toBe(dedupeKey({ url: 'https://boards.greenhouse.io/acme/jobs/1?utm_campaign=x&t=99' }));
  });

  it('keeps different postings apart', () => {
    expect(dedupeKey({ url: 'https://boards.greenhouse.io/acme/jobs/1' }))
      .not.toBe(dedupeKey({ url: 'https://boards.greenhouse.io/acme/jobs/2' }));
  });

  it('does not throw on a url it cannot parse', () => {
    expect(dedupeKey({ url: 'not a url' })).toBe('not a url');
  });
});

describe('mergeStall', () => {
  it('adds a stall that is not in the list yet', () => {
    expect(mergeStall([], stall())).toHaveLength(1);
  });

  /* The rule the whole queue rests on. Re-observing an application does not restart its wait, and
   * the application nobody has dealt with is exactly the one that keeps being re-observed - so a
   * list that re-dated on each sighting would bury the worst case forever. */
  it('does not restart the wait when the same application stalls again', () => {
    const merged = mergeStall([stall()], stall({ stalledAt: '2026-08-04T23:00:00.000Z' }));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.stalledAt).toBe('2026-08-04T09:00:00.000Z');
  });

  it('takes the newer provider and company while keeping the original wait', () => {
    const merged = mergeStall(
      [stall({ provider: 'unknown', company: '' })],
      stall({ provider: 'hcaptcha', company: 'Acme', stalledAt: '2026-08-04T23:00:00.000Z' }),
    );
    expect(merged[0]!.provider).toBe('hcaptcha');
    expect(merged[0]!.company).toBe('Acme');
    expect(merged[0]!.stalledAt).toBe('2026-08-04T09:00:00.000Z');
  });

  it('keeps the queue oldest first', () => {
    let list: CaptchaStall[] = [];
    list = mergeStall(list, stall({ url: 'https://a.com/jobs/1', stalledAt: '2026-08-03T10:00:00.000Z' }));
    list = mergeStall(list, stall({ url: 'https://b.com/jobs/2', stalledAt: '2026-08-01T10:00:00.000Z' }));
    list = mergeStall(list, stall({ url: 'https://c.com/jobs/3', stalledAt: '2026-08-02T10:00:00.000Z' }));
    expect(list.map((entry) => entry.url)).toEqual([
      'https://b.com/jobs/2',
      'https://c.com/jobs/3',
      'https://a.com/jobs/1',
    ]);
  });

  /* Eviction drops the NEWEST. The queue exists to surface the application nobody has dealt with,
   * and mergeStall goes out of its way to protect a long-waiting entry's place, so evicting from
   * that end would discard exactly the entries the feature is for. */
  it('bounds the list by dropping the newest, never the longest-waiting', () => {
    let list: CaptchaStall[] = [];
    for (let index = 0; index < 60; index += 1) {
      list = mergeStall(list, stall({
        url: `https://boards.greenhouse.io/acme/jobs/${index}`,
        // Ascending, so index 0 is the longest wait and index 59 the newest.
        stalledAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      }));
    }
    expect(list.length).toBeLessThanOrEqual(50);
    const oldest = [...list].sort((a, b) => (a.stalledAt < b.stalledAt ? -1 : 1))[0]!;
    expect(list[0]!.stalledAt).toBe(oldest.stalledAt);
  });

  it('does not mutate the list it was given', () => {
    const original = [stall()];
    mergeStall(original, stall({ url: 'https://other.com/jobs/9' }));
    expect(original).toHaveLength(1);
  });
});

describe('removeStall', () => {
  it('removes the finished application regardless of its tracking parameters', () => {
    const list = [stall(), stall({ url: 'https://other.com/jobs/9' })];
    const next = removeStall(list, { url: 'https://boards.greenhouse.io/acme/jobs/1?gh_src=zzz' });
    expect(next.map((entry) => entry.url)).toEqual(['https://other.com/jobs/9']);
  });

  /* The case a url-only match cannot handle, and the reason the count would otherwise only ever
   * grow: submitting redirects to a confirmation page on a DIFFERENT path, and the resolution is
   * reported from that page. Greenhouse goes to /confirmation, Lever to /thanks. */
  it('clears by tab, so a confirmation redirect still resolves the stall', () => {
    const list = [stall({ tabId: 7 }), stall({ tabId: 9, url: 'https://other.com/jobs/9' })];
    const next = removeStall(list, { tabId: 7, url: 'https://boards.greenhouse.io/acme/jobs/1/confirmation' });
    expect(next.map((entry) => entry.tabId)).toEqual([9]);
  });

  it('is a no-op for an application that was never in the list', () => {
    expect(removeStall([stall()], { url: 'https://nowhere.com/jobs/1' })).toHaveLength(1);
  });
});

describe('dropExpired', () => {
  const now = Date.parse('2026-08-20T00:00:00.000Z');

  /* The clear path fires on a confirmed submission, and most real endings are not that: the
   * applicant solves the check and submits without Litos seeing the click, the outcome reads as
   * unknown, or they close the tab. Without expiry the badge becomes a number that never goes down. */
  it('drops an application nobody came back to', () => {
    const old = new Date(now - STALL_TTL_MS - 1000).toISOString();
    expect(dropExpired([stall({ stalledAt: old })], now)).toHaveLength(0);
  });

  it('keeps one that is still within the window', () => {
    const recent = new Date(now - STALL_TTL_MS + 60_000).toISOString();
    expect(dropExpired([stall({ stalledAt: recent })], now)).toHaveLength(1);
  });

  // Hiding an application because a date failed to parse is worse than showing it.
  it('keeps an entry whose timestamp cannot be parsed', () => {
    expect(dropExpired([stall({ stalledAt: 'not a date' })], now)).toHaveLength(1);
  });
});
