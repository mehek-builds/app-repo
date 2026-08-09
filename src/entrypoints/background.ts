// Token access goes through lib/storage, so the background reads the exact key the popup
// writes, including the backward-compatible fallback to the legacy Volley-era key name.
import {
  clearAll as clearStoredSession,
  abandonPendingPortalAccount,
  activatePendingPortalAccount,
  getPendingPortalAccount,
  getPortalAccount,
  getToken as getStoredToken,
  migrateLegacyStorage,
  setProfile,
  setToken,
  setAutoSubmitEnabled,
  recordPendingPortalAccount,
  currentAuthEpoch,
  authEpochIsCurrent,
  pendingPortalAccountClaimIsCurrent,
} from '../lib/storage';
import { overloadWaitMs, overloadBudgetRemains, RESUME_OVERLOAD_BUDGET_MS } from '../lib/overload';
// Pure salary/posting helpers (R-031). adapters/salary is a LEAF module (types only), so this
// import does not pull the DOM-adjacent adapter graph into the service worker bundle.
import { parseAshbyPostingRef, selectPostingCompensation, type PostingCompensation } from '../lib/adapters/salary';
import { PRODUCT_NAME, type ProductMeta } from '../lib/product';
import type { ApplicationProfile, GeneratedResume, Profile } from '../lib/types';
import {
  ARMED_HANDOFF_KEY,
  armHandoffs,
  claimArmed,
  decideAdoption,
  type AdoptionOutcome,
  type ArmedHandoff,
} from '../lib/web-handoff';
import { automaticSubmissionEnabled, groundedDraftAnswer } from '../lib/auto-submit-consent';
import { backendFetch } from '../lib/backend-fetch';
import { flushAnalyticsQueue, trackExtensionEvent } from '../lib/analytics';
import { clearStall, readStalls, recordStall } from '../lib/captcha-stalls';
import { badgeState } from '../lib/badge';
import { applicantEmailForGeneratedPacket, atsNameForPortalUrl } from '../lib/applicant-email';
import {
  clearPacketApplicantIdentity,
  packetIdentityMatchesCurrentRoute,
  peekPacketApplicantIdentity,
  readPacketApplicantIdentity,
  storePacketApplicantIdentity,
} from '../lib/packet-applicant-identity';

// Latched off once the backend reports onboarding complete. Service-worker memory is fine for
// this: the worst case on a restart is one wasted 403, which re-latches it immediately.
let harvestStopped = false;

type PendingExtensionSubmission = {
  applicationId: string;
  claimId: string;
  startedAt: number;
  frameId: number;
};

const PENDING_SUBMISSIONS_KEY = 'litos_pending_extension_submission';
const PENDING_SUBMISSION_MAX_AGE_MS = 5 * 60_000;

function pendingSubmissionKey(tabId: number): string {
  return `${PENDING_SUBMISSIONS_KEY}:${tabId}`;
}

async function pendingSubmission(tabId: number): Promise<PendingExtensionSubmission | null> {
  const key = pendingSubmissionKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return (stored[key] as PendingExtensionSubmission | undefined) ?? null;
}

async function setPendingSubmission(tabId: number, pending: PendingExtensionSubmission | null) {
  const key = pendingSubmissionKey(tabId);
  if (pending) await chrome.storage.session.set({ [key]: pending });
  else await chrome.storage.session.remove(key);
}

async function postExtensionOutcome(pending: PendingExtensionSubmission, outcome: 'confirmed' | 'failed' | 'unknown' | 'cancelled', finalUrl: string, confirmationText?: string) {
  const token = await getStoredToken();
  if (!token) throw new Error('Sign in to Litos again before updating this application.');
  const response = await timeoutBackendFetch(`/applications/${pending.applicationId}/submission/extension-outcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      claim_id: pending.claimId,
      outcome,
      final_url: finalUrl,
      ...(confirmationText ? { confirmation_text: confirmationText.slice(0, 2000) } : {}),
    }),
  }, token);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Could not update application (${response.status})`);
  }
  void trackExtensionEvent('application_submission_outcome_recorded', { outcome });
  if (outcome === 'confirmed') void trackExtensionEvent('application_submission_completed');
}

async function closePendingSubmission(tabId: number, finalUrl = 'https://trylitos.com') {
  const pending = await pendingSubmission(tabId);
  if (!pending) return;
  try {
    await postExtensionOutcome(pending, 'unknown', finalUrl);
    await setPendingSubmission(tabId, null);
  } catch {
    // Keep the claim in session storage. A later page wake can retry the safe unknown outcome.
  }
}

/**
 * POST what the student typed by hand to /profile/harvest.
 *
 * The server is the authority on every rule that matters here - it refuses work authorization,
 * sponsorship and self-identification with a hard 400, only fills fields that are empty, and 403s
 * once onboarding is done. This function deliberately re-checks none of that: a second copy of
 * those rules in the client is a second thing to drift. Its only job is carrying the token and
 * translating a 403 into "stop asking".
 */
