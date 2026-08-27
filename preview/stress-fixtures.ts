import type { EntitlementSnapshotV2 } from '../src/lib/entitlements';
import type {
  ApplicationProfile,
  Contact,
  Draft,
  ExperienceBankEntry,
  JobContext,
  OutreachEvent,
  Profile,
} from '../src/lib/types';

export const UNBREAKABLE = 'LITOSCONTENTWITHOUTBREAKPOINTS'.repeat(12);

export const normalProfile: Profile = {
  full_name: 'Alex Rivera',
  email: 'alex@example.com',
  experience: [
    {
      company: 'Campus Labs',
      title: 'Software Engineer Intern',
      start: '2025',
      end: '2025',
      description: 'Built a React and FastAPI study tool used by 400 students.',
    },
  ],
  projects: [
    {
      name: 'Interview notebook',
      description: 'Created a searchable notebook for technical interview practice.',
    },
  ],
  skills: ['React', 'TypeScript', 'Python', 'FastAPI'],
  school: 'University of Southern California',
  grad_year: 2027,
};

export const emptyProfile: Profile = {
  experience: [],
  projects: [],
  skills: [],
  school: '',
  grad_year: 0,
};

export const normalJob: JobContext = {
  application_id: 'stress-application',
  company: 'Figma',
  role: 'Software Engineer',
  domain: 'figma.com',
  url: 'https://www.figma.com/careers/job/123',
};

export const longJob: JobContext = {
  application_id: 'stress-application-long',
  company: UNBREAKABLE,
  role: 'Senior staff software engineer for cross-functional platform reliability, developer tooling, privacy, data systems, and customer-facing infrastructure across several international product groups',
};

export const normalContacts: Contact[] = [
  {
    id: 'contact-alumni',
    full_name: 'Marcus Lee',
    title: 'Software Engineer',
    persona: 'alumni',
    company_domain: 'figma.com',
    school_match: true,
    email: 'marcus.lee@figma.com',
    linkedin_url: 'https://linkedin.com/in/marcuslee',
    tier: 'green',
    status: 'verified',
  },
  {
    id: 'contact-recruiter',
    full_name: 'Priya Sharma',
    title: 'Engineering Recruiter',
    persona: 'recruiter',
    company_domain: 'figma.com',
    school_match: false,
    email: 'priya@figma.com',
    linkedin_url: 'https://linkedin.com/in/priyasharma',
    tier: 'green',
    status: 'verified',
  },
  {
    id: 'contact-manager',
    full_name: 'Dana Whitfield',
    title: 'Hiring Manager, Growth',
    persona: 'hiring_manager',
    company_domain: 'figma.com',
    school_match: false,
    email: 'dana.w@figma.com',
    linkedin_url: 'https://linkedin.com/in/danawhitfield',
    tier: 'amber',
    status: 'likely',
  },
  {
    id: 'contact-linkedin',
    full_name: 'Jordan Kim',
    title: 'New Grad Software Engineer',
    persona: 'near_peer',
    company_domain: 'figma.com',
    school_match: false,
    linkedin_url: 'https://linkedin.com/in/jordankim',
    tier: 'blue',
    status: 'linkedin_only',
  },
];

const personas: Contact['persona'][] = [
  'alumni',
  'near_peer',
  'senior_ic',
  'hiring_manager',
  'recruiter',
];

export const manyContacts: Contact[] = Array.from({ length: 24 }, (_, index) => ({
  id: `contact-${index + 1}`,
  full_name: index === 10 ? UNBREAKABLE : `Contact ${index + 1} With a Realistically Long Name`,
  title: index === 11
    ? 'Principal engineering and recruiting operations leader for international early-career platform teams'
    : `Role ${index + 1}`,
  persona: personas[index % personas.length],
  company_domain: index === 12 ? UNBREAKABLE : `company-${index + 1}.example`,
  school_match: index % 4 === 0,
  ...(index % 5 === 4
    ? { linkedin_url: `https://linkedin.com/in/contact-${index + 1}` }
    : { email: `contact.${index + 1}@company-${index + 1}.example` }),
  tier: index % 5 === 4 ? 'blue' : index % 3 === 0 ? 'amber' : 'green',
  status: index % 5 === 4 ? 'linkedin_only' : index % 3 === 0 ? 'likely' : 'verified',
}));

export const incompleteContact: Contact = {
  id: 'contact-incomplete',
  full_name: UNBREAKABLE,
  title: '',
  persona: 'near_peer',
  company_domain: '',
  school_match: false,
  tier: 'blue',
  status: 'none',
};

export const normalDraft: Draft = {
  subject: 'Fellow Trojan reaching out about the software engineer role',
  body: "Hi Marcus,\n\nI studied computer science at USC and came across the software engineer opening at Figma. Your path from USC into engineering stood out to me.\n\nI have spent the last year building full-stack projects, including a React and FastAPI study tool used by 400 students. Would you be open to a short chat about what the team looks for?\n\nThank you,\nAlex",
  word_count: 72,
  warnings: [],
  draft_type: 'first_note',
  contact_id: 'contact-alumni',
  application_id: 'stress-application',
};

export const longDraft: Draft = {
  subject: UNBREAKABLE,
  body: `${UNBREAKABLE}\n\n${'This paragraph intentionally carries a very long but breakable sentence about product engineering, developer infrastructure, privacy, accessibility, international operations, and the many teams involved in the role. '.repeat(8)}\n\n${UNBREAKABLE}`,
  word_count: Number.MAX_SAFE_INTEGER,
  warnings: [
    'This draft has incomplete contact details and needs review before it can be sent.',
    UNBREAKABLE,
    'The role title is unusually long, so check that the opening sentence still sounds natural.',
  ],
  draft_type: 'follow_up',
};

