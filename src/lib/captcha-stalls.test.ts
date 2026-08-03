import { describe, it, expect } from 'vitest';
import { dedupeKey, mergeStall, removeStall, type CaptchaStall } from './captcha-stalls';

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
    const next = removeStall(list, 'https://boards.greenhouse.io/acme/jobs/1?gh_src=zzz');
    expect(next.map((entry) => entry.url)).toEqual(['https://other.com/jobs/9']);
  });

  it('is a no-op for an application that was never in the list', () => {
    expect(removeStall([stall()], 'https://nowhere.com/jobs/1')).toHaveLength(1);
  });
});
