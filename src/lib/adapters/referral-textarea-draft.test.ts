// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { fillGenericApplication, factQuestionRefusingDraft } from './generic';
import { skippedReasonsNeedReview } from '../autosubmit-gate';
import type { ApplicationProfile, Profile } from '../types';

// referral-fill.test.ts pins what the adapter does with a referral question rendered as a SELECT,
// which is the shape R-118 fixed. This file pins the other shape. The select path resolves through
// desiredAnswer and therefore reaches `case 'referral_source_default'`; a <textarea> never did.
// The identity-first chain leaves `value` undefined for a referral label, the profile lookup after
// it is gated on `!isTextarea`, and the essay drafter at the bottom of the loop had no
// field-identity check - so "How did you hear about us?" in a textarea was handed to a language
// model, which wrote a paragraph asserting how she found the posting. Same invention R-118
// removed, in her voice and at greater length.
//
// These tests read the emitted skip reason rather than restating it, for the reason
// referral-fill.test.ts documents: asserting skippedReasonsNeedReview() against a hand-typed
// literal proves nothing about what generic.ts actually pushes.

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

function textareaFor(labelText: string, id = 'q'): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.id = id;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  document.body.append(label, el);
  return el;
}

// A drafter that would happily invent the answer, so a test failure is the fabrication itself
// rather than a mock returning nothing.
function spyDrafter() {
  return vi.fn(async () => 'I first came across this role on the company careers page.');
}

function run(draftAnswer: ReturnType<typeof spyDrafter>, applicationProfile = ap()) {
  return fillGenericApplication({
    fullName: 'Mehek Mandal',
    email: 'mehekman@usc.edu',
    profile,
    applicationProfile,
    draftAnswer,
  });
}

