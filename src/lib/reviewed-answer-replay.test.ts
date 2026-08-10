// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandoffQuestion } from './handoff-packet';
import { frozenAnswerForQuestion, replayReviewedAnswers } from './reviewed-answer-replay';

const questions: HandoffQuestion[] = [
  { id: 'essay', question: 'Why this role?', answer: 'Exact reviewed answer', kind: 'essay', required: true, portal_selector: '#essay' },
  { id: 'choice', question: 'Work authorization', answer: 'Yes', kind: 'required', required: true, portal_selector: '#auth-yes', portal_input_type: 'radio' },
];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('reviewed answer replay', () => {
  it('returns the exact frozen essay instead of asking for a new draft', () => {
    expect(frozenAnswerForQuestion(questions, 'Why this role?')).toBe('Exact reviewed answer');
    expect(frozenAnswerForQuestion(questions, 'A new employer question')).toBeNull();
  });

  it('writes exact frozen text and choice answers through their stored selectors', () => {
    document.body.innerHTML = `
      <textarea id="essay"></textarea>
      <label for="auth-yes">Yes</label><input id="auth-yes" name="auth" type="radio" value="yes">
      <label for="auth-no">No</label><input id="auth-no" name="auth" type="radio" value="no">
    `;
    const result = replayReviewedAnswers(document, questions);
    expect(result).toEqual({ applied: ['essay', 'choice'], failed: [] });
    expect((document.querySelector('#essay') as HTMLTextAreaElement).value).toBe('Exact reviewed answer');
    expect((document.querySelector('#auth-yes') as HTMLInputElement).checked).toBe(true);
  });

  it('never touches unsafe controls or a selector absent from the authoritative form', () => {
    document.body.innerHTML = '<input id="password" type="password"><textarea id="unrelated"></textarea>';
    const input = document.querySelector('#unrelated') as HTMLTextAreaElement;
    const listener = vi.fn();
    input.addEventListener('input', listener);
    const result = replayReviewedAnswers(document, [
      { ...questions[0], id: 'missing', portal_selector: '#other-company-field' },
      { ...questions[0], id: 'unsafe', portal_selector: '#password' },
    ]);
    expect(result).toEqual({ applied: [], failed: ['missing', 'unsafe'] });
    expect(input.value).toBe('');
    expect(listener).not.toHaveBeenCalled();
  });
});