async function harvestFields(fields: unknown): Promise<{ ok: boolean; stop?: boolean; kept?: string[] }> {
  if (harvestStopped) return { ok: false, stop: true };
  const token = await getStoredToken();
  if (!token) return { ok: false };
  try {
    const res = await timeoutBackendFetch('/profile/harvest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }, token);
    if (res.status === 403) {
      harvestStopped = true;
      return { ok: false, stop: true };
    }
    if (!res.ok) {
      // A 400 here means the classifier produced a field the server refuses - i.e. the R-004
      // guard failed somewhere upstream. Loud in the log, because it should be impossible:
      // ProfileKey has no member for any denied field.
      console.warn('[Litos] harvest rejected', res.status, await res.text().catch(() => ''));
      return { ok: false };
    }
    const body = (await res.json().catch(() => null)) as { kept?: string[] } | null;
    return { ok: true, kept: body?.kept ?? [] };
  } catch {
    return { ok: false };
  }
}

// A hung backend must never leave the caller waiting forever - the resume-fill card awaits
// these responses, so an unbounded fetch strands the student on "Tailoring your resume...".
// Resume generation is a real LLM round trip (tens of seconds), so it gets a longer budget
// than the plain JSON endpoints.
const FETCH_TIMEOUT_MS = 20000;
const RESUME_FETCH_TIMEOUT_MS = 60000;
function timeoutFetch(input: string, init: RequestInit = {}, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
}

function timeoutBackendFetch(
  path: string,
  init: RequestInit = {},
  token?: string,
  ms = FETCH_TIMEOUT_MS,
): Promise<Response> {
  return backendFetch(path, init, { token, timeoutMs: ms });
}

type VerifiedWorkdayPacket = {
  userId: string;
  applicationId: string;
  email: string;
  host: string;
  routeFingerprint: string;
};

async function verifyWorkdayPacketForTab(token: string, tabId: number, portalUrl: string): Promise<VerifiedWorkdayPacket | null> {
  const candidate = await peekPacketApplicantIdentity({ tabId, portalUrl });
  if (!candidate) return null;
  const response = await timeoutBackendFetch(`/applications/${candidate.applicationId}/workday-account-identity`, {}, token);
  if (!response.ok) return null;
  const owned = await response.json().catch(() => null) as {
    user_id?: unknown;
    application_id?: unknown;
    email?: unknown;
    portal_host?: unknown;
  } | null;
  if (
    typeof owned?.user_id !== 'string'
    || typeof owned.application_id !== 'string'
    || typeof owned.email !== 'string'
    || typeof owned.portal_host !== 'string'
  ) return null;
  const identity = await readPacketApplicantIdentity({ tabId, portalUrl, userId: owned.user_id });
  if (!identity) return null;
  const expectedHost = new URL(portalUrl).hostname.toLowerCase().replace(/^www\./, '');
  if (
    owned.application_id !== identity.applicationId
    || owned.email.trim().toLowerCase() !== identity.email
    || owned.portal_host.trim().toLowerCase().replace(/^www\./, '') !== expectedHost
  ) return null;
  return {
    userId: owned.user_id.toLowerCase(),
    applicationId: identity.applicationId,
    email: identity.email,
    host: expectedHost,
    routeFingerprint: identity.routeFingerprint,
  };
}

// ─── Website → extension session handover ────────────────────────────────────
// See lib/web-handoff.ts for why this exists at all. Short version: being signed in on
// trylitos.com used to tell the extension nothing, so the one path the product puts a button in
// front of ("Finish this one" on the Home screen) ended at an extension that answered
// "not signed in" while the dashboard sat authenticated in the next tab.

/**
 * The one sentence every "we have no session" branch answers with.
 *
 * It used to be the fragment `not signed in`, which the fill card pasted straight in front of its
 * own sentence and rendered as "not signed in Nothing was attached or submitted." A whole sentence
 * here fixes that at the source for every caller, and says what to do rather than what is missing.
 */
const NOT_SIGNED_IN_MESSAGE = 'You are not signed in to the Litos extension. Open Litos from your browser toolbar and sign in.';

/** What the backend says a token is. null means the backend would not honour it. */
async function accountForToken(token: string): Promise<Profile | null> {
  try {
    const res = await timeoutBackendFetch('/profile', {}, token);
    if (!res.ok) return null;
    return (await res.json()) as Profile;
  } catch {
    return null;
  }
}

async function adoptWebSession(incomingToken: string): Promise<{ ok: boolean; outcome: AdoptionOutcome; error?: string }> {
  const incoming = incomingToken.trim();
  const storedToken = await getStoredToken();
  if (storedToken && storedToken === incoming) return { ok: true, outcome: 'already_signed_in' };

  // The website's token is verified against the backend before it is stored. The origin check
  // upstream says the message came from our own page; only the backend can say the token is real,
  // and storing an unverified one would replace a working session with a broken one.
  const incomingProfile = await accountForToken(incoming);
  const storedProfile = storedToken ? await accountForToken(storedToken) : null;
  const outcome = decideAdoption({
    incomingToken: incoming,
    incomingEmail: incomingProfile?.email ?? null,
    storedToken,
    storedEmail: storedProfile?.email ?? null,
  });

  if (outcome !== 'adopted') {
    return {
      ok: outcome === 'already_signed_in',
      outcome,
      error:
        outcome === 'different_account'
          ? 'The Litos extension is signed in to a different account. Sign out of the extension to switch.'
          : outcome === 'rejected'
            ? 'Litos did not accept that sign-in.'
            : undefined,
    };
  }

  try {
    await setToken(incoming);
    if (incomingProfile) await setProfile(incomingProfile);
    return { ok: true, outcome };
  } catch (error) {
    return { ok: false, outcome: 'rejected', error: error instanceof Error ? error.message : 'Could not save the sign-in.' };
  }
}

async function readArmedHandoffs(): Promise<ArmedHandoff[]> {
  const stored = await chrome.storage.session.get(ARMED_HANDOFF_KEY).catch(() => ({}) as Record<string, unknown>);
  const value = stored?.[ARMED_HANDOFF_KEY];
  return Array.isArray(value) ? (value as ArmedHandoff[]) : [];
}

async function writeArmedHandoffs(entries: ArmedHandoff[]): Promise<void> {
  await chrome.storage.session.set({ [ARMED_HANDOFF_KEY]: entries }).catch(() => {});
}

// ─── Transient model-capacity retry (live QA 2026-07-16, R-003) ──────────────
// A real Anthropic overload incident hard-failed a whole fill: the card said "Failed to generate
// resume spec" and the student's only recovery was re-clicking "Yes, fill it" (6+ times on Global
// Relay, never succeeding while it lasted). It blocked a submission outright.
//
// The retry has to live HERE, on the client, and that is not a stylistic choice. The backend cannot
// retry its way out: Vercel kills the function at 60s (vercel.json maxDuration) and the incident
// needed ~6 attempts over ~2.5 minutes to get a 200. Only a FRESH REQUEST escapes that ceiling, so
// only the client can outlive an incident longer than one function. The backend's job is to say
// which failures are worth coming back for; it now returns 503 + `code: 'llm_overloaded'` for
// exactly those, which is what this loop keys on. Anything else still fails fast: retrying a bad JD
// against a healthy API just reproduces the same error more slowly.
//
// 150s covers the observed incident (the manual poll that eventually got a 200 took ~2.5 min).
// The student is never trapped by it: the card stays dismissable throughout and reports each retry,
// and because generation pre-warms on card hover, most or all of this window is usually spent
// before they ever click "Yes, fill it".
//
// Known risk, deliberately accepted: an MV3 service worker can be torn down mid-loop. The pending
// sendResponse port keeps it alive in practice (and this file already awaits a 60s fetch the same
// way), and content.ts already treats a dead worker as a recoverable error and offers a manual fill,
// so the worst case degrades to today's behavior rather than to a hang.
// The wait policy itself lives in lib/overload.ts, where it can be unit-tested: background.ts can't
// be imported by a test (chrome.* and defineBackground at module load), and a silently-wrong
// backoff is exactly the kind of bug that only shows up during the next incident.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shape returned by GET /profile (the resume-parsed JSON, sent unwrapped by the backend).
// Must satisfy the /draft route's user_profile schema, so we fall back to a valid empty
// profile when the user hasn't uploaded a resume yet (otherwise /draft 400s).
interface UserProfile {
  experience: Array<{ company: string; title: string; start: string; end: string; description: string }>;
  skills: string[];
  school: string;
  grad_year: number;
}

const EMPTY_PROFILE: UserProfile = { experience: [], skills: [], school: '', grad_year: 0 };

// Shape of each item in the /resolve response: { contacts: [{ contact, email_resolution }] }
interface ResolvedContact {
  contact: {
    id: string;
    full_name: string;
    first_name: string;
    last_name: string;
    title: string;
    persona: string;
    school_match: boolean;
    linkedin_url: string;
    company_domain: string;
  };
  email_resolution: {
    id: string;
    email: string;
    status: string;
    tier: string;
    source: string;
    pattern_used: string;
  };
}

async function resolveAndDraft(title: string, company: string, url: string, token: string) {
  // Fetch the user's profile first so we can (a) feed their school into contact
  // resolution for alumni matches and (b) ground the drafts. The backend returns the
  // parsed JSON unwrapped, and 404s when no resume has been uploaded yet.
  const profileRes = await timeoutBackendFetch('/profile', {}, token);
  const userProfile: UserProfile = profileRes.ok ? await profileRes.json() : EMPTY_PROFILE;

  // Resolve contacts
  const resolveRes = await timeoutBackendFetch('/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company,
      role: title,
      domain: company.toLowerCase().replace(/\s+/g, '') + '.com',
      ...(userProfile.school ? { user_school: userProfile.school } : {}),
    }),
  }, token);
  if (!resolveRes.ok) throw new Error('resolve failed');
  const { contacts }: { contacts: ResolvedContact[] } = await resolveRes.json();

  // We verify all sourced contacts but only draft the best two. For a student, reply
  // likelihood (and referral value) matters more than seniority: alumni and near-peers
  // reply far more than busy execs, so a Head of Eng is a poor cold-email target. Rank by
  // that priority and force the two picks to be DIFFERENT personas (e.g. a near-peer for the
  // referral + a recruiter who owns the req), rather than two of whatever sorts first.
  const DRAFT_PRIORITY = ['alumni', 'near_peer', 'recruiter', 'hiring_manager', 'senior_ic'];
  const rank = (persona: string) => {
    const i = DRAFT_PRIORITY.indexOf(persona);
    return i === -1 ? 99 : i;
  };

  const reachable = (contacts ?? [])
    .filter(c => c.email_resolution.tier === 'green' || c.email_resolution.tier === 'amber')
    .sort((a, b) => rank(a.contact.persona) - rank(b.contact.persona));
  if (reachable.length === 0) return [];

  const top = [reachable[0]];
  const second =
    reachable.find(c => c.contact.persona !== reachable[0].contact.persona) ?? reachable[1];
  if (second) top.push(second);

  const drafts = await Promise.all(top.map(async ({ contact, email_resolution }) => {
    const draftRes = await timeoutBackendFetch('/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact: {
          full_name: contact.full_name,
          title: contact.title,
          persona: contact.persona,
          company,
          school_match: contact.school_match,
          linkedin_url: contact.linkedin_url,
        },
        role: title,
        company,
        user_profile: userProfile,
      }),
    }, token);
    if (!draftRes.ok) return null;
    const draft = await draftRes.json();
    return {
      contact: { ...contact, email: email_resolution.email, tier: email_resolution.tier },
      draft,
      job: { company, role: title, url },
    };
  }));

  return drafts.filter(Boolean);
}

