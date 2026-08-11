import { fillField, isHoneypotField } from './adapters/shared/dom';
import type { HandoffQuestion } from './handoff-packet';

export type GatedAttendedFamily = 'jobvite' | 'icims';
export type GatedAttendedStage =
  | 'privacy_consent'
  | 'account_login'
  | 'security_code'
  | 'captcha'
  | 'application'
  | 'other';

export function gatedStageCanPrepare(stage: GatedAttendedStage): boolean {
  return stage === 'privacy_consent'
    || stage === 'account_login'
    || stage === 'security_code'
    || stage === 'captcha';
}

export function validGatedAccountNavigationProof(input: {
  family: GatedAttendedFamily;
  loginProofAt?: number;
  loginProofDocumentId?: string;
  securityProofAt?: number;
  securityProofDocumentId?: string;
  currentDocumentId?: string;
  now: number;
  ttlMs: number;
}): boolean {
  if (input.family !== 'icims') return true;
  const loginAge = typeof input.loginProofAt === 'number' ? input.now - input.loginProofAt : Number.NaN;
  if (!(typeof input.loginProofAt === 'number'
    && loginAge >= 0
    && loginAge <= input.ttlMs
    && input.loginProofDocumentId
    && input.currentDocumentId)) return false;
  if (input.securityProofAt === undefined) return input.loginProofDocumentId !== input.currentDocumentId;
  const securityAge = input.now - input.securityProofAt;
  return securityAge >= 0
    && securityAge <= input.ttlMs
    && input.securityProofAt >= input.loginProofAt
    && Boolean(input.securityProofDocumentId)
    && input.loginProofDocumentId !== input.securityProofDocumentId
    && input.loginProofDocumentId !== input.currentDocumentId
    && input.securityProofDocumentId !== input.currentDocumentId;
}

export function newArmingSupersedesContinuation(existingApplicationId: string, armedApplicationId?: string): boolean {
  void existingApplicationId;
  return Boolean(armedApplicationId);
}

export function gatedAttendedIdentity(raw: string): { family: GatedAttendedFamily; key: string } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');
    if (host === 'jobs.jobvite.com') {
      const match = /^\/([a-z0-9._-]+)\/job\/([a-z0-9]+)(?:\/apply)?(?:\/(?:confirmation|thank-you|submitted|application-submitted))?$/i.exec(path);
      return match ? { family: 'jobvite', key: `${url.origin}/${match[1]}/job/${match[2]}` } : null;
    }
    if (/^(?!(?:www|community|login|api)\.)[a-z0-9-]+\.icims\.com$/i.test(host)) {
      const match = /^\/jobs\/(\d+)\/([a-z0-9%._~-]+)\/(?:job|login)(?:\/(?:confirmation|thank-you|submitted|application-submitted))?$/i.exec(path);
      return match ? { family: 'icims', key: `${url.origin}/jobs/${match[1]}` } : null;
    }
    return null;
  } catch {
    return null;
  }
}

