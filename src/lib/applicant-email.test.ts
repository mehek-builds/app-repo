import { describe, expect, it } from 'vitest';
import type { GeneratedResume } from './types';
import { applicantEmailForGeneratedPacket, atsNameForPortalUrl } from './applicant-email';

function resumeWithSpec(spec: unknown): GeneratedResume {
  return {
    resume_id: '22222222-2222-4222-8222-222222222222',
    resume_url: 'https://api.trylitos.com/resume/download?t=test',
    file_name: 'resume.pdf',
    spec: {},
    application: {
      id: '22222222-2222-4222-8222-222222222222',
      spec,
    },
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

describe('applicantEmailForGeneratedPacket', () => {
  it('uses the backend-pinned packet email instead of profile.email', () => {
    const resume = resumeWithSpec({
      _applicant_email: { address: 'app-123@applications.trylitos.com', source: 'litos_alias' },
      _contact: { email: 'app-123@applications.trylitos.com' },
    });
    expect(applicantEmailForGeneratedPacket(resume, 'mehekmandal05@gmail.com'))
      .toBe('app-123@applications.trylitos.com');
  });

  it('fails closed when a modern application response has no pinned email', () => {
    expect(applicantEmailForGeneratedPacket(
      resumeWithSpec({ _contact: { email: 'printed@example.com' } }),
      'different@example.com',
    )).toBeUndefined();
    expect(applicantEmailForGeneratedPacket(resumeWithSpec({}), 'profile@example.com')).toBeUndefined();
  });

  it('falls back only for old resume-only responses', () => {
    const resume = resumeWithSpec(undefined);
    resume.application = undefined;
    expect(applicantEmailForGeneratedPacket(resume, 'Legacy@Example.com')).toBe('legacy@example.com');
  });
});

describe('atsNameForPortalUrl', () => {
  it('labels supported extension portals for packet creation', () => {
    expect(atsNameForPortalUrl('https://acme.wd5.myworkdayjobs.com/en-US/jobs/job/1')).toBe('workday');
    expect(atsNameForPortalUrl('https://job-boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
  });
});