describe('referral source rendered as a textarea', () => {
  it('leaves it blank, never calls the drafter, and holds auto-submit on the reason it emits', async () => {
    const el = textareaFor(REFERRAL_LABEL, 'referral_source');
    const draftAnswer = spyDrafter();

    const result = await run(draftAnswer); // owner's shipping shape: no stored referral source

    // The fabrication, stated three ways: the model was never asked, nothing was written, and
    // nothing was counted as drafted.
    expect(draftAnswer).not.toHaveBeenCalled();
    expect(el.value).toBe('');
    expect(result.ai_drafted).toBe(0);

    // Read the emitted reason, do not restate it: whatever wording generic.ts uses must satisfy
    // the gate, or a required referral question goes blank into an auto-submit.
    const reason = result.skipped_reasons.find((r) => r.toLowerCase().includes('hear about us'));
    expect(reason, `no skip reason mentioned the referral question: ${JSON.stringify(result.skipped_reasons)}`)
      .toBeTruthy();
    expect(reason).toMatch(/left for/i);
    expect(skippedReasonsNeedReview([reason!])).toBe(true);
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('refuses even when a referral source IS stored, because a textarea is not an option list', async () => {
    // desiredAnswer resolves a stored channel to {mode:'oneof'}, which only ever meant "match an
    // option". There is nothing to match in a textarea, and prose about the channel is prose the
    // student did not write.
    const el = textareaFor(REFERRAL_LABEL, 'referral_source');
    const draftAnswer = spyDrafter();

    const result = await run(draftAnswer, ap({ referral_source_default: 'LinkedIn' }));

    expect(draftAnswer).not.toHaveBeenCalled();
    expect(el.value).toBe('');
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('still drafts a real essay on the same form, so the refusal is scoped to the fact', async () => {
    textareaFor(REFERRAL_LABEL, 'referral_source');
    const essay = textareaFor('Why do you want to work here?', 'motivation');
    const draftAnswer = spyDrafter();

    const result = await run(draftAnswer);

    expect(draftAnswer).toHaveBeenCalledTimes(1);
    expect(essay.value).not.toBe('');
    expect(result.ai_drafted).toBe(1);
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });
});

describe('the same hole on the other keys the profile owns', () => {
  // Measured on this adapter before the fix: every one of these drafted a paragraph.
  const FACTS: Array<[label: string, id: string]> = [
    ['What is your date of birth?', 'dob'],
    ['What is your GPA?', 'gpa'],
    ['What is your expected graduation date?', 'grad'],
    ['What is your major?', 'major'],
    ['What school do you attend?', 'school'],
    ['What is your country of citizenship?', 'citizenship'],
    ['What is your phone number?', 'phone'],
  ];

  for (const [label, id] of FACTS) {
    it(`leaves "${label}" for the student instead of drafting it`, async () => {
      const el = textareaFor(label, id);
      const draftAnswer = spyDrafter();

      const result = await run(draftAnswer);

      expect(draftAnswer).not.toHaveBeenCalled();
      expect(el.value).toBe('');
      expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
    });
  }
});

describe('factQuestionRefusingDraft: the fact-vs-essay split', () => {
  // A prompt that merely CONTAINS a field word is still an essay, and blanking one is its own
  // failure. These are the live-shaped collisions the escape hatch exists for.
  const ESSAYS = [
    'tell us about a project you worked on at school',
    'describe your degree and how it prepared you for this role',
    'tell us about a time you worked with people of different nationalities',
    'describe your mobile app experience',
    'why do you want to work here?',
    'what interests you about this role?',
    'in your own words, what makes you different from other candidates?',
    'share an example of a project where you had to learn something new quickly',
    'describe the type of problems you most enjoy working on',
  ];

  it('never refuses a genuine essay prompt', () => {
    const refused = ESSAYS
      .map((e) => [e, factQuestionRefusingDraft(e)] as const)
      .filter(([, key]) => key !== null)
      .map(([e, key]) => `${e} -> ${key}`);
    expect(refused).toEqual([]);
  });

  it('errs toward refusing when a field word appears in a verbless prompt', () => {
    // The known and accepted cost of keying the escape on VERBS rather than on
    // isOpenEndedQuestion's 40-character arm: \bmajor\b matches this essay and no verb does, so it
    // is flagged for the student instead of drafted. Pinned deliberately - the length arm was
    // rejected because it made the guard depend on how long the control's id attribute is, which
    // meant the same citizenship question was refused as `q` and drafted as `citizenship`.
    // Blanking an essay costs a paragraph of typing; drafting a fact she never recorded puts a
    // false statement on a real application.
    expect(factQuestionRefusingDraft('what was the major challenge you overcame in your last role?'))
      .toBe('major');
  });

  it('does not depend on the length of the control id appended to the label', () => {
    // questionLabel() concatenates the visible label with the control's id or name, so the same
    // question arrives at different lengths on different forms. Both must resolve the same way.
    expect(factQuestionRefusingDraft('what is your country of citizenship? q')).toBe('citizenship');
    expect(factQuestionRefusingDraft('what is your country of citizenship? citizenship'))
      .toBe('citizenship');
  });

  it('refuses the field-shaped phrasings of each owned fact', () => {
    const drafted = [
      'how did you hear about us?',
      'how did you first hear about this position?',
      'referral source',
      'what is your date of birth?',
      'what is your gpa?',
      'expected graduation year',
      'what is your major?',
      'what school do you attend?',
      'what is your citizenship?',
      'what city do you live in?',
    ].filter((f) => factQuestionRefusingDraft(f) === null);
    expect(drafted).toEqual([]);
  });

  it('refuses a referral question however it is phrased, unlike every other key', () => {
    // "How did you hear about us?" trips isOpenEndedQuestion's `how (did|do) you` arm, so a
    // referral key that yielded to prose shape would hand back exactly the label this fix exists
    // for. This is the assertion that pins the unconditional arm.
    expect(factQuestionRefusingDraft('how did you hear about us?')).toBe('referral_source_default');
    expect(factQuestionRefusingDraft('please describe how you first heard about this opening'))
      .toBe('referral_source_default');
  });
});
