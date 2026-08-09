import { detectChallenge } from './captcha-detection';

export type WorkdayAccountGate =
  | { kind: 'clear' }
  | { kind: 'captcha'; reason: string }
  | { kind: 'legal_consent'; reason: string }
  | { kind: 'attestation'; reason: string };

const LEGAL_COPY = /terms(?:\s+and\s+conditions)?|privacy(?:\s+(?:notice|policy))?|data\s+(?:processing|storage)|consent/i;
const ATTESTATION_COPY = /i\s+(?:certify|attest|declare|confirm)|information\s+(?:is|provided\s+is)\s+(?:true|accurate|complete)|electronic\s+signature|under\s+penalty/i;

function labelFor(control: HTMLInputElement): string {
  const idLabel = control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent : '';
  return [
    control.getAttribute('aria-label'),
    control.getAttribute('name'),
    control.id,
    control.value,
    control.getAttribute('data-automation-id'),
    idLabel,
    control.closest('label')?.textContent,
    control.closest('fieldset, [data-automation-id$="Section"], div')?.textContent,
  ].filter((value) => value?.trim()).join(' ').replace(/\s+/g, ' ').trim();
}

function visible(element: Element): boolean {
  const html = element as HTMLElement;
  const style = getComputedStyle(html);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (html.closest('[hidden], [aria-hidden="true"]')) return false;
  return true;
}

export function inspectWorkdayAccountGate(root: ParentNode = document): WorkdayAccountGate {
  if (detectChallenge(root).waiting) {
    return { kind: 'captcha', reason: 'Workday is asking you to prove you are human. Complete that check yourself.' };
  }

  const choices = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]')]
    .filter((control) => !control.disabled);
  for (const choice of choices) {
    const label = labelFor(choice);
    if (ATTESTATION_COPY.test(label)) {
      return { kind: 'attestation', reason: 'Workday is asking you to attest that information is true. That confirmation is yours.' };
    }
    if (LEGAL_COPY.test(label) || choice.getAttribute('data-automation-id') === 'createAccountCheckbox') {
      return { kind: 'legal_consent', reason: 'Workday is asking you to accept legal or privacy terms. That choice is yours.' };
    }
  }
  return { kind: 'clear' };
}

export function workdayAccountReceiptProof(expectedEmail: string, root: ParentNode = document): boolean {
  const create = root.querySelector('[data-automation-id="createAccountSubmitButton"], input[data-automation-id="verifyPassword"]');
  if (create) return false;
  const authenticatedMarker = root.querySelector(
    '[data-automation-id="candidateHomeButton"], [data-automation-id="accountSettingsButton"], [data-automation-id="utilityButtonSignOut"]',
  );
  if (!authenticatedMarker) return false;
  const normalizedEmail = expectedEmail.trim().toLowerCase();
  if (!normalizedEmail) return false;
  const inputMatches = [...root.querySelectorAll<HTMLInputElement>('input[type="email"], input[data-automation-id*="email" i]')]
    .some((input) => input.value.trim().toLowerCase() === normalizedEmail);
  const pageCopy = (root instanceof Document ? root.body?.textContent : root.textContent)?.toLowerCase() ?? '';
  return inputMatches || pageCopy.includes(normalizedEmail);
}

export function workdayVerificationStage(root: ParentNode = document): boolean {
  return Boolean(root.querySelector(
    'input[autocomplete="one-time-code"], input[name*="verification" i], input[id*="verification" i], input[name*="otp" i], input[id*="otp" i]',
  ));
}

export function fillWorkdayVerificationCode(code: string, root: ParentNode = document): boolean {
  const clean = code.replace(/[\s-]/g, '');
  if (!/^[A-Za-z0-9]{4,12}$/.test(clean)) return false;
  const fields = [...root.querySelectorAll<HTMLInputElement>(
    'input[autocomplete="one-time-code"], input[name*="verification" i], input[id*="verification" i], input[name*="otp" i], input[id*="otp" i]',
  )].filter((field) => !field.disabled);
  if (fields.length === 0) return false;
  const split = fields.length >= clean.length && fields.slice(0, clean.length).every((field) => field.maxLength === 1);
  const write = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (split) clean.split('').forEach((character, index) => write(fields[index], character));
  else write(fields[0], clean);
  return true;
}

export function findWorkdayVerificationContinue(root: ParentNode = document): HTMLButtonElement | null {
  const codeField = root.querySelector<HTMLInputElement>(
    'input[autocomplete="one-time-code"], input[name*="verification" i], input[id*="verification" i], input[name*="otp" i], input[id*="otp" i]',
  );
  if (!codeField) return null;
  const scope = codeField.closest('form, [role="dialog"], [data-automation-id*="verification" i], section') ?? codeField.parentElement;
  if (!scope) return null;
  const candidates = [...scope.querySelectorAll<HTMLButtonElement>('button')];
  return candidates.find((button) =>
    !button.disabled && /^(?:verify|verify code|confirm|confirm code|continue|next)$/i.test(button.textContent?.trim() ?? ''),
  ) ?? null;
}

export type WorkdayAccountAction = 'create' | 'sign_in';

export function isTrustedWorkdayAccountIntent(event: Event): boolean {
  return event instanceof MouseEvent && event.isTrusted;
}

export function findWorkdayAccountSubmit(
  action: WorkdayAccountAction,
  root: ParentNode = document,
): HTMLButtonElement | HTMLInputElement | null {
  const automationId = action === 'create' ? 'createAccountSubmitButton' : 'signInSubmitButton';
  const expectedCopy = action === 'create' ? /^create account$/i : /^sign in$/i;
  const control = root.querySelector<HTMLButtonElement | HTMLInputElement>(
    `button[data-automation-id="${automationId}"], input[data-automation-id="${automationId}"]`,
  );
  if (!control || control.disabled || !visible(control)) return null;
  const copy = control instanceof HTMLInputElement ? control.value : control.textContent?.trim() ?? '';
  return expectedCopy.test(copy) ? control : null;
}

