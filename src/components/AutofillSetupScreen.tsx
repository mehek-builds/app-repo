import React, { useEffect, useState } from 'react';
import { getExperienceBank, putExperienceBank, getApplicationProfile, putApplicationProfile, getAutomationSettings, putAutomationSettings, type StandingConsentEligibility } from '../lib/api';
import { setAutoSubmitEnabled } from '../lib/storage';
import type { ExperienceBankEntry, ApplicationProfile, Profile } from '../lib/types';
import { parseStoredDate, formatDate } from '../lib/adapters/shared/dates';
import WarningBanner from './WarningBanner';
import LoadingSpinner from './LoadingSpinner';
import {
  PopupHeader,
  StatusDot,
  StepProgress,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
  textAreaClass,
} from './ui';

// An <input type="date"> renders NOTHING unless its value is ISO, so switching these fields to a
// date picker would have made every existing value vanish from the screen: "18/07/2026" and
// "Summer 2027" would both just look unset, and a student would reasonably conclude the app had
// lost their data. Reuse the filler's own parser so anything resolvable is shown as the day it
// means, and say so plainly when it is not.
function isoForDateInput(stored: string | null | undefined): string {
  const parts = parseStoredDate(stored);
  return parts ? formatDate(parts, 'ymd') : '';
}

// A saved value that exists but cannot be shown. Never silently swallow it: it is the student's
// data and the reason the field looks empty.
function unreadableStoredDate(stored: string | null | undefined): string | null {
  const raw = (stored ?? '').trim();
  return raw && !parseStoredDate(raw) ? raw : null;
}

// Onboarding for Litos v2's resume-gen + application-autofill flow (PRD-v2-resume-autofill.md
// Section 4-5). Sequenced fast-confirm-first, sensitive-last (Section 5's ordering rationale):
// Bucket 1 (auto-extracted, quick confirm) -> Bucket 2 (signal-checked, never default absence
// to "no") -> Bucket 3 (always ask, never inferred) -> links/preferences. Reachable from
// MainScreen rather than folded into v0's mandatory signup, so v0 stays fast and this stays
// opt-in until the student actually wants autofill.

type Step = 'loading' | 'experience' | 'checks' | 'required' | 'links' | 'saving' | 'done';

interface AutofillSetupScreenProps {
  token: string;
  profile: Profile;
  onBack: () => void;
  onLogout: () => void;
}

const cardClass = 'group border-b border-gray-200 py-3';

function ResumePill() {
  return (
    <span className="flex-shrink-0 text-xs font-medium text-gray-600">From resume</span>
  );
}

function StepHeader({ title, subtitle, step, total, showProgress }: { title: string; subtitle: string; step: number; total: number; showProgress: boolean }) {
  return (
    <div className="animate-fade-in-up">
      {showProgress && <StepProgress step={step} total={total} />}
      {/* gray-950 is the product's ink; this was the one heading at gray-900. */}
      <h2 className="text-base font-semibold text-gray-950">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-gray-600">{subtitle}</p>
    </div>
  );
}

