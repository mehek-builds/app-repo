import type { HandoffQuestion } from './handoff-packet';

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

type ReplayRoot = Document | ShadowRoot;

function searchableRoots(root: Document): ReplayRoot[] {
  const roots: ReplayRoot[] = [root];
  for (let index = 0; index < roots.length; index += 1) {
    for (const element of roots[index].querySelectorAll<HTMLElement>('*')) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
    }
  }
  return roots;
}

function queryAcrossRoots(root: Document, selector: string): Element[] {
  const matches: Element[] = [];
  for (const searchable of searchableRoots(root)) {
    try {
      matches.push(...searchable.querySelectorAll(selector));
    } catch {
      return [];
    }
  }
  return matches;
}

function questionTextFor(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string[] {
  const texts = new Set<string>();
  const add = (value: string | null | undefined) => {
    const text = normalized(value ?? '');
    if (text) texts.add(text);
  };
  add(control.getAttribute('aria-label'));
  add(control.getAttribute('data-question'));
  for (const label of [...(control.labels ?? [])]) add(label.textContent);
  const fieldset = control.closest('fieldset');
  add(fieldset?.querySelector(':scope > legend')?.textContent);
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) add(control.ownerDocument.getElementById(id)?.textContent);
  }
  return [...texts];
}

function semanticControls(root: Document, question: HandoffQuestion): Element[] {
  const key = normalized(question.question);
  if (!key) return [];
  return queryAcrossRoots(root, 'input, textarea, select').filter((candidate) =>
    candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement || candidate instanceof HTMLSelectElement
      ? questionTextFor(candidate).includes(key)
      : false,
  );
}

function controlType(control: Element): string | null {
  if (control instanceof HTMLInputElement) return control.type;
  if (control instanceof HTMLTextAreaElement) return 'textarea';
  if (control instanceof HTMLSelectElement) return control.multiple ? 'select-multiple' : 'select-one';
  return null;
}

function controlMatchesFrozenIdentity(control: Element, question: HandoffQuestion): boolean {
  const expectedType = question.portal_input_type?.trim().toLowerCase();
  if (expectedType && controlType(control) !== expectedType) return false;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return false;
  const visibleQuestionTexts = questionTextFor(control);
  return visibleQuestionTexts.length === 0 || visibleQuestionTexts.includes(normalized(question.question));
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
  return normalized(`${input.value} ${input.getAttribute('aria-label') ?? ''} ${[...(input.labels ?? [])].map((label) => label.textContent ?? '').join(' ')}`);
}

function controlsForQuestion(root: Document, question: HandoffQuestion): Element[] {
  const selector = question.portal_selector?.trim();
  if (selector && selector.length <= 500) {
    const selected = queryAcrossRoots(root, selector);
    if (selected.length === 1) return controlMatchesFrozenIdentity(selected[0], question) ? selected : [];
    if (selected.length > 1) return [];
  }
  const semantic = semanticControls(root, question);
  if (semantic.length === 1) return semantic;
  if (semantic.length > 1 && semantic.every((item) => item instanceof HTMLInputElement && item.type === 'radio')) {
    const names = new Set(semantic.map((item) => (item as HTMLInputElement).name));
    if (names.size === 1) return [semantic[0]];
  }
  return [];
}

function replayOne(root: Document, question: HandoffQuestion): boolean {
  if (!question.answer.trim()) return false;
  const [control] = controlsForQuestion(root, question);
  if (!control) return false;
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
      ? queryAcrossRoots(root, 'input[type="radio"]').filter((item): item is HTMLInputElement =>
        item instanceof HTMLInputElement && item.name === control.name)
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

export type ReviewedAnswerReplayOptions = {
  allowControl?: (control: Element, question: HandoffQuestion) => boolean;
};

function answerMatches(root: Document, question: HandoffQuestion): boolean {
  if (!question.answer.trim()) return false;
  const [control] = controlsForQuestion(root, question);
  if (control instanceof HTMLTextAreaElement) return control.value === question.answer;
  if (control instanceof HTMLSelectElement) {
    const selected = control.selectedOptions[0];
    return Boolean(selected && normalized(`${selected.value} ${selected.textContent ?? ''}`) === normalized(question.answer));
  }
  if (!(control instanceof HTMLInputElement)) return false;
  if (control.type === 'radio') {
    const candidates = control.name
      ? queryAcrossRoots(root, 'input[type="radio"]').filter((item): item is HTMLInputElement =>
        item instanceof HTMLInputElement && item.name === control.name)
      : [control];
    const selected = candidates.find((item) => item.checked);
    const answer = normalized(question.answer);
    return Boolean(selected && (optionText(selected) === answer || optionText(selected).split(' ').includes(answer)));
  }
  if (control.type === 'checkbox') {
    const answer = normalized(question.answer);
    return ['yes', 'true', 'no', 'false'].includes(answer)
      && control.checked === (answer === 'yes' || answer === 'true');
  }
  return control.value === question.answer;
}

export function replayReviewedAnswers(
  root: Document,
  questions: readonly HandoffQuestion[],
  options: ReviewedAnswerReplayOptions = {},
): { applied: string[]; failed: string[]; denied?: string[] } {
  const applied: string[] = [];
  const failed: string[] = [];
  const denied: string[] = [];
  for (const question of questions) {
    const [control] = controlsForQuestion(root, question);
    if (control && options.allowControl && !options.allowControl(control, question)) {
      denied.push(question.id);
      continue;
    }
    (replayOne(root, question) ? applied : failed).push(question.id);
  }
  return { applied, failed, ...(denied.length > 0 ? { denied } : {}) };
}

export function reviewedAnswersMatch(
  root: Document,
  questions: readonly HandoffQuestion[],
  options: ReviewedAnswerReplayOptions = {},
): { matched: string[]; failed: string[]; denied?: string[] } {
  const matched: string[] = [];
  const failed: string[] = [];
  const denied: string[] = [];
  for (const question of questions) {
    const [control] = controlsForQuestion(root, question);
    if (control && options.allowControl && !options.allowControl(control, question)) {
      denied.push(question.id);
      continue;
    }
    (answerMatches(root, question) ? matched : failed).push(question.id);
  }
  return { matched, failed, ...(denied.length > 0 ? { denied } : {}) };
}
