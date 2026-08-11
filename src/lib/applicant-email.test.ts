import { describe, expect, it } from 'vitest';
import type { GeneratedResume } from './types';
import { applicantEmailForGeneratedPacket, atsNameForPortalUrl, resumeContactEmailForProfile } from './applicant-email';

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
  it('uses the backend-pinned portal email instead of the personal PDF or profile email', () => {
    const resume = resumeWithSpec({
      _applicant_email: { address: 'app-123@applications.trylitos.com', source: 'litos_alias', tracked: true },
      _contact: { email: 'mehekman@usc.edu' },
    });
    expect(applicantEmailForGeneratedPacket(resume))
      .toBe('app-123@applications.trylitos.com');
  });

  it('fails closed when a modern application response has no pinned email', () => {
    expect(applicantEmailForGeneratedPacket(
      resumeWithSpec({ _contact: { email: 'printed@example.com' } }),
    )).toBeUndefined();
    expect(applicantEmailForGeneratedPacket(resumeWithSpec({}))).toBeUndefined();
  });

  it('never substitutes the personal PDF address when the frozen portal address is malformed', () => {
    expect(applicantEmailForGeneratedPacket(resumeWithSpec({
      _applicant_email: { address: 'not-an-email' },
      _contact: { email: 'mehekman@usc.edu' },
    }))).toBeUndefined();
  });

  it('rejects a missing, untracked, or swapped routing alias', () => {
    const personal = { email: 'mehekman@usc.edu' };
    expect(applicantEmailForGeneratedPacket(resumeWithSpec({
      _applicant_email: { address: 'app-123@applications.trylitos.com', source: 'litos_alias', tracked: false },
      _contact: personal,
    }))).toBeUndefined();
    expect(applicantEmailForGeneratedPacket(resumeWithSpec({
      _applicant_email: { address: 'mehekman@usc.edu', source: 'litos_alias', tracked: true },
      _contact: personal,
    }))).toBeUndefined();
    expect(applicantEmailForGeneratedPacket(resumeWithSpec({
      _contact: personal,
    }))).toBeUndefined();
  });

  it('rejects a routing alias that leaked into resume-derived content', () => {
    const resume = resumeWithSpec({
      _applicant_email: { address: 'app-123@applications.trylitos.com', source: 'litos_alias', tracked: true },
      _contact: { email: 'mehekman@usc.edu' },
    });
    resume.spec = {
      experience: [{ bullets: ['Contact app-123@applications.trylitos.com'] }],
    };
    expect(applicantEmailForGeneratedPacket(resume)).toBeUndefined();
  });

  it('rejects old resume-only responses even when a personal profile email is available', () => {
    const resume = resumeWithSpec(undefined);
    resume.application = undefined;
    expect(applicantEmailForGeneratedPacket(resume)).toBeUndefined();
  });
});

describe('resumeContactEmailForProfile', () => {
  it('uses only the explicit personal resume email and never the Litos login email', () => {
    expect(resumeContactEmailForProfile({
      email: 'mehekmandal05@gmail.com',
      resume_email: 'MehekMan@USC.edu',
    })).toBe('mehekman@usc.edu');
    expect(resumeContactEmailForProfile({ email: 'mehekmandal05@gmail.com' })).toBeUndefined();
    expect(resumeContactEmailForProfile({
      email: 'mehekman@usc.edu',
      resume_email: 'invalid',
    })).toBeUndefined();
  });
});

describe('atsNameForPortalUrl', () => {
  it('labels supported extension portals for packet creation', () => {
    expect(atsNameForPortalUrl('https://acme.wd5.myworkdayjobs.com/en-US/jobs/job/1')).toBe('workday');
    expect(atsNameForPortalUrl('https://job-boards.greenhouse.io/acme/jobs/1')).toBe('greenhouse');
    expect(atsNameForPortalUrl('https://jobs-express.icims.com/jobs/48173/sales-associate/login')).toBe('icims');
    expect(atsNameForPortalUrl('https://evilicims.com/jobs/48173/sales-associate/login')).toBe('evilicims.com');
  });
});