function visible(control: HTMLElement): boolean {
  for (let current: HTMLElement | null = control; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function controlText(control: Element): string {
  const input = control as HTMLInputElement;
  const labels = Array.from(input.labels ?? []).map((label) => label.textContent ?? '').join(' ');
  return [
    control.id,
    control.getAttribute('name') ?? '',
    control.getAttribute('aria-label') ?? '',
    control.getAttribute('placeholder') ?? '',
    labels,
    control.closest('fieldset, [role="group"]')?.textContent ?? '',
  ].join(' ').replace(/\s+/g, ' ').trim();
}

function rootsAcrossOpenShadow(root: ParentNode): ParentNode[] {
  const roots: ParentNode[] = [root];
  for (let index = 0; index < roots.length; index += 1) {
    for (const element of roots[index].querySelectorAll('*')) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
    }
  }
  return roots;
}

function queryAcrossRoots<T extends Element>(root: ParentNode, selector: string): T[] {
  return rootsAcrossOpenShadow(root).flatMap((candidate) => [...candidate.querySelectorAll<T>(selector)]);
}

function hasSemanticResumeInput(root: ParentNode): boolean {
  return queryAcrossRoots<HTMLInputElement>(root, 'input[type="file"]').some((input) => {
    if (input.disabled || !visible(input) || isHoneypotField(input)) return false;
    const context = `${controlText(input)} ${input.closest('label, fieldset, section, div')?.textContent ?? ''}`;
    return /\b(?:resume|résumé|cv|curriculum vitae)\b/i.test(context) && !/cover\s*letter|portfolio/i.test(context);
  });
}

function hasApplicantIdentityInput(root: ParentNode): boolean {
  return queryAcrossRoots<HTMLInputElement>(root, 'input').some((input) => {
    if (input.disabled || input.readOnly || !visible(input) || isHoneypotField(input)) return false;
    const context = controlText(input);
    return input.type === 'email' || /\b(?:e-?mail|first\s*name|last\s*name|full\s*name)\b/i.test(context);
  });
}

export function inspectGatedAttendedStage(
  rawUrl: string,
  root: ParentNode = document,
): { family: GatedAttendedFamily; identity: string; stage: GatedAttendedStage } | null {
  const identity = gatedAttendedIdentity(rawUrl);
  if (!identity) return null;

  if (identity.family === 'jobvite' && queryAcrossRoots<HTMLElement>(root, 'select#jv-country-select').some(visible)) {
    return { family: identity.family, identity: identity.key, stage: 'privacy_consent' };
  }

  const securityCode = queryAcrossRoots<HTMLInputElement>(root, 'input').find((input) =>
    visible(input)
    && (input.autocomplete === 'one-time-code'
      || /\b(?:security|verification|one[- ]?time|access)\s*(?:code|pin)\b/i.test(controlText(input))),
  );
  if (securityCode) return { family: identity.family, identity: identity.key, stage: 'security_code' };

  if (hasSemanticResumeInput(root) && hasApplicantIdentityInput(root)) {
    return { family: identity.family, identity: identity.key, stage: 'application' };
  }

  const captcha = queryAcrossRoots<HTMLElement>(root,
    'textarea[name="h-captcha-response"], textarea[name="g-recaptcha-response"], .h-captcha, .g-recaptcha, iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"]',
  ).find(visible);
  const icimsLogin = identity.family === 'icims'
    ? queryAcrossRoots<HTMLInputElement>(root, 'input#email[name="css_loginName"]')[0]
    : null;
  if (icimsLogin && visible(icimsLogin)) {
    return { family: identity.family, identity: identity.key, stage: captcha ? 'captcha' : 'account_login' };
  }

  if (captcha) return { family: identity.family, identity: identity.key, stage: 'captcha' };
  return { family: identity.family, identity: identity.key, stage: 'other' };
}

export function frozenIcimsLoginEmailState(
  email: string,
  root: ParentNode = document,
): 'missing' | 'empty' | 'match' | 'mismatch' | 'ambiguous' {
  const candidates = queryAcrossRoots<HTMLInputElement>(root, 'input#email[name="css_loginName"]')
    .filter((input) => !input.disabled && !input.readOnly && visible(input) && !isHoneypotField(input));
  if (candidates.length === 0) return 'missing';
  if (candidates.length !== 1) return 'ambiguous';
  const [input] = candidates;
  if (!input.value.trim()) return 'empty';
  return input.value.trim().toLowerCase() === email.trim().toLowerCase() ? 'match' : 'mismatch';
}

export async function fillFrozenIcimsLoginEmail(email: string, root: ParentNode = document): Promise<boolean> {
  const input = queryAcrossRoots<HTMLInputElement>(root, 'input#email[name="css_loginName"]')
    .find((candidate) => !candidate.disabled && !candidate.readOnly && visible(candidate) && !isHoneypotField(candidate));
  if (frozenIcimsLoginEmailState(email, root) !== 'empty' || !input) return false;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return false;
  return fillField(input, email.trim().toLowerCase());
}

export function guardFrozenIcimsLoginIntent(input: {
  email: string;
  onInvalid: () => void;
  onTrustedSubmit: () => void;
  root?: ParentNode;
}): boolean {
  const root = input.root ?? document;
  const candidates = queryAcrossRoots<HTMLInputElement>(root, 'input#email[name="css_loginName"]')
    .filter((candidate) => !candidate.disabled && !candidate.readOnly && visible(candidate) && !isHoneypotField(candidate));
  if (candidates.length !== 1 || frozenIcimsLoginEmailState(input.email, root) !== 'match') return false;
  const emailControl = candidates[0];
  const form = emailControl.form;
  if (!form) return false;
  let invalidated = false;
  const invalidate = () => {
    if (invalidated) return;
    invalidated = true;
    input.onInvalid();
  };
  emailControl.addEventListener('input', () => {
    if (frozenIcimsLoginEmailState(input.email, root) !== 'match') invalidate();
  });
  form.addEventListener('submit', (event) => {
    if (!event.isTrusted || invalidated || frozenIcimsLoginEmailState(input.email, root) !== 'match') {
      if (frozenIcimsLoginEmailState(input.email, root) !== 'match') invalidate();
      return;
    }
    input.onTrustedSubmit();
  }, true);
  return true;
}

export function guardTrustedSecurityCodeIntent(input: {
  onTrustedSubmit: () => void;
  root?: ParentNode;
}): boolean {
  const root = input.root ?? document;
  const candidates = queryAcrossRoots<HTMLInputElement>(root, 'input').filter((control) =>
    !control.disabled
    && !control.readOnly
    && visible(control)
    && !isHoneypotField(control)
    && (control.autocomplete === 'one-time-code'
      || /\b(?:security|verification|one[- ]?time|access)\s*(?:code|pin)\b/i.test(controlText(control))),
  );
  if (candidates.length !== 1 || !candidates[0].form) return false;
  candidates[0].form!.addEventListener('submit', (event) => {
    if (event.isTrusted) input.onTrustedSubmit();
  }, true);
  return true;
}

const STRONG_EMPLOYER_RECEIPT =
  /\bthank you for applying\b|\b(?:your|the) application (?:has been |was )?(?:successfully )?(?:submitted|received)\b|\bwe(?:'|’)ve received your application\b/i;
const NON_TERMINAL_STATE =
  /\b(?:data consent|privacy acknowledgement|create (?:an )?account|sign in|log in|protected by hcaptcha|security code|verification code|apply for this job|start (?:your )?application)\b/i;

export function exactGatedAttendedReceipt(input: {
  family: string;
  startedUrl: string;
  finalUrl: string;
  employerText: string;
}): { finalUrl: string; confirmationText: string } | null {
  if (input.family !== 'jobvite' && input.family !== 'icims') return null;
  const started = gatedAttendedIdentity(input.startedUrl);
  const final = gatedAttendedIdentity(input.finalUrl);
  if (!started || !final || started.family !== input.family || final.family !== input.family || started.key !== final.key) return null;
  let finalPath = '';
  try {
    finalPath = new URL(input.finalUrl).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
  if (!/(?:confirmation|thank-you|submitted|application-submitted)$/i.test(finalPath)) return null;
  const confirmationText = input.employerText.replace(/\s+/g, ' ').trim();
  if (!confirmationText || NON_TERMINAL_STATE.test(confirmationText) || !STRONG_EMPLOYER_RECEIPT.test(confirmationText)) return null;
  return { finalUrl: input.finalUrl, confirmationText: confirmationText.slice(0, 2000) };
}

export function gatedStageNotice(stage: GatedAttendedStage): string {
  if (stage === 'privacy_consent') return 'Review and choose the company privacy option yourself. Litos will continue with this exact saved application after the form opens.';
  if (stage === 'captcha') return 'Complete the human check yourself. Litos will continue with this exact saved application after the application form opens.';
  if (stage === 'account_login') return 'Sign in or make the applicant account yourself. Litos can place the saved application email in the email box, but it will not enter a password or press the account button.';
  if (stage === 'security_code') return 'Enter the company security code yourself. Litos will continue only after the exact application form opens.';
  return 'Finish this company step yourself. Litos will continue only when the exact application form opens.';
}

const HUMAN_OWNED_REPLAY = /\b(?:privacy|consent|agree|agreement|acknowledg\w*|attest\w*|certif\w*|authorize|authorization|eligible|legally|work\s*auth|sponsor|captcha|human\s*check|security\s*code|verification\s*code|one[- ]?time|password|sign\s*in|log\s*in|create\s*(?:an\s*)?account)\b/i;

export function gatedReviewedAnswerControlAllowed(control: Element, question: HandoffQuestion): boolean {
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return false;
  if (control.disabled
    || ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && control.readOnly)
    || !visible(control)
    || isHoneypotField(control)) return false;
  const context = [
    question.question,
    question.portal_selector ?? '',
    controlText(control),
    control.closest('fieldset, [role="group"], [role="radiogroup"], form')?.textContent ?? '',
  ].join(' ');
  return !HUMAN_OWNED_REPLAY.test(context);
}

const THIRD_PARTY_EMAIL = /\b(?:manager|reference|referrer|recommender|supervisor|emergency|previous\s+employer|other\s+person)\b/i;

export function applicantOwnedEmailInputs(root: Document): HTMLInputElement[] {
  const roots: Array<Document | ShadowRoot> = [root];
  const candidates: HTMLInputElement[] = [];
  for (let index = 0; index < roots.length; index += 1) {
    for (const element of roots[index].querySelectorAll<HTMLElement>('*')) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
    }
    for (const input of roots[index].querySelectorAll<HTMLInputElement>('input')) {
      const context = `${input.type} ${controlText(input)} ${input.closest('fieldset, form')?.getAttribute('aria-label') ?? ''}`;
      if (input.disabled || input.readOnly || input.hidden || !visible(input) || isHoneypotField(input)) continue;
      if (!/\bemail\b/i.test(context) || THIRD_PARTY_EMAIL.test(context)) continue;
      candidates.push(input);
    }
  }
  return candidates;
}
