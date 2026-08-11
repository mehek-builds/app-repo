// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exactGatedAttendedReceipt,
  fillFrozenIcimsLoginEmail,
  frozenIcimsLoginEmailState,
  gatedAttendedIdentity,
  gatedReviewedAnswerControlAllowed,
  gatedStageCanPrepare,
  applicantOwnedEmailInputs,
  guardFrozenIcimsLoginIntent,
  guardTrustedSecurityCodeIntent,
  inspectGatedAttendedStage,
  validGatedAccountNavigationProof,
  newArmingSupersedesContinuation,
} from './gated-attended-ats';
import { replayReviewedAnswers, reviewedAnswersMatch } from './reviewed-answer-replay';
import type { HandoffQuestion } from './handoff-packet';

const JOBVITE = 'https://jobs.jobvite.com/worldfirst/job/oknrAfws/apply';
const ICIMS_JOB = 'https://jobs-express.icims.com/jobs/48173/sales-associate/job';
const ICIMS_LOGIN = 'https://jobs-express.icims.com/jobs/48173/sales-associate/login';

describe('gated attended application identity', () => {
  it('keeps only measured stages of the exact tenant and job', () => {
    expect(gatedAttendedIdentity(JOBVITE)?.key).toBe('https://jobs.jobvite.com/worldfirst/job/oknrAfws');
    expect(gatedAttendedIdentity(ICIMS_JOB)?.key).toBe(gatedAttendedIdentity(ICIMS_LOGIN)?.key);
    expect(gatedAttendedIdentity('https://jobs-express.icims.com/jobs/48173/sales-associate/apply')).toBeNull();
    expect(gatedAttendedIdentity('https://jobs-express.icims.com/jobs/48174/sales-associate/login')?.key)
      .not.toBe(gatedAttendedIdentity(ICIMS_LOGIN)?.key);
    expect(gatedAttendedIdentity('https://other.icims.com/jobs/48173/sales-associate/login')?.key)
      .not.toBe(gatedAttendedIdentity(ICIMS_LOGIN)?.key);
    expect(gatedAttendedIdentity('https://jobs-express.icims.com/jobs/search')).toBeNull();
  });

  it('preserves case-sensitive Jobvite tenant and job identifiers', () => {
    expect(gatedAttendedIdentity(JOBVITE)?.key)
      .not.toBe(gatedAttendedIdentity('https://jobs.jobvite.com/WorldFirst/job/oknrafws/apply')?.key);
  });
});

describe('iCIMS account navigation proof', () => {
  const base = { family: 'icims' as const, loginProofAt: 1_000, loginProofDocumentId: 'login-doc', now: 2_000, ttlMs: 5_000 };
  it('requires a fresh proof from a different browser document', () => {
    expect(validGatedAccountNavigationProof({ ...base, currentDocumentId: 'application-doc' })).toBe(true);
    expect(validGatedAccountNavigationProof({ ...base, currentDocumentId: 'login-doc' })).toBe(false);
    expect(validGatedAccountNavigationProof({ ...base, currentDocumentId: undefined })).toBe(false);
    expect(validGatedAccountNavigationProof({ ...base, currentDocumentId: 'application-doc', now: 7_000 })).toBe(false);
    expect(validGatedAccountNavigationProof({ ...base, currentDocumentId: 'application-doc', now: 999 })).toBe(false);
  });

  it('requires the frozen-email login proof before a security-code transition', () => {
    const chained = {
      ...base,
      securityProofAt: 1_500,
      securityProofDocumentId: 'security-doc',
      currentDocumentId: 'application-doc',
    };
    expect(validGatedAccountNavigationProof(chained)).toBe(true);
    expect(validGatedAccountNavigationProof({
      family: 'icims',
      securityProofAt: 1_500,
      securityProofDocumentId: 'security-doc',
      currentDocumentId: 'application-doc',
      now: 2_000,
      ttlMs: 5_000,
    })).toBe(false);
    expect(validGatedAccountNavigationProof({ ...chained, currentDocumentId: 'security-doc' })).toBe(false);
    expect(validGatedAccountNavigationProof({ ...chained, currentDocumentId: 'login-doc' })).toBe(false);
    expect(validGatedAccountNavigationProof({ ...chained, securityProofAt: 900 })).toBe(false);
    expect(validGatedAccountNavigationProof({ ...chained, now: 7_000 })).toBe(false);
  });


  it('does not impose an account proof on Jobvite', () => {
    expect(validGatedAccountNavigationProof({ family: 'jobvite', now: 2_000, ttlMs: 5_000 })).toBe(true);
  });
});

