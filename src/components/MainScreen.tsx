import React, { useEffect, useState } from 'react';
import { getEvents, resolveContacts } from '../lib/api';
import type { Contact, JobContext, OutreachEvent } from '../lib/types';
import { outreachStatus } from '../lib/outreach-status';
import Avatar from './Avatar';
import { SkeletonBar } from './Skeleton';
import WarningBanner from './WarningBanner';
import {
  fieldClass,
  PendingLabel,
  PopupHeader,
  primaryButtonClass,
  secondaryButtonClass,
  quietButtonClass,
  SectionLabel,
  StatusDot,
  textButtonClass,
} from './ui';

interface MainScreenProps {
  token: string;
  detectedJob?: JobContext | null;
  pendingDraftCount?: number;
  onViewDrafts?: () => void;
  onContactsFound: (contacts: Contact[], job: JobContext) => void;
  onViewTracking: () => void;
  onViewAutofillSetup: () => void;
  userSchool?: string;
}

function EventStatus({ status }: { status: string }) {
  // Same map the Emails screen uses. This used to invent its own tones and print the raw enum.
  const { tone, className, label } = outreachStatus(status);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${className}`}>
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

function slugToName(slug: string): string {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function parseJobUrl(url: string): { company?: string } {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;
    const parts = parsedUrl.pathname.split('/').filter(Boolean);

    if (host.includes('greenhouse.io') && parts[0]) return { company: slugToName(parts[0]) };
    if (host.includes('lever.co') && parts[0]) return { company: slugToName(parts[0]) };
    if (host.includes('ashbyhq.com') && parts[0]) return { company: slugToName(parts[0]) };
    if (host.includes('myworkdayjobs.com') || host.includes('workday.com')) {
      const slug = host.split('.')[0].replace(/^www/, '');
      if (slug) return { company: slugToName(slug) };
    }
    if (host.includes('joinhandshake.com') && parts[1]) return { company: slugToName(parts[1]) };
  } catch {
    return {};
  }
  return {};
}

export default function MainScreen({
  token,
  detectedJob,
  pendingDraftCount = 0,
  onViewDrafts,
  onContactsFound,
  onViewTracking,
  onViewAutofillSetup,
  userSchool,
}: MainScreenProps) {
  const [jobUrl, setJobUrl] = useState(detectedJob?.url ?? '');
  const [company, setCompany] = useState(detectedJob?.company ?? '');
  const [role, setRole] = useState(detectedJob?.role ?? '');
  const [editingJob, setEditingJob] = useState(!detectedJob);
  const [jobDetailsTouched, setJobDetailsTouched] = useState(false);
  const [companyWasGuessed, setCompanyWasGuessed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentEvents, setRecentEvents] = useState<OutreachEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [fillError, setFillError] = useState<string | null>(null);

  const handleFillThisPage = async () => {
    setFillError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setFillError('Litos lost track of this tab. Close this popup and open it again.');
        return;
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/content.js'],
      });
      window.close();
    } catch {
      setFillError('Chrome blocks extensions on this page. Open the job on the company\u2019s own site and try again.');
    }
  };

  useEffect(() => {
    getEvents(token)
      .then((events) => setRecentEvents(events.slice(0, 3)))
      .catch((err) => setEventsError(err instanceof Error ? err.message : 'We could not load your recent emails.'))
      .finally(() => setEventsLoading(false));
  }, [token]);

  useEffect(() => {
    if (!detectedJob) return;
    if (detectedJob.company) setCompany((current) => current || detectedJob.company);
    if (detectedJob.role) setRole((current) => current || detectedJob.role);
    if (detectedJob.url) setJobUrl((current) => current || detectedJob.url!);
    if (!jobDetailsTouched && (detectedJob.company || detectedJob.role)) setEditingJob(false);
  }, [detectedJob, jobDetailsTouched]);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setJobUrl(value);
    setJobDetailsTouched(true);
    setError(null);
    const parsed = parseJobUrl(value);
    if (parsed.company && !company) {
      setCompany(parsed.company);
      // A name pulled out of a URL slug is a guess, and Workday subdomains in particular produce
      // junk. Say so, rather than presenting it as something we read off the posting.
      setCompanyWasGuessed(true);
    }
  };

  const handleFind = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCompany = company.trim();
    const cleanRole = role.trim();
    if (!cleanCompany || !cleanRole) {
      setError('Enter both the company and role.');
      setEditingJob(true);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const contacts = await resolveContacts(token, {
        company: cleanCompany,
        role: cleanRole,
        user_school: userSchool,
      });
      onContactsFound(contacts, {
        company: cleanCompany,
        role: cleanRole,
        url: jobUrl || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find anyone. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const hasJob = Boolean(company || role);

  return (
    <div className="flex min-h-full animate-fade-in flex-col bg-white">
      {/* The h1 says what this screen is for. It used to say "Litos" on every screen, so the
          popup's heading never once told you where you were.

          Two destinations, and they are named the same thing here, in the tracking screen's own
          title, and on the website: Answers and Emails. Sign out is not a destination and no
          longer sits between them - it lives at the foot of Answers, behind an inline confirm,
          because a native window.confirm is the one piece of OS chrome in the product. */}
      <PopupHeader title="This job">
        <button type="button" onClick={onViewAutofillSetup} className="min-h-11 px-1.5 text-xs font-medium text-gray-600 hover:text-gray-950">
          Answers
        </button>
        <button type="button" onClick={onViewTracking} className="min-h-11 px-1.5 text-xs font-medium text-gray-600 hover:text-gray-950">
          Emails
        </button>
      </PopupHeader>

      <main className="flex flex-1 flex-col gap-5 px-4 py-4">
        {pendingDraftCount > 0 && (
          <button
            type="button"
            onClick={onViewDrafts}
            className="flex min-h-14 w-full items-center gap-3 border-b border-gray-200 pb-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <StatusDot tone="success" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-950">
                {pendingDraftCount} draft{pendingDraftCount === 1 ? '' : 's'} ready
              </span>
              <span className="block text-xs text-gray-600">Review before sending</span>
            </span>
            <span className="text-sm font-semibold text-brand-700">Review</span>
          </button>
        )}

        <form onSubmit={handleFind} className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>{hasJob ? 'Current job' : 'Add a job'}</SectionLabel>
            {hasJob && !editingJob && (
              <button type="button" onClick={() => setEditingJob(true)} className={quietButtonClass}>
                Edit
              </button>
            )}
          </div>

          {hasJob && !editingJob ? (
            <div className="flex items-start gap-3 border-b border-gray-200 pb-4">
              <StatusDot tone="brand" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold text-gray-950">{company}</h2>
                <p className="truncate text-sm text-gray-600">{role}</p>
              </div>
              <span className="text-xs text-gray-600">Found on this page</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3 border-b border-gray-200 pb-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="job-url" className="text-sm font-medium text-gray-800">Job link</label>
                <input
                  id="job-url"
                  type="url"
                  value={jobUrl}
                  onChange={handleUrlChange}
                  placeholder="Paste a job URL"
                  className={fieldClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="job-company" className="text-sm font-medium text-gray-800">Company</label>
                  <input
                    id="job-company"
                    value={company}
                    onChange={(e) => {
                      setCompany(e.target.value);
                      setJobDetailsTouched(true);
                      setCompanyWasGuessed(false);
                    }}
                    placeholder="Figma"
                    className={fieldClass}
                  />
                  {companyWasGuessed && (
                    <p className="text-xs leading-5 text-gray-600">We guessed this from the link. Fix it if it is wrong.</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="job-role" className="text-sm font-medium text-gray-800">Role</label>
                  <input
                    id="job-role"
                    value={role}
                    onChange={(e) => {
                      setRole(e.target.value);
                      setJobDetailsTouched(true);
                    }}
                    placeholder="Software Engineer"
                    className={fieldClass}
                  />
                </div>
              </div>
            </div>
          )}

          {error && <WarningBanner message={error} variant="error" />}

          <section aria-labelledby="workflow-heading">
            <div id="workflow-heading"><SectionLabel>What Litos can do here</SectionLabel></div>
            <div className="mt-2 divide-y divide-gray-200 border-y border-gray-200">
              <div className="flex min-h-16 items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-950">This job&rsquo;s form</p>
                  <p className="text-xs text-gray-600">Litos fills it in and stops so you can check it</p>
                </div>
                <button type="button" onClick={handleFillThisPage} className={primaryButtonClass}>
                  Fill this form
                </button>
              </div>
              <div className="flex min-h-16 items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-950">Emails to people here</p>
                  <p className="text-xs text-gray-600">Find someone at this company to write to</p>
                </div>
                {/* The row that describes the job now carries the button that does it. This row's
                    only affordance used to be the words "Not started", with its actual control a
                    hundred pixels below as a full-width outlined button - which read as the
                    screen's primary while the real primary sat inside the row above. */}
                <button type="submit" aria-label="Find people" disabled={loading} className={secondaryButtonClass}>
                  {loading ? <PendingLabel state="searching">Looking…</PendingLabel> : 'Find people'}
                </button>
              </div>
            </div>
            {fillError && <p className="mt-2 text-xs text-danger-700" role="alert">{fillError}</p>}
          </section>
        </form>

        <section className="flex flex-col gap-2" aria-labelledby="recent-emails-heading">
          <div className="flex items-center justify-between gap-3">
            <div id="recent-emails-heading"><SectionLabel>Recent emails</SectionLabel></div>
            <button type="button" onClick={onViewTracking} className={quietButtonClass}>View all</button>
          </div>

          {eventsLoading ? (
            <div className="flex min-h-16 flex-col justify-center gap-2 border-y border-gray-200 py-3">
              <SkeletonBar width="55%" height={10} />
              <SkeletonBar width="40%" height={9} />
            </div>
          ) : eventsError ? (
            <WarningBanner message={eventsError} variant="error" />
          ) : recentEvents.length === 0 ? (
            <p className="border-y border-gray-200 py-4 text-sm text-gray-600">
              No emails yet. Find someone to write to and they show up here.
            </p>
          ) : (
            <div className="divide-y divide-gray-200 border-y border-gray-200">
              {recentEvents.map((event) => (
                <div key={event.id} className="flex min-h-14 items-center gap-3 py-2">
                  <Avatar name={event.contact.full_name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-950">{event.contact.full_name}</p>
                    <p className="truncate text-xs text-gray-600">{event.contact.company_domain}</p>
                  </div>
                  <EventStatus status={event.status} />
                </div>
              ))}
            </div>
          )}
        </section>

        {loading && <p className="sr-only" role="status" aria-live="polite">Finding people</p>}
      </main>
    </div>
  );
}