function YesNoDecline({
  value,
  onChange,
  options = ['Yes', 'No', 'I would rather not say'],
  labelledBy,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  options?: string[];
  labelledBy?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-labelledby={labelledBy}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={`min-h-11 rounded-inner border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
            value === opt
              ? 'border-brand-400 bg-brand-50 text-brand-700'
              : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// Seeded entries carry NO tags (R-027). This used to stamp the whole `profile.skills` array onto
// EVERY entry, which is the actual root cause of R-015's "seeded junk": a tag is supposed to say
// what THIS entry demonstrates, and copying one global array onto a Product Management internship
// and a VP of Finance role alike says nothing while poisoning everything grounded against it. The
// UI collects no per-entry tags, so seeding none is the only honest value. Entries already stored
// on the server keep whatever tags they have: handleSave passes stored tags through untouched,
// and this seed only runs when the bank is empty. Exported for the test that pins this.
export function seedExperienceBank(profile: Profile): ExperienceBankEntry[] {
  const jobs: ExperienceBankEntry[] = profile.experience.map((e) => ({
    type: 'job',
    org: e.company,
    title: e.title,
    date_range: `${e.start} - ${e.end}`,
    bullet_variants: e.description ? [e.description] : [''],
    tags: [],
  }));
  const projects: ExperienceBankEntry[] = (profile.projects ?? []).map((p) => ({
    type: 'project',
    org: p.name,
    bullet_variants: p.description ? [p.description] : [''],
    tags: [],
  }));
  return [...jobs, ...projects];
}

export default function AutofillSetupScreen({ token, profile, onBack, onLogout }: AutofillSetupScreenProps) {
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);
  // Two taps, in our own UI, instead of a native OS dialog inside a 380px popup.
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const [bank, setBank] = useState<ExperienceBankEntry[]>([]);
  const [bankIsSeeded, setBankIsSeeded] = useState(false);
  /* Seeding only happens when the server had no bank at all, so it is our first-run signal. */
  const firstRun = bankIsSeeded;

  const [appProfile, setAppProfile] = useState<ApplicationProfile>({});
  const [eeo, setEeo] = useState<Record<string, string>>({});
  const [eeoExpanded, setEeoExpanded] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [automaticVerification, setAutomaticVerification] = useState(false);
  const [automationSettingsLoaded, setAutomationSettingsLoaded] = useState(false);
  /* Referenced by the consent copy below but never declared, so main has not
     typechecked since that change landed. The server is the authority on
     whether unattended submission has been earned; this only explains the
     state so the toggle is not an unexplained dead control. */
  const [consentEligibility, setConsentEligibility] = useState<StandingConsentEligibility | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [existingBank, existingProfile, automation] = await Promise.all([
          getExperienceBank(token),
          getApplicationProfile(token).catch(() => null),
          getAutomationSettings(token).catch(() => null),
        ]);
        if (existingBank.length > 0) {
          setBank(existingBank);
        } else {
          setBank(seedExperienceBank(profile));
          setBankIsSeeded(true);
        }
        if (existingProfile) {
          setAppProfile(existingProfile);
          setEeo((existingProfile.eeo_prefs as Record<string, string>) ?? {});
        }
        if (automation) {
          setAutoSubmit(automation.automatic_submission_enabled);
          setAutomaticVerification(automation.automatic_verification_enabled);
          setConsentEligibility(automation.standing_consent_eligibility ?? null);
          setAutomationSettingsLoaded(true);
        } else {
          setAutoSubmit(false);
          setAutomaticVerification(false);
          setError('Could not load what Litos is allowed to do on its own. Reopen setup before changing it.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your setup data.');
      } finally {
        setStep('experience');
      }
    })();
  }, [token, profile]);

  const updateEntry = (idx: number, patch: Partial<ExperienceBankEntry>) => {
    setBank((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };

  const removeEntry = (idx: number) => {
    setBank((prev) => prev.filter((_, i) => i !== idx));
  };

  const addEntry = () => {
    setBank((prev) => [...prev, { type: 'project', org: '', bullet_variants: [''], tags: [] }]);
  };

  const handleSave = async () => {
    setStep('saving');
    setError(null);
    try {
      await putExperienceBank(
        token,
        bank
          .filter((e) => e.org.trim())
          .map((e) => ({ ...e, bullet_variants: e.bullet_variants.filter((b) => b.trim()) })),
      );
      await putApplicationProfile(token, {
        ...appProfile,
        eeo_prefs: Object.keys(eeo).length > 0 ? eeo : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your setup.');
      setStep('links');
      return;
    }

    // The automation permissions are saved SEPARATELY, and their failure is NOT a setup failure.
    //
    // The backend now refuses to enable unattended submission until the student has approved a few
    // applications themselves. This call used to sit inside the same try as the experience bank and
    // the application profile, so a refused toggle threw, reported "Could not save your setup", and
    // bounced the student back to a form whose contents had in fact already been written. They
    // would have saved it a second time to fix a problem that did not exist.
    try {
      await putAutomationSettings(token, {
        automatic_submission_enabled: autoSubmit,
        automatic_verification_enabled: automaticVerification,
      });
      await setAutoSubmitEnabled(autoSubmit);
    } catch (err) {
      // Keep the LOCAL switch in step with what the server actually holds. Otherwise the extension
      // counts down and clicks submit on a permission the backend never granted, which is the exact
      // outcome the gate exists to prevent.
      setAutoSubmit(false);
      await setAutoSubmitEnabled(false);
      setError(
        err instanceof Error
          ? err.message
          : 'Your answers are saved. The automation setting was not changed.',
      );
      setStep('done');
      return;
    }

    setStep('done');
  };

  if (step === 'loading') {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  return (
    <div className="flex min-h-full animate-fade-in flex-col bg-white">
      <PopupHeader title="Answers" subtitle="Litos reuses these on every form" onBack={onBack} />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {error && <WarningBanner message={error} variant="error" />}

        {/* First run is a sequence, because the order is the point. Coming back is not: changing
            a LinkedIn URL should not mean clicking through experience, location and EEO first.
            After setup, the four sections become tabs. */}
        {!firstRun && step !== 'saving' && step !== 'done' && (
          <nav aria-label="Answer sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {([
              ['experience', 'Your experience'],
              ['checks', 'About you'],
              ['required', 'Every form asks these'],
              ['links', 'Your links'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStep(key)}
                aria-current={step === key ? 'true' : undefined}
                className={`min-h-11 whitespace-nowrap rounded-control px-3 text-sm transition-colors ${
                  step === key ? 'bg-gray-100 font-medium text-gray-950' : 'text-gray-600 hover:text-gray-950'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        {step === 'experience' && (
          <div className="flex flex-col gap-3">
            <StepHeader
              showProgress={firstRun}
              step={2}
              total={5}
              title="Your experience"
              subtitle={
                bankIsSeeded
                  ? 'Pulled from your resume. Review each entry, edit the bullet if it needs work.'
                  : 'Add the jobs and projects Litos should draw from when tailoring a resume.'
              }
            />

            <div className="flex flex-col gap-2.5">
              {bank.map((entry, idx) => (
                <div key={idx} className={cardClass}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="flex items-end gap-1.5">
                        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
                          {entry.type === 'job' ? 'Company' : 'Project name'}
                        <input
                          value={entry.org}
                          onChange={(e) => updateEntry(idx, { org: e.target.value })}
                          placeholder={entry.type === 'job' ? 'Company' : 'Project name'}
                          aria-label={entry.type === 'job' ? `Company ${idx + 1}` : `Project ${idx + 1}`}
                          className="w-full rounded-inner border-0 bg-transparent px-0 text-sm font-semibold text-gray-900 placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                        />
                        </label>
                        {bankIsSeeded && <ResumePill />}
                      </div>
                      {entry.type === 'job' && (
                        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                          Title
                        <input
                          value={entry.title ?? ''}
                          onChange={(e) => updateEntry(idx, { title: e.target.value })}
                          placeholder="Title"
                          aria-label={`Title ${idx + 1}`}
                          className="w-full rounded-inner border-0 bg-transparent px-0 text-xs text-gray-600 placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                        />
                        </label>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeEntry(idx)}
                      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-inner text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      aria-label={`Remove ${entry.org || entry.type}`}
                    >
                      ×
                    </button>
                  </div>
                  <label className="mt-2 flex flex-col gap-1 text-xs font-medium text-gray-600">
                    Description
                    <textarea
                      value={entry.bullet_variants[0] ?? ''}
                      onChange={(e) => updateEntry(idx, { bullet_variants: [e.target.value, ...entry.bullet_variants.slice(1)] })}
                      placeholder="What did you do here? One or two sentences."
                      aria-label={`Description ${idx + 1}`}
                      rows={2}
                      className={`${textAreaClass} text-xs`}
                    />
                  </label>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addEntry}
              className={secondaryButtonClass}
            >
              + Add another job or project
            </button>

            <button
              type="button"
              onClick={() => setStep('checks')}
              disabled={bank.filter((e) => e.org.trim()).length === 0}
              className={`${primaryButtonClass} mt-1 w-full`}
            >
              Continue
            </button>
          </div>
        )}

        {step === 'checks' && (
          <div className="flex animate-fade-in-up flex-col gap-4">
            <StepHeader
              showProgress={firstRun}
              step={3}
              total={5}
              title="About you"
              subtitle="Not usually on a resume, so we ask instead of guessing."
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="application-city" className="text-xs font-medium text-gray-700">Current city</label>
              <input
                id="application-city"
                value={appProfile.address_city ?? ''}
                onChange={(e) => setAppProfile((p) => ({ ...p, address_city: e.target.value }))}
                placeholder="e.g. Los Angeles"
                className={fieldClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="application-country" className="text-xs font-medium text-gray-700">Country you&apos;re based in</label>
              <input
                id="application-country"
                value={appProfile.address_country ?? ''}
                onChange={(e) => setAppProfile((p) => ({ ...p, address_country: e.target.value }))}
                placeholder="e.g. United States"
                className={fieldClass}
              />
              <p className="text-xs leading-5 text-gray-600">Where you live or would work from. Separate from citizenship below.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <p id="veteran-status-label" className="text-xs font-medium text-gray-700">Veteran or military status</p>
              <YesNoDecline labelledBy="veteran-status-label" value={eeo.veteran} onChange={(v) => setEeo((p) => ({ ...p, veteran: v }))} />
            </div>

            <button
              type="button"
              onClick={() => setStep('required')}
              className={`${primaryButtonClass} mt-1 w-full`}
            >
              Continue
            </button>
          </div>
        )}

        {step === 'required' && (
          <div className="flex animate-fade-in-up flex-col gap-4">
            <StepHeader
              showProgress={firstRun}
              step={4}
              total={5}
              title="Every form asks these"
              subtitle="We never guess these, so we ask you once."
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="application-citizenship" className="text-xs font-medium text-gray-700">Citizenship</label>
              <input
                id="application-citizenship"
                value={appProfile.citizenship ?? ''}
                onChange={(e) => setAppProfile((p) => ({ ...p, citizenship: e.target.value }))}
                placeholder="e.g. United States"
                className={fieldClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <p id="work-authorization-label" className="text-xs font-medium text-gray-700">Authorized to work without sponsorship?</p>
              <YesNoDecline
                labelledBy="work-authorization-label"
                value={appProfile.work_authorized === undefined ? undefined : appProfile.work_authorized ? 'Yes' : 'No'}
                onChange={(v) => setAppProfile((p) => ({ ...p, work_authorized: v === 'Yes' }))}
                options={['Yes', 'No']}
              />
              {/* Stored for your reference only. Never used to answer forms: work-authorization
                  questions are location-specific, so Litos always leaves them for you (see
                  WORK_ELIGIBILITY_QUESTION in adapters/generic.ts). Do not re-wire this into an adapter. */}
              <p className="text-xs leading-5 text-gray-600">
                Saved on your profile so you can see it. Every country has different rules, so Litos
                always leaves work-authorization questions for you to answer.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <p id="sponsorship-label" className="text-xs font-medium text-gray-700">Will need sponsorship in the future?</p>
              <YesNoDecline
                labelledBy="sponsorship-label"
                value={appProfile.needs_sponsorship === undefined ? undefined : appProfile.needs_sponsorship ? 'Yes' : 'No'}
                onChange={(v) => setAppProfile((p) => ({ ...p, needs_sponsorship: v === 'Yes' }))}
                options={['Yes', 'No']}
              />
              {/* Reference only, same as work_authorized above: sponsorship questions are
                  location-specific, so Litos never answers them from this flag (see
                  WORK_ELIGIBILITY_QUESTION in adapters/generic.ts). Do not re-wire. */}
              <p className="text-xs leading-5 text-gray-600">
                Saved on your profile so you can see it. Sponsorship rules differ by country,
                so Litos always leaves them for you to answer.
              </p>
            </div>

            {/*
              type="date" is the actual fix for R-014, and it is here rather than in the filler on
              purpose. A free-text box cannot say which number is the month: "03/04/2026" is 3 April
              in Dubai and 4 March in California, and nothing in the string resolves it. The filler
              spent five attempts trying to work it out at write time and the honest answer is that
              THE INFORMATION IS NOT IN THE PAGE - the only ways to get it are to guess, or to write
              a date that is not hers and watch. Both were tried; both shipped a wrong date into a
              real application.

              A date input ends the argument at the source: the browser hands back ISO
              (YYYY-MM-DD) whatever the locale shows the student, so storage has known semantics and
              the picker's order stops mattering. The old placeholder made it worse than free text -
              it said "e.g. Summer 2027", inviting a value parseStoredDate cannot resolve, which is
              a guaranteed skip.
            */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="application-start-date" className="text-xs font-medium text-gray-700">Earliest start date (optional)</label>
              <input
                id="application-start-date"
                type="date"
                value={isoForDateInput(appProfile.availability_date)}
                onChange={(e) => setAppProfile((p) => ({ ...p, availability_date: e.target.value }))}
                className={fieldClass}
              />
              {unreadableStoredDate(appProfile.availability_date) ? (
                <p className="text-xs leading-5 text-warning-700">
                  Your saved value ("{unreadableStoredDate(appProfile.availability_date)}") isn't a date we can read, so
                  forms asking when you can start are left for you. Pick a date to fix that.
                </p>
              ) : (
                <p className="text-xs leading-5 text-gray-600">The earliest date you could start.</p>
              )}
            </div>

            {/*
              A separate question from the one above, and the reason it exists: "Length or
              term/length of availability (10-14 weeks)" and "When can you start?" both contain
              "availab", so one field answering both meant a duration question got answered with a
              start time ("Immediately"). Free text, not a date: "14 weeks", "3 months" and "a
              semester" are all real answers and none of them parse.
            */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="application-availability-term" className="text-xs font-medium text-gray-700">How long you are available (optional)</label>
              <input
                id="application-availability-term"
                value={appProfile.availability_term ?? ''}
                onChange={(e) => setAppProfile((p) => ({ ...p, availability_term: e.target.value }))}
                placeholder="e.g. 14 weeks"
                className={fieldClass}
              />
              <p className="text-xs leading-5 text-gray-600">Only for forms that ask how long, not when.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="application-salary" className="text-xs font-medium text-gray-700">Desired salary (optional)</label>
              <input
                id="application-salary"
                value={appProfile.desired_salary ?? ''}
                onChange={(e) => setAppProfile((p) => ({ ...p, desired_salary: e.target.value }))}
                placeholder="Leave blank"
                className={fieldClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="application-date-of-birth" className="text-xs font-medium text-gray-700">Date of birth (optional)</label>
              <input
                id="application-date-of-birth"
                type="date"
                value={isoForDateInput(appProfile.date_of_birth)}
                onChange={(e) => setAppProfile((p) => ({ ...p, date_of_birth: e.target.value }))}
                className={fieldClass}
              />
              {unreadableStoredDate(appProfile.date_of_birth) ? (
                <p className="text-xs leading-5 text-warning-700">
                  Your saved value ("{unreadableStoredDate(appProfile.date_of_birth)}") isn't a date we can read. Pick one
                  to fix that.
                </p>
              ) : (
                <p className="text-xs leading-5 text-gray-600">Only used when a form asks for it.</p>
              )}
            </div>

            <div className="border-y border-gray-200 py-3">
              <button
                type="button"
                onClick={() => setEeoExpanded((v) => !v)}
                aria-expanded={eeoExpanded}
                aria-controls="eeo-fields"
                className="flex min-h-11 w-full items-center justify-between rounded-inner text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <span className="text-xs font-medium text-gray-700">
                  Questions about race and gender <span className="text-gray-600">(optional)</span>
                </span>
                <span className="text-gray-600" aria-hidden="true">{eeoExpanded ? '-' : '+'}</span>
              </button>
              {eeoExpanded && (
                <div id="eeo-fields" className="mt-3 flex animate-fade-in-up flex-col gap-3">
                  {(['gender', 'race', 'disability'] as const).map((field) => (
                    <div key={field} className="flex flex-col gap-1.5">
                      <label htmlFor={`eeo-${field}`} className="text-xs font-medium capitalize text-gray-700">{field}</label>
                      <input
                        id={`eeo-${field}`}
                        value={eeo[field] ?? ''}
                        onChange={(e) => setEeo((p) => ({ ...p, [field]: e.target.value }))}
                        placeholder="Leave blank"
                        className={fieldClass}
                      />
                    </div>
                  ))}
                  <p className="text-xs leading-5 text-gray-600">
                    Leave these blank and Litos picks "I would rather not say" on every application.
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setStep('links')}
              className={`${primaryButtonClass} mt-1 w-full`}
            >
              Continue
            </button>
          </div>
        )}

        {step === 'links' && (
          <div className="flex animate-fade-in-up flex-col gap-4">
            <StepHeader showProgress={firstRun} step={5} total={5} title="Your links" subtitle="Leave anything you do not have blank." />

            {(
              [
                ['phone', 'Phone'],
                ['linkedin_url', 'LinkedIn'],
                ['github_url', 'GitHub'],
                ['portfolio_url', 'Portfolio'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <label htmlFor={`profile-${key}`} className="text-xs font-medium text-gray-700">{label}</label>
                <input
                  id={`profile-${key}`}
                  value={(appProfile[key] as string) ?? ''}
                  onChange={(e) => setAppProfile((p) => ({ ...p, [key]: e.target.value }))}
                  className={fieldClass}
                />
              </div>
            ))}

            <div className="border-y border-gray-200 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-gray-700">Send an application without asking me again</p>
                  <p className="mt-1 text-xs leading-5 text-gray-600">
                    Litos may send applications you start after a countdown you can cancel. It still
                    stops when something is missing, when two answers do not match, when a question is one you have to swear to, when a site checks you are human, and
                    unsupported portal steps.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoSubmit}
                  aria-label="Send an application without asking me again"
                  // Locked until earned, mirroring the dashboard, and NEVER locked while it is on
                  // so the student can always turn it back off from here. Without this the toggle
                  // flipped freely and the save then 403d, which is a worse way to learn the rule.
                  disabled={!automationSettingsLoaded || (!autoSubmit && consentEligibility?.eligible === false)}
                  onClick={() => setAutoSubmit((v) => !v)}
                  className="relative flex h-11 w-12 flex-shrink-0 items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                >
                  <span
                    className={`relative block h-7 w-12 rounded-full transition-colors ${
                      autoSubmit ? 'bg-brand-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-6 w-6 rounded-full border border-gray-200 bg-white transition-transform ${
                        autoSubmit ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </button>
              </div>
            </div>

            <div className="border-b border-gray-200 py-3">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-xs font-medium text-gray-700">Read the code a company emails me</p><p className="mt-1 text-xs leading-5 text-gray-600">Litos can look in the Gmail or Outlook you connected to find a code for an application that is running. Codes are never saved.</p></div>
                <button type="button" role="switch" aria-checked={automaticVerification} aria-label="Read the code a company emails me" disabled={!automationSettingsLoaded} onClick={() => setAutomaticVerification((value) => !value)} className="relative flex h-11 w-12 flex-shrink-0 items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
                  <span className={`relative block h-7 w-12 rounded-full transition-colors ${automaticVerification ? 'bg-brand-600' : 'bg-gray-200'}`}><span className={`absolute top-0.5 h-6 w-6 rounded-full border border-gray-200 bg-white transition-transform ${automaticVerification ? 'translate-x-5' : 'translate-x-0.5'}`} /></span>
                </button>
              </div>
            </div>

            {consentEligibility && !consentEligibility.eligible && !autoSubmit && (
              <p className="-mt-2 text-xs leading-5 text-amber-700">
                Sending without asking is available after you have approved{' '}
                {consentEligibility.required} applications yourself. {consentEligibility.remaining} to
                go. That way you have seen what Litos fills in on a real form before it sends one
                without you.
              </p>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={!automationSettingsLoaded}
              className={`${primaryButtonClass} mt-1 w-full`}
            >
              Save and finish
            </button>

            {/* Sign out lives here, at the end of the settings screen, rather than one mis-click
                away in the header between two navigation items. The confirm is our own two-tap
                control: a native window.confirm was the only piece of OS chrome in the product. */}
            <div className="mt-2 border-t border-gray-200 pt-4">
              {confirmSignOut ? (
                <div className="flex flex-col gap-2" role="group" aria-label="Confirm sign out">
                  <p className="text-sm text-gray-950">Sign out of Litos?</p>
                  <p className="text-xs leading-5 text-gray-600">Your saved answers stay on your account. You will need your email again to get back in.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={onLogout} className={`${secondaryButtonClass} flex-1 border-danger-200 text-danger-700 hover:border-danger-600 hover:bg-danger-50`}>
                      Sign out
                    </button>
                    <button type="button" onClick={() => setConfirmSignOut(false)} className={`${secondaryButtonClass} flex-1`}>
                      Stay signed in
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmSignOut(true)} className="min-h-11 text-sm font-medium text-gray-600 hover:text-gray-950">
                  Sign out
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'saving' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <LoadingSpinner size="md" message="Saving your setup…" />
          </div>
        )}

        {step === 'done' && (
          <div className="flex animate-fade-in-up flex-col gap-4 py-6" role="status" aria-live="polite">
            <div>
              <p className="flex items-center gap-2 text-base font-semibold text-gray-950">
                <StatusDot tone="success" />
                You're set up
              </p>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Next application, Litos will tailor a resume and fill the form for you
                {autoSubmit ? ', then send it after a countdown you can cancel.' : '.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onBack}
              className={`${primaryButtonClass} w-full`}
            >
              Back to Litos
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