export const normalEvents: OutreachEvent[] = [
  {
    id: 'event-replied',
    contact: normalContacts[0],
    channel: 'email',
    subject: 'Fellow Trojan reaching out',
    sent_at: '2026-08-21T10:00:00Z',
    replied_at: '2026-08-22T09:30:00Z',
    bounced: false,
    status: 'replied',
  },
];

const outreachStatuses: OutreachEvent['status'][] = ['drafted', 'sent', 'replied', 'bounced'];

export const manyEvents: OutreachEvent[] = Array.from({ length: 48 }, (_, index) => ({
  id: `event-${index + 1}`,
  contact: manyContacts[index % manyContacts.length],
  channel: index % 5 === 4 ? 'linkedin' : 'email',
  subject: index === 9
    ? UNBREAKABLE
    : `Follow-up ${index + 1} about a software engineering opportunity`,
  ...(index % 7 === 0 ? {} : { sent_at: `2026-08-${String((index % 25) + 1).padStart(2, '0')}T10:00:00Z` }),
  bounced: index % 4 === 3,
  status: outreachStatuses[index % outreachStatuses.length],
}));

export const incompleteEvent: OutreachEvent = {
  id: 'event-incomplete',
  contact: incompleteContact,
  channel: 'email',
  bounced: false,
  status: 'sent',
};

export const manyExperienceEntries: ExperienceBankEntry[] = Array.from({ length: 16 }, (_, index) => ({
  id: `experience-${index + 1}`,
  type: index % 3 === 0 ? 'project' : 'job',
  org: index === 7 ? UNBREAKABLE : `Organization ${index + 1}`,
  title: index % 3 === 0 ? undefined : `Position ${index + 1}`,
  date_range: index % 4 === 0 ? undefined : `202${index % 6} - 202${(index % 6) + 1}`,
  bullet_variants: [
    index === 8
      ? UNBREAKABLE
      : `Built and measured project ${index + 1} across several teams and customer groups.`,
  ],
  tags: [],
}));

export const stressApplicationProfile: ApplicationProfile = {
  phone: UNBREAKABLE,
  address_city: 'Los Angeles',
  address_country: 'United States',
  linkedin_url: `https://linkedin.com/in/${UNBREAKABLE}`,
  github_url: `https://github.com/${UNBREAKABLE}`,
  portfolio_url: `https://example.com/${UNBREAKABLE}`,
  citizenship: 'United States',
  work_authorized: true,
  needs_sponsorship: false,
  availability_date: 'Summer 2027',
  availability_term: '14 weeks',
  desired_salary: '999999999999999999999 USD',
  date_of_birth: 'not-a-date',
  eeo_prefs: {
    veteran: 'I would rather not say',
    gender: 'I would rather not say',
  },
};

const plusFeatures: EntitlementSnapshotV2['features'] = {
  application_fill: true,
  application_tracking: true,
  job_discovery: true,
  base_resume_use: true,
  saved_profile_use: true,
  saved_answer_use: true,
  document_management: true,
  application_review: true,
  manual_submission_controls: true,
  account_data_controls: true,
  ai_resume_tailoring: true,
  ai_resume_feedback: true,
  ai_cover_letter_generation: true,
  ai_application_answer_generation: true,
  saved_generated_versions: true,
  contact_discovery: true,
  outreach_email_generation: true,
  networking_discovery: true,
  referral_paths: true,
  connected_companies: true,
  advanced_job_insights: true,
  recruiter_visibility: true,
  hover_generation: false,
  automatic_submission: true,
};

export const trialSnapshot: EntitlementSnapshotV2 = {
  schema_version: 2,
  policy_version: 'litos-entitlements-v2',
  account_id: 'stress-trial-account',
  revision: 'stress-trial-1',
  evaluated_at: '2026-08-27T00:00:00Z',
  access_class: 'trial_plus',
  product: 'litos_plus',
  term: null,
  features: plusFeatures,
  trial: {
    meter_policy: 'litos_plus_v2_lifetime',
    starts_at: '2026-08-26T00:00:00Z',
    ends_at: '2099-12-31T00:00:00Z',
    active: true,
    tailored_resumes_used: Number.MAX_SAFE_INTEGER,
    tailored_resumes_limit: 5,
    cover_letters_used: 1,
    cover_letters_limit: 5,
    answer_applications_used: 2,
    answer_applications_limit: 5,
    outreach_companies_used: 4,
    outreach_companies_limit: 5,
    company_usage: [],
  },
  legacy_limits: null,
  subscription: null,
};

export const freeSnapshot: EntitlementSnapshotV2 = {
  ...trialSnapshot,
  account_id: 'stress-free-account',
  revision: 'stress-free-1',
  access_class: 'free_new',
  product: null,
  term: null,
  features: {
    ...plusFeatures,
    ai_resume_tailoring: false,
    ai_resume_feedback: false,
    ai_cover_letter_generation: false,
    ai_application_answer_generation: false,
    saved_generated_versions: false,
    contact_discovery: false,
    outreach_email_generation: false,
    networking_discovery: false,
    referral_paths: false,
    connected_companies: false,
    advanced_job_insights: false,
    recruiter_visibility: false,
    hover_generation: false,
    automatic_submission: false,
  },
  trial: null,
};

export const paidSnapshot: EntitlementSnapshotV2 = {
  ...trialSnapshot,
  account_id: 'stress-paid-account',
  revision: 'stress-paid-1',
  access_class: 'plus_paid',
  term: 'month',
  trial: null,
  subscription: {
    provider: 'stripe',
    status: 'active',
    cancel_at_period_end: false,
    current_period_start: '2026-08-01T00:00:00Z',
    current_period_end: '2026-09-01T00:00:00Z',
    access_ends_at: null,
    management_available: true,
  },
};
