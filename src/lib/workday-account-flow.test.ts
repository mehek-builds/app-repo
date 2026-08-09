// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillWorkdayVerificationCode, findWorkdayAccountSubmit, findWorkdayFinalSubmitButton, findWorkdayNextButton, findWorkdayVerificationContinue, inspectWorkdayAccountGate, isTrustedWorkdayAccountIntent, readWorkdayApplicationStep, replayWorkdayFinalSubmitIfAllowed, runBoundedWorkdayAccountAction, workdayAccountReceiptProof, workdayApplicationCanAdvance, workdayProgrammaticFinalSubmitAllowed, workdayVerificationStage } from './workday-account-flow';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'src/lib/__fixtures__/workday', `${name}.html`), 'utf8');

describe('Workday account gates from live tenant shapes', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'block', visibility: 'visible' } as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 80 } as DOMRect);
    if (!globalThis.CSS) Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (value: string) => value } });
  });

  it('allows the Broadcom create-account fixture with only account fields and a honeypot', () => {
    document.body.innerHTML = fixture('broadcom-create-account');
    expect(inspectWorkdayAccountGate()).toEqual({ kind: 'clear' });
  });

  it('hands NVIDIA legal and privacy consent to the applicant', () => {
    document.body.innerHTML = fixture('nvidia-create-account');
    expect(inspectWorkdayAccountGate()).toMatchObject({ kind: 'legal_consent' });
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  });

  it('hands CAPTCHA and attestation controls to the applicant', () => {
    document.body.innerHTML = '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><textarea name="g-recaptcha-response"></textarea>';
    expect(inspectWorkdayAccountGate()).toMatchObject({ kind: 'captcha' });
    document.body.innerHTML = '<label><input type="checkbox">I certify the information provided is true and complete</label>';
    expect(inspectWorkdayAccountGate()).toMatchObject({ kind: 'attestation' });
  });

  it('does not block on a solved CAPTCHA token', () => {
    document.body.innerHTML = '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><textarea name="g-recaptcha-response">solved-token</textarea>';
    expect(inspectWorkdayAccountGate()).toEqual({ kind: 'clear' });
  });

  it('hands off hidden and prechecked legal controls using combined control evidence', () => {
    document.body.innerHTML = '<input type="checkbox" checked hidden name="applicantPrivacyConsent" aria-label="I agree">';
    expect(inspectWorkdayAccountGate()).toMatchObject({ kind: 'legal_consent' });
  });

  it('requires positive post-account DOM proof before activating an account claim', () => {
    document.body.innerHTML = '<button data-automation-id="createAccountSubmitButton">Create Account</button>';
    expect(workdayAccountReceiptProof('packet@apply.example.com')).toBe(false);
    document.body.innerHTML = '<button data-automation-id="candidateHomeButton">Candidate Home</button> packet@apply.example.com';
    expect(workdayAccountReceiptProof('packet@apply.example.com')).toBe(true);
    expect(workdayAccountReceiptProof('rotated@apply.example.com')).toBe(false);
  });

  it('selects only exact Workday account actions', () => {
    document.body.innerHTML = fixture('broadcom-create-account');
    expect(findWorkdayAccountSubmit('create')?.textContent).toBe('Create Account');
    expect(findWorkdayAccountSubmit('sign_in')).toBeNull();

    document.body.innerHTML = `
      <button data-automation-id="signInSubmitButton">Sign In</button>
      <button data-automation-id="bottom-navigation-next-button">Next</button>
      <button>Submit Application</button>`;
    expect(findWorkdayAccountSubmit('sign_in')?.textContent).toBe('Sign In');
    expect(findWorkdayAccountSubmit('create')).toBeNull();
  });

  it('rejects a synthetic account-card click before it can authorize work', () => {
    const button = document.createElement('button');
    let authorized = false;
    button.addEventListener('click', (event) => {
      if (!isTrustedWorkdayAccountIntent(event)) return;
      authorized = true;
    });
    button.click();
    expect(authorized).toBe(false);
  });

  it('refuses disabled or misleading account actions', () => {
    document.body.innerHTML = `
      <button data-automation-id="createAccountSubmitButton" disabled>Create Account</button>
      <button data-automation-id="signInSubmitButton">Submit Application</button>`;
    expect(findWorkdayAccountSubmit('create')).toBeNull();
    expect(findWorkdayAccountSubmit('sign_in')).toBeNull();
  });

  it('does not acquire a claim when a handoff gate already blocks the click', async () => {
    document.body.innerHTML = '<button data-automation-id="createAccountSubmitButton">Create Account</button>';
    const control = findWorkdayAccountSubmit('create')!;
    const click = vi.spyOn(control, 'click');
    const claim = vi.fn(async () => true);
    const abandon = vi.fn(async () => true);
    const result = await runBoundedWorkdayAccountAction({
      action: 'create',
      control,
      claim,
      abandon,
      inspectGate: () => ({ kind: 'legal_consent', reason: 'Applicant choice' }),
    });
    expect(result).toMatchObject({ started: false, reason: 'gate' });
    expect(click).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
  });

  it('abandons an acquired claim when the gate or control changes after the claim, or clicking throws', async () => {
    document.body.innerHTML = '<button data-automation-id="createAccountSubmitButton">Create Account</button>';
    const control = findWorkdayAccountSubmit('create')!;
    let gateReads = 0;
    const abandonGate = vi.fn(async () => true);
    expect(await runBoundedWorkdayAccountAction({
      action: 'create', control, claim: async () => true, abandon: abandonGate,
      inspectGate: () => ++gateReads === 1 ? { kind: 'clear' } : { kind: 'legal_consent', reason: 'Applicant choice' },
    })).toMatchObject({ started: false, reason: 'gate' });
    expect(abandonGate).toHaveBeenCalledOnce();

    const abandonChanged = vi.fn(async () => true);
    let controlReads = 0;
    expect(await runBoundedWorkdayAccountAction({
      action: 'create', control, claim: async () => true, abandon: abandonChanged,
      resolveControl: () => ++controlReads === 1 ? control : null,
    })).toMatchObject({ started: false, reason: 'control_changed' });
    expect(abandonChanged).toHaveBeenCalledOnce();

    const abandonThrow = vi.fn(async () => true);
    vi.spyOn(control, 'click').mockImplementation(() => { throw new Error('page rejected click'); });
    expect(await runBoundedWorkdayAccountAction({
      action: 'create', control, claim: async () => true, abandon: abandonThrow,
    })).toMatchObject({ started: false, reason: 'click_failed' });
    expect(abandonThrow).toHaveBeenCalledOnce();
  });

  it('abandons without clicking when logout invalidates the claim at the last-moment recheck', async () => {
    document.body.innerHTML = '<button data-automation-id="createAccountSubmitButton">Create Account</button>';
    const control = findWorkdayAccountSubmit('create')!;
    const click = vi.spyOn(control, 'click');
    const abandon = vi.fn(async () => true);
    const result = await runBoundedWorkdayAccountAction({
      action: 'create', control, claim: async () => true, revalidateClaim: async () => false, abandon,
    });
    expect(result).toMatchObject({ started: false, reason: 'claim_denied' });
    expect(click).not.toHaveBeenCalled();
    expect(abandon).toHaveBeenCalledOnce();
  });

  it('recognizes single and split verification-code controls', () => {
    document.body.innerHTML = '<input autocomplete="one-time-code">';
    expect(workdayVerificationStage()).toBe(true);
    document.body.innerHTML = '<input id="verification-code-1" maxlength="1">';
    expect(workdayVerificationStage()).toBe(true);
  });

  it('fills a code without persisting it and selects only a bounded verification action', () => {
    document.body.innerHTML = `
      <input id="verification-1" maxlength="1"><input id="verification-2" maxlength="1">
      <input id="verification-3" maxlength="1"><input id="verification-4" maxlength="1">
      <button>Verify</button><button>Submit Application</button>`;
    expect(fillWorkdayVerificationCode('A1-B2')).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>('input')].map((field) => field.value).join('')).toBe('A1B2');
    expect(findWorkdayVerificationContinue()?.textContent).toBe('Verify');
  });

  it('rejects malformed codes and never chooses an application submit control', () => {
    document.body.innerHTML = '<input autocomplete="one-time-code"><button>Submit Application</button>';
    expect(fillWorkdayVerificationCode('not a code!')).toBe(false);
    expect(findWorkdayVerificationContinue()).toBeNull();
  });

  it('correlates verification continuation to the code form', () => {
    document.body.innerHTML = `
      <form id="application"><button>Continue</button></form>
      <form id="verification"><input autocomplete="one-time-code"><button>Verify Code</button></form>`;
    expect(findWorkdayVerificationContinue()?.closest('form')?.id).toBe('verification');
  });

  it('reads Workday multi-step progress and selects Next without confusing final submit', () => {
    document.body.innerHTML = fixture('six-step-application');
    expect(readWorkdayApplicationStep()).toEqual({ current: 1, total: 6, name: 'My Information', final: false });
    expect(findWorkdayNextButton()?.textContent).toBe('Next');
    expect(findWorkdayFinalSubmitButton()).toBeNull();
    document.querySelector('[aria-current="step"]')!.textContent = 'current step 6 of 6 Review';
    expect(readWorkdayApplicationStep()).toMatchObject({ current: 6, total: 6, final: true });
    document.querySelector('[data-automation-id="bottom-navigation-next-button"]')?.remove();
    expect(findWorkdayNextButton()).toBeNull();
    document.body.insertAdjacentHTML('beforeend', '<button data-automation-id="bottom-navigation-next-button">Submit</button>');
    expect(findWorkdayFinalSubmitButton()?.textContent).toBe('Submit');
  });

  it('advances a non-final step only when every live safety fact is clear', () => {
    const safe = {
      step: { current: 1, total: 6, name: 'My Information', final: false },
      nextButton: document.createElement('button'),
      needsReview: false,
      hasEmptyRequiredFields: false,
      challengeWaiting: false,
      accountGate: { kind: 'clear' as const },
      tabVisible: true,
    };
    expect(workdayApplicationCanAdvance(safe)).toBe(true);
    expect(workdayApplicationCanAdvance({ ...safe, needsReview: true })).toBe(false);
    expect(workdayApplicationCanAdvance({ ...safe, challengeWaiting: true })).toBe(false);
    expect(workdayApplicationCanAdvance({ ...safe, step: { ...safe.step, current: 6, final: true } })).toBe(false);
    expect(workdayApplicationCanAdvance({
      ...safe,
      accountGate: { kind: 'legal_consent', reason: 'Applicant choice' },
    })).toBe(false);
  });

  it('allows only the exact final Workday control on a parsed final step', () => {
    document.body.innerHTML = `
      <div aria-current="step">current step 6 of 6 Review</div>
      <button id="generic">Submit Application</button>
      <button data-automation-id="bottom-navigation-next-button">Submit</button>`;
    const exact = findWorkdayFinalSubmitButton()!;
    const generic = document.querySelector<HTMLElement>('#generic')!;
    expect(workdayProgrammaticFinalSubmitAllowed(generic)).toBe(false);
    expect(workdayProgrammaticFinalSubmitAllowed(exact)).toBe(true);
  });

  it('denies a final Workday click when hidden or prechecked legal state exists', () => {
    document.body.innerHTML = `
      <div aria-current="step">current step 6 of 6 Review</div>
      <input type="checkbox" checked hidden name="privacyConsent">
      <button data-automation-id="bottom-navigation-next-button">Submit</button>`;
    expect(workdayProgrammaticFinalSubmitAllowed(findWorkdayFinalSubmitButton()!)).toBe(false);
  });

  it('denies trusted replay after control replacement, legal state, non-final step, or CAPTCHA', () => {
    const replay = (control: HTMLElement) => replayWorkdayFinalSubmitIfAllowed({
      expectedControl: control,
      tabVisible: true,
      tabFocused: true,
      requiredFieldsClear: true,
    });

    document.body.innerHTML = '<div aria-current="step">current step 6 of 6 Review</div><button data-automation-id="bottom-navigation-next-button">Submit</button>';
    const replaced = findWorkdayFinalSubmitButton()!;
    replaced.replaceWith(replaced.cloneNode(true));
    expect(replay(replaced)).toBe(false);

    document.body.innerHTML = '<div aria-current="step">current step 6 of 6 Review</div><input type="checkbox" checked hidden name="termsConsent"><button data-automation-id="bottom-navigation-next-button">Submit</button>';
    expect(replay(findWorkdayFinalSubmitButton()!)).toBe(false);

    document.body.innerHTML = '<div aria-current="step">current step 5 of 6 Disclosures</div><button data-automation-id="bottom-navigation-next-button">Submit</button>';
    expect(replay(findWorkdayFinalSubmitButton()!)).toBe(false);

    document.body.innerHTML = '<div aria-current="step">current step 6 of 6 Review</div><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><textarea name="g-recaptcha-response"></textarea><button data-automation-id="bottom-navigation-next-button">Submit</button>';
    expect(replay(findWorkdayFinalSubmitButton()!)).toBe(false);
  });

  it('replays a clean exact Workday final control exactly once', () => {
    document.body.innerHTML = '<div aria-current="step">current step 6 of 6 Review</div><button data-automation-id="bottom-navigation-next-button">Submit</button>';
    const control = findWorkdayFinalSubmitButton()!;
    const click = vi.spyOn(control, 'click');
    expect(replayWorkdayFinalSubmitIfAllowed({
      expectedControl: control,
      tabVisible: true,
      tabFocused: true,
      requiredFieldsClear: true,
    })).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });
});
