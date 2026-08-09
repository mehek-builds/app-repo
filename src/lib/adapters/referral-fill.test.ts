// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { fillGenericApplication } from './generic';
import { skippedReasonsNeedReview } from '../autosubmit-gate';
import type { ApplicationProfile, Profile } from '../types';

// generic.answers.test.ts pins what desiredAnswer RESOLVES for a referral question. This file
// pins what the adapter actually DOES with that resolution, because the safety argument for
// refusing the question lives in a string the pure tests never see: the skip reason the fill loop
// pushes, which autosubmit-gate's REVIEW_FLAG has to match or the countdown does not hold.
//
// Written after review caught that asserting `skippedReasonsNeedReview('dropdown left for you: ...')`
// against a hand-typed literal proves nothing: renaming the reason inside generic.ts left the whole
// suite green, and a reworded reason means a required referral question goes blank into an
// auto-submit. These tests read the emitted reason instead of restating it.

const profile = {} as Profile;
const ap = (o: Partial<ApplicationProfile> = {}): ApplicationProfile => o as ApplicationProfile;
const REFERRAL_LABEL = 'How did you hear about us?';

beforeAll(() => {
  // The generic adapter filters every control through isVisible(), and jsdom has no layout: every
  // rect is 0x0, so nothing would ever be considered. Give every element a real-looking box.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }),
  });
  if (typeof globalThis.CSS === 'undefined' || !globalThis.CSS?.escape) {
    (globalThis as Record<string, unknown>).CSS = {
      escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
    };
  }
});

beforeEach(() => {
  document.body.innerHTML = '';
});

function referralSelect(options: string[]): HTMLSelectElement {
  const select = document.createElement('select');
  select.id = 'referral_source';
  const label = document.createElement('label');
  label.htmlFor = select.id;
  label.textContent = REFERRAL_LABEL;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select...';
  select.appendChild(placeholder);
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    select.appendChild(o);
  }
  document.body.appendChild(label);
  document.body.appendChild(select);
  return select;
}

function run(referral_source_default?: string) {
  return fillGenericApplication({
    fullName: 'Mehek Mandal',
    email: 'mehekman@usc.edu',
    profile,
    applicationProfile: ap(referral_source_default === undefined ? {} : { referral_source_default }),
  });
}

describe('referral source: what the adapter emits when it refuses to answer', () => {
  it('leaves a channel-only dropdown blank AND holds auto-submit on the reason it emits', async () => {
    const select = referralSelect(['LinkedIn', 'Indeed', 'Company website', 'Employee referral']);

    const result = await run(); // owner's shipping shape: no stored referral source

    expect(select.value).toBe('');
    // Read the emitted reason, do not restate it. This is the coupling that matters: whatever
    // wording generic.ts uses must satisfy the gate.
    const referralReason = result.skipped_reasons.find((r) => r.toLowerCase().includes(REFERRAL_LABEL.toLowerCase().slice(0, 20)));
    expect(referralReason, `no skip reason mentioned the referral question: ${JSON.stringify(result.skipped_reasons)}`)
      .toBeTruthy();
    expect(skippedReasonsNeedReview([referralReason!])).toBe(true);
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('never selects a channel-naming "Other ..." option, and still holds auto-submit', async () => {
    // \bother\b matches "Other job board" as readily as "Other", and a single hit used to commit.
    const select = referralSelect(['LinkedIn', 'Indeed', 'Other job board']);

    const result = await run();

    expect(select.value).toBe('');
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('leaves even a real catch-all unanswered when no source is stored, and holds auto-submit', async () => {
    const select = referralSelect(['LinkedIn', 'Indeed', 'Other (please specify)']);

    const result = await run();

    expect(select.value).toBe('');
    expect(result.skipped_reasons.some((r) => r.toLowerCase().includes(REFERRAL_LABEL.toLowerCase().slice(0, 20)))).toBe(true);
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('leaves legacy and ambiguous company-site defaults blank without packet evidence', async () => {
    for (const source of ['Company website', 'Website', 'Careers']) {
      document.body.innerHTML = '';
      const select = referralSelect(['LinkedIn', source, 'Other']);
      const result = await run(source);
      expect(select.value, source).toBe('');
      expect(skippedReasonsNeedReview(result.skipped_reasons), source).toBe(true);
    }
  });

  it('fills the stored channel when the form lists it', async () => {
    const select = referralSelect(['LinkedIn', 'Indeed', 'Other']);

    const result = await run('LinkedIn');

    expect(select.value).toBe('LinkedIn');
    expect(result.fields_filled).toBeGreaterThan(0);
  });

  it('falls to the catch-all when the form does not list the stored channel', async () => {
    const select = referralSelect(['Indeed', 'Company website', 'Other']);

    await run('LinkedIn');

    expect(select.value).toBe('Other');
  });

  it('never substitutes a different channel for the stored one', async () => {
    const select = referralSelect(['Indeed', 'Company website', 'Employee referral']);

    const result = await run('LinkedIn');

    expect(select.value).toBe('');
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });
});
