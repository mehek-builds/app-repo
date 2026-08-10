// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandoffQuestion } from './handoff-packet';
import { frozenAnswerForQuestion, replayReviewedAnswers, reviewedAnswersMatch } from './reviewed-answer-replay';

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
      <fieldset><legend>Work authorization</legend>
        <label for="auth-yes">Yes</label><input id="auth-yes" name="auth" type="radio" value="yes">
        <label for="auth-no">No</label><input id="auth-no" name="auth" type="radio" value="no">
      </fieldset>
    `;
    const result = replayReviewedAnswers(document, questions);
    expect(result).toEqual({ applied: ['essay', 'choice'], failed: [] });
    expect((document.querySelector('#essay') as HTMLTextAreaElement).value).toBe('Exact reviewed answer');
    expect((document.querySelector('#auth-yes') as HTMLInputElement).checked).toBe(true);
    expect(reviewedAnswersMatch(document, questions)).toEqual({ matched: ['essay', 'choice'], failed: [] });
  });

  it('replays a generic other-ATS answer by one exact accessible question when managed selectors are absent', () => {
    document.body.innerHTML = `
      <label for="motivation">Why this role?</label>
      <textarea id="motivation"></textarea>
    `;
    const generic = [{ ...questions[0], portal_selector: '[data-litos-discovered-91]' }];
    expect(replayReviewedAnswers(document, generic)).toEqual({ applied: ['essay'], failed: [] });
    expect((document.querySelector('#motivation') as HTMLTextAreaElement).value).toBe('Exact reviewed answer');
  });

  it('replays an exact SmartRecruiters control inside open shadow DOM', () => {
    const host = document.createElement('spl-input');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.id = 'custom-answer';
    shadow.appendChild(input);
    document.body.appendChild(host);
    const exact = [{ ...questions[0], portal_selector: '#custom-answer' }];
    expect(replayReviewedAnswers(document, exact)).toEqual({ applied: ['essay'], failed: [] });
    expect(input.value).toBe('Exact reviewed answer');
  });

  it('fails closed for optional and required custom answers that cannot be replayed', () => {
    const optional = { ...questions[0], id: 'optional', required: false, portal_selector: '#gone' };
    const required = { ...questions[0], id: 'required', required: true, portal_selector: '#also-gone' };
    expect(replayReviewedAnswers(document, [optional, required])).toEqual({ applied: [], failed: ['optional', 'required'] });
    expect(reviewedAnswersMatch(document, [optional, required])).toEqual({ matched: [], failed: ['optional', 'required'] });
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

  it('refuses a stale selector that now points at a differently labelled or typed question', () => {
    document.body.innerHTML = `
      <label for="stale">Expected salary</label><textarea id="stale"></textarea>
      <label for="wrong-type">Why this role?</label><input id="wrong-type" type="text">
    `;
    const labelledElsewhere = [{ ...questions[0], portal_selector: '#stale' }];
    const changedType = [{ ...questions[0], portal_selector: '#wrong-type', portal_input_type: 'textarea' }];
    expect(replayReviewedAnswers(document, labelledElsewhere).failed).toEqual(['essay']);
    expect(replayReviewedAnswers(document, changedType).failed).toEqual(['essay']);
    expect((document.querySelector('#stale') as HTMLTextAreaElement).value).toBe('');
    expect((document.querySelector('#wrong-type') as HTMLInputElement).value).toBe('');
  });
});
