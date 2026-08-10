import type { HandoffQuestion } from './handoff-packet';

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function frozenAnswerForQuestion(questions: readonly HandoffQuestion[], question: string): string | null {
  const key = normalized(question);
  if (!key) return null;
  const exact = questions.find((item) => normalized(item.question) === key && item.answer.trim());
  return exact?.answer ?? null;
}

function setTextControl(control: HTMLInputElement | HTMLTextAreaElement, answer: string): void {
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, answer);
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function optionText(input: HTMLInputElement): string {
  const idLabel = input.id
    ? [...document.querySelectorAll<HTMLLabelElement>('label[for]')].find((label) => label.htmlFor === input.id) ?? null
    : null;
  return normalized(`${input.value} ${input.getAttribute('aria-label') ?? ''} ${idLabel?.textContent ?? ''}`);
}

function replayOne(root: Document, question: HandoffQuestion): boolean {
  const selector = question.portal_selector?.trim();
  if (!selector || selector.length > 500 || !question.answer.trim()) return false;
  let control: Element | null;
  try {
    control = root.querySelector(selector);
  } catch {
    return false;
  }
  if (control instanceof HTMLTextAreaElement) {
    setTextControl(control, question.answer);
    return control.value === question.answer;
  }
  if (control instanceof HTMLSelectElement) {
    const answer = normalized(question.answer);
    const option = [...control.options].find((item) => normalized(`${item.value} ${item.textContent ?? ''}`) === answer);
    if (!option) return false;
    control.value = option.value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return control.value === option.value;
  }
  if (!(control instanceof HTMLInputElement)) return false;
  if (['file', 'password', 'submit', 'button', 'reset', 'image', 'hidden'].includes(control.type)) return false;
  if (control.type === 'radio') {
    const candidates = control.name
      ? [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter((item) => item.name === control.name)
      : [control];
    const answer = normalized(question.answer);
    const option = candidates.find((item) => optionText(item) === answer || optionText(item).split(' ').includes(answer));
    if (!option) return false;
    option.click();
    return option.checked;
  }
  if (control.type === 'checkbox') {
    const answer = normalized(question.answer);
    if (!['yes', 'true', 'no', 'false'].includes(answer)) return false;
    const checked = answer === 'yes' || answer === 'true';
    if (control.checked !== checked) control.click();
    return control.checked === checked;
  }
  setTextControl(control, question.answer);
  return control.value === question.answer;
}

export function replayReviewedAnswers(
  root: Document,
  questions: readonly HandoffQuestion[],
): { applied: string[]; failed: string[] } {
  const applied: string[] = [];
  const failed: string[] = [];
  for (const question of questions) {
    (replayOne(root, question) ? applied : failed).push(question.id);
  }
  return { applied, failed };
}