describe('exact applicant email evidence', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('selects one applicant email without treating a manager email as the applicant', () => {
    document.body.innerHTML = `
      <label>Applicant email<input type="email" name="candidateEmail" value="application@example.com"></label>
      <label>Manager email<input type="email" name="managerEmail"></label>`;
    expect(applicantOwnedEmailInputs(document).map((input) => input.name)).toEqual(['candidateEmail']);
  });

  it('fails closed through ambiguity instead of choosing between two applicant email controls', () => {
    document.body.innerHTML = `
      <label>Email<input type="email" name="email"></label>
      <label>Confirm email<input type="email" name="confirmEmail"></label>`;
    expect(applicantOwnedEmailInputs(document)).toHaveLength(2);
  });

});

describe('same-job packet replacement', () => {
  it('lets every newly armed packet replace a stale continuation, including a revised packet for the same application', () => {
    expect(newArmingSupersedesContinuation('packet-a', 'packet-b')).toBe(true);
    expect(newArmingSupersedesContinuation('packet-a', 'packet-a')).toBe(true);
    expect(newArmingSupersedesContinuation('packet-a')).toBe(false);
  });
});

describe('human-owned gated stages', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('holds on visible Jobvite privacy and ignores a stale hidden selector', () => {
    document.body.innerHTML = '<select id="jv-country-select"><option>Choose</option></select>';
    expect(inspectGatedAttendedStage(JOBVITE)?.stage).toBe('privacy_consent');
    document.body.innerHTML = '<div hidden><select id="jv-country-select"></select></div>';
    expect(inspectGatedAttendedStage(JOBVITE)?.stage).toBe('other');
  });

  it('never lets an empty parent or sibling frame consume the one-shot arm', async () => {
    expect(gatedStageCanPrepare('other')).toBe(false);
    expect(gatedStageCanPrepare('privacy_consent')).toBe(true);
    expect(gatedStageCanPrepare('account_login')).toBe(true);
    expect(gatedStageCanPrepare('security_code')).toBe(true);
    expect(gatedStageCanPrepare('captcha')).toBe(true);
    expect(gatedStageCanPrepare('application')).toBe(false);
    let arm = 'packet';
    const consume = async (frame: string, stage: Parameters<typeof gatedStageCanPrepare>[0]) => {
      if (!gatedStageCanPrepare(stage) || !arm) return null;
      const packet = arm;
      arm = '';
      return { frame, packet };
    };
    const [parent, child] = await Promise.all([
      consume('top-empty', 'other'),
      consume('child-form', 'privacy_consent'),
    ]);
    expect(parent).toBeNull();
    expect(child).toEqual({ frame: 'child-form', packet: 'packet' });
    expect(arm).toBe('');
  });

  it('fills only the exact frozen iCIMS email and never operates password, CAPTCHA, or login', async () => {
    document.body.innerHTML = `
      <label for="email">Email</label><input id="email" name="css_loginName">
      <input id="password" name="password" type="password">
      <textarea name="h-captcha-response"></textarea>
      <button id="login">Log in</button>`;
    const login = document.querySelector<HTMLButtonElement>('#login')!;
    const click = vi.spyOn(login, 'click');
    expect(inspectGatedAttendedStage(ICIMS_LOGIN)?.stage).toBe('captcha');
    expect(await fillFrozenIcimsLoginEmail('Applicant@Litos.Email')).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#email')?.value).toBe('applicant@litos.email');
    expect(document.querySelector<HTMLInputElement>('#password')?.value).toBe('');
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
    expect(click).not.toHaveBeenCalled();
  });

  it('rejects a different browser-autofilled iCIMS account email', async () => {
    document.body.innerHTML = '<input id="email" name="css_loginName" value="other@example.com">';
    expect(frozenIcimsLoginEmailState('applicant@litos.email')).toBe('mismatch');
    expect(await fillFrozenIcimsLoginEmail('applicant@litos.email')).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#email')?.value).toBe('other@example.com');
    document.querySelector<HTMLInputElement>('#email')!.value = 'Applicant@Litos.Email';
    expect(frozenIcimsLoginEmailState('applicant@litos.email')).toBe('match');
  });

  it('ignores a hidden stale login input and refuses two visible candidates', async () => {
    document.body.innerHTML = `
      <div hidden><input id="email" name="css_loginName" value="wrong@example.com"></div>
      <input id="email" name="css_loginName">`;
    expect(frozenIcimsLoginEmailState('applicant@litos.email')).toBe('empty');
    expect(await fillFrozenIcimsLoginEmail('applicant@litos.email')).toBe(true);
    document.body.insertAdjacentHTML('beforeend', '<input id="email" name="css_loginName">');
    expect(frozenIcimsLoginEmailState('applicant@litos.email')).toBe('ambiguous');
    expect(await fillFrozenIcimsLoginEmail('applicant@litos.email')).toBe(false);
  });

  it('accepts no synthetic account submit and invalidates an edited email before submit', () => {
    document.body.innerHTML = '<form><input id="email" name="css_loginName" value="applicant@litos.email"></form>';
    const invalid = vi.fn();
    const proved = vi.fn();
    expect(guardFrozenIcimsLoginIntent({ email: 'applicant@litos.email', onInvalid: invalid, onTrustedSubmit: proved })).toBe(true);
    document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(proved).not.toHaveBeenCalled();
    const email = document.querySelector<HTMLInputElement>('#email')!;
    email.value = 'other@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    expect(invalid).toHaveBeenCalledTimes(1);
  });

  it('finds CAPTCHA and security-code gates inside open shadow roots without touching them', () => {
    const host = document.createElement('section');
    const shadow = host.attachShadow({ mode: 'open' });
    const token = document.createElement('textarea');
    token.name = 'h-captcha-response';
    shadow.appendChild(token);
    document.body.appendChild(host);
    expect(inspectGatedAttendedStage(ICIMS_LOGIN)?.stage).toBe('captcha');
    token.remove();
    const code = document.createElement('input');
    code.autocomplete = 'one-time-code';
    shadow.appendChild(code);
    expect(inspectGatedAttendedStage(ICIMS_LOGIN)?.stage).toBe('security_code');
    expect(code.value).toBe('');
  });

  it('observes but never reads or enters a security code, and ignores synthetic submit', () => {
    document.body.innerHTML = '<form><label>Security code<input id="code" autocomplete="one-time-code"></label></form>';
    const code = document.querySelector<HTMLInputElement>('#code')!;
    const proved = vi.fn();
    expect(guardTrustedSecurityCodeIntent({ onTrustedSubmit: proved })).toBe(true);
    code.value = '123456';
    document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));
    expect(proved).not.toHaveBeenCalled();
    expect(code.value).toBe('123456');
  });

  it('prefers a real application form over stale gate controls and final-form CAPTCHA', () => {
    document.body.innerHTML = `
      <div hidden><select id="jv-country-select"></select></div>
      <label>Resume<input type="file" name="resume"></label>
      <label>Email<input type="email" name="email"></label>
      <textarea name="h-captcha-response"></textarea>`;
    expect(inspectGatedAttendedStage(JOBVITE)?.stage).toBe('application');
  });

  it('does not treat a hidden pre-rendered application as gate completion', () => {
    document.body.innerHTML = `
      <section hidden>
        <label>Resume<input type="file" name="resume"></label>
        <label>Email<input type="email" name="email"></label>
      </section>`;
    expect(inspectGatedAttendedStage(ICIMS_LOGIN)?.stage).toBe('other');
  });
});

