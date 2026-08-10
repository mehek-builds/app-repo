import { describe, expect, it } from 'vitest';
import {
  ARMED_HANDOFF_TTL_MS,
  applicationFormIdentityKey,
  armHandoffs,
  claimArmed,
  decideAdoption,
  handoffKey,
  handoffMatches,
  pruneArmed,
  continueSmartRecruitersHandoff,
  smartRecruitersApplicationUrl,
  smartRecruitersContinuationAllowed,
} from './web-handoff';

const NOW = 1_760_000_000_000;

describe('handoffKey', () => {
  it('drops the query and hash so tracking parameters cannot split one application into two', () => {
    expect(handoffKey('https://jobs.lever.co/palantir/9e40/apply?gh_src=x#top')).toBe(
      'https://jobs.lever.co/palantir/9e40/apply',
    );
  });

  it('ignores a trailing slash', () => {
    expect(handoffKey('https://jobs.lever.co/palantir/9e40/')).toBe('https://jobs.lever.co/palantir/9e40');
  });

  /* Same rule as the website's safePortalUrl. A portal url we would not turn into a link is not a
     url we should auto-fill against either. */
  it('refuses anything that is not https', () => {
    expect(handoffKey('http://jobs.lever.co/palantir/9e40')).toBeNull();
    expect(handoffKey('javascript:alert(1)')).toBeNull();
    expect(handoffKey('not a url')).toBeNull();
  });
});

describe('handoffMatches', () => {
  /* The reported case: the dashboard stores the /apply form, and Lever also serves the posting one
     level up. Both are the same application. */
  it('matches a posting against its own apply page in both directions', () => {
    const posting = 'https://jobs.lever.co/palantir/9e40';
    const apply = 'https://jobs.lever.co/palantir/9e40/apply';
    expect(handoffMatches(posting, apply)).toBe(true);
    expect(handoffMatches(apply, posting)).toBe(true);
  });

  it('never matches a different posting at the same employer', () => {
    expect(handoffMatches('https://jobs.lever.co/palantir/9e40', 'https://jobs.lever.co/palantir/aaaa')).toBe(false);
  });

  it('never matches across employers', () => {
    expect(handoffMatches('https://jobs.lever.co/palantir/9e40', 'https://jobs.lever.co/other/9e40')).toBe(false);
  });

});