// This posting's structured salary range (R-031), when the tab is an Ashby posting whose board
// slug resolves on the public posting API. Ashby's JD extractor always fetched this payload with
// includeCompensation=true and then DROPPED the compensation object on the floor; this is the
// same fetch, keeping only the one slice the salary rule needs. Never fatal and never blocking:
// any failure (non-Ashby URL, 404 slug, malformed payload, timeout) resolves null and the fill
// proceeds exactly as before, with the salary rule on its label/stored-value chain.
async function fetchAshbyPostingCompensation(url: string | undefined): Promise<PostingCompensation | null> {
  if (!url) return null;
  const ref = parseAshbyPostingRef(url);
  if (!ref) return null;
  try {
    const res = await timeoutFetch(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.org)}?includeCompensation=true`,
      { credentials: 'omit' },
    );
    if (!res.ok) return null;
    return selectPostingCompensation(await res.json(), ref.postingId);
  } catch {
    return null;
  }
}

// Fetches everything a client-side autofill adapter needs in one round trip: the resume
// profile (for name/experience), the more-sensitive application profile (Section 4B - phone,
// address, work-auth), and a JD-tailored resume file. Runs in the background script (not the
// content script) because it needs the auth token from chrome.storage.local.
async function generateResumeAndProfile(
  company: string,
  role: string,
  jdText: string,
  token: string,
  portalUrl?: string,
  // Called before each capacity backoff so the caller can tell the student what is happening.
  // "Tailoring your resume..." sitting frozen for two minutes is indistinguishable from a hang, and
  // a student who thinks it hung fills the form by hand or re-clicks (which is what the live
  // incident produced). Optional: a caller that has nowhere to show it still gets the retry.
  onOverloadRetry?: (attempt: number, waitMs: number) => void,
) {
  // The two profile fetches are independent, so run them together instead of one-after-another -
  // this is on the pre-warm critical path, so a saved round trip is a saved round trip.
  const [profileRes, appProfileRes] = await Promise.all([
    timeoutBackendFetch('/profile', {}, token),
    timeoutBackendFetch('/profile/application', {}, token),
  ]);
  const profile: UserProfile & { full_name?: string; email?: string } = profileRes.ok ? await profileRes.json() : EMPTY_PROFILE;
  const applicationProfile: ApplicationProfile = appProfileRes.ok ? await appProfileRes.json() : {};

  // Only the resume POST retries. The profile reads above are cheap, already done, and unaffected
  // by a model overload; re-running them per attempt would add round trips to a backend that is
  // already telling us it is busy.
  const overloadDeadline = Date.now() + RESUME_OVERLOAD_BUDGET_MS;
  let resume: GeneratedResume | undefined;
  for (let attempt = 1; ; attempt++) {
    const resumeRes = await timeoutBackendFetch('/resume/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company,
        role,
        jd_text: jdText,
        contact: {
          full_name: profile.full_name || 'Applicant',
          email: profile.email,
          linkedin_url: applicationProfile.linkedin_url,
          github_url: applicationProfile.github_url,
          portfolio_url: applicationProfile.portfolio_url,
          phone: applicationProfile.phone,
        },
        ...(portalUrl ? {
          application: {
            portal_url: portalUrl,
            ats_name: atsNameForPortalUrl(portalUrl),
          },
        } : {}),
      }),
    }, token, RESUME_FETCH_TIMEOUT_MS);

    if (resumeRes.ok) {
      resume = await resumeRes.json();
      break;
    }

    const body: { error?: string; detail?: string[]; code?: string; retry_after_ms?: number } | null =
      await resumeRes.json().catch(() => null);

    // The one retryable case, and it is retryable only because the SERVER said so. Keying on the
    // explicit code rather than the bare 503 matters: the route returns 503 for "taking too long"
    // as well, which is a budget failure that retrying identically would just reproduce.
    const overloaded = resumeRes.status === 503 && body?.code === 'llm_overloaded';
    if (overloaded && overloadBudgetRemains(overloadDeadline)) {
      const waitMs = overloadWaitMs(body?.retry_after_ms);
      onOverloadRetry?.(attempt, waitMs);
      await sleep(waitMs);
      continue;
    }

    const message = body?.detail?.length ? `${body.error}: ${body.detail.join(', ')}` : body?.error;
    if (overloaded) {
      // Budget spent on a still-ongoing incident. Say what actually happened rather than the
      // generic failure: this is a capacity problem that will pass, not a broken resume, and the
      // student should know re-clicking later is worth it.
      throw new Error('The model stayed busy for too long. Try "Yes, fill it" again in a minute, or fill this one manually.');
    }
    throw new Error(message || 'resume generation failed');
  }

  return { profile, applicationProfile, resume };
}


/**
 * The single badge writer. Every source of badge state is read here and the priority decision lives
 * in the pure badgeState(); nothing else in this file may call chrome.action.setBadgeText.
 */
async function renderBadge(): Promise<void> {
  const [stalls, session] = await Promise.all([
    readStalls().catch(() => []),
    chrome.storage.session.get(['pendingDrafts', 'lastDetectedJob']).catch(() => ({} as Record<string, unknown>)),
  ]);
  const drafts = Array.isArray(session?.pendingDrafts) ? session.pendingDrafts.length : 0;
  const state = badgeState({ stalls: stalls.length, drafts, jobDetected: Boolean(session?.lastDetectedJob) });
  chrome.action.setBadgeText({ text: state.text });
  if (state.color) chrome.action.setBadgeBackgroundColor({ color: state.color });
}

export default defineBackground(() => {
  // Retry privacy-sanitized events that were queued through a prior offline or interrupted wake.
  void flushAnalyticsQueue();
  chrome.tabs.onRemoved.addListener((tabId) => {
    closePendingSubmission(tabId).catch(() => {});
  });
  // One-time copy of any legacy Volley-era storage keys to their new litos_* names, so a
  // published update never orphans an existing user's saved token/profile/settings.
  void migrateLegacyStorage();

  // Cache the backend-owned public contract for this service-worker session.
  // Static fallbacks keep the extension usable offline; the live contract lets
  // future releases add compatibility gates without another naming migration.
  void timeoutBackendFetch('/v1/meta')
    .then(async (res) => {
      if (!res.ok) return;
      const meta = (await res.json()) as ProductMeta;
      if (meta.product.name !== PRODUCT_NAME) {
        console.warn(`[${PRODUCT_NAME}] backend product contract mismatch`);
      }
      await chrome.storage.session.set({ litos_product_meta: meta });
    })
    .catch(() => {});

  // QA/dev bootstrap: when built with VITE_QA_TOKEN, seed the session once at install/reload so
  // the extension is signed in without driving the popup UI (which automation can't reach).
  // Seeding on onInstalled (not on every service-worker wake) means sign-out tests and the
  // auto-submit toggle hold their state for the rest of the QA run. Keeping it out of store
  // builds is enforced by scripts/ensure-no-qa-token.mjs, which the zip scripts run first.
  // OUTSIDE the QA gate below, deliberately. A stall outlives the service worker, so the badge has
  // to be restored when it wakes, and that matters most in exactly the builds real users run. An
  // earlier version of this sat inside the VITE_QA_TOKEN block, which ensure-no-qa-token.mjs
  // guarantees is false in every shippable build - so the fix was live only where it was not needed.
  void renderBadge();
  chrome.runtime.onStartup?.addListener(() => { void renderBadge(); });

  if (import.meta.env.VITE_QA_TOKEN) {
    chrome.runtime.onInstalled.addListener(() => {
      setToken(import.meta.env.VITE_QA_TOKEN)
        .then(() => setAutoSubmitEnabled(import.meta.env.VITE_QA_AUTOSUBMIT === '1'))
        .catch((e) => console.warn('[Litos QA] storage seed failed:', e));
    });
  }

  let lastDetectedJob: { title: string; company: string; url: string } | null = null;

  chrome.storage.session.get('lastDetectedJob').then((result) => {
    if (result.lastDetectedJob) lastDetectedJob = result.lastDetectedJob as { title: string; company: string; url: string };
  }).catch(() => {});

  // IMPORTANT: only return true for branches that call sendResponse asynchronously.
  // Returning true from a fire-and-forget handler (or a blanket return at the end) leaves
  // the message channel open with no response coming, which surfaces in the sender (the
  // popup) as "A listener indicated an asynchronous response... but the message channel
  // closed before a response was received" once the popup unmounts.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'JOB_DETECTED': {
        // Idempotent: content scripts (notably the Workday stage poll) can re-fire this for the
        // same job repeatedly. Skip the storage write, badge update, and popup broadcast when the
        // payload is unchanged, so a re-detect of the same posting isn't a write/message storm.
        const p = message.payload as { title: string; company: string; url: string };
        const unchanged =
          lastDetectedJob &&
          lastDetectedJob.title === p.title &&
          lastDetectedJob.company === p.company &&
          lastDetectedJob.url === p.url;
        if (unchanged) return false;
        lastDetectedJob = p;
        chrome.storage.session.set({ lastDetectedJob }).then(() => renderBadge()).catch(() => {});
        chrome.runtime.sendMessage(message).catch(() => {});
        void trackExtensionEvent('job_detected');
        return false;
      }

      case 'ANALYTICS_EVENT': {
        void trackExtensionEvent(message.event, message.properties);
        return false;
      }

      case 'GET_LAST_JOB': {
        sendResponse({ job: lastDetectedJob }); // synchronous response
        return false;
      }

      case 'GET_AUTOMATION_SETTINGS': {
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ automatic_submission_enabled: false, automatic_verification_enabled: false, automatic_captcha_enabled: false });
            return;
          }
          try {
            const res = await timeoutBackendFetch('/onboarding/state', {}, token);
            if (!res.ok) throw new Error(`settings failed (${res.status})`);
            const data: {
              automatic_submission_enabled?: boolean;
              automatic_verification_enabled?: boolean;
              automatic_captcha_enabled?: boolean;
            } = await res.json();
            const automaticSubmission = automaticSubmissionEnabled(data);
            await setAutoSubmitEnabled(automaticSubmission);
            sendResponse({
              automatic_submission_enabled: automaticSubmission,
              automatic_verification_enabled: data.automatic_verification_enabled === true,
              // Already version-checked by the backend. The extension deliberately does not
              // re-derive that rule; a second implementation of a consent check is a second thing
              // that can be wrong about consent.
              automatic_captcha_enabled: data.automatic_captcha_enabled === true,
            });
          } catch {
            // A failed revocation check is a hold, never permission to submit from stale storage.
            sendResponse({ automatic_submission_enabled: false, automatic_verification_enabled: false, automatic_captcha_enabled: false });
          }
        });
        return true;
      }

      case 'EXTENSION_SUBMISSION_START': {
        Promise.all([getStoredToken(), Promise.resolve(sender.tab?.id)])
          .then(async ([token, tabId]) => {
            if (!token || tabId === undefined) throw new Error('Litos could not identify this application tab.');
            const applicationId = String(message.payload?.applicationId ?? '');
            const authorization = message.payload?.authorization === 'user_initiated'
              ? 'user_initiated'
              : 'standing_consent';
            const response = await timeoutBackendFetch(`/applications/${applicationId}/submission/extension-start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ authorization }),
            }, token);
            const body = await response.json().catch(() => null) as { claim_id?: string; error?: string; already_submitted?: boolean } | null;
            if (!response.ok || !body?.claim_id) throw new Error(body?.error ?? 'Litos could not reserve this application.');
            const pending = { applicationId, claimId: body.claim_id, startedAt: Date.now(), frameId: sender.frameId ?? 0 };
            await setPendingSubmission(tabId, pending);
            void trackExtensionEvent('application_submission_requested', { authorization });
            sendResponse({ ok: true, claimId: body.claim_id });
          })
          .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Submission could not start.' }));
        return true;
      }

      case 'EXTENSION_SUBMISSION_OUTCOME': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          sendResponse({ ok: false, error: 'Litos could not identify this application tab.' });
          return false;
        }
        pendingSubmission(tabId).then(async (pending) => {
          if (!pending || pending.applicationId !== String(message.payload?.applicationId ?? '')) {
            throw new Error('This application is no longer waiting for a confirmation.');
          }
          if (pending.frameId !== (sender.frameId ?? 0)) throw new Error('This confirmation came from a different page frame.');
          if (Date.now() - pending.startedAt > PENDING_SUBMISSION_MAX_AGE_MS) {
            await postExtensionOutcome(pending, 'unknown', String(sender.tab?.url ?? 'https://trylitos.com'));
            await setPendingSubmission(tabId, null);
            sendResponse({ ok: false, error: 'The confirmation window expired. Check the employer portal.' });
            return;
          }
          await postExtensionOutcome(
            pending,
            message.payload?.outcome === 'confirmed'
              ? 'confirmed'
              : message.payload?.outcome === 'failed'
                ? 'failed'
                : message.payload?.outcome === 'cancelled'
                  ? 'cancelled'
                  : 'unknown',
            String(message.payload?.finalUrl ?? sender.tab?.url ?? 'https://trylitos.com'),
            typeof message.payload?.confirmationText === 'string' ? message.payload.confirmationText : undefined,
          );
          await setPendingSubmission(tabId, null);
          sendResponse({ ok: true });
        }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Could not record the outcome.' }));
        return true;
      }

      case 'GET_PENDING_EXTENSION_SUBMISSION': {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          sendResponse({ pending: null });
          return false;
        }
        pendingSubmission(tabId).then((pending) => {
          if (pending && Date.now() - pending.startedAt > PENDING_SUBMISSION_MAX_AGE_MS) {
            closePendingSubmission(tabId, String(sender.tab?.url ?? 'https://trylitos.com'))
              .finally(() => sendResponse({ pending: null }));
            return;
          }
          sendResponse({ pending: pending?.frameId === (sender.frameId ?? 0) ? pending : null });
        });
        return true;
      }

      case 'CLEAR_JOB_BADGE': {
        lastDetectedJob = null;
        // Clears the JOB signal only. Clearing the badge outright here is what let an unrelated
        // dismissal erase a stall count that nothing would have restored.
        chrome.storage.session.remove('lastDetectedJob').then(() => renderBadge()).catch(() => {});
        return false;
      }

      case 'GET_PENDING_DRAFTS': {
        chrome.storage.session.get('pendingDrafts').then((r) => {
          sendResponse({ drafts: r.pendingDrafts ?? [] });
        });
        return true; // responding asynchronously - keep the channel open
      }

      case 'CLEAR_PENDING_DRAFTS': {
        chrome.storage.session.remove('pendingDrafts').then(() => renderBadge()).catch(() => {});
        return false;
      }

      case 'JOB_APPROVED': {
        const { title, company, url } = message.payload;
        getStoredToken().then(async (token) => {
          if (!token) return;
          try {
            const drafts = await resolveAndDraft(title, company, url, token);
            if (drafts.length > 0) {
              await chrome.storage.session.set({ pendingDrafts: drafts });
              await renderBadge();
              // Notify popup if open
              chrome.runtime.sendMessage({ type: 'DRAFTS_READY', payload: { count: drafts.length } }).catch(() => {});
              void trackExtensionEvent('outreach_draft_created', { draft_count: drafts.length });
            }
          } catch {
            // silently fail - user can still use the popup manually
          }
        });
        return false;
      }

      case 'GENERATE_RESUME_AND_FILL_DATA': {
        // `url` is the sending tab's posting URL, used only to fetch Ashby's structured
        // compensation range (R-031). Older callers that omit it just get no payload.
        const { company, role, jd_text, url } = message.payload;
        // The card lives in the sending tab, so a capacity-retry notice has to go back to that tab
        // specifically: chrome.runtime.sendMessage from the background reaches the popup, never a
        // content script (that is why DRAFTS_READY works but this would not). Best-effort by
        // design - a closed tab or a card already dismissed just means nobody is listening, which
        // must never take down the generation itself.
        const tabId = sender.tab?.id;
        const notifyRetry = (attempt: number, waitMs: number) => {
          if (tabId === undefined) return;
          chrome.tabs
            .sendMessage(tabId, { type: 'RESUME_GEN_RETRYING', payload: { company, role, attempt, waitMs } })
            .catch(() => {});
        };
        const requestAuthEpoch = currentAuthEpoch();
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            if (tabId !== undefined) await clearPacketApplicantIdentity(tabId);
            // Started alongside the (much slower) resume generation, awaited only at the end;
            // internally caught, so a compensation miss can never sink the fill data.
            const compensationPromise = fetchAshbyPostingCompensation(url);
            const result = await generateResumeAndProfile(company, role, jd_text, token, url, notifyRetry);
            if (!result.resume || !result.profile) {
              throw new Error('Litos did not return a complete application packet. Nothing was filled. Try again.');
            }
            const packetEmail = applicantEmailForGeneratedPacket(result.resume, result.profile.email);
            const applicationId = result.resume.application?.id;
            if (!packetEmail || !applicationId || tabId === undefined || typeof url !== 'string') {
              throw new Error('Litos could not preserve one email across this application, so nothing was filled. Try again.');
            }
            const routeResponse = await timeoutBackendFetch('/application-email', {}, token);
            const route = routeResponse.ok
              ? await routeResponse.json().catch(() => null) as {
                tracking_active?: unknown;
                domain?: unknown;
                route_generation_fingerprint?: unknown;
              } | null
              : null;
            const routeFingerprint = route?.route_generation_fingerprint;
            if (
              typeof routeFingerprint !== 'string'
              || !packetIdentityMatchesCurrentRoute({
                applicationId,
                email: packetEmail,
                routeFingerprint,
              }, route ?? {})
            ) {
              throw new Error('Litos could not verify the current application email route, so nothing was filled. Try again.');
            }
            if (atsNameForPortalUrl(url) === 'workday') {
              const ownedResponse = await timeoutBackendFetch(`/applications/${applicationId}/workday-account-identity`, {}, token);
              const owned = ownedResponse.ok
                ? await ownedResponse.json().catch(() => null) as { user_id?: unknown; application_id?: unknown; email?: unknown; portal_host?: unknown } | null
                : null;
              const portalHost = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
              if (
                typeof owned?.user_id !== 'string'
                || owned.application_id !== applicationId
                || typeof owned.email !== 'string'
                || owned.email.trim().toLowerCase() !== packetEmail.trim().toLowerCase()
                || owned.portal_host !== portalHost
              ) {
                throw new Error('Litos could not verify that this application packet belongs to the signed-in account. Nothing was filled.');
              }
              await storePacketApplicantIdentity({
                tabId,
                userId: owned.user_id,
                applicationId,
                email: packetEmail,
                portalUrl: url,
                routeFingerprint,
                expectedAuthEpoch: requestAuthEpoch,
              });
            }
            void trackExtensionEvent('application_generation_completed');
            sendResponse({ ...result, posting_compensation: await compensationPromise });
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : 'resume generation failed' });
          }
        });
        return true; // responding asynchronously
      }

      case 'ANSWER_QUESTION': {
        // Drafts one open-ended application answer from the backend. The generic adapter calls
        // this per textarea; the field it fills is flagged for review, so this is a first draft
        // in the student's voice, never a silent final answer.
        const { company, role, jd_text, question } = message.payload;
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            const res = await timeoutBackendFetch('/application/answer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ company, role, jd_text, question }),
            }, token, RESUME_FETCH_TIMEOUT_MS);
            if (!res.ok) {
              sendResponse({ error: `draft failed (${res.status})` });
              return;
            }
            const data: unknown = await res.json();
            sendResponse({ answer: groundedDraftAnswer(data) });
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : 'draft failed' });
          }
        });
        return true; // responding asynchronously
      }

      case 'GET_ACCOUNT_CREATION_DATA': {
        // Lighter than GENERATE_RESUME_AND_FILL_DATA - the Workday signup screen only needs the
        // account email, not a resume, so this skips the /resume/generate call entirely (no
        // point spending a resume-gen quota unit on a step before there's even an application to
        // tailor one for). Password is deliberately not fetched here - the student types their
        // own (2026-07-03 product decision), Litos never touches that field.
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          try {
            const tabId = sender.tab?.id;
            const portalUrl = sender.tab?.url;
            const identity = tabId === undefined || !portalUrl
              ? null
              : await verifyWorkdayPacketForTab(token, tabId, portalUrl);
            if (!identity) {
              sendResponse({ error: 'Litos has not prepared this application email yet. Return to the job page and prepare the application first.' });
              return;
            }
            const routeResponse = await timeoutBackendFetch('/application-email', {}, token);
            const route = routeResponse.ok
              ? await routeResponse.json().catch(() => null) as {
                tracking_active?: unknown;
                domain?: unknown;
                route_generation_fingerprint?: unknown;
              } | null
              : null;
            if (!route || !packetIdentityMatchesCurrentRoute(identity, route)) {
              sendResponse({ error: 'The Litos application email route changed after this application was prepared. Regenerate it before creating the employer account.' });
              return;
            }
            sendResponse({ email: identity.email, applicationId: identity.applicationId });
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : 'could not load account data' });
          }
        });
        return true;
      }

      case 'GET_WORKDAY_ACCOUNT_STATE':
      case 'CLAIM_WORKDAY_ACCOUNT':
      case 'VALIDATE_WORKDAY_ACCOUNT_ACTION':
      case 'ABANDON_WORKDAY_ACCOUNT_CLAIM':
      case 'ACTIVATE_WORKDAY_ACCOUNT': {
        const operationAuthEpoch = currentAuthEpoch();
        getStoredToken().then(async (token) => {
          if (!token) throw new Error(NOT_SIGNED_IN_MESSAGE);
          const tabId = sender.tab?.id;
          const portalUrl = sender.tab?.url;
          if (tabId === undefined || !portalUrl) throw new Error('The Workday account tab is unavailable.');
          const identity = await verifyWorkdayPacketForTab(token, tabId, portalUrl);
          if (!identity) throw new Error('The Workday account identity does not belong to the signed-in Litos account.');
          const { userId, host, email, applicationId } = identity;
          const requestedHost = String(message.payload?.host ?? '').trim().toLowerCase().replace(/^www\./, '');
          if (requestedHost && requestedHost !== host) throw new Error('The Workday account identity is invalid.');

          if (message.type === 'GET_WORKDAY_ACCOUNT_STATE') {
            const [active, pending] = await Promise.all([
              getPortalAccount(userId, host, applicationId, email),
              getPendingPortalAccount(userId, host, applicationId, email),
            ]);
            sendResponse({ active, pending, authEpoch: operationAuthEpoch });
            return;
          }
          if (message.type === 'VALIDATE_WORKDAY_ACCOUNT_ACTION') {
            const claimedEpoch = Number(message.payload?.authEpoch);
            const action = message.payload?.action === 'sign_in' ? 'sign_in' : 'create';
            const valid = claimedEpoch === operationAuthEpoch
              && authEpochIsCurrent(claimedEpoch)
              && (action === 'create'
                ? await pendingPortalAccountClaimIsCurrent(claimedEpoch, userId, host, applicationId, email)
                : Boolean(await getPortalAccount(userId, host, applicationId, email)));
            sendResponse({ valid });
            return;
          }
          if (message.type === 'CLAIM_WORKDAY_ACCOUNT') {
            const saltFingerprint = String(message.payload?.saltFingerprint ?? '');
            const requestedAt = Number(message.payload?.requestedAt);
            if (!saltFingerprint || !Number.isFinite(requestedAt)) throw new Error('The Workday account claim is incomplete.');
            const claimed = await recordPendingPortalAccount(
              { userId, host, email, applicationId, saltFingerprint, requestedAt },
              operationAuthEpoch,
            );
            sendResponse({ claimed, ...(claimed ? { authEpoch: operationAuthEpoch } : {}) });
            return;
          }
          if (message.type === 'ABANDON_WORKDAY_ACCOUNT_CLAIM') {
            sendResponse({ abandoned: await abandonPendingPortalAccount(userId, host, email, applicationId) });
            return;
          }
          sendResponse({ activated: await activatePendingPortalAccount(userId, host, email, applicationId) });
        }).catch((error) => sendResponse({
          error: error instanceof Error ? error.message : 'The Workday account operation failed.',
        }));
        return true;
      }

      case 'GET_WORKDAY_VERIFICATION_CODE': {
        getStoredToken().then(async (token) => {
          if (!token) {
            sendResponse({ error: NOT_SIGNED_IN_MESSAGE });
            return;
          }
          const tabId = sender.tab?.id;
          const portalUrl = sender.tab?.url;
          const identity = tabId === undefined || !portalUrl ? null : await verifyWorkdayPacketForTab(token, tabId, portalUrl);
          if (!identity) {
            sendResponse({ error: 'The Workday verification session is incomplete.' });
            return;
          }
          const pending = await getPendingPortalAccount(identity.userId, identity.host, identity.applicationId, identity.email);
          if (!pending) {
            sendResponse({ error: 'The Workday verification session is no longer active.' });
            return;
          }
          const applicationId = identity.applicationId;
          const requestedAt = new Date(pending.requestedAt).toISOString();
          try {
            for (let attempt = 0; attempt < 10; attempt += 1) {
              const response = await timeoutBackendFetch(`/applications/${applicationId}/workday-verification-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requested_at: requestedAt }),
              }, token);
              const body = await response.json().catch(() => null) as { status?: unknown; code?: unknown; provider?: unknown; error?: unknown } | null;
              if (response.ok && body?.status === 'ready' && typeof body.code === 'string') {
                sendResponse({ code: body.code, provider: body.provider });
                return;
              }
              if (response.status !== 202) {
                sendResponse({ error: typeof body?.error === 'string' ? body.error : 'Could not read the Workday verification email.' });
                return;
              }
              if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 3_000));
            }
            sendResponse({ error: 'The Workday verification email has not arrived yet. Try again when it does.' });
          } catch (err) {
            sendResponse({ error: err instanceof Error ? err.message : 'Could not read the Workday verification email.' });
          }
        });
        return true;
      }

      case 'CAPTCHA_STALL': {
        // Recorded locally, for the applicant. A human-verification check asks whether the person
        // in THIS session is human, so it can only be answered here, by them - there is nothing to
        // forward and nobody to forward it to.
        void recordStall({
          // The tab is the durable identity. A submission redirects to a confirmation page on a
          // different path, and the stall is cleared from THAT document, so a URL-keyed clear never
          // matches and the count only ever grows.
          tabId: sender.tab?.id,
          url: message.payload?.url ?? '',
          company: message.payload?.job_context?.company ?? '',
          role: message.payload?.job_context?.role ?? '',
          provider: message.payload?.provider ?? 'unknown',
          atsName: message.payload?.ats_name,
          stalledAt: message.payload?.stalled_at ?? new Date().toISOString(),
        }).then(() => renderBadge()).catch(() => {});
        return false;
      }

      case 'CAPTCHA_STALL_RESOLVED': {
        // The application went through, so it is no longer waiting on anyone. Without this the
        // count only ever grows and the badge becomes a number people learn to ignore.
        clearStall({ tabId: sender.tab?.id, url: message.payload?.url ?? '' })
          .then(() => renderBadge())
          .catch(() => {});
        return false;
      }

      case 'AUTOFILL_EVENT': {
        void trackExtensionEvent('application_fill_completed', message.payload);
        getStoredToken().then((token) => {
          if (!token) return;
          timeoutBackendFetch('/autofill/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.payload),
          }, token).catch(() => {});
        });
        return false;
      }

      case 'APPLICATION_REVIEW_READY': {
        const tabId = sender.tab?.id;
        getStoredToken().then(async (token) => {
          if (!token || tabId === undefined) {
            sendResponse({ error: 'The application tab is no longer available.' });
            return;
          }
          const payload = message.payload as {
            applicationId: string;
            atsName: string;
            portalUrl: string;
            questions: Array<{ id: string; question: string; answer: string; kind: 'essay' | 'required'; required: boolean }>;
            skippedReasons: string[];
          };
          try {
            const res = await timeoutBackendFetch(`/applications/${payload.applicationId}/review`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ats_name: payload.atsName,
                portal_url: payload.portalUrl,
                questions: payload.questions,
                skipped_reasons: payload.skippedReasons,
              }),
            }, token);
            if (!res.ok) throw new Error(`review handoff failed (${res.status})`);
            const stored = await chrome.storage.session.get('litos_application_tabs');
            const tabs = (stored.litos_application_tabs ?? {}) as Record<string, number | { tabId: number; frameId: number }>;
            await chrome.storage.session.set({
              litos_application_tabs: { ...tabs, [payload.applicationId]: { tabId, frameId: sender.frameId ?? 0 } },
            });
            await chrome.tabs.create({
              url: `https://trylitos.com/dashboard/applications?application=${encodeURIComponent(payload.applicationId)}`,
              active: true,
            });
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({ error: error instanceof Error ? error.message : 'Could not prepare dashboard review.' });
          }
        });
        return true;
      }

      // Fields the student typed by hand into a real application during onboarding. The content
      // script has no token and no host_permissions, so every write goes through here.
      //
      // Answers { stop: true } when the backend says harvest is over (403 = onboarding complete),
      // which latches the content script off for the page's lifetime. Without that the extension
      // would keep POSTing into a 403 on every keystroke of every application, forever.
      case 'HARVEST_FIELDS': {
        harvestFields(message.fields).then(sendResponse);
        return true; // async: see the convention note above - only async branches return true.
      }

      // "Did the applicant arrive here by clicking Finish this one?" Answered once and then
      // forgotten (claimArmed removes the entry), so a later visit to the same posting is an
      // ordinary visit and the card asks before touching anything.
      case 'CLAIM_HANDOFF': {
        // Two candidates, because the content script runs in all frames and the frame that finds
        // the form is often not the page the applicant navigated to (Greenhouse and Workday both
        // embed the application in a cross-origin iframe, where location.href is the ATS's url and
        // the employer's is unreachable from script). The sender's TAB url is the one the dashboard
        // armed, and only the background can see it.
        const candidates = [
          typeof message.url === 'string' ? message.url : '',
          sender.tab?.url ?? '',
        ].filter(Boolean);
        readArmedHandoffs()
          .then(async (entries) => {
            let pool = entries;
            let hit: ReturnType<typeof claimArmed>['claimed'] = null;
            for (const candidate of candidates) {
              const { claimed, remaining } = claimArmed(pool, candidate, Date.now());
              pool = remaining;
              if (claimed) {
                hit = claimed;
                break;
              }
            }
            if (pool.length !== entries.length) await writeArmedHandoffs(pool);
            sendResponse({ armed: Boolean(hit), applicationId: hit?.applicationId });
          })
          .catch(() => sendResponse({ armed: false }));
        return true;
      }

      default:
        return false;
    }
  });

  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    const origin = (() => {
      try {
        return sender.url ? new URL(sender.url).origin : '';
      } catch {
        return '';
      }
    })();
    const allowed =
      origin === 'https://trylitos.com' ||
      origin === 'https://www.trylitos.com' ||
      origin === 'https://role-quick-website.vercel.app' ||
      /^http:\/\/localhost(?::\d+)?$/.test(origin);
    if (!allowed) {
      sendResponse({ error: 'This page is not allowed to control Litos.' });
      return false;
    }
    if (message?.type === 'LITOS_PING') {
      // `signedIn` is the whole point of the ping now: the website cannot see chrome.storage, so
      // without an answer here it has no way to know the extension is sitting there logged out.
      getStoredToken()
        .then((token) => sendResponse({ ok: true, signedIn: Boolean(token) }))
        .catch(() => sendResponse({ ok: true, signedIn: false }));
      return true;
    }

    if (message?.type === 'LITOS_ADOPT_SESSION') {
      const token = typeof message.token === 'string' ? message.token : '';
      if (!token.trim()) {
        sendResponse({ ok: false, outcome: 'rejected', error: 'No sign-in was sent.' });
        return false;
      }
      adoptWebSession(token)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({ ok: false, outcome: 'rejected', error: error instanceof Error ? error.message : 'Could not sign in.' }),
        );
      return true;
    }

    if (message?.type === 'LITOS_CLEAR_SESSION') {
      // Signing out on the website signs out the extension. One product, one account: the
      // alternative is an extension quietly applying as whoever was signed in last week.
      clearStoredSession()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, error: 'Litos could not clear the extension session. Nothing changed in the popup.' }));
      return true;
    }

    if (message?.type === 'LITOS_ARM_HANDOFF') {
      const items: unknown[] = Array.isArray(message.applications) ? message.applications : [];
      const incoming = items
        .map((item) => item as { url?: unknown; applicationId?: unknown })
        .filter((item) => typeof item?.url === 'string')
        .map((item) => ({
          url: item.url as string,
          applicationId: typeof item.applicationId === 'string' ? item.applicationId : undefined,
        }));
      readArmedHandoffs()
        .then(async (existing) => {
          const next = armHandoffs(existing, incoming, Date.now());
          await writeArmedHandoffs(next);
          sendResponse({ ok: true, armed: next.length });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message?.type !== 'LITOS_SUBMIT_APPLICATION') return false;

    const applicationId = String(message.applicationId ?? '');
    const questions = Array.isArray(message.questions) ? message.questions : [];
    Promise.all([getStoredToken(), chrome.storage.session.get('litos_application_tabs')])
      .then(async ([token, stored]) => {
        const storedTarget = ((stored.litos_application_tabs ?? {}) as Record<string, number | { tabId: number; frameId: number }>)[applicationId];
        const tabId = typeof storedTarget === 'number' ? storedTarget : storedTarget?.tabId;
        const frameId = typeof storedTarget === 'number' ? 0 : storedTarget?.frameId ?? 0;
        if (!token || tabId === undefined) throw new Error('That tab is no longer open. Go back to the job and start it again.');
        const startResponse = await timeoutBackendFetch(`/applications/${applicationId}/submission/extension-start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authorization: 'user_initiated' }),
        }, token);
        const started = await startResponse.json().catch(() => null) as { claim_id?: string; error?: string } | null;
        if (!startResponse.ok || !started?.claim_id) throw new Error(started?.error ?? 'Could not reserve this application.');
        const pending = { applicationId, claimId: started.claim_id, startedAt: Date.now(), frameId };
        await setPendingSubmission(tabId, pending);
        try {
          const result = await chrome.tabs.sendMessage(tabId, {
            type: 'SUBMIT_FROM_DASHBOARD',
            payload: { applicationId, questions },
          }, { frameId }) as { ok?: boolean; clicked?: boolean; error?: string; finalUrl?: string; confirmationText?: string };
          await postExtensionOutcome(
            pending,
            result?.ok ? 'confirmed' : result?.clicked ? 'unknown' : 'cancelled',
            result?.finalUrl ?? sender.url ?? 'https://trylitos.com',
            result?.confirmationText ?? result?.error,
          );
          await setPendingSubmission(tabId, null);
          if (!result?.ok) {
            sendResponse({ error: result?.error ?? 'The company never confirmed it arrived.' });
            return;
          }
          sendResponse({ ok: true });
        } catch (error) {
          try {
            await postExtensionOutcome(pending, 'unknown', sender.url ?? 'https://trylitos.com');
            await setPendingSubmission(tabId, null);
          } catch {
            // Retain the pending claim so a later tab wake can safely reconcile it.
          }
          throw error;
        }
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : 'Submission failed.' }));
    return true;
  });
});