describe('gated frozen-answer replay policy', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const question = (id: string, label: string, selector: string, answer = 'Yes'): HandoffQuestion => ({
    id,
    question: label,
    answer,
    kind: 'required',
    required: true,
    portal_selector: selector,
    portal_input_type: selector.includes('select') ? 'select-one' : selector.includes('textarea') ? 'textarea' : 'checkbox',
  });

  it('replays an ordinary exact reviewed answer', () => {
    document.body.innerHTML = '<label for="ordinary">Available weekends</label><input id="ordinary" type="checkbox">';
    const safe = question('ordinary', 'Available weekends', '#ordinary');
    expect(replayReviewedAnswers(document, [safe], { allowControl: gatedReviewedAnswerControlAllowed }))
      .toEqual({ applied: ['ordinary'], failed: [] });
    expect(reviewedAnswersMatch(document, [safe], { allowControl: gatedReviewedAnswerControlAllowed }).failed).toEqual([]);
  });

  it.each([
    ['privacy consent', 'I agree to the privacy policy'],
    ['legal attestation', 'I certify this legal attestation'],
    ['work authorization', 'I am legally authorized to work'],
    ['CAPTCHA', 'Complete the human check CAPTCHA'],
    ['account', 'Create an account and sign in'],
    ['security code', 'Enter the verification code'],
  ])('never replays %s controls', (id, label) => {
    document.body.innerHTML = `<label for="blocked">${label}</label><input id="blocked" type="checkbox">`;
    const blocked = question(id, label, '#blocked');
    const result = replayReviewedAnswers(document, [blocked], { allowControl: gatedReviewedAnswerControlAllowed });
    expect(result).toEqual({ applied: [], failed: [], denied: [id] });
    expect(document.querySelector<HTMLInputElement>('#blocked')?.checked).toBe(false);
  });

  it('never replays a hidden ordinary control', () => {
    document.body.innerHTML = '<div hidden><label for="hidden">Available weekends</label><input id="hidden" type="checkbox"></div>';
    const hidden = question('hidden', 'Available weekends', '#hidden');
    expect(replayReviewedAnswers(document, [hidden], { allowControl: gatedReviewedAnswerControlAllowed }).denied).toEqual(['hidden']);
    expect(document.querySelector<HTMLInputElement>('#hidden')?.checked).toBe(false);
  });

  it('never writes a clipped anti-bot field even when its frozen selector is exact', () => {
    document.body.innerHTML = '<label for="trap">Available weekends</label><input id="trap" style="position:absolute;left:-10000px;width:1px;height:1px">';
    const trap = { ...question('trap', 'Available weekends', '#trap', 'weekends'), portal_input_type: 'text' };
    expect(replayReviewedAnswers(document, [trap], { allowControl: gatedReviewedAnswerControlAllowed }).denied).toEqual(['trap']);
    expect(document.querySelector<HTMLInputElement>('#trap')?.value).toBe('');
  });
});

