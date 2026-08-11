import { describe, expect, it } from 'vitest';
import { frozenApplicantFillData } from './handoff-applicant-snapshot';
import type { GeneratedResume } from './types';

function packet(snapshot: GeneratedResume['applicant_snapshot'] | undefined): GeneratedResume {
  return {
    resume_id: 'app',
    resume_url: 'https://api.trylitos.com/resume.pdf',
    file_name: 'resume.pdf',
    handoff_version: 'a'.repeat(64),
    spec: {},
    application: {
      id: 'app',
      spec: {
        _applicant_email: { address: 'application@example.com', source: 'litos_alias', tracked: true },
        _contact: { full_name: 'Mehek Mandal', email: 'mehekman@usc.edu' },
      },
    },
    applicant_snapshot: snapshot,
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

const snapshot: NonNullable<GeneratedResume['applicant_snapshot']> = {
  profile: {
    full_name: 'Mehek Mandal',
    email: 'application@example.com',
    experience: [{ company: 'Litos', title: 'Founder', start: '2025-01', end: 'present', description: 'Built Litos' }],
    skills: ['TypeScript'],
    school: 'USC',
    grad_year: 2028,
    currently_enrolled: true,
  },
  application_profile: {
    phone: '+971500000000',
    address_city: 'Dubai',
    address_state: 'Dubai',
    address_zip: '00000',
    address_country: 'United Arab Emirates',
    date_of_birth: '2005-09-25',
    languages: ['English', 'Hindi'],
    referral_source_default: 'Company website',
  },
};

describe('frozen handoff applicant data', () => {
  it('returns the version-bound structured snapshot verbatim', () => {
    const result = frozenApplicantFillData(packet(snapshot));
    expect(result).toEqual({ profile: snapshot.profile, applicationProfile: snapshot.application_profile });
    expect(result?.profile.experience[0]).toEqual({
      company: 'Litos', title: 'Founder', start: '2025-01', end: 'present', description: 'Built Litos',
    });
    expect(result?.applicationProfile).toMatchObject({
      address_city: 'Dubai',
      address_country: 'United Arab Emirates',
      address_zip: '00000',
      date_of_birth: '2005-09-25',
      languages: ['English', 'Hindi'],
      referral_source_default: 'Company website',
    });
  });

  it('fails closed when the snapshot is missing or its email differs from the frozen packet', () => {
    expect(frozenApplicantFillData(packet(undefined))).toBeNull();
    expect(frozenApplicantFillData(packet({
      ...snapshot,
      profile: { ...snapshot.profile, email: 'mehekman@usc.edu' },
    }))).toBeNull();
    expect(frozenApplicantFillData(packet({
      ...snapshot,
      application_profile: { ...snapshot.application_profile, currently_enrolled: false },
    }))).toBeNull();
  });
});
