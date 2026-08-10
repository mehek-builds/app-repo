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

export function validHandoffVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Preserve the exact reviewed answers frozen into a generated application packet. null means the
 * answer map itself is missing or malformed and must hold the handoff. An empty array is a valid,
 * explicitly reviewed packet with no custom questions.
 */
export function reviewedQuestionsForHandoff(resume: GeneratedResume): HandoffQuestion[] | null {
  const stored = resume.application?.spec;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const review = (stored as Record<string, unknown>)._review;
  if (!review || typeof review !== 'object' || Array.isArray(review)) return null;
  const questions = (review as Record<string, unknown>).questions;
  if (!Array.isArray(questions)) return null;
  const parsed: HandoffQuestion[] = [];
  for (const candidate of questions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id.trim()
      || typeof item.question !== 'string' || !item.question.trim()
      || typeof item.answer !== 'string') return null;
    if (item.kind !== 'essay' && item.kind !== 'required') return null;
    parsed.push({
      id: item.id,
      question: item.question,
      answer: item.answer,
      kind: item.kind,
      required: item.required === true,
      ...(typeof item.portal_selector === 'string' ? { portal_selector: item.portal_selector } : {}),
      ...(typeof item.portal_input_type === 'string' ? { portal_input_type: item.portal_input_type } : {}),
    });
  }
  return parsed;
}
