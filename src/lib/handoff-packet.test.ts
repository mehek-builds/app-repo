import { describe, expect, it } from 'vitest';
import { reviewedQuestionsForHandoff } from './handoff-packet';
import type { GeneratedResume } from './types';

function packet(spec: unknown): GeneratedResume {
  return {
    resume_id: 'packet-1',
    resume_url: 'https://api.example/resume/download?t=sealed',
    file_name: 'Mehek_Mandal_Resume.pdf',
    spec: {},
    application: { id: 'packet-1', spec },
    quality: {
      ready_to_attach: true,
      issues: [],
      warnings: [],
      ats_keyword_coverage_pct: 100,
      trimmed_for_one_page_fit: false,
      sparse_add_more_experience: false,
      grounding_removed: [],
      omissions: [],
    },
  };
}

describe('reviewedQuestionsForHandoff', () => {
  it('preserves reviewed answers and selectors from the exact packet', () => {
    expect(reviewedQuestionsForHandoff(packet({
      _review: {
        questions: [{
          id: 'q-1',
          question: 'Are you authorized to work here?',
          answer: 'Yes',
          kind: 'required',
          required: true,
          portal_selector: '#work-auth',
          portal_input_type: 'radio',
        }],
      },
    }))).toEqual([{
      id: 'q-1',
      question: 'Are you authorized to work here?',
      answer: 'Yes',
      kind: 'required',
      required: true,
      portal_selector: '#work-auth',
      portal_input_type: 'radio',
    }]);
  });

  it('refuses malformed packet question data instead of inventing an answer', () => {
    expect(reviewedQuestionsForHandoff(packet({ _review: { questions: [{ id: 'q', question: 'Missing answer' }] } }))).toEqual([]);
  });
});