export type WorkdayAccountActionResult =
  | { started: true }
  | { started: false; reason: 'claim_denied' | 'gate' | 'control_changed' | 'click_failed'; gate?: WorkdayAccountGate };

export async function runBoundedWorkdayAccountAction(input: {
  action: WorkdayAccountAction;
  control: HTMLButtonElement | HTMLInputElement;
  claim?: () => Promise<boolean>;
  revalidateClaim?: () => Promise<boolean>;
  abandon?: () => Promise<unknown>;
  inspectGate?: () => WorkdayAccountGate;
  resolveControl?: () => HTMLButtonElement | HTMLInputElement | null;
}): Promise<WorkdayAccountActionResult> {
  let claimAcquired = false;
  let started = false;
  try {
    const initialGate = (input.inspectGate ?? (() => inspectWorkdayAccountGate()))();
    if (initialGate.kind !== 'clear') return { started: false, reason: 'gate', gate: initialGate };
    const initialControl = (input.resolveControl ?? (() => findWorkdayAccountSubmit(input.action)))();
    if (!input.control.isConnected || initialControl !== input.control) {
      return { started: false, reason: 'control_changed' };
    }
    if (input.claim) {
      claimAcquired = await input.claim();
      if (!claimAcquired) return { started: false, reason: 'claim_denied' };
    }
    const gate = (input.inspectGate ?? (() => inspectWorkdayAccountGate()))();
    if (gate.kind !== 'clear') return { started: false, reason: 'gate', gate };
    const liveControl = (input.resolveControl ?? (() => findWorkdayAccountSubmit(input.action)))();
    if (!input.control.isConnected || liveControl !== input.control) {
      return { started: false, reason: 'control_changed' };
    }
    if (input.revalidateClaim && !await input.revalidateClaim()) {
      return { started: false, reason: 'claim_denied' };
    }
    input.control.click();
    started = true;
    return { started: true };
  } catch {
    return { started: false, reason: 'click_failed' };
  } finally {
    if (claimAcquired && !started) await input.abandon?.().catch(() => undefined);
  }
}

export type WorkdayApplicationStep = {
  current: number;
  total: number;
  name: string;
  final: boolean;
};

export function readWorkdayApplicationStep(root: ParentNode = document): WorkdayApplicationStep | null {
  const progress = root.querySelector('[aria-current="step"]')?.textContent
    ?? [...root.querySelectorAll('li, div, span')].map((node) => node.textContent ?? '').find((text) => /current step\s+\d+\s+of\s+\d+/i.test(text));
  const match = progress?.match(/current step\s+(\d+)\s+of\s+(\d+)\s*:?\s*(.*)/i);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  return { current, total, name: match[3].trim(), final: current === total };
}

export function findWorkdayNextButton(root: ParentNode = document): HTMLButtonElement | null {
  const byId = root.querySelector<HTMLButtonElement>('[data-automation-id="bottom-navigation-next-button"]');
  if (byId && !byId.disabled && /^next$/i.test(byId.textContent?.trim() ?? '')) return byId;
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    !button.disabled && /^next$/i.test(button.textContent?.trim() ?? ''),
  ) ?? null;
}

export function findWorkdayFinalSubmitButton(root: ParentNode = document): HTMLElement | null {
  const control = root.querySelector<HTMLElement>('[data-automation-id="bottom-navigation-next-button"]');
  if (!control || (control as HTMLButtonElement).disabled || !visible(control)) return null;
  const label = `${control.textContent ?? ''} ${(control as HTMLInputElement).value ?? ''}`.trim();
  return /^(?:submit|submit application)$/i.test(label) ? control : null;
}

export function workdayProgrammaticFinalSubmitAllowed(
  expectedControl: HTMLElement,
  root: ParentNode = document,
): boolean {
  const step = readWorkdayApplicationStep(root);
  if (!step?.final) return false;
  if (!expectedControl.isConnected || findWorkdayFinalSubmitButton(root) !== expectedControl) return false;
  return inspectWorkdayAccountGate(root).kind === 'clear';
}

export function replayWorkdayFinalSubmitIfAllowed(input: {
  expectedControl: HTMLElement;
  root?: ParentNode;
  tabVisible: boolean;
  tabFocused: boolean;
  requiredFieldsClear: boolean;
}): boolean {
  const root = input.root ?? document;
  if (!input.tabVisible || !input.tabFocused || !input.requiredFieldsClear) return false;
  if (detectChallenge(root).waiting) return false;
  if (!workdayProgrammaticFinalSubmitAllowed(input.expectedControl, root)) return false;
  try {
    input.expectedControl.click();
    return true;
  } catch {
    return false;
  }
}

export function workdayApplicationCanAdvance(input: {
  step: WorkdayApplicationStep | null;
  nextButton: HTMLButtonElement | null;
  needsReview: boolean;
  hasEmptyRequiredFields: boolean;
  challengeWaiting: boolean;
  accountGate: WorkdayAccountGate;
  tabVisible: boolean;
}): boolean {
  return Boolean(
    input.step &&
    !input.step.final &&
    input.nextButton &&
    !input.needsReview &&
    !input.hasEmptyRequiredFields &&
    !input.challengeWaiting &&
    input.accountGate.kind === 'clear' &&
    input.tabVisible,
  );
}
