// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fillGenericApplication, isPerApplicationDecisionQuestion } from './generic';
import { ATS_SPECS } from './ats-2026-07';
import { fillAshbyApplication } from './ashby';
import { fillGreenhouseApplication } from './greenhouse';
import { fillLeverApplication } from './lever';
import { fillLinkedInApplication } from './linkedin';
import { fillWorkdayApplication } from './workday';
import type { ApplicationProfile, Profile } from '../types';

const RECT = {
  width: 200, height: 24, top: 0, left: 0, right: 200, bottom: 24, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

function makeVisible(): void {
  for (const el of document.querySelectorAll<HTMLElement>('input, textarea, select, label, fieldset')) {
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

describe('application decision safety parity', () => {
  it('enables consent and human-decision denial on every generic-backed provider policy', () => {
    const genericProviders = ATS_SPECS.filter((spec) => spec.genericPolicy);
    expect(genericProviders.length).toBeGreaterThan(0);
    for (const spec of genericProviders) {
      expect(spec.genericPolicy?.forbidConsentWrites, spec.id).toBe(true);
      expect(spec.genericPolicy?.forbidHumanDecisionWrites, spec.id).toBe(true);
    }
  });

  it.each([
    'Expected pay: AED 15,000 - 20,000 monthly',
    'When are you available to start?',
    'Can you commit to three days per week onsite?',
    'Are you comfortable working remotely for this role?',
    'Preferred work location',
    'Are you prepared to be in San Francisco four days each week?',
    'I consent to the candidate privacy notice and processing of my personal data',
    'I understand that all information in this application is true and complete',
    'What hourly rate do you expect?',
    'Are you legally authorized to work in Germany?',
    'Will you need sponsorship to work in the UAE?',
  ])('classifies label and option context as human-only: %s', (context) => {
    expect(isPerApplicationDecisionQuestion(context)).toBe(true);
  });

  it('blocks every synthetic control path while preserving factual email fill', async () => {
    document.body.innerHTML = `
      <label for="email">Email</label><input id="email" name="email" type="email">
      <label for="salary">Expected pay, choose a scale</label><select id="salary" name="pay_band">
        <option value="">Choose</option><option value="1">USD 90,000 - 110,000</option>
      </select>
      <label for="privacy">Applicant privacy notice</label><textarea id="privacy" name="privacy_acknowledgement"></textarea>
      <fieldset><legend>Can you commit to four days per week onsite?</legend>
        <label for="onsite-y">Yes</label><input id="onsite-y" name="onsite" type="radio" value="yes">
        <label for="onsite-n">No</label><input id="onsite-n" name="onsite" type="radio" value="no">
      </fieldset>
      <fieldset><legend>Are you authorized to work in the UK, Germany, UAE, or US?</legend>
        <label for="auth-y">Yes</label><input id="auth-y" name="work_auth" type="radio" value="yes">
        <label for="auth-n">No</label><input id="auth-n" name="work_auth" type="radio" value="no">
      </fieldset>
      <label for="consent">I agree to processing under the privacy policy</label>
      <input id="consent" name="privacy_consent" type="checkbox">
      <label for="default-consent">I consent to retention under the applicant privacy notice</label>
      <input id="default-consent" name="default_privacy_consent" type="checkbox" checked>
    `;
    makeVisible();

    const result = await fillGenericApplication({
      fullName: 'Mehek Mandal',
      email: 'mehek@example.com',
      profile: {} as Profile,
      applicationProfile: {
        work_authorized: true,
        needs_sponsorship: false,
        desired_salary: '100000',
        desired_salary_currency: 'USD',
        availability_date: '2026-09-01',
      } as ApplicationProfile,
      draftAnswer: async () => 'must not be used',
    });

    expect((document.querySelector('#email') as HTMLInputElement).value).toBe('mehek@example.com');
    expect((document.querySelector('#salary') as HTMLSelectElement).value).toBe('');
    expect((document.querySelector('#privacy') as HTMLTextAreaElement).value).toBe('');
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every((input) => !input.checked)).toBe(true);
    expect((document.querySelector('#consent') as HTMLInputElement).checked).toBe(false);
    expect((document.querySelector('#default-consent') as HTMLInputElement).checked).toBe(true);
    expect(result.fields_filled).toBe(1);
    expect(result.fields_skipped).toBe(7);
    expect(result.skipped_reasons.filter((reason) => /application decision left for you/.test(reason))).toHaveLength(6);
    expect(result.skipped_reasons.some((reason) => /left for you/.test(reason))).toBe(true);
  });

  it.each([
    ['ashby', '<div class="_fieldEntry_test"><label>Explain why you accept the applicant privacy policy</label><textarea>tenant default</textarea></div>', fillAshbyApplication],
    ['greenhouse', '<div class="field-wrapper"><label>Explain why you accept the applicant privacy policy</label><textarea>tenant default</textarea></div>', fillGreenhouseApplication],
    ['lever', '<div class="application-question"><label>Explain why you accept the applicant privacy policy</label><textarea>tenant default</textarea></div>', fillLeverApplication],
    ['linkedin', '<div data-test-modal-id="easy-apply-modal"><div class="fb-dash-form-element"><label>Explain why you accept the applicant privacy policy</label><textarea>tenant default</textarea></div></div>', fillLinkedInApplication],
    ['workday', '<fieldset><legend>Explain why you accept the applicant privacy policy</legend><textarea>tenant default</textarea></fieldset>', fillWorkdayApplication],
  ] as const)('%s holds a prefilled decision and never sends it to the drafter', async (_name, markup, fill) => {
    document.body.innerHTML = markup;
    makeVisible();
    const drafted: string[] = [];
    const result = await fill({
      fullName: '',
      profile: {} as Profile,
      applicationProfile: {} as ApplicationProfile,
      draftAnswer: async (question: string) => {
        drafted.push(question);
        return 'generated acceptance';
      },
    });
    expect(drafted).toEqual([]);
    expect(document.querySelector('textarea')?.value).toBe('tenant default');
    expect(result.skipped_reasons.some((reason) => /application decision left for you/.test(reason))).toBe(true);
  });
});

/* The 18+ attestation reaches an employer's form in the applicant's own browser, so "we could not
 * answer it" has to arrive as a stated reason on the fill card, not as an empty required field she
 * discovers at submit. The wording carries "left for", which is what autosubmit-gate's REVIEW_FLAG
 * matches, so the countdown HOLDS while it waits. */
describe('the 18+ attestation on a live form', () => {
  const form = `
    <fieldset><legend>Are you 18 years of age or older?</legend>
      <label for="age-y">Yes</label><input id="age-y" name="age_attest" type="radio" value="yes">
      <label for="age-n">No</label><input id="age-n" name="age_attest" type="radio" value="no">
    </fieldset>
    <label for="age-cb">I am 18 years of age or older</label>
    <input id="age-cb" name="age_checkbox" type="checkbox">
  `;

  const fill = (applicationProfile: ApplicationProfile) => fillGenericApplication({
    fullName: 'Mehek Mandal',
    profile: {} as Profile,
    applicationProfile,
    draftAnswer: async () => 'must not be used',
  });

  it('flags it with a stated reason when no date of birth is saved', async () => {
    document.body.innerHTML = form;
    makeVisible();
    const result = await fill({} as ApplicationProfile);

    expect([...document.querySelectorAll<HTMLInputElement>('input')].every((i) => !i.checked)).toBe(true);
    const flagged = result.skipped_reasons.filter((r) => /date of birth is not saved/.test(r));
    expect(flagged).toHaveLength(2);
    // The bare checkbox carries no certify/consent wording, so before this it left NO reason at all.
    expect(flagged.every((r) => /left for/.test(r))).toBe(true);
  });

  it('answers it from the stored date of birth', async () => {
    document.body.innerHTML = form;
    makeVisible();
    const result = await fill({ date_of_birth: '2005-09-25' } as ApplicationProfile);

    expect((document.querySelector('#age-y') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('#age-n') as HTMLInputElement).checked).toBe(false);
    expect((document.querySelector('#age-cb') as HTMLInputElement).checked).toBe(true);
    expect(result.skipped_reasons.some((r) => /date of birth is not saved/.test(r))).toBe(false);
  });

  it('never turns "18 months of experience" into an age attestation', async () => {
    document.body.innerHTML = `
      <fieldset><legend>Do you have 18+ months of relevant experience?</legend>
        <label for="exp-y">Yes</label><input id="exp-y" name="exp" type="radio" value="yes">
        <label for="exp-n">No</label><input id="exp-n" name="exp" type="radio" value="no">
      </fieldset>
    `;
    makeVisible();
    const result = await fill({ date_of_birth: '2005-09-25' } as ApplicationProfile);

    expect([...document.querySelectorAll<HTMLInputElement>('input')].every((i) => !i.checked)).toBe(true);
    expect(result.skipped_reasons.some((r) => /date of birth is not saved/.test(r))).toBe(false);
  });
});