describe('applicationFormIdentityKey', () => {
  const cases = [
    ['Lever', 'https://jobs.lever.co/acme/one/apply?utm_source=a#x', 'https://jobs.lever.co/acme/one?utm_source=b', 'https://jobs.lever.co/acme/two/apply'],
    ['Greenhouse', 'https://job-boards.greenhouse.io/acme/jobs/123?gh_src=a#x', 'https://job-boards.greenhouse.io/acme/jobs/123?utm_source=b', 'https://job-boards.greenhouse.io/acme/jobs/456'],
    ['Greenhouse embed', 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123&utm_source=a#x', 'https://job-boards.greenhouse.io/embed/job_app?token=123&for=acme', 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=456'],
    ['Ashby', 'https://jobs.ashbyhq.com/acme/one/application', 'https://jobs.ashbyhq.com/acme/one/application', 'https://jobs.ashbyhq.com/acme/two/application'],
    ['Workday', 'https://acme.wd5.myworkdayjobs.com/en-US/jobs/job/one/apply', 'https://acme.wd5.myworkdayjobs.com/en-US/jobs/job/one/apply', 'https://acme.wd5.myworkdayjobs.com/en-US/jobs/job/two/apply'],
    ['SmartRecruiters', 'https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/123e4567-e89b-12d3-a456-426614174000?dcr_ci=Acme', 'https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/123e4567-e89b-12d3-a456-426614174000?utm_source=x', 'https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/223e4567-e89b-12d3-a456-426614174999'],
    ['iCIMS', 'https://careers-acme.icims.com/jobs/123/job?mobile=true', 'https://careers-acme.icims.com/jobs/123/job?utm_source=x', 'https://careers-acme.icims.com/jobs/456/job'],
    ['Jobvite', 'https://jobs.jobvite.com/acme/job/one/apply?source=a', 'https://jobs.jobvite.com/acme/job/one?source=b', 'https://jobs.jobvite.com/acme/job/two'],
    ['Personio', 'https://acme.jobs.personio.com/job/123/apply?language=en', 'https://acme.jobs.personio.com/job/123?language=de', 'https://acme.jobs.personio.com/job/456'],
    ['Recruitee', 'https://acme.recruitee.com/o/one/c/new?source=a', 'https://acme.recruitee.com/o/one?source=b', 'https://acme.recruitee.com/o/two'],
    ['Teamtailor', 'https://jobs.acme.teamtailor.com/jobs/123/applications/new?source=a', 'https://jobs.acme.teamtailor.com/jobs/123?source=b', 'https://jobs.acme.teamtailor.com/jobs/456'],
    ['Pinpoint', 'https://acme.pinpointhq.com/en/postings/one/applications/new?source=a', 'https://acme.pinpointhq.com/en/postings/one?source=b', 'https://acme.pinpointhq.com/en/postings/two'],
    ['Zoho', 'https://acme.zohorecruit.com/jobs/Careers/123/apply?source=a', 'https://acme.zohorecruit.com/jobs/Careers/123/apply?source=b', 'https://acme.zohorecruit.com/jobs/Careers/456/apply'],
    ['Bullhorn', 'https://www.serverlogic.com/wp-content/plugins/bullhorn-oscp/?source=a#/jobs/123', 'https://www.serverlogic.com/wp-content/plugins/bullhorn-oscp/#/jobs/123', 'https://www.serverlogic.com/wp-content/plugins/bullhorn-oscp/#/jobs/456'],
    ['SAP', 'https://career5.successfactors.eu/sfcareer/jobreqcareer?jobId=123&company=ACME&utm_source=a', 'https://career5.successfactors.eu/sfcareer/jobreqcareer?company=ACME&jobId=123', 'https://career5.successfactors.eu/sfcareer/jobreqcareer?jobId=456&company=ACME'],
    ['Taleo', 'https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=123&lang=fr', 'https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=123&lang=en', 'https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=456'],
    ['ADP', 'https://myjobs.adp.com/acme/cx/job-details?reqId=123&utm_source=a', 'https://myjobs.adp.com/acme/cx/job-details?reqId=123', 'https://myjobs.adp.com/acme/cx/job-details?reqId=456'],
    ['JazzHR', 'https://acme.applytojob.com/apply/one?source=a', 'https://acme.applytojob.com/apply/one?source=b', 'https://acme.applytojob.com/apply/two'],
    ['BambooHR', 'https://acme.bamboohr.com/careers/123?source=a', 'https://acme.bamboohr.com/careers/123?source=b', 'https://acme.bamboohr.com/careers/456'],
    ['Oracle Cloud', 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123?source=a', 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/123?source=b', 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/456'],
    ['Avature', 'https://acme.avature.net/careers/JobDetail/Test?jobId=123&utm_source=a', 'https://acme.avature.net/careers/JobDetail/Test?jobId=123', 'https://acme.avature.net/careers/JobDetail/Test?jobId=456'],
    ['UKG', 'https://recruiting.ultipro.com/ACM/jobboard/x/OpportunityDetail?opportunityId=123e4567-e89b-12d3-a456-426614174000&utm_source=a', 'https://recruiting.ultipro.com/ACM/jobboard/x/OpportunityDetail?opportunityId=123e4567-e89b-12d3-a456-426614174000', 'https://recruiting.ultipro.com/ACM/jobboard/x/OpportunityDetail?opportunityId=223e4567-e89b-12d3-a456-426614174999'],
    ['Comeet', 'https://www.comeet.com/jobs/acme/one?token=secret&utm_source=first#form', 'https://www.comeet.com/jobs/acme/one?token=secret&utm_campaign=second', 'https://www.comeet.com/jobs/acme/one?token=other'],
    ['Rippling', 'https://ats.rippling.com/acme/jobs/one', 'https://ats.rippling.com/acme/jobs/one', 'https://ats.rippling.com/acme/jobs/two'],
    ['Breezy', 'https://acme.breezy.hr/p/one/apply', 'https://acme.breezy.hr/p/one/apply', 'https://acme.breezy.hr/p/two/apply'],
  ] as const;

  it.each(cases)('%s keeps one form stable and rejects a different job', (_name, reviewed, same, other) => {
    expect(applicationFormIdentityKey(reviewed)).toBe(applicationFormIdentityKey(same));
    expect(applicationFormIdentityKey(reviewed)).not.toBe(applicationFormIdentityKey(other));
  });
});

describe('SmartRecruiters handoff continuation', () => {
  const posting = 'https://jobs.smartrecruiters.com/SeekaTechnology/744000063648206-software-engineer-internship';
  const form = 'https://jobs.smartrecruiters.com/oneclick-ui/company/SeekaTechnology/publication/123e4567-e89b-12d3-a456-426614174000';

  it('moves an armed posting only to its trusted one-click application form', () => {
    expect(smartRecruitersApplicationUrl(posting, ['/privacy', form])).toBe(form);
    expect(smartRecruitersContinuationAllowed(posting, form)).toBe(true);
  });

  it('refuses lookalike hosts, arbitrary SmartRecruiters paths, and non-https links', () => {
    expect(smartRecruitersApplicationUrl(posting, [
      'https://evil.example/oneclick-ui/company/x/publication/123e4567-e89b-12d3-a456-426614174000',
      'https://jobs.smartrecruiters.com/company/admin',
      'http://jobs.smartrecruiters.com/oneclick-ui/company/x/publication/123e4567-e89b-12d3-a456-426614174000',
      'https://jobs.smartrecruiters.com/oneclick-ui/company/OtherEmployer/publication/123e4567-e89b-12d3-a456-426614174000',
    ])).toBeNull();
  });

  it('moves only the packet id atomically claimed from the exact armed posting', () => {
    const armed = armHandoffs([], [{ url: posting, applicationId: 'packet-seeka' }], NOW);
    const continued = continueSmartRecruitersHandoff(armed, posting, form, NOW + 1);
    expect(continued.applicationId).toBe('packet-seeka');
    expect(claimArmed(continued.remaining, form, NOW + 2).claimed?.applicationId).toBe('packet-seeka');
  });

  it('does not continue a different posting or accept an unarmed caller-selected packet', () => {
    const otherPosting = 'https://jobs.smartrecruiters.com/SeekaTechnology/744000063648999-another-role';
    const armed = armHandoffs([], [{ url: posting, applicationId: 'packet-seeka' }], NOW);
    expect(continueSmartRecruitersHandoff(armed, otherPosting, form, NOW + 1).applicationId).toBeNull();
    expect(continueSmartRecruitersHandoff([], posting, form, NOW + 1).applicationId).toBeNull();
  });
});

describe('armHandoffs', () => {
  it('keeps one entry per application however many times the dashboard re-renders', () => {
    const once = armHandoffs([], [{ url: 'https://jobs.lever.co/a/1/apply', applicationId: 'app-1' }], NOW);
    const twice = armHandoffs(once, [{ url: 'https://jobs.lever.co/a/1/apply', applicationId: 'app-1' }], NOW + 5_000);
    expect(twice).toHaveLength(1);
    expect(twice[0].armedAt).toBe(NOW + 5_000);
  });

  it('silently skips urls it will not act on rather than storing them', () => {
    expect(armHandoffs([], [{ url: 'javascript:alert(1)' }], NOW)).toEqual([]);
  });

  it('forgets armings older than the ttl', () => {
    const stale = [{ key: 'https://jobs.lever.co/a/1', armedAt: NOW - ARMED_HANDOFF_TTL_MS - 1 }];
    expect(pruneArmed(stale, NOW)).toEqual([]);
    expect(armHandoffs(stale, [], NOW)).toEqual([]);
  });
});

describe('claimArmed', () => {
  const armed = armHandoffs([], [{ url: 'https://jobs.lever.co/palantir/9e40/apply', applicationId: 'app-1' }], NOW);

  it('claims the page the applicant was sent to and reports which application it is', () => {
    const { claimed } = claimArmed(armed, 'https://jobs.lever.co/palantir/9e40/apply', NOW + 1_000);
    expect(claimed?.applicationId).toBe('app-1');
  });

  /* One-shot. A fill the applicant did not ask for, on a page they happen to reopen next week, is a
     different product doing a different thing. */
  it('hands the same arming out exactly once', () => {
    const first = claimArmed(armed, 'https://jobs.lever.co/palantir/9e40/apply', NOW + 1_000);
    expect(first.claimed).not.toBeNull();
    const second = claimArmed(first.remaining, 'https://jobs.lever.co/palantir/9e40/apply', NOW + 2_000);
    expect(second.claimed).toBeNull();
  });

  it('does not claim an unrelated posting', () => {
    expect(claimArmed(armed, 'https://jobs.lever.co/palantir/zzzz/apply', NOW).claimed).toBeNull();
  });

  it('does not claim once the arming has aged out', () => {
    expect(claimArmed(armed, 'https://jobs.lever.co/palantir/9e40/apply', NOW + ARMED_HANDOFF_TTL_MS + 1).claimed).toBeNull();
  });
});

describe('decideAdoption', () => {
  /* The reported defect: the website is signed in, the extension holds nothing at all. */
  it('adopts the website session when the extension has none', () => {
    expect(
      decideAdoption({ incomingToken: 'web', incomingEmail: 'a@example.com', storedToken: null, storedEmail: null }),
    ).toBe('adopted');
  });

  it('says nothing to do when it is already the same token', () => {
    expect(
      decideAdoption({ incomingToken: 'web', incomingEmail: 'a@example.com', storedToken: 'web', storedEmail: 'a@example.com' }),
    ).toBe('already_signed_in');
  });

  it('takes a rotated token for the same account', () => {
    expect(
      decideAdoption({ incomingToken: 'new', incomingEmail: 'A@Example.com ', storedToken: 'old', storedEmail: 'a@example.com' }),
    ).toBe('adopted');
  });

  /* The conservative half. A page must not be able to swap out a working extension session for a
     different person's, so this one refuses and says so instead. */
  it('refuses to switch accounts under a working extension session', () => {
    expect(
      decideAdoption({ incomingToken: 'new', incomingEmail: 'b@example.com', storedToken: 'old', storedEmail: 'a@example.com' }),
    ).toBe('different_account');
  });

  /* storedEmail null means the backend no longer honours the stored token. Refusing here would
     strand the applicant behind a session that cannot be used and cannot be replaced. */
  it('replaces a stored session the backend no longer honours', () => {
    expect(
      decideAdoption({ incomingToken: 'new', incomingEmail: 'b@example.com', storedToken: 'dead', storedEmail: null }),
    ).toBe('adopted');
  });

  /* incomingEmail null means the BACKEND refused the incoming token. Never store an unverified
     token: it would replace a working session with a broken one. */
  it('rejects a token the backend did not accept', () => {
    expect(
      decideAdoption({ incomingToken: 'forged', incomingEmail: null, storedToken: null, storedEmail: null }),
    ).toBe('rejected');
    expect(
      decideAdoption({ incomingToken: '   ', incomingEmail: 'a@example.com', storedToken: null, storedEmail: null }),
    ).toBe('rejected');
  });
});
