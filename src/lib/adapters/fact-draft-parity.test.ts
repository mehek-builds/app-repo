// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fillAshbyApplication } from './ashby';
import { fillGreenhouseApplication } from './greenhouse';
import { fillLeverApplication } from './lever';
import { fillLinkedInApplication } from './linkedin';
import { fillWorkdayApplication } from './workday';
import { skippedReasonsNeedReview } from '../autosubmit-gate';
import type { ApplicationProfile, Profile } from '../types';

// referral-textarea-draft.test.ts pins the generic adapter's half of R-119. This file pins the
// other five, which had a NARROWER version of the same hole and needed their own fix.
//
// Why they were partly safe already: each runs `const known = desiredAnswer(label, ...)` before
// its drafter, so a referral question - whose desiredAnswer is catch-all and therefore never null
// - always took the `known` branch and was flagged rather than drafted. But desiredAnswer is
// guarded on the stored value being present, so on an UNSET profile field it returns null, and
// "no date of birth stored" collapses into "not a date of birth question". That is the exact
// collapse classifyField's docstring says it exists to undo. Measured on all five before the fix:
// date of birth, school, degree, graduation date, citizenship and phone each came back as an
// LLM-authored paragraph asserting a fact the student never recorded.
//
// Location was already covered by locationQuestion and GPA/major by gradeQuestion, which is the
// same doctrine arrived at one field at a time; this guard generalises it.

const RECT = {
  width: 200, height: 24, top: 0, left: 0, right: 200, bottom: 24, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

function makeVisible(): void {
  for (const el of document.querySelectorAll<HTMLElement>('input, textarea, select, label, fieldset, legend')) {
    el.getBoundingClientRect = () => RECT;
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(globalThis, 'CSS', {
    value: { escape: (value: string) => value },
    configurable: true,
  });
});

type Fill = (params: {
  fullName: string;
  email: string;
  profile: Profile;
  applicationProfile: ApplicationProfile;
  draftAnswer: (question: string) => Promise<string | null>;
}) => Promise<{ skipped_reasons: string[]; ai_drafted?: number }>;

// Each adapter only recognises questions inside its own block markup, so the wrapper is part of
// the fixture rather than incidental.
const ADAPTERS: Array<[name: string, wrap: (q: string) => string, fill: Fill]> = [
  ['ashby', (q) => `<div class="_fieldEntry_test"><label>${q}</label><textarea></textarea></div>`, fillAshbyApplication as unknown as Fill],
  ['greenhouse', (q) => `<div class="field-wrapper"><label>${q}</label><textarea></textarea></div>`, fillGreenhouseApplication as unknown as Fill],
  ['lever', (q) => `<div class="application-question"><label>${q}</label><textarea></textarea></div>`, fillLeverApplication as unknown as Fill],
  ['linkedin', (q) => `<div data-test-modal-id="easy-apply-modal"><div class="fb-dash-form-element"><label>${q}</label><textarea></textarea></div></div>`, fillLinkedInApplication as unknown as Fill],
  ['workday', (q) => `<fieldset><legend>${q}</legend><textarea></textarea></fieldset>`, fillWorkdayApplication as unknown as Fill],
];

// Every one of these drafted a paragraph on every adapter before the fix.
const FACTS = [
  'How did you hear about us?',
  'What is your date of birth?',
  'What school do you attend?',
  'What degree are you pursuing?',
  'What is your expected graduation date?',
  'What is your country of citizenship?',
  'What is your phone number?',
];

// A prompt that merely contains a field word is still an essay. Blanking one is its own failure,
// so the refusal has to be scoped, not blanket.
const ESSAYS = [
  'Why do you want to work here?',
  'Tell us about a project you worked on at school',
  'Describe your degree and how it prepared you for this role',
];

async function fillOne(wrap: (q: string) => string, fill: Fill, question: string) {
  document.body.innerHTML = wrap(question);
  makeVisible();
  const drafted: string[] = [];
  const result = await fill({
    fullName: 'Mehek Mandal',
    email: 'mehekman@usc.edu',
    profile: {} as Profile,
    applicationProfile: {} as ApplicationProfile,
    // A drafter that WOULD invent the answer, so a failure here is the fabrication itself rather
    // than a mock returning nothing.
    draftAnswer: async (q: string) => {
      drafted.push(q);
      return 'I found this role on the company careers page while finishing my degree.';
    },
  });
  return { drafted, result, textarea: document.querySelector('textarea') };
}

describe.each(ADAPTERS)('%s: a fact the profile owns is never AI-drafted', (name, wrap, fill) => {
  it.each(FACTS)('leaves "%s" for the student', async (question) => {
    const { drafted, result, textarea } = await fillOne(wrap, fill, question);

    expect(drafted, `${name} sent the question to the drafter`).toEqual([]);
    expect(textarea?.value).toBe('');
    // The reason has to hold the auto-submit countdown, or the field goes blank into a submit.
    // Read what the adapter emitted rather than restating it: a reworded reason that no longer
    // matches REVIEW_FLAG would otherwise leave this suite green.
    expect(skippedReasonsNeedReview(result.skipped_reasons), `${name} emitted no review-holding reason for "${question}": ${JSON.stringify(result.skipped_reasons)}`)
      .toBe(true);
  });

  it.each(ESSAYS)('still drafts "%s"', async (question) => {
    const { drafted, textarea } = await fillOne(wrap, fill, question);

    expect(drafted, `${name} refused a legitimate essay`).toHaveLength(1);
    expect(textarea?.value).not.toBe('');
  });
});
