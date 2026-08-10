import type { GeneratedResume } from './types';

export type HandoffQuestion = {
  id: string;
  question: string;
  answer: string;
  kind: 'essay' | 'required';
  required: boolean;
  portal_selector?: string;
  portal_input_type?: string;
};

/** Preserve the exact reviewed answers frozen into a generated application packet. */
export function reviewedQuestionsForHandoff(resume: GeneratedResume): HandoffQuestion[] {
  const stored = resume.application?.spec;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
  const review = (stored as Record<string, unknown>)._review;
  if (!review || typeof review !== 'object' || Array.isArray(review)) return [];
  const questions = (review as Record<string, unknown>).questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.question !== 'string' || typeof item.answer !== 'string') return [];
    if (item.kind !== 'essay' && item.kind !== 'required') return [];
    return [{
      id: item.id,
      question: item.question,
      answer: item.answer,
      kind: item.kind,
      required: item.required === true,
      ...(typeof item.portal_selector === 'string' ? { portal_selector: item.portal_selector } : {}),
      ...(typeof item.portal_input_type === 'string' ? { portal_input_type: item.portal_input_type } : {}),
    }];
  });
}