describe('employer receipt binding', () => {
  it('accepts only strong employer text on a terminal route for the same exact job', () => {
    expect(exactGatedAttendedReceipt({
      family: 'jobvite',
      startedUrl: JOBVITE,
      finalUrl: `${JOBVITE}/confirmation`,
      employerText: 'Thank you for applying. Your application has been received.',
    })).toEqual({
      finalUrl: `${JOBVITE}/confirmation`,
      confirmationText: 'Thank you for applying. Your application has been received.',
    });
    expect(exactGatedAttendedReceipt({
      family: 'icims',
      startedUrl: ICIMS_LOGIN,
      finalUrl: `${ICIMS_LOGIN}/thank-you`,
      employerText: 'Your application was successfully submitted.',
    })).not.toBeNull();
  });

  it.each([
    [JOBVITE, JOBVITE, 'Thank you for applying'],
    [JOBVITE, 'https://jobs.jobvite.com/worldfirst/job/other/apply/confirmation', 'Thank you for applying'],
    [ICIMS_LOGIN, 'https://other.icims.com/jobs/48173/sales-associate/login/confirmation', 'Thank you for applying'],
    [ICIMS_LOGIN, `${ICIMS_LOGIN}/confirmation`, 'Sign in to start your application'],
  ])('rejects non-terminal, cross-job, cross-tenant, and gate text', (startedUrl, finalUrl, employerText) => {
    expect(exactGatedAttendedReceipt({ family: startedUrl.includes('jobvite') ? 'jobvite' : 'icims', startedUrl, finalUrl, employerText })).toBeNull();
  });
});
