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

  it('refuses a referral ask phrased as a request, driven through the real adapter', async () => {
    // The shape that broke v1 of this guard: a plain referral ask wearing a courtesy verb. v1
    // escaped on the verb and drafted it with no skip reason, so auto-submit did not hold either.
    const el = textareaFor('Please tell us how you heard about this role', 'ref2');
    const draftAnswer = spyDrafter();

    const result = await run(draftAnswer);

    expect(draftAnswer).not.toHaveBeenCalled();
    expect(el.value).toBe('');
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('drafts and FILLS the essay every earlier version blanked', async () => {
    // Asserting through the adapter, not just the predicate: the drafter has to actually run and
    // the control has to end up populated. REFERRAL_QUESTION's bare `source of` arm made a
    // classifyField-based guard refuse this real essay.
    const el = textareaFor('What is the source of your motivation to build things?', 'motiv');
    const draftAnswer = spyDrafter();

    const result = await run(draftAnswer);

    expect(draftAnswer).toHaveBeenCalledTimes(1);
    expect(el.value).not.toBe('');
    expect(result.ai_drafted).toBe(1);
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

describe('factQuestionRefusingDraft: referral asks vs everything else', () => {
  // Every phrasing that asks how she found the posting. The last one carries the control id that
  // questionLabel() appends, because the guard sees that composite, not the visible label alone.
  const REFERRAL_ASKS = [
    'how did you hear about us?',
    'how did you first hear about this position?',
    'referral source',
    'referral',
    'referred by',
    'who referred you?',
    'were you referred by a current employee?',
    'how were you referred to us?',
    'how did you hear about this role?',
    'where did you hear about this job?',
    'where did you see this vacancy advertised?',
    'how did you find out about this opening?',
    'how did you learn about this opportunity?',
    'how did you discover this role?',
    'where did you first hear about us?',
    'how did you come across this posting?',
    'please tell us how you heard about this role',
    'please describe how you first heard of this opening',
    'how did you find us?',
    // questionLabel() appends the control id, so the guard sees this composite, not the label alone.
    'how did you hear about us? referral_source',
  ];

  it('refuses every referral phrasing', () => {
    const drafted = REFERRAL_ASKS.filter((l) => factQuestionRefusingDraft(l) === null);
    expect(drafted).toEqual([]);
  });

  it('reports the referral key, not merely a non-null one', () => {
    for (const l of REFERRAL_ASKS) {
      expect(factQuestionRefusingDraft(l), l).toBe('referral_source_default');
    }
  });

  // Real essay prompts. The guard must hand every one to the drafter. This corpus is the measured
  // reason the guard covers referral ONLY: each of these classifies to some ProfileKey through
  // classifyField, so a guard keyed on classification alone would blank them. school is hit six
  // times here, phone three, and even date_of_birth once.
  const ESSAYS = [
    'tell us about a project you worked on at school',
    'describe your degree and how it prepared you for this role',
    'how has your degree prepared you for this role?',
    'tell us about a time you worked with people of different nationalities',
    'describe your mobile app experience',
    'share your experience building mobile applications',
    'what mobile applications have you built?',
    'what did you learn from your experience at school?',
    'give an example of a difficult project at school',
    'walk us through a project you completed at school',
    'describe the class of problems you enjoy solving',
    'why do you want to work here?',
    'what interests you about this role?',
    'in your own words, what makes you different from other candidates?',
    'share an example of a project where you had to learn something new quickly',
    'tell us about your proudest achievement at university',
    'describe a time you failed and what you learned',
    'please share your thoughts on remote collaboration',
    'explain a technical concept you find fascinating',
    'what was the major challenge you overcame in your last role?',
    'please explain circumstances that affected your gpa',
    'explain why the date of birth on your transcript differs from this application',
    'describe your citizenship status',
    'describe your salary expectations and how you arrived at them',
    // The one that broke every earlier version: REFERRAL_QUESTION carries a bare `source of` arm
    // for harvest, so a classifyField-based guard refused this essay. REFERRAL_FACT requires an
    // explicit hearing token and does not.
    'what is the source of your motivation to build things?',
    'describe the source of your best ideas',
    // Near misses on the discovery arm. Each contains a discovery verb, and each was blanked by a
    // looser version of REFERRAL_FACT that did not require the object to be this posting.
    'where did you find the greatest opportunity for improvement?',
    'where did you see the biggest weakness in the process?',
    'how did you find us to be different from our competitors?',
    'what have you learned from your last role?',
    'tell us about a time you had to learn something new quickly',
    'what is the primary source of your technical knowledge?',
  ];

  it('never refuses a genuine essay prompt', () => {
    const refused = ESSAYS
      .map((e) => [e, factQuestionRefusingDraft(e)] as const)
      .filter(([, key]) => key !== null)
      .map(([e, key]) => `${e} -> ${key}`);
    expect(refused).toEqual([]);
  });

  it('does not refuse a plain field ask it never claimed to cover', () => {
    // Honest scope boundary, pinned so it stays visible rather than being believed fixed. These
    // still reach the drafter when nothing is stored, exactly as before this guard existed. Two
    // earlier versions DID try to cover them and blanked real essays doing it; see REFERRAL_FACT.
    for (const label of ['what is your phone number?', 'what school do you attend?', 'what is your major?']) {
      expect(factQuestionRefusingDraft(label), label).toBeNull();
    }
  });

  it('does not depend on the length of the control id appended to the label', () => {
    // questionLabel() concatenates the visible label with the control's id or name, so the same
    // question arrives at different lengths on different forms. An earlier version keyed its
    // escape on isOpenEndedQuestion, whose 40-character arm made a pair like this disagree.
    expect(factQuestionRefusingDraft('how did you hear about us? q')).toBe('referral_source_default');
    expect(factQuestionRefusingDraft('how did you hear about us? referral_source_dropdown_field'))
      .toBe('referral_source_default');
  });
});
