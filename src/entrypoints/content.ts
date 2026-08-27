import { isLeverApplicationPage, extractLeverJdText, fillLeverApplication } from '../lib/adapters/lever';
import { isGreenhouseApplicationPage, extractGreenhouseJdText, fillGreenhouseApplication } from '../lib/adapters/greenhouse';
import { isAshbyApplicationPage, extractAshbyJdText, fillAshbyApplication } from '../lib/adapters/ashby';
import {
  isWorkdayApplicationPage, extractWorkdayJdText, fillWorkdayApplication,
  isWorkdayAccountCreationPage, fillWorkdayAccountCreation, isWorkdayCreateAccountStage,
  isWorkdayStartScreen, findApplyManuallyButton,
} from '../lib/adapters/workday';
import { isLinkedInApplicationPage, extractLinkedInJdText, fillLinkedInApplication } from '../lib/adapters/linkedin';
import { isLikelyApplicationForm, extractGenericJdText, getGenericJobDetails, fillGenericApplication, drainR030CandidateLabels, isPerApplicationDecisionQuestion } from '../lib/adapters/generic';
import { atsCanAutoSubmit, clickAtsSubmitIfAllowed, clickDashboardSubmitIfAllowed, isAtsApplicationPage, extractAtsJdText, fillAtsApplication, gatedPortalNotice, specForCurrentPage } from '../lib/adapters/ats-2026-07';
import { PendingSubmissionRecoveryGate } from '../lib/submission-recovery';
import { COLOR, DISMISS_MS, FONT, OVERLAY, RADIUS, SHADOW, markSvg } from '../styles/tokens';

/* Status icons drawn as SVG.
 *
 * These were `iconEl.textContent = '✓' / '!' / '?'`, so they inherited the employer page's
 * font stack and rendered as three different glyph designs across macOS, Windows and Linux,
 * inside a 20px circle we drew ourselves. */
function setStatusIcon(el: HTMLElement, kind: 'ok' | 'problem' | 'unknown'): void {
  const path = kind === 'ok'
    ? '<path d="M4 8.5l3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    : kind === 'problem'
      ? '<path d="M8 4v5m0 3v.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      : '<path d="M6 6a2 2 0 113 1.7c-.6.4-1 .8-1 1.5m0 2.8v.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  el.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${path}</svg>`;
}

/** Hostnames where the student pressed "Never ask on this site". */
const MUTED_HOSTS_KEY = 'litos-muted-hosts';
import { selectNeedsYouReasons, skippedReasonsNeedReview } from '../lib/autosubmit-gate';
import {
  extractValidationErrors,
  mergeValidationReasons,
  validationErrorsToReasons,
} from '../lib/validation-authority';
import { fetchResumeBlob, resumeFetchSkipReason } from '../lib/resume-fetch';
import { packetAuditForResume, packetAuditPdfMatches } from '../lib/handoff-packet-audit';
import { startHarvest } from '../lib/harvest';
import { withInactivityTimeout } from '../lib/inactivity-timeout';
import { asSentence } from '../lib/sentence';
import type { Profile, ApplicationProfile, AutofillResult, GeneratedResume } from '../lib/types';
import { createFillActionGate, type FillActionPresentation } from '../lib/application-fill-action';
import { createFreeFillTrackerSync, type FreeFillTrackerPayload } from '../lib/free-fill-tracker';
import {
  createFreeSubmissionOutcomeSync,
  recordFreeSubmissionOutcome,
} from '../lib/free-submission-outcome';
import { FREE_SUBMISSION_OUTCOME_TIMEOUT_MS } from '../lib/free-submission-monitor';
import { detectChallenge, waitForChallengeCleared, watchForChallenge } from '../lib/captcha-detection';
import type { PostingCompensation } from '../lib/adapters/salary';
import { buildResumeReviewSummary } from '../lib/resume-review';
import {
  escapeApplicationText,
  pageShowsSubmissionConfirmation,
  pageSubmissionFailureMessage,
  submissionProgress,
} from '../lib/application-progress';
import {
  createResumeGenerationController,
  createSubmissionOutcomeController,
} from '../lib/application-task-controller';
import { mountThinkingOrb } from '../lib/thinking-orb';
import { derivePortalPassword, portalKeyForHost, currentSaltFingerprint } from '../lib/portal-password';
import { automaticSubmissionEnabled } from '../lib/auto-submit-consent';
import { applicantEmailForGeneratedPacket } from '../lib/applicant-email';
import { frozenApplicantFillData } from '../lib/handoff-applicant-snapshot';
import {
  WORKDAY_ACCOUNT_PROMPT_BODY,
  WORKDAY_ACCOUNT_PROMPT_TITLE,
  workdayAccountCompletion,
} from '../lib/workday-account-copy';
import { bullhornEmployerName, contentInitRoute } from '../lib/content-init-routing';
import { applicationFormIdentityKey, smartRecruitersApplicationUrl } from '../lib/web-handoff';
import { reviewedQuestionsForHandoff, validHandoffVersion, type HandoffQuestion } from '../lib/handoff-packet';
import { frozenAnswerForQuestion, replayReviewedAnswers, reviewedAnswersMatch } from '../lib/reviewed-answer-replay';
import { manualSubmissionPreflightError } from '../lib/manual-submission-preflight';
import {
  exactGatedAttendedReceipt,
  fillFrozenIcimsLoginEmail,
  frozenIcimsLoginEmailState,
  guardFrozenIcimsLoginIntent,
  guardTrustedSecurityCodeIntent,
  gatedReviewedAnswerControlAllowed,
  gatedStageCanPrepare,
  applicantOwnedEmailInputs,
  gatedStageNotice,
  inspectGatedAttendedStage,
  type GatedAttendedFamily,
} from '../lib/gated-attended-ats';
import {
  fillWorkdayVerificationCode,
  findWorkdayAccountSubmit,
  findWorkdayFinalSubmitButton,
  findWorkdayNextButton,
  findWorkdayVerificationContinue,
  inspectWorkdayAccountGate,
  isTrustedWorkdayAccountIntent,
  readWorkdayApplicationStep,
  runBoundedWorkdayAccountAction,
  workdayAccountReceiptProof,
  workdayApplicationCanAdvance,
  workdayProgrammaticFinalSubmitAllowed,
  replayWorkdayFinalSubmitIfAllowed,
  workdayVerificationStage,
} from '../lib/workday-account-flow';
import type { SerializedLitosApiError } from '../lib/api-error';
import {
  premiumRetryControlSelector,
  type ExtensionPremiumActionFeature,
} from '../lib/extension-premium-action';
import { installPersistentBadge } from '../lib/persistent-badge';

export default defineContentScript({
  matches: [
    'https://www.linkedin.com/*',
    'https://linkedin.com/*',
    'https://*.greenhouse.io/*',
    'https://*.lever.co/*',
    'https://*.myworkdayjobs.com/*',
    'https://*.workday.com/*',
    'https://*.ashbyhq.com/*',
    'https://www.indeed.com/*',
    'https://app.joinhandshake.com/*',
    'https://joinhandshake.com/*',
    // Added 2026-07-29. Each host is pinned as tightly as the platform allows, because several of
    // them share a host space with a LOGIN page: app.rippling.com is Rippling's HR product and
    // ultipro.com is UKG's employee sign-in, so a loose match would inject the card onto a
    // credential form. See ats-2026-07.ts, whose host predicates mirror these.
    'https://ats.rippling.com/*',
    // Path-scoped, not host-scoped. Every one of these hosts serves far more than job pages, and a
    // content script injects on every URL it matches - which both widens the install warning the
    // Chrome Web Store shows and puts Litos on pages it has no business seeing. /p/ is Breezy's
    // posting route and /careers/ is BambooHR's; both also cover the JD page, so nothing is lost.
    'https://*.breezy.hr/p/*',
    'https://*.bamboohr.com/careers/*',
    // Public application routes captured on two unrelated tenants per family on 2026-08-09.
    'https://*.recruitee.com/o/*',
    'https://*.teamtailor.com/jobs/*',
    'https://*.zohorecruit.com/jobs/Careers/*',
    'https://*.zohorecruit.eu/jobs/Careers/*',
    'https://*.zohorecruit.in/jobs/Careers/*',
    'https://www.serverlogic.com/wp-content/plugins/bullhorn-oscp/*',
    'https://www.staffingsolutionsenterprises.com/wp-content/plugins/bullhorn-oscp/*',
    // SuccessFactors has many product surfaces. The runtime predicate accepts only career<number>
    // hosts, and only recognition is enabled because the application itself is account-walled.
    'https://*.successfactors.com/*',
    'https://*.successfactors.eu/*',
    // SmartRecruiters public postings and one-click forms share this exact host. The adapter fills
    // only the one-click form and is permanently denied programmatic submit because later steps
    // contain tenant-specific questions and confirmation.
    'https://jobs.smartrecruiters.com/*',
    // The four below have no adapter and never will until their gates change. They are matched so
    // Litos can RECOGNISE the page and say plainly why it cannot fill it, which is worth more to a
    // job seeker than a card that never appears. See gatedPortalNotice.
    'https://jobs.jobvite.com/*/job/*',
    'https://*.icims.com/jobs/*',
    // The one that matters most. oraclecloud.com hosts EVERY Oracle Cloud application - payroll,
    // ERP, finance - so a bare host match would inject this script into somebody's payroll session.
    // /hcmUI/CandidateExperience/ is the candidate-facing recruiting app and nothing else.
    'https://fa-etxx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/*/sites/*/job/*',
    'https://fa-etxx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/*/sites/*/opportunity/*',
    'https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/*/sites/*/job/*',
    'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/*/sites/*/job/*',
    'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/*/sites/*/opportunity/*',
    'https://recruiting.ultipro.com/*/JobBoard/*/OpportunityDetail*',
    // Exact tenants and routes captured 2026-08-09. Taleo and ADP stop at a legal or account wall;
    // JazzHR exposes only the fixed factual controls before its Human Check.
    'https://fa007.taleo.net/careersection/*',
    'https://aa270.taleo.net/careersection/*',
    'https://myjobs.adp.com/guitarcenterexternal/cx/job-details*',
    'https://myjobs.adp.com/kaisercareers/cx/job-details*',
    'https://utilidata.applytojob.com/apply/jobs/details/*',
    'https://foundationai.applytojob.com/apply/jobs/details/*',
    'https://maximus.avature.net/careers/*',
    'https://sandboxxerox.avature.net/*/careers/*',
    'https://jobs.ea.com/en_US/careers/JobDetail/Software-Engineer-Intern/214956',
    'https://*.jobs.personio.de/job/*',
    'https://*.jobs.personio.com/job/*',
    'https://*.pinpointhq.com/postings/*',
    // Comeet renders the actual application as a token-bearing iframe on .co. allFrames below
    // lets the adapter run inside that frame without reaching across origins.
    'https://www.comeet.co/jobs/*',
  ],
  // Some companies embed their Greenhouse board in an iframe hosted on greenhouse.io while the
  // parent page is on the company's own domain (Section 9/12.3 of PRD-v2). `matches` is evaluated
  // per-frame, so all_frames lets this script inject directly into that iframe - it runs with the
  // iframe's own greenhouse.io origin, not the parent page's, so no cross-frame messaging is needed.
  allFrames: true,
  runAt: 'document_idle',
  main() {
    installPersistentBadge();

    async function serverCaptchaResumeEnabled(): Promise<boolean> {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (enabled: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(enabled);
        };
        // A failed read is a NO. Resuming on stale or missing permission would be Litos deciding it
        // had consent because it could not check.
        // 25s, not 10s: the background's own fetch budget is 20s, so a shorter wait here denied a
        // permission the applicant had actually granted, silently, whenever the backend was slow.
        const timer = window.setTimeout(() => finish(false), 25_000);
        chrome.runtime.sendMessage(
          { type: 'GET_AUTOMATION_SETTINGS' },
          (settings: { automatic_captcha_enabled?: boolean } | undefined) =>
            finish(!chrome.runtime.lastError && settings?.automatic_captcha_enabled === true),
        );
      });
    }

    async function serverAutoSubmitEnabled(): Promise<boolean> {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (enabled: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(enabled);
        };
        const timer = window.setTimeout(() => finish(false), 10_000);
        chrome.runtime.sendMessage(
          { type: 'GET_AUTOMATION_SETTINGS' },
          (settings: { automatic_submission_enabled?: boolean } | undefined) =>
            finish(automaticSubmissionEnabled(settings)),
        );
      });
    }

    const monitoredSubmissionIds = new Set<string>();
    const pendingRecoveryGate = new PendingSubmissionRecoveryGate();

    function visibleSubmissionOutcomeTexts(): string[] {
      const selectors = '[role="alert"], [role="status"], [aria-live], h1, h2, [class*="error" i], [class*="success" i], [class*="confirm" i], [class*="thank" i]';
      return [...document.querySelectorAll<HTMLElement>(selectors)]
        .filter((element) => !element.closest('[id*="litos"]'))
        .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
        .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    }

    function monitorExtensionSubmission(
      applicationId: string,
      baselineTexts: ReadonlySet<string> = new Set(),
      strictReceipt?: { family: GatedAttendedFamily; startedUrl: string },
    ) {
      if (monitoredSubmissionIds.has(applicationId)) return;
      monitoredSubmissionIds.add(applicationId);
      const readText = () => visibleSubmissionOutcomeTexts()
        .filter((text) => !baselineTexts.has(text))
        .join(' ');
      let observer: MutationObserver | null = null;
      let interval: ReturnType<typeof setInterval>;
      const report = (outcome: 'confirmed' | 'failed' | 'unknown', confirmationText?: string, attempt = 0) => {
        // A confirmed submission means this application is no longer waiting on anyone, so it
        // leaves the stall list. Without this the count only ever grows and the badge becomes a
        // number people learn to ignore, which is worse than no badge at all.
        if (outcome === 'confirmed') {
          try {
            chrome.runtime.sendMessage({ type: 'CAPTCHA_STALL_RESOLVED', payload: { url: window.location.href } });
          } catch {
            // Nothing here is worth failing an outcome report over.
          }
        }
        chrome.runtime.sendMessage({
          type: 'EXTENSION_SUBMISSION_OUTCOME',
          payload: { applicationId, outcome, finalUrl: window.location.href, confirmationText },
        }, (response: { ok?: boolean } | undefined) => {
          if (!response?.ok && attempt < 4) window.setTimeout(() => report(outcome, confirmationText, attempt + 1), 1000 * (attempt + 1));
        });
      };
      const controller = createSubmissionOutcomeController({
        readText,
        classify: strictReceipt
          ? (text) => {
            const failure = pageSubmissionFailureMessage(text);
            if (failure) return { kind: 'failure', message: failure };
            const receipt = exactGatedAttendedReceipt({
              family: strictReceipt.family,
              startedUrl: strictReceipt.startedUrl,
              finalUrl: window.location.href,
              employerText: text,
            });
            return receipt ? { kind: 'confirmed' } : null;
          }
          : undefined,
        onStop: () => { clearInterval(interval); observer?.disconnect(); },
        onOutcome: (outcome) => report(outcome.kind === 'failure' ? 'failed' : 'confirmed', outcome.kind === 'failure' ? outcome.message : readText().slice(0, 2000)),
        onUnknown: () => report('unknown'),
      });
      interval = setInterval(controller.scan, 1000);
      observer = new MutationObserver(controller.queueScan);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      controller.scan();
    }

    function armManualSubmissionTracking(
      submitButton: HTMLElement,
      applicationId: string,
      statusEl: HTMLElement | null,
      atsName: string,
      submissionGuard: () => string | null = () => null,
      attendedHandoff = false,
    ) {
      let reserving = false;
      const onClick = (event: MouseEvent) => {
        if (!event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (reserving) return;
        const guardError = submissionGuard();
        // This click was already swallowed by the preventDefault above, so a bare return here is a
        // dead Submit button: nothing sends, the page's own validation never runs, and the student
        // gets no reason. Say which state she is in. Reachable whenever a required control is
        // genuinely empty, which the combobox abandon path (closeOpenCombobox) now makes honest
        // rather than hiding behind Litos's own uncommitted typeahead text.
        const preflightError = manualSubmissionPreflightError({
          guardError,
          requiredFieldMissing: hasEmptyRequiredFields(),
          challengeWaiting: captchaWaiting || detectChallenge().waiting,
        });
        if (preflightError) {
          if (statusEl) statusEl.textContent = preflightError;
          return;
        }
        reserving = true;
        pendingRecoveryGate.beginLocal(applicationId);
        const baselineTexts = new Set(visibleSubmissionOutcomeTexts());
        const submissionStartedUrl = window.location.href;
        chrome.runtime.sendMessage({
          type: 'EXTENSION_SUBMISSION_START',
          payload: { applicationId, authorization: 'user_initiated', attendedHandoff },
        }, (response: { ok?: boolean; error?: string } | undefined) => {
          reserving = false;
          if (!response?.ok) {
            pendingRecoveryGate.endLocal(applicationId);
            if (statusEl) statusEl.textContent = response?.error ?? 'Litos could not safely track this submission. Try again.';
            return;
          }
          const challengeNow = captchaWaiting || detectChallenge().waiting;
          const replayGuardError = submissionGuard();
          const replaySafe = submitButton.isConnected
            && isElementVisible(submitButton)
            && !document.hidden
            && document.hasFocus()
            && !challengeNow
            && !replayGuardError
            && !hasEmptyRequiredFields()
            && findProgrammaticFinalSubmitButton(atsName) === submitButton;
          const clicked = replaySafe && atsName === 'workday'
            ? replayWorkdayFinalSubmitIfAllowed({
              expectedControl: submitButton,
              tabVisible: !document.hidden,
              tabFocused: document.hasFocus(),
              requiredFieldsClear: !hasEmptyRequiredFields(),
            })
            : replaySafe && (() => { submitButton.click(); return true; })();
          if (!clicked) {
            const cancelReservation = (attempt = 0) => chrome.runtime.sendMessage({
                type: 'EXTENSION_SUBMISSION_OUTCOME',
                payload: {
                  applicationId,
                  outcome: 'cancelled',
                  finalUrl: window.location.href,
                  confirmationText: 'The application changed after the reservation. Nothing was sent.',
                },
              }, (cancelResponse: { ok?: boolean } | undefined) => {
                if (!cancelResponse?.ok && attempt < 4) {
                  window.setTimeout(() => cancelReservation(attempt + 1), 1000 * (attempt + 1));
                  return;
                }
                pendingRecoveryGate.endLocal(applicationId);
              });
            cancelReservation();
            if (statusEl) statusEl.textContent = replayGuardError ?? 'The application changed before submission. Review the final page and click Submit again.';
            return;
          }
          submitButton.removeEventListener('click', onClick, true);
          monitorExtensionSubmission(
            applicationId,
            baselineTexts,
            atsName === 'jobvite' || atsName === 'icims'
              ? { family: atsName, startedUrl: submissionStartedUrl }
              : undefined,
          );
          pendingRecoveryGate.endLocal(applicationId);
        });
      };
      submitButton.addEventListener('click', onClick, true);
    }

    const freeSubmissionOutcomeButtons = new WeakSet<HTMLElement>();
    const activeFreeSubmissionOutcomeEvents = new Set<string>();

    function reportFreeSubmissionOutcomeWithRetry(
      outcomeSync: ReturnType<typeof createFreeSubmissionOutcomeSync>,
      baselineUrl: string,
      outcome: 'confirmed' | 'failed' | 'unknown',
      confirmationText?: string,
      attempt = 0,
    ): void {
      const finalUrl = window.location.href || baselineUrl;
      void outcomeSync.record(outcome, finalUrl, confirmationText).then((result) => {
        if (result.ok) return;
        if (attempt < 4) {
          window.setTimeout(
            () => reportFreeSubmissionOutcomeWithRetry(
              outcomeSync,
              baselineUrl,
              outcome,
              confirmationText,
              attempt + 1,
            ),
            1000 * (attempt + 1),
          );
          return;
        }
        chrome.runtime.sendMessage({
          type: 'ABANDON_FREE_SUBMISSION_OUTCOME_MONITOR',
          event_id: outcomeSync.eventId,
        });
      });
    }

    function monitorFreeSubmissionOutcome(input: {
      outcomeSync: ReturnType<typeof createFreeSubmissionOutcomeSync>;
      baselineUrl: string;
      baselineTexts: ReadonlySet<string>;
      timeoutMs?: number;
    }): void {
      if (activeFreeSubmissionOutcomeEvents.has(input.outcomeSync.eventId)) return;
      activeFreeSubmissionOutcomeEvents.add(input.outcomeSync.eventId);
      const readNewReceiptText = () => visibleSubmissionOutcomeTexts()
        .filter((text) => !input.baselineTexts.has(text))
        .join(' ');
      let observer: MutationObserver | null = null;
      let interval: ReturnType<typeof setInterval> | null = null;
      const stopResources = () => {
        if (interval) clearInterval(interval);
        interval = null;
        observer?.disconnect();
        observer = null;
      };
      const controller = createSubmissionOutcomeController({
        readText: readNewReceiptText,
        timeoutMs: input.timeoutMs ?? FREE_SUBMISSION_OUTCOME_TIMEOUT_MS,
        onStop: stopResources,
        onOutcome: (outcome) => {
          const receiptText = readNewReceiptText().slice(0, 1000);
          if (outcome.kind === 'failure') {
            reportFreeSubmissionOutcomeWithRetry(
              input.outcomeSync,
              input.baselineUrl,
              'failed',
              receiptText || outcome.message,
            );
            return;
          }
          reportFreeSubmissionOutcomeWithRetry(
            input.outcomeSync,
            input.baselineUrl,
            'confirmed',
            receiptText,
          );
        },
        onUnknown: () => reportFreeSubmissionOutcomeWithRetry(
          input.outcomeSync,
          input.baselineUrl,
          'unknown',
        ),
      });
      interval = setInterval(controller.scan, 1000);
      observer = new MutationObserver(controller.queueScan);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      controller.scan();
    }

    /**
     * Observes the applicant's own native Free-plan submit click. This is intentionally separate
     * from armManualSubmissionTracking: there is no reservation, entitlement check, click replay,
     * or event cancellation in this lane. If Tracker transport fails, the employer click and page
     * behavior remain exactly as they would be without Litos.
     */
    function armFreeManualSubmissionOutcomeTracking(
      submitButton: HTMLElement,
      applicationId: string,
    ): void {
      if (freeSubmissionOutcomeButtons.has(submitButton)) return;
      freeSubmissionOutcomeButtons.add(submitButton);
      const onTrustedClick = (event: MouseEvent) => {
        if (!event.isTrusted) return;
        submitButton.removeEventListener('click', onTrustedClick, true);

        const baselineUrl = window.location.href;
        const baselineTexts = new Set(visibleSubmissionOutcomeTexts());
        const eventId = crypto.randomUUID();
        let settleMonitorStart!: () => void;
        const monitorStart = new Promise<void>((resolve) => { settleMonitorStart = resolve; });
        const outcomeSync = createFreeSubmissionOutcomeSync(
          applicationId,
          eventId,
          async (payload) => {
            await monitorStart;
            return recordFreeSubmissionOutcome(payload);
          },
        );
        // Fire-and-observe: queueing this storage message never delays or alters the employer's
        // native click, but gives a post-navigation content script the same stable event id.
        chrome.runtime.sendMessage({
          type: 'START_FREE_SUBMISSION_OUTCOME_MONITOR',
          payload: {
            event_id: outcomeSync.eventId,
            application_id: applicationId,
            start_url: baselineUrl,
          },
        }, () => {
          void chrome.runtime.lastError;
          settleMonitorStart();
        });
        monitorFreeSubmissionOutcome({ outcomeSync, baselineUrl, baselineTexts });
      };
      submitButton.addEventListener('click', onTrustedClick, true);
    }

    function findFreeManualFinalSubmitButton(atsName: string): HTMLElement | null {
      return atsName === 'workday' ? findWorkdayFinalSubmitButton() : findFinalSubmitButton();
    }

    const pendingFreeSubmissionOutcomeApplications = new Set<string>();

    function armFreeManualSubmissionOutcomeWhenAvailable(
      applicationId: string,
      atsName: string,
    ): void {
      if (pendingFreeSubmissionOutcomeApplications.has(applicationId)) return;
      pendingFreeSubmissionOutcomeApplications.add(applicationId);
      let observer: MutationObserver | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const tryArm = (): boolean => {
        const finalControl = findFreeManualFinalSubmitButton(atsName);
        if (!finalControl) return false;
        armFreeManualSubmissionOutcomeTracking(finalControl, applicationId);
        observer?.disconnect();
        observer = null;
        if (timeout) clearTimeout(timeout);
        timeout = null;
        return true;
      };
      if (tryArm()) return;
      observer = new MutationObserver(() => { tryArm(); });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      timeout = setTimeout(() => {
        observer?.disconnect();
        observer = null;
        pendingFreeSubmissionOutcomeApplications.delete(applicationId);
      }, 5 * 60_000);
    }

    // No top-frame gating: for a cross-origin Greenhouse iframe embed, this script's instance
    // running INSIDE that iframe is the only one that ever matches `*.greenhouse.io/*` at all
    // (the parent page is on the company's own domain, which isn't in `matches`). That iframe
    // instance is also the only one with access to the actual form DOM, so its card must render
    // in its own document - a `position: fixed` card inside an iframe is scoped to that iframe's
    // own viewport, which is correct here since Greenhouse embeds are typically full-size.

    // Besides the manifest matches, this same file is injected ON DEMAND (popup's "Fill the
    // form on this page" button -> activeTab + chrome.scripting) into company career sites
    // that host their own application form. A second click re-executes the whole bundle in
    // the same isolated world, so guard against double-running: the repeat call just re-shows
    // the generic card instead of standing up a second set of observers.
    const w = window as unknown as { __litosLoaded?: boolean; __litosGenericInit?: () => void };
    if (w.__litosLoaded) {
      w.__litosGenericInit?.();
      return;
    }
    w.__litosLoaded = true;

    const checkPendingSubmission = (attempt = 0) => {
      chrome.runtime.sendMessage(
        { type: 'GET_PENDING_EXTENSION_SUBMISSION' },
        (response: { pending?: { applicationId?: string; startedAt?: number; strictReceipt?: { family: GatedAttendedFamily; startedUrl: string } } | null } | undefined) => {
          const pending = response?.pending;
          if (pending?.applicationId && pendingRecoveryGate.shouldRecover(pending)) {
            monitorExtensionSubmission(
              pending.applicationId,
              new Set(),
              pending.strictReceipt,
            );
          } else if (attempt < 60) {
            window.setTimeout(() => checkPendingSubmission(attempt + 1), 500);
          }
        },
      );
    };
    checkPendingSubmission();

    const checkPendingFreeSubmissionOutcome = (attempt = 0): void => {
      chrome.runtime.sendMessage(
        { type: 'GET_PENDING_FREE_SUBMISSION_OUTCOME' },
        (response: {
          pending?: {
            eventId?: string;
            applicationId?: string;
            startUrl?: string;
          } | null;
          force_unknown?: boolean;
          remaining_ms?: number;
          retry_pending?: boolean;
        } | undefined) => {
          const pending = response?.pending;
          if (
            pending?.eventId
            && pending.applicationId
            && pending.startUrl
          ) {
            const outcomeSync = createFreeSubmissionOutcomeSync(
              pending.applicationId,
              pending.eventId,
            );
            const remainingMs = Math.max(0, response?.remaining_ms ?? 0);
            if (response?.force_unknown || remainingMs === 0) {
              reportFreeSubmissionOutcomeWithRetry(
                outcomeSync,
                pending.startUrl,
                'unknown',
              );
              return;
            }
            // A new document has no trustworthy pre-click text baseline. Only visible receipt or
            // failure text on this bound post-navigation page participates in classification.
            monitorFreeSubmissionOutcome({
              outcomeSync,
              baselineUrl: pending.startUrl,
              baselineTexts: new Set(),
              timeoutMs: remainingMs,
            });
            return;
          }
          // The native navigation can beat the asynchronous session-storage write by a few
          // milliseconds. Retry briefly without keeping every ordinary application page polling.
          if (attempt < 20 || (response?.retry_pending && attempt < 100)) {
            window.setTimeout(() => checkPendingFreeSubmissionOutcome(attempt + 1), 250);
          }
        },
      );
    };
    checkPendingFreeSubmissionOutcome();

    let cardInjected = false;
    let approved = false; // true once user taps "Yes" on either card
    let submitFromDashboard: ((questions: Array<{ id: string; question: string; answer: string }>) => Promise<{ ok: boolean; clicked?: boolean; error?: string; finalUrl?: string; confirmationText?: string }>) | null = null;
    let prepareSubmissionFromDashboard: ((resume: GeneratedResume, expectedUrl: string) => Promise<string | null>) | null = null;

    function openLitosPlansFromPage(
      trigger: ExtensionPremiumActionFeature,
      actionContext: {
        application_id?: string;
        company: string;
        role: string;
        portal_url: string;
      } | null,
      done: (result: { ok: boolean; error?: string }) => void,
    ): void {
      chrome.runtime.sendMessage({
        type: 'OPEN_LITOS_PLANS',
        trigger,
        ...(actionContext ? { action_context: actionContext } : {}),
      }, (response: { ok?: boolean; error?: string } | undefined) => {
        const runtimeError = chrome.runtime.lastError?.message;
        done(response?.ok === true
          ? { ok: true }
          : { ok: false, error: response?.error ?? runtimeError ?? 'Litos+ options could not open.' });
      });
    }

    function focusPremiumRetryControl(
      feature: ExtensionPremiumActionFeature,
      actionNonce?: string,
    ): boolean {
      const selector = premiumRetryControlSelector(feature);
      if (!selector) return false;
      let observer: MutationObserver | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const tryFocus = (): boolean => {
        const control = document.querySelector<HTMLElement>(selector);
        if (
          !control
          || !isElementVisible(control)
          || (control as HTMLButtonElement).disabled
          || control.getAttribute('aria-disabled') === 'true'
        ) return false;
        control.scrollIntoView({ block: 'center', behavior: 'smooth' });
        control.focus({ preventScroll: true });
        observer?.disconnect();
        observer = null;
        if (timeout) clearTimeout(timeout);
        timeout = null;
        if (actionNonce) {
          chrome.runtime.sendMessage({
            type: 'COMPLETE_PREMIUM_RETRY_FOCUS',
            action_nonce: actionNonce,
          });
        }
        return true;
      };
      if (tryFocus()) return true;
      observer = new MutationObserver(() => { tryFocus(); });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      timeout = setTimeout(() => observer?.disconnect(), 5 * 60_000);
      return true;
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'FOCUS_PREMIUM_RETRY_CONTROL') {
        const focused = focusPremiumRetryControl(
          message.feature_key as ExtensionPremiumActionFeature,
          typeof message.action_nonce === 'string' ? message.action_nonce : undefined,
        );
        sendResponse({ ok: focused });
        return false;
      }
      if (message?.type === 'GET_CURRENT_APPLICATION_URL') {
        sendResponse({ url: window.location.href });
        return false;
      }
      if (message?.type === 'PREPARE_SUBMISSION_FROM_DASHBOARD') {
        if (!prepareSubmissionFromDashboard || !message.payload?.resume) {
          sendResponse({ ok: false, error: 'This page is not ready to verify the saved application packet.' });
          return false;
        }
        prepareSubmissionFromDashboard(message.payload.resume as GeneratedResume, String(message.payload.expectedUrl ?? ''))
          .then((error) => sendResponse(error ? { ok: false, error } : { ok: true }))
          .catch(() => sendResponse({ ok: false, error: 'The exact application packet could not be verified. Nothing was sent.' }));
        return true;
      }
      if (message?.type !== 'SUBMIT_FROM_DASHBOARD') return false;
      if (!submitFromDashboard) {
        sendResponse({ ok: false, error: 'This page is not ready to send any more. Open it and check it.' });
        return false;
      }
      const applicationId = String(message.payload?.applicationId ?? '');
      pendingRecoveryGate.beginLocal(applicationId);
      submitFromDashboard(message.payload?.questions ?? [])
        .then(sendResponse)
        .finally(() => pendingRecoveryGate.endLocal(applicationId));
      return true;
    });

    chrome.runtime.sendMessage(
      { type: 'CLAIM_PREMIUM_RETRY_FOCUS' },
      (response: { ok?: boolean; action_nonce?: string; feature_key?: ExtensionPremiumActionFeature } | undefined) => {
        if (response?.ok && response.feature_key) {
          focusPremiumRetryControl(response.feature_key, response.action_nonce);
        }
      },
    );

    // ─── Job title/company extraction ───────────────────────────────────────

    function getJobDetails(): { title: string; company: string } | null {
      const h = window.location.hostname;
      const path = window.location.pathname;

      if (h.includes('linkedin.com')) {
        const parts = document.title.split(' | ');
        if (parts.length >= 2 && parts[parts.length - 1].trim() === 'LinkedIn') {
          const title = parts[0].trim();
          const company = parts[1].trim();
          if (title && company && title !== 'Jobs') return { title, company };
        }
      }

      if (h.includes('greenhouse.io')) {
        const docTitle = document.title;
        const atIdx = docTitle.lastIndexOf(' at ');
        const company = atIdx !== -1
          ? docTitle.slice(atIdx + 4).replace(/\s*\|.*$/, '').trim()
          : document.querySelector<HTMLElement>('.company-name')?.textContent?.trim() ?? h.split('.')[0];
        // The /embed/job_app template (companies embedding their board in an iframe on their
        // own careers site, e.g. databricks.com - live-tested 2026-07-04) renders NO h1 at
        // all, so without the document.title fallback getJobDetails() returned null there and
        // no card ever fired on any embedded Greenhouse application.
        const titleFromDocTitle =
          atIdx !== -1 ? docTitle.slice(0, atIdx).replace(/^job application for\s*/i, '').trim() : undefined;
        const title =
          document.querySelector<HTMLElement>('h1.app-title')?.textContent?.trim() ??
          document.querySelector<HTMLElement>('h1')?.textContent?.trim() ??
          titleFromDocTitle;
        if (title && company) return { title, company };
      }

      if (h.includes('lever.co')) {
        const title =
          document.querySelector<HTMLElement>('.posting-headline h2')?.textContent?.trim() ??
          document.querySelector<HTMLElement>('h2')?.textContent?.trim();
        const company =
          document.querySelector<HTMLElement>('.main-header-logo img')?.getAttribute('alt')?.trim().replace(/\s+logo$/i, '') ??
          path.split('/')[1];
        if (title && company) return { title, company };
      }

      if (h.includes('myworkdayjobs.com') || h.includes('workday.com')) {
        const title =
          document.querySelector<HTMLElement>('[data-automation-id="jobPostingHeader"]')?.textContent?.trim() ??
          document.querySelector<HTMLElement>('h1')?.textContent?.trim();
        const company = h.split('.')[0].replace('www', '') || document.title.split('-')[1]?.trim();
        if (title && company) return { title, company };
      }

      if (h.includes('ashbyhq.com')) {
        const title = document.querySelector<HTMLElement>('h1')?.textContent?.trim();
        const company = path.split('/')[1];
        if (title && company) return { title, company };
      }

      if (h.includes('indeed.com')) {
        const title =
          document.querySelector<HTMLElement>('[data-testid="jobsearch-JobInfoHeader-title"]')?.textContent?.trim() ??
          document.querySelector<HTMLElement>('.jobsearch-JobInfoHeader-title')?.textContent?.trim();
        const company =
          document.querySelector<HTMLElement>('[data-testid="inlineHeader-companyName"]')?.textContent?.trim() ??
          document.querySelector<HTMLElement>('.jobsearch-InlineCompanyRating-companyHeader')?.textContent?.trim();
        if (title && company) return { title, company };
      }

      if (h.includes('joinhandshake.com')) {
        const title = document.querySelector<HTMLElement>('h1')?.textContent?.trim();
        const company = document.querySelector<HTMLElement>('.company-name, [class*="employer-name"]')?.textContent?.trim();
        if (title && company) return { title, company };
      }

      // Declarative ATS pages generally put the role in h1 and the employer in the tenant label.
      // Rippling carries the tenant in its first path segment. Comeet's .co iframe carries the
      // employer in its query or in the public wrapper referrer.
      if (specForCurrentPage()) {
        let referrerParts: string[] = [];
        try {
          referrerParts = new URL(document.referrer).pathname.split('/').filter(Boolean);
        } catch {
          referrerParts = [];
        }
        const title = document.querySelector<HTMLElement>('h1')?.textContent?.trim()
          ?? (h === 'www.comeet.co' ? referrerParts.at(-2)?.replace(/[-_]+/g, ' ') : undefined)
          ?? document.title.replace(/^apply\s*[-|]\s*/i, '').trim();
        const smartRecruitersCompany = h === 'jobs.smartrecruiters.com'
          ? window.location.pathname.split('/').filter(Boolean).find((_part, index, parts) => parts[index - 1] === 'company')
            ?? window.location.pathname.split('/').filter(Boolean)[0]
          : undefined;
        const tenant = smartRecruitersCompany
          ?? (h === 'ats.rippling.com'
            ? window.location.pathname.split('/').filter(Boolean)[0]
            : h === 'www.comeet.co'
              ? new URLSearchParams(window.location.search).get('company-name') ?? referrerParts[1]
              : h.split('.')[0]);
        const company = bullhornEmployerName(h)
          ?? document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content?.trim()
          ?? (tenant ? tenant.replace(/[-_]+/g, ' ').trim() : undefined);
        if (title && company) return { title, company };
      }

      return null;
    }

    // ─── Application page detection ─────────────────────────────────────────

    function isApplicationPage(): boolean {
      const h = window.location.hostname;
      const path = window.location.pathname.toLowerCase();

      if (h.includes('myworkdayjobs.com') || h.includes('workday.com')) {
        return path.includes('/apply') || (path.includes('/job/') && path.endsWith('/apply'));
      }

      if (h.includes('greenhouse.io')) {
        if (path.includes('/application') || path.includes('/apply')) return true;
        const hasResumeUpload = !!document.querySelector('input[type="file"], [data-source="resume"]');
        const hasNameField = !!document.querySelector('input[name="job_application[first_name]"], input[id*="first_name"]');
        const hasPrivacyNotice = !!document.querySelector('.gdpr-consent, [class*="privacy"], [id*="privacy"]');
        return hasResumeUpload || hasNameField || hasPrivacyNotice;
      }

      if (h.includes('lever.co')) return path.includes('/apply');
      // Live-tested 2026-07-02 (jobs.ashbyhq.com/notion): the real apply-flow path is
      // "/application", not "/apply" - see isAshbyApplicationPage()'s matching comment.
      if (h.includes('ashbyhq.com')) return path.includes('/apply') || path.includes('/application');
      if (h.includes('joinhandshake.com')) return path.includes('/apply') || path.includes('/application');
      if (h.includes('indeed.com')) {
        return path.includes('/apply') || !!document.querySelector('[id*="apply"], [class*="apply-form"]');
      }

      // Rippling / BreezyHR / BambooHR. Their host and path rules live with their selectors rather
      // than here, so there is one place to read when a platform changes its URL shape.
      if (isAtsApplicationPage()) return true;

      return false;
    }

    // ─── Submit button detection ─────────────────────────────────────────────

    function findSubmitButton(): Element | null {
      // Workday reuses this automation id for intermediate Next and final Submit controls. Only
      // the latter may start submission monitoring. Treating Next as final can arm receipt logic
      // several pages before the applicant has reviewed the application.
      const workday = document.querySelector('[data-automation-id="bottom-navigation-next-button"]');
      if (workday) {
        const finalWorkdaySubmit = findWorkdayFinalSubmitButton();
        if (finalWorkdaySubmit) return finalWorkdaySubmit;
      }

      // Everything else: SCORE every button/submit-like control by what it says, rather than
      // taking the first `input[type=submit]`. Real forms often carry more than one submit-type
      // button - live-seen on vercel.com, an "Apply for Role" that opens/anchors the form near the
      // top AND the real "Submit Application" at the bottom, both `button[type=submit]`. A plain
      // querySelector returns the wrong (top) one. We also can't require type=submit, since Lever's
      // submit is a text button. So: score by label, exclude the obvious non-submits, and break
      // ties toward the control lower on the page (the real submit sits at the bottom).
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          'button, input[type="submit"], input[type="button"], [role="button"], a[role="button"]',
        ),
      ].filter((el) => !el.closest('[id*="litos"]') && el.offsetParent !== null);

      const EXCLUDE =
        /resume|cover\s*letter|\bsave\b|cancel|\bback\b|\bedit\b|sign\s*in|log\s*in|create account|\bupload\b|add another|remove|delete|\bsearch\b|ask ai|previous|learn more/i;
      let best: { el: Element; score: number } | null = null;
      for (let i = 0; i < controls.length; i++) {
        const el = controls[i];
        const label = `${el.textContent ?? ''} ${(el as HTMLInputElement).value ?? ''} ${el.getAttribute('aria-label') ?? ''}`
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        if (!label || label.length > 40 || EXCLUDE.test(label)) continue;
        let score = 0;
        if (/\bsubmit\b/.test(label)) score = 100;
        else if (/send (my |your )?application/.test(label)) score = 80;
        else if (/\bfinish\b|complete application/.test(label)) score = 60;
        else if (/apply for|apply now|^\s*apply\b/.test(label)) score = 40;
        if (score === 0) continue;
        if ((el as HTMLButtonElement).type === 'submit') score += 5;
        score += i / 1000; // tie-break toward the control lower in the DOM
        if (!best || score > best.score) best = { el, score };
      }
      return best ? best.el : null;
    }

    // A TRUE final-submit control, distinct from a "Next"/"Continue"/"Save and Continue"/"Review"
    // step-advance button. The auto-submit countdown must anchor to THIS, never a step button:
    // clicking a step button would advance a multi-step form (Workday's 5 pages) and then falsely
    // report the application as submitted. Returns null when the only actionable control is a
    // step-advance - i.e. a multi-step form that isn't on its final page yet, so there is nothing
    // to auto-submit toward.
    // Visible = has a layout box and isn't visibility:hidden. Unlike offsetParent !== null this keeps
    // a legitimately-visible position:fixed control (whose offsetParent is null) while still excluding
    // a display:none pre-rendered later-step button (and its descendants).
    function isElementVisible(el: HTMLElement): boolean {
      return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    }

    function findFinalSubmitButton(): HTMLElement | null {
      const STEP_ADVANCE = /\b(next|continue|save\s*(and|&)\s*continue|review|save\s+for\s+later|back)\b/i;
      const SUBMIT = /\bsubmit(\s+application)?\b|\bsend\s+application\b/i;
      const candidates = [
        ...document.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]'),
      ];
      for (const el of candidates) {
        if (el.closest('[id*="litos"]')) continue;
        if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue;
        // Must be visible: a multi-step form can pre-render a later step's "Submit" hidden in the
        // DOM; anchoring or firing on an off-screen button would submit a step the student can't see.
        if (!isElementVisible(el)) continue;
        // `||` not `??`: textContent is "" (not null) for a void <input type="submit">, so `??`
        // would never fall through to .value and classic Greenhouse's submit input would be missed.
        const text = (el.textContent || (el as HTMLInputElement).value || '').trim();
        if (!text) continue;
        // Skip a step-advance word ONLY when the text is not also a submit, so a final button
        // labelled "Review and Submit" / "Review & Submit application" still counts as a submit.
        if (STEP_ADVANCE.test(text) && !SUBMIT.test(text)) continue;
        if (SUBMIT.test(text)) return el;
      }
      return null;
    }

    function findProgrammaticFinalSubmitButton(atsName: string): HTMLElement | null {
      if (atsName !== 'workday') return findFinalSubmitButton();
      const control = findWorkdayFinalSubmitButton();
      return control && workdayProgrammaticFinalSubmitAllowed(control) ? control : null;
    }

    // Is any on-screen required field still empty? Used to hold back auto-submit: the browser's own
    // validation would block the submit anyway, but by then we'd already have reported it as sent.
    function hasEmptyRequiredFields(): boolean {
      const req = [...document.querySelectorAll<HTMLElement>('[required], [aria-required="true"]')];
      for (const el of req) {
        if (el.closest('[id*="litos"]')) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const tag = el.tagName.toLowerCase();
        if (tag === 'input') {
          const inp = el as HTMLInputElement;
          // react-select comboboxes put aria-required on a visible input that stays value-empty
          // after a selection (the chosen value lives in component state / a hidden input), so an
          // empty .value there is NOT an unanswered field - skip it rather than wrongly holding
          // auto-submit on the work-auth/country/EEO controls Greenhouse and Ashby render this way.
          if (inp.getAttribute('role') === 'combobox' || inp.closest('[class*="select__control"], [class*="Select-control"]')) {
            // .value stays empty on a react-select even after a selection, so read the control
            // instead: a filled one renders a single/multi value node, an empty one a placeholder.
            // Only HOLD auto-submit when we can positively see it's empty; if we can't tell, skip it
            // as before so a genuinely filled control never wrongly blocks the submit.
            const control = inp.closest('[class*="select__control"], [class*="Select-control"]') ?? inp.parentElement;
            const hasValue = control?.querySelector(
              '[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"], [class*="Select-value"]',
            );
            const hasPlaceholder = control?.querySelector('[class*="placeholder"]');
            if (!hasValue && hasPlaceholder) return true;
            continue;
          }
          if (inp.type === 'checkbox' || inp.type === 'radio') {
            const group = inp.name
              ? [...document.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(inp.name)}"]`)]
              : [inp];
            if (!group.some((g) => g.checked)) return true;
          } else if (!inp.value.trim() && !inp.files?.length) {
            return true;
          }
        } else if (tag === 'select') {
          if (!(el as HTMLSelectElement).value) return true;
        } else if (tag === 'textarea') {
          if (!(el as HTMLTextAreaElement).value.trim()) return true;
        }
      }
      return false;
    }

    // Programmatic submission must be denied if a current-application decision exists anywhere in
    // the live form, including a hidden or tenant-prechecked control. The fill result is only a
    // snapshot, so every countdown and dashboard entrance re-reads the DOM immediately before its
    // click. A trusted direct click is intentionally handled separately by the attended replay.
    function hasApplicationDecisionControls(): boolean {
      return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')]
        .some((control) => {
          if (control.closest('[id*="litos"]')) return false;
          const explicitLabel = control.id
            ? [...document.querySelectorAll<HTMLLabelElement>('label[for]')].find((label) => label.htmlFor === control.id)?.textContent ?? ''
            : '';
          const context = [
            control.id,
            control.getAttribute('name') ?? '',
            control.getAttribute('aria-label') ?? '',
            control.labels?.[0]?.textContent ?? explicitLabel,
            control.closest('fieldset, [role="group"], [role="radiogroup"]')?.textContent ?? '',
            control instanceof HTMLSelectElement
              ? [...control.options].map((option) => option.textContent ?? '').join(' ')
              : '',
          ].join(' ');
          return isPerApplicationDecisionQuestion(context);
        });
    }

    // Field labels in skipped_reasons come from the page DOM, so escape before inserting via
    // innerHTML - a hostile <label> must not be able to inject markup into our card.
    const escapeHtml = escapeApplicationText;

    // Show WHAT still needs the student, not just a filled count (the adapters compute a precise
    // skipped list that content.ts previously discarded). This is the difference between a form that
    // "looks done" and one where the student can see the resume, an agreement box, or a blank
    // required field still needs them before they submit.
    function renderFillSummary(
      statusEl: HTMLElement | null,
      fillResult: AutofillResult,
      opts: { resumeMissing: boolean; autoSubmitHeld: boolean; capOverride?: number },
    ): void {
      if (!statusEl) return;
      const head: string[] = [`Filled ${fillResult.fields_filled} field${fillResult.fields_filled === 1 ? '' : 's'}.`];
      if (opts.resumeMissing) head.push('Litos could not attach your resume. Add it yourself before you send.');
      if (opts.autoSubmitHeld) head.push('Waiting on you. Finish the items below, then send.');
      // Keep the reasons that actually need a human: resume, agreements, unmatched/never-fill,
      // required blanks. Selection + ordering live in the pure selectNeedsYouReasons (autosubmit-
      // gate.ts) so it stays unit-tested: required blanks sort ahead of the cap, because a card
      // that truncated a REQUIRED blank off its list read as complete over an empty required
      // field (R-033's second half). capOverride exists for the E-015 path: the form's own
      // validation list is authoritative and must never be truncated.
      const needsYou = selectNeedsYouReasons(fillResult.skipped_reasons, opts.capOverride);
      statusEl.style.display = 'block';
      statusEl.innerHTML =
        head.map((l) => `<div style="line-height:1.4;">${escapeHtml(l)}</div>`).join('') +
        (needsYou.length
          ? `<div style="margin-top:4px;font-weight:500;line-height:1.4;">Still needs you:</div>` +
            needsYou.map((r) => `<div style="line-height:1.4;">• ${escapeHtml(r)}</div>`).join('')
          : '') +
        `<div style="margin-top:4px;line-height:1.4;">Check it over, then send it yourself.</div>`;
    }

    /* The stall.
     *
     * Until now a challenge on an ATS form ended the in-browser fill SILENTLY: Litos filled the
     * form, the applicant pressed Submit, nothing appeared to happen, and the application quietly
     * never went anywhere. The fill itself was already correct - it stops at the submit button by
     * design - but nobody was told why it stopped, and "why" is the whole difference between a
     * ten-second interruption and an application that dies unnoticed.
     *
     * Litos does not solve the challenge. It cannot and must not: the applicant is sitting right
     * there, it is their application, and passing that check is exactly the thing the check exists
     * to establish. All this does is say so, in the place they are already looking.
     *
     * Armed AFTER the fill and watched for a while afterwards, because the common shape is a
     * challenge that mounts on the first submit attempt rather than one present at page load. */
    let captchaStallStop: (() => void) | null = null;
    /* Read by the auto-submit gate and re-read immediately before the click. A challenge is the one
     * blocker where submitting anyway is actively harmful rather than merely useless: the employer
     * records the applicant as bot traffic and can discard the application with no error shown to
     * anyone. Same failure the honeypot guard exists to prevent. */
    let captchaWaiting = false;
    let captchaResumeCancel: (() => void) | null = null;
    /* Every arm gets a number, and everything async closes over the one it started with.
     * The permission read is a round trip, so a re-arm (a refill, a second "Yes", an SPA route
     * change) can land while it is in flight - and a superseded arm that still runs would clobber
     * the live arm's cancel handle, clear the shared challenge flag, and write its message into the
     * previous card. */
    let captchaArmId = 0;

    function armCaptchaStall(
      card: HTMLElement,
      statusEl: HTMLElement | null,
      context: { company: string; role: string; atsName?: string },
      onChallenge?: () => void,
    ): void {
      captchaStallStop?.();
      captchaResumeCancel?.();
      captchaResumeCancel = null;
      captchaWaiting = false;
      const armId = (captchaArmId += 1);
      captchaStallStop = watchForChallenge(
        // The WHOLE document, and the same node the detection reads. Scoping this to the first
        // <form> was wrong twice over: providers append challenge overlays to document.body, so the
        // observer never saw them, and on a board page document.querySelector('form') is usually a
        // search or newsletter box rather than the application.
        document.documentElement,
        (state) => {
          captchaWaiting = true;
          /* Rendered as its own node NEXT TO statusEl, never inside it. statusEl is repeatedly
           * reassigned with textContent by the countdown ("... in 4 seconds") and by the review
           * callback, and every one of those assignments wipes its children - so a line prepended
           * into it disappears a tick later, exactly in the case where the challenge was already on
           * the page when the fill finished. */
          card.querySelector('#litos-captcha-stall')?.remove();
          const line = document.createElement('div');
          line.id = 'litos-captcha-stall';
          line.style.cssText = 'margin-top:6px;line-height:1.4;font-weight:500;';
          line.textContent = 'This company asks you to prove you are human. Everything else is filled in, so all that is left is that check and the send button.';
          (statusEl?.parentElement ?? card).insertBefore(line, statusEl?.nextSibling ?? null);
          onChallenge?.();
          /* Resume after solve, gated on its own permission.
           *
           * Litos does not solve the challenge and does not read the token: it watches its own
           * detection until a human has cleared it. Even then it does not send anything - it
           * re-checks the form and says what is left, because a challenge re-render routinely
           * resets fields, and telling someone their application is ready when the form quietly
           * emptied is the failure this whole feature exists to avoid. */
          void serverCaptchaResumeEnabled().then((permitted) => {
            if (!permitted || armId !== captchaArmId) return;
            const waiter = waitForChallengeCleared();
            captchaResumeCancel = waiter.cancel;
            return waiter.promise.then((solved) => {
              if (!solved || armId !== captchaArmId) return;
              captchaWaiting = false;
              const stillEmpty = hasEmptyRequiredFields();
              const message = stillEmpty
                ? 'Thanks. That check cleared, but the page reset some required boxes when it did, so fill those in before you send.'
                : 'Thanks. That check cleared and everything is still filled in. Send it whenever you are ready.';
              /* The card may be GONE by now, and in the case this feature is most for. A challenge
               * that mounts during the countdown cancels it, and that cancel path removes the card
               * four seconds later - while a human clearing a CAPTCHA takes ten seconds to two
               * minutes. Writing into the old card would mutate a detached tree nobody can see, so
               * a fresh host is injected instead. */
              if (card.isConnected) {
                card.querySelector('#litos-captcha-stall')?.remove();
                line.textContent = message;
                (statusEl?.parentElement ?? card).insertBefore(line, statusEl?.nextSibling ?? null);
                return;
              }
              document.getElementById('litos-captcha-resumed')?.remove();
              const revived = document.createElement('div');
              revived.id = 'litos-captcha-resumed';
              revived.style.cssText = 'position:fixed;bottom:20px;right:76px;z-index:2147483645;max-width:320px;'
                + 'background:#fff;border:1px solid #e8e6e1;border-radius:10px;padding:12px 14px;'
                + 'box-shadow:0 3px 14px rgba(21,20,18,0.16);font-family:"Hanken Grotesk Variable","Hanken Grotesk",sans-serif;'
                + 'font-size:13px;line-height:1.4;color:#12120f;';
              revived.textContent = message;
              document.body.appendChild(revived);
              setTimeout(() => revived.remove(), 15_000);
            });
          });
          // Fire-and-forget. The badge and the queue read this; a delivery failure must never take
          // down a fill that already succeeded, and there is nothing to retry for.
          try {
            chrome.runtime.sendMessage({
              type: 'CAPTCHA_STALL',
              payload: {
                provider: state.provider,
                url: location.href,
                job_context: { company: context.company, role: context.role },
                ats_name: context.atsName,
                stalled_at: new Date().toISOString(),
              },
            });
          } catch {
            // Service worker asleep or torn down. Nothing here is worth failing the fill over.
          }
        },
        // Bounded: past a couple of minutes the applicant has moved on, and an observer left
        // attached runs on every DOM change the board makes for as long as the tab is open.
        { timeoutMs: 120_000 },
      );
    }

    // E-015 watcher. A MutationObserver, deliberately NOT an event listener: a capture-phase
    // click listener on document measurably broke keyboard input into Ashby's React fields on
    // the live QA build (typed characters vanished with the input focused; removing the listener
    // restored typing; bisected 2026-07-18). Watching for the ATS's own error nodes appearing is
    // passive with respect to the page's input pipeline and needs no knowledge of when submit was
    // clicked - validation errors only exist after a refusal. Re-fires on later refusals too; the
    // latest fill's card state rides module vars so a refill redirects the same observer.
    let validationCardState: {
      statusEl: HTMLElement | null;
      fillResult: AutofillResult;
      resumeMissing: boolean;
    } | null = null;
    let validationObserver: MutationObserver | null = null;
    let validationDebounce: ReturnType<typeof setTimeout> | null = null;

    function armValidationAuthority(
      statusEl: HTMLElement | null,
      fillResult: AutofillResult,
      resumeMissing: boolean,
    ): void {
      validationCardState = { statusEl, fillResult, resumeMissing };
      if (validationObserver) return;
      validationObserver = new MutationObserver(() => {
        // Debounce: refusals render many nodes in one burst, and the extract walks the DOM.
        if (validationDebounce) clearTimeout(validationDebounce);
        validationDebounce = setTimeout(() => {
          const state = validationCardState;
          if (!state) return;
          const errors = extractValidationErrors(document);
          if (!errors.length) return;
          const merged = mergeValidationReasons(
            state.fillResult.skipped_reasons,
            validationErrorsToReasons(errors),
          );
          if (merged.length === state.fillResult.skipped_reasons.length) return;
          state.fillResult.skipped_reasons = merged;
          // The summary card self-dismisses ~9s after the fill, so by the time the student
          // submits, statusEl is usually detached. The refusal verdict needs somewhere to
          // land: re-inject a minimal status host rather than rendering into a ghost node.
          if (!state.statusEl || !state.statusEl.isConnected) {
            document.getElementById('litos-validation-card')?.remove();
            const host = document.createElement('div');
            host.id = 'litos-validation-card';
            host.style.cssText =
              `position:fixed;right:${OVERLAY.right};bottom:${OVERLAY.bottom};z-index:${OVERLAY.z};width:${OVERLAY.width};` +
              `background:#fff;border:1px solid ${COLOR.border};border-radius:${RADIUS.card};box-shadow:${SHADOW.raised};` +
              `padding:12px 14px;font:13px/1.45 ${FONT.sans};color:${COLOR.ink};`;
            document.documentElement.appendChild(host);
            state.statusEl = host;
          }
          renderFillSummary(state.statusEl, state.fillResult, {
            resumeMissing: state.resumeMissing,
            autoSubmitHeld: true,
            capOverride: merged.length,
          });
        }, 700);
      });
      validationObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Result of the background resume-gen round trip, cached per job (company|role) for the tab's
    // life so a multi-step flow reuses step 1's resume instead of paying for - and being metered
    // for - a fresh generation on every step.
    type ResumeGenResult = {
      error?: string;
      api_error?: SerializedLitosApiError;
      profile?: Profile;
      applicationProfile?: ApplicationProfile;
      resume?: GeneratedResume;
      // This posting's structured salary range (R-031), fetched by the background from Ashby's
      // posting API off the tab URL; null/absent on every other ATS or when nothing usable exists.
      posting_compensation?: PostingCompensation | null;
    };
    const resumeGenByJob = new Map<string, Promise<ResumeGenResult>>();
    const resumeOperationIdByJob = new Map<string, string>();

    function watchSubmitButton(title: string, company: string, url: string) {
      let watched = false;
      let observer: MutationObserver | null = null;

      function attachListener() {
        if (watched) return;
        const btn = findSubmitButton();
        if (!btn) return;
        watched = true;
        // The button exists; stop re-scanning the whole body subtree on every mutation.
        // Without this the observer runs findSubmitButton() (several querySelectorAll + a text
        // scan of every button) on each DOM change for the life of the tab.
        observer?.disconnect();

        btn.addEventListener('click', () => {
          // Remove card 1 if still showing
          document.getElementById('litos-action-card')?.remove();
          cardInjected = false;
          injectSubmitCard(title, company, url);
        });
      }

      // Try immediately; only fall back to watching for the button (multi-step forms) if it
      // isn't there yet, and disconnect as soon as it is (in attachListener).
      attachListener();
      if (!watched) {
        observer = new MutationObserver(() => attachListener());
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }

    // ─── LinkedIn Easy Apply modal detection ────────────────────────────────

    function watchLinkedInEasyApply(title: string, company: string) {
      const modalSelectors = [
        '[data-test-modal-id="easy-apply-modal"]',
        '[aria-label="Easy Apply"]',
        '.jobs-easy-apply-modal',
        '[class*="easy-apply-modal"]',
      ];

      function checkForModal() {
        const modal = modalSelectors.reduce<Element | null>(
          (found, sel) => found ?? document.querySelector(sel),
          null
        );
        if (modal && !cardInjected) {
          injectActionCard(title, company, window.location.href);
          // Also watch for the submit button inside the modal
          watchSubmitButton(title, company, window.location.href);
        }
        // Fill-and-stop, same as Lever/Greenhouse/Ashby (2026-07-02: form-fill now runs
        // on LinkedIn too, not just resume-gen). Easy Apply already implies a real
        // LinkedIn account exists (there's no separate account-creation step inside it).
        if (isLinkedInApplicationPage()) {
          injectResumeFillCard(title, company, extractLinkedInJdText, fillLinkedInApplication);
        }
      }

      const easyApplyBtns = document.querySelectorAll(
        '[data-control-name="jobs_apply_button"], [aria-label*="Easy Apply"], button[class*="easy-apply"]'
      );

      easyApplyBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          let attempts = 0;
          const poll = setInterval(() => {
            checkForModal();
            if (++attempts >= 10 || cardInjected) clearInterval(poll);
          }, 300);
        });
      });

      const modalObserver = new MutationObserver(() => {
        if (!cardInjected) checkForModal();
      });
      modalObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ─── Card helpers ────────────────────────────────────────────────────────

    // Every card goes into one fixed bottom-right stack and flows vertically (2026-07-04,
    // Mehek's direction) - previously each card type carried its own hardcoded `right` offset
    // (20px / 306px), which put two simultaneous cards side by side and would overlap them
    // outright if a third ever fired. Cards keep their own ids; removing one collapses the
    // stack naturally, and an empty container is invisible.
    function getCardStack(): HTMLElement {
      let stack = document.getElementById('litos-card-stack');
      if (!stack) {
        stack = document.createElement('div');
        stack.id = 'litos-card-stack';
        stack.style.cssText =
          `position:fixed;bottom:${OVERLAY.bottom};right:${OVERLAY.right};z-index:${OVERLAY.z};display:flex;flex-direction:column;align-items:flex-end;gap:${OVERLAY.gap};`;
        document.body.appendChild(stack);
      }
      return stack;
    }

    function cardShell(headline: string, subline: string): string {
      return `
        <div style="
          position: relative;
          background: white;
          border: 1px solid ${COLOR.border};
          border-radius: ${RADIUS.card};
          padding: 16px 16px 14px;
          font-family: ${FONT.sans}; color-scheme: only light;
          font-size: 13px;
          line-height: 1.4;
          box-shadow: ${SHADOW.raised};
          width: 272px;
          box-sizing: border-box;
          animation: wp-slide-in 0.25s ease-out;
        ">
          <button id="wp-close" style="position:absolute;top:10px;right:12px;background:none;border:none;cursor:pointer;font-size:17px;opacity:0.55;color:${COLOR.muted};padding:0;line-height:1;">×</button>
          <div style="display:flex;align-items:flex-start;gap:9px;margin-bottom:12px;line-height:1.4;">
            <div>
              <div style="font-weight:500;font-size:13px;color:${COLOR.ink};line-height:1.4;">${escapeHtml(headline)}</div>
              <div style="font-size:12px;color:${COLOR.muted};margin-top:2px;word-break:break-word;line-height:1.4;">${escapeHtml(subline)}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button id="wp-yes" style="
              flex:1;background:${COLOR.brand};color:white;border:none;border-radius:${RADIUS.control};
              min-height:44px;padding:0 12px;font-size:13px;font-weight:500;cursor:pointer;
              font-family:${FONT.sans};color-scheme:only light;
            ">Find people</button>
            <button id="wp-no" style="
              flex:1;background:${COLOR.surfaceAlt};color:${COLOR.ink};border:none;border-radius:${RADIUS.control};
              min-height:44px;padding:0 12px;font-size:13px;font-weight:500;cursor:pointer;
              font-family:${FONT.sans};color-scheme:only light;
            ">Not this time</button>
          </div>
          <!-- A forced yes/no on someone's own application page left no way to stop being
               interrupted short of uninstalling. This is the third answer. -->
          <button id="wp-never" style="
            margin-top:10px;background:none;border:none;padding:0;cursor:pointer;
            font-size:11px;color:${COLOR.faint};text-decoration:underline;text-underline-offset:2px;
            font-family:${FONT.sans};color-scheme:only light;
          ">Never ask me on this site again</button>
        </div>
        <style>
          @keyframes wp-slide-in {
            from { transform: translateY(16px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        </style>
      `;
    }

    function attachCardHandlers(card: HTMLElement, title: string, company: string, url: string) {
      // A retry of this exact card action must reach the server with the same operation ID so
      // response loss cannot consume the Trial company meters more than once.
      const outreachOperationId = crypto.randomUUID();
      const dismiss = () => { card.remove(); cardInjected = false; };
      card.querySelector('#wp-close')?.addEventListener('click', dismiss);
      card.querySelector('#wp-no')?.addEventListener('click', dismiss);
      // Remembered per hostname, so the answer holds for this employer's site rather than only
      // for this one posting. Read back by shouldOfferOnThisHost() before any card is injected.
      card.querySelector('#wp-never')?.addEventListener('click', () => {
        try {
          chrome.storage.local.get([MUTED_HOSTS_KEY], (items) => {
            const hosts: string[] = Array.isArray(items?.[MUTED_HOSTS_KEY]) ? items[MUTED_HOSTS_KEY] : [];
            if (!hosts.includes(location.hostname)) hosts.push(location.hostname);
            chrome.storage.local.set({ [MUTED_HOSTS_KEY]: hosts });
          });
        } catch {
          /* storage unavailable: still dismiss, the student asked us to go away */
        }
        dismiss();
      });
      const requestOutreach = () => {
        approved = true;
        const inner = card.querySelector('div') as HTMLElement;
        inner.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;">
            <div>
              <div style="font-weight:500;font-size:13px;color:${COLOR.ink};">Finding people to email</div>
              <div style="font-size:12px;color:${COLOR.muted};margin-top:2px;">Checking your plan and verified contact options</div>
            </div>
          </div>
        `;
        chrome.runtime.sendMessage(
          { type: 'JOB_APPROVED', payload: { title, company, url, operation_id: outreachOperationId } },
          (response: {
            ok?: boolean;
            count?: number;
            error?: string;
            api_error?: SerializedLitosApiError;
            failures?: Array<{ contact_id: string; contact_name: string; error: string }>;
          } | undefined) => {
            if (!card.isConnected) return;
            const renderActions = (input: {
              heading: string;
              detail: string;
              primary: string;
              onPrimary: () => void;
              secondary?: string;
              onSecondary?: () => void;
            }) => {
              inner.innerHTML = `
                <div style="font-weight:500;font-size:13px;color:${COLOR.ink};line-height:1.4;"></div>
                <div data-litos-outreach-detail style="font-size:12px;color:${COLOR.muted};margin-top:3px;line-height:1.4;"></div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                  <button data-litos-outreach-primary style="flex:1;background:${COLOR.brand};color:white;border:0;border-radius:${RADIUS.control};min-height:44px;padding:0 10px;font:500 12px ${FONT.sans};cursor:pointer;"></button>
                  ${input.secondary ? `<button data-litos-outreach-secondary style="flex:1;background:${COLOR.surfaceAlt};color:${COLOR.ink};border:0;border-radius:${RADIUS.control};min-height:44px;padding:0 10px;font:500 12px ${FONT.sans};cursor:pointer;"></button>` : ''}
                </div>
              `;
              const heading = inner.firstElementChild as HTMLElement | null;
              const detail = inner.querySelector<HTMLElement>('[data-litos-outreach-detail]');
              const primary = inner.querySelector<HTMLButtonElement>('[data-litos-outreach-primary]');
              const secondary = inner.querySelector<HTMLButtonElement>('[data-litos-outreach-secondary]');
              if (heading) heading.textContent = input.heading;
              if (detail) detail.textContent = input.detail;
              if (primary) {
                primary.textContent = input.primary;
                primary.addEventListener('click', input.onPrimary);
              }
              if (secondary && input.secondary) {
                secondary.textContent = input.secondary;
                secondary.addEventListener('click', input.onSecondary ?? dismiss);
              }
            };

            if (chrome.runtime.lastError || !response) {
              renderActions({
                heading: 'Could not finish',
                detail: chrome.runtime.lastError?.message || 'Litos did not respond. Nothing was sent.',
                primary: 'Try again',
                onPrimary: requestOutreach,
                secondary: 'Close',
              });
              return;
            }
            if (response.ok && (response.count ?? 0) > 0) {
              inner.innerHTML = `
                <div data-litos-outreach-heading style="font-weight:500;font-size:13px;color:${COLOR.ink};"></div>
                <div data-litos-outreach-detail style="font-size:12px;color:${COLOR.muted};margin-top:2px;"></div>
              `;
              const count = response.count ?? 0;
              const heading = inner.querySelector<HTMLElement>('[data-litos-outreach-heading]');
              const detail = inner.querySelector<HTMLElement>('[data-litos-outreach-detail]');
              if (heading) heading.textContent = count === 1 ? 'Outreach draft ready' : 'Outreach drafts ready';
              if (detail) {
                const failedNames = (response.failures ?? []).map((failure) => failure.contact_name).join(', ');
                const partial = failedNames ? ` Drafting failed for ${failedNames}; no successful draft was discarded.` : '';
                detail.textContent = `Open Litos to review ${count === 1 ? 'the draft' : `${count} drafts`}. Nothing was sent.${partial}`;
              }
              setTimeout(dismiss, DISMISS_MS.confirmation);
              return;
            }
            if (response.ok) {
              renderActions({
                heading: 'No verified contacts found',
                detail: 'You can still add someone you know and write the message yourself.',
                primary: 'Add manually',
                onPrimary: () => {
                  chrome.runtime.sendMessage({ type: 'OPEN_MANUAL_OUTREACH', company, role: title });
                  dismiss();
                },
                secondary: 'Close',
              });
              return;
            }
            if (response.api_error?.status === 402) {
              renderActions({
                heading: 'Find people with Litos+',
                detail: response.error || 'Contact discovery and AI outreach drafts are part of Litos+.',
                primary: 'See Litos+',
                onPrimary: () => {
                  const primary = inner.querySelector<HTMLButtonElement>('[data-litos-outreach-primary]');
                  const detail = inner.querySelector<HTMLElement>('[data-litos-outreach-detail]');
                  if (primary) {
                    primary.disabled = true;
                    primary.textContent = 'Opening Litos+...';
                  }
                  openLitosPlansFromPage('contact_discovery', {
                    company,
                    role: title,
                    portal_url: window.location.href,
                  }, (result) => {
                    if (result.ok) {
                      dismiss();
                      return;
                    }
                    if (primary) {
                      primary.disabled = false;
                      primary.textContent = 'Try again';
                    }
                    if (detail) detail.textContent = result.error ?? 'Litos+ options could not open.';
                  });
                },
                secondary: 'Add manually',
                onSecondary: () => {
                  chrome.runtime.sendMessage({ type: 'OPEN_MANUAL_OUTREACH', company, role: title });
                  dismiss();
                },
              });
              return;
            }
            renderActions({
              heading: 'Could not finish',
              detail: (response.failures?.length
                ? `${response.error || 'Litos could not prepare outreach.'} ${response.failures.map((failure) => `${failure.contact_name}: ${failure.error}`).join(' ')}`
                : response.error) || 'Litos could not prepare outreach. Nothing was sent.',
              primary: 'Try again',
              onPrimary: requestOutreach,
              secondary: 'Close',
            });
          },
        );
      };
      card.querySelector('#wp-yes')?.addEventListener('click', requestOutreach);
    }

    // Card 1: fires when application form loads
    function injectActionCard(title: string, company: string, url: string) {
      if (cardInjected || document.getElementById('litos-action-card')) return;
      // Honour "Never ask on this site" before anything is drawn.
      chrome.storage.local.get([MUTED_HOSTS_KEY], (items) => {
        const hosts: string[] = Array.isArray(items?.[MUTED_HOSTS_KEY]) ? items[MUTED_HOSTS_KEY] : [];
        if (hosts.includes(location.hostname)) return;
        drawActionCard(title, company, url);
      });
    }

    function drawActionCard(title: string, company: string, url: string) {
      if (cardInjected || document.getElementById('litos-action-card')) return;
      cardInjected = true;

      chrome.runtime.sendMessage({ type: 'JOB_DETECTED', payload: { title, company, url } });

      const card = document.createElement('div');
      card.id = 'litos-action-card';
      card.innerHTML = cardShell(
        'Want to email someone here?',
        `${title} at ${company}`
      );
      getCardStack().appendChild(card);
      attachCardHandlers(card, title, company, url);
    }

    // Submission status replaces the application card when the portal's Submit button is clicked.
    function injectSubmitCard(title: string, company: string, url: string) {
      if (document.getElementById('litos-submit-card')) return;
      cardInjected = true;
      document.getElementById('litos-action-card')?.remove();
      document.getElementById('litos-resume-card')?.remove();

      const card = document.createElement('div');
      card.id = 'litos-submit-card';
      card.innerHTML = `
        <div style="position:relative;background:white;border:1px solid ${COLOR.border};border-radius:${RADIUS.card};padding:16px;font-family:${FONT.sans};color-scheme:only light;font-size:13px;line-height:1.4;box-shadow:${SHADOW.raised};width:${OVERLAY.width};box-sizing:border-box;animation:wp-slide-in 0.25s ease-out;">
          <button id="wp-submit-close" aria-label="Close Litos submission status" style="position:absolute;top:10px;right:12px;background:none;border:none;cursor:pointer;font-size:17px;opacity:0.55;color:${COLOR.muted};padding:0;line-height:1;">×</button>
          <div style="display:flex;align-items:flex-start;gap:9px;line-height:1.4;">
            <span id="wp-submit-icon" style="font-size:20px;flex-shrink:0;line-height:1.4;"><canvas id="wp-submit-orb"></canvas></span>
            <div style="line-height:1.4;">
              <div id="wp-submit-title" style="font-weight:500;font-size:13px;color:${COLOR.ink};line-height:1.4;">Sending</div>
              <div style="font-size:12px;color:${COLOR.muted};margin-top:2px;word-break:break-word;line-height:1.4;">${escapeHtml(title)} at ${escapeHtml(company)}</div>
              <div id="wp-submit-status" role="status" aria-live="polite" style="font-size:12.5px;font-family:${FONT.mono};color:${COLOR.muted};margin-top:8px;line-height:1.4;">${submissionProgress(0)}</div>
            </div>
          </div>
        </div>
      `;
      getCardStack().appendChild(card);

      const startedAt = Date.now();
      const statusEl = card.querySelector<HTMLElement>('#wp-submit-status');
      const titleEl = card.querySelector<HTMLElement>('#wp-submit-title');
      const iconEl = card.querySelector<HTMLElement>('#wp-submit-icon');
      const submitOrbCanvas = card.querySelector<HTMLCanvasElement>('#wp-submit-orb');
      let stopSubmitOrb: (() => void) | null = null;
      if (submitOrbCanvas) stopSubmitOrb = mountThinkingOrb(submitOrbCanvas, 'searching', 20);
      const stopSubmitOrbAnd = (setIcon: () => void) => {
        stopSubmitOrb?.();
        stopSubmitOrb = null;
        setIcon();
      };
      let outcomeObserver: MutationObserver | null = null;
      let timer: ReturnType<typeof setInterval>;
      const outcomeSelectors = [
        '[role="alert"]',
        '[role="status"]',
        '[aria-live]',
        'h1',
        'h2',
        '[class*="error" i]',
        '[class*="success" i]',
        '[class*="confirm" i]',
        '[class*="thank" i]',
      ].join(',');
      const readOutcomeText = (): string => [...document.querySelectorAll<HTMLElement>(outcomeSelectors)]
        .filter((element) => !card.contains(element))
        .map((element) => element.textContent ?? '')
        .join(' ');
      const stopResources = () => {
        clearInterval(timer);
        outcomeObserver?.disconnect();
      };
      const outcomeController = createSubmissionOutcomeController({
        readText: readOutcomeText,
        onStop: stopResources,
        onOutcome: (outcome) => {
        if (outcome.kind === 'failure') {
          stopSubmitOrbAnd(() => { if (iconEl) setStatusIcon(iconEl, 'problem'); });
          if (titleEl) titleEl.textContent = 'Not sent';
          if (statusEl) statusEl.textContent = outcome.message;
        } else {
          stopSubmitOrbAnd(() => { if (iconEl) setStatusIcon(iconEl, 'ok'); });
          if (titleEl) titleEl.textContent = 'Sent';
          if (statusEl) statusEl.textContent = 'The company confirmed they got it.';
        }
        },
        onUnknown: () => {
          stopSubmitOrbAnd(() => { if (iconEl) setStatusIcon(iconEl, 'unknown'); });
          if (titleEl) titleEl.textContent = 'Not sure it went through';
          if (statusEl) statusEl.textContent = 'Open the tab and check before you send it again.';
        },
      });
      timer = setInterval(() => {
        if (!card.isConnected) {
          outcomeController.stop();
          return;
        }
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        if (outcomeController.scan()) return;
        // Native browser validation can reject a click before any request leaves the page. Do not
        // tell the student Litos is waiting on the company when the form is visibly incomplete.
        if (!outcomeController.isFinished() && elapsedSeconds >= 1 && hasEmptyRequiredFields()) {
          stopSubmitOrbAnd(() => { if (iconEl) setStatusIcon(iconEl, 'problem'); });
          if (titleEl) titleEl.textContent = 'Needs you';
          if (statusEl) statusEl.textContent = 'The form did not go through. Fill in what is missing, then try again.';
          return;
        }
        if (!outcomeController.isFinished() && statusEl) {
          statusEl.textContent = submissionProgress(elapsedSeconds);
        }
      }, 1000);
      outcomeObserver = new MutationObserver(outcomeController.queueScan);
      outcomeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
      card.querySelector('#wp-submit-close')?.addEventListener('click', () => {
        outcomeController.stop();
        stopSubmitOrb?.();
        stopSubmitOrb = null;
        card.remove();
        cardInjected = false;
      });
      outcomeController.scan();
    }

    // ─── v2: resume-gen + Lever autofill (fill-and-stop, never clicks Submit) ──────────

    function resumeFillCardShell(title: string, company: string): string {
      return `
        <div style="
          position: relative;
          background: white; border: 1px solid ${COLOR.border}; border-radius: ${RADIUS.card};
          padding: 16px 16px 14px; font-family: ${FONT.sans}; color-scheme: only light;
          font-size: 13px; line-height: 1.4; box-shadow: ${SHADOW.raised};
          width: 300px; box-sizing: border-box; animation: wp-slide-in 0.25s ease-out;
        ">
          <button id="wp-resume-close" aria-label="Close Litos resume assistant" style="position:absolute;top:10px;right:12px;background:none;border:none;cursor:pointer;font-size:17px;opacity:0.55;color:${COLOR.muted};padding:0;line-height:1;">×</button>
          <div style="display:flex;align-items:flex-start;gap:9px;margin-bottom:12px;line-height:1.4;">
            ${markSvg()}
            <div>
              <div id="wp-resume-heading" style="font-weight:500;font-size:13px;color:${COLOR.ink};line-height:1.4;">Fill this application for you?</div>
              <div style="font-size:12px;color:${COLOR.muted};margin-top:2px;word-break:break-word;line-height:1.4;">${escapeHtml(title)} at ${escapeHtml(company)}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;min-width:0;">
            <canvas id="wp-resume-orb" style="display:none;flex-shrink:0;"></canvas>
            <div id="wp-resume-status" style="font-size:11px;color:${COLOR.muted};display:none;line-height:1.4;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
          </div>
          <div id="wp-resume-announcer" role="status" aria-live="polite" aria-atomic="true" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;"></div>
          <div style="display:flex;gap:8px;">
            <button id="wp-resume-yes" disabled style="
              flex:1;background:${COLOR.brand};color:white;border:none;border-radius:${RADIUS.control};
              min-height:44px;padding:0 12px;font-size:13px;font-weight:500;cursor:wait;
              font-family:${FONT.sans};color-scheme:only light;
            ">Checking plan...</button>
            <button id="wp-resume-no" style="
              flex:1;background:${COLOR.surfaceAlt};color:${COLOR.ink};border:none;border-radius:${RADIUS.control};
              min-height:44px;padding:0 12px;font-size:13px;font-weight:500;cursor:pointer;
              font-family:${FONT.sans};color-scheme:only light;
            ">Not this time</button>
          </div>
        </div>
      `;
    }

    type FillFn = (params: {
      fullName: string;
      email?: string;
      profile: Profile;
      applicationProfile: ApplicationProfile;
      resumeBlob?: Blob;
      resumeFileName?: string;
      // Generic-adapter-only extras (ATS adapters ignore them). eeo carries the student's
      // demographic prefs for EEO questions; draftAnswer AI-drafts an open-ended textarea.
      eeo?: Record<string, string>;
      draftAnswer?: (question: string) => Promise<string | null>;
      signal?: AbortSignal;
      onProgress?: (partial: { fields_filled: number; fields_skipped: number; ai_drafted: number; pendingEssays: number }) => void;
      // Ashby-only today (the other adapters ignore it): the posting's structured salary range,
      // for the R-031 median rule.
      postingCompensation?: PostingCompensation | null;
    }) => Promise<AutofillResult>;

    // Shared by every ATS adapter: generate the JD-tailored resume, then run that adapter's
    // client-side fill-and-stop. Only the JD-extraction and fill functions differ per ATS.
    function injectResumeFillCard(
      title: string,
      company: string,
      extractJdText: () => string,
      fill: FillFn,
      initialHandoffApplicationId?: string,
      expectedGatePacket?: { handoffVersion: string; applicantEmail: string },
      initialFreeFillApplicationId?: string,
    ) {
      if (document.getElementById('litos-resume-card')) return;
      // Resume preparation and outreach are one application workflow, not two competing prompts.
      // Keep only the active resume task visible. Outreach can return after submission.
      document.getElementById('litos-action-card')?.remove();
      cardInjected = false;
      const card = document.createElement('div');
      card.id = 'litos-resume-card';
      card.innerHTML = resumeFillCardShell(title, company);
      getCardStack().appendChild(card);

      // New Free, trial, and original Free accounts start generation only after the named action,
      // so a passive hover cannot consume a trial unit. Active paid accounts may pre-warm on hover
      // when the live entitlement says so. Page detection and card injection never start work.
      let jdCache: string | null = null;
      const getJd = (): string => (jdCache ??= extractJdText());
      let resumeGenStartedAt: number | null = null;
      const announcerEl = card.querySelector<HTMLElement>('#wp-resume-announcer');
      const statusEl = card.querySelector<HTMLElement>('#wp-resume-status');
      const orbCanvas = card.querySelector<HTMLCanvasElement>('#wp-resume-orb');
      let stopOrb: (() => void) | null = null;
      const generationController = createResumeGenerationController({
        statusElement: statusEl,
        announcerElement: announcerEl,
      });
      let handoffApplicationId: string | null = initialHandoffApplicationId ?? null;
      let handoffFormUrl: string | null = initialHandoffApplicationId ? window.location.href : null;
      let dashboardFreeFillApplicationId: string | null = initialFreeFillApplicationId ?? null;
      let handoffClaimSettled = Boolean(initialHandoffApplicationId || initialFreeFillApplicationId);
      let resolveHandoffClaim: (() => void) | null = null;
      const handoffClaimReady = handoffClaimSettled
        ? Promise.resolve()
        : new Promise<void>((resolve) => { resolveHandoffClaim = resolve; });
      const settleHandoffClaim = (): void => {
        if (handoffClaimSettled) return;
        handoffClaimSettled = true;
        resolveHandoffClaim?.();
        resolveHandoffClaim = null;
      };

      // Must stay longer than the background's WHOLE budget so its descriptive error surfaces
      // first; this is only the backstop for the worse case where the service worker is torn down
      // and the callback never fires at all.
      // This was 65s, sized against a single 60s resume fetch. That cap is now load-bearing in a
      // way it wasn't: the background retries a transient model overload for up to 150s across
      // fresh requests (R-003, live QA 2026-07-16 - the backend can't retry past Vercel's 60s
      // function ceiling, so only the client can outlive an incident). Leaving this at 65s would
      // have made that retry unreachable - the card would declare a timeout while the retry that
      // was about to succeed was still in flight, which is just the old hard failure with extra
      // steps. So: the background's 150s budget + one final 60s fetch + slack.
      const RESUME_GEN_TIMEOUT_MS = 215000;
      const jobKey = `${company}\u0000${title}`;
      const startResumeGen = (initiation: 'explicit' | 'hover' = 'explicit'): Promise<ResumeGenResult> => {
        const cacheKey = handoffApplicationId ? `application:${handoffApplicationId}` : jobKey;
        const cached = resumeGenByJob.get(cacheKey);
        if (cached) return cached; // reuse across steps of a multi-step application (no re-charge)
        const operationId = resumeOperationIdByJob.get(cacheKey) ?? crypto.randomUUID();
        resumeOperationIdByJob.set(cacheKey, operationId);
        resumeGenStartedAt = Date.now();
        const p = new Promise<ResumeGenResult>((resolve) => {
          let settled = false;
          const done = (r: ResumeGenResult) => {
            if (settled) return;
            settled = true;
            if (r.error) {
              // Let a retry run, but retain its operation ID because the server may have committed
              // before the response was lost.
              resumeGenByJob.delete(cacheKey);
            } else {
              resumeOperationIdByJob.delete(cacheKey);
            }
            resolve(r);
          };
          const timer = setTimeout(
            () => done({ error: 'The resume took too long. Fill this form yourself.' }),
            RESUME_GEN_TIMEOUT_MS,
          );
          chrome.runtime.sendMessage(
            // `url` lets the background fetch Ashby's structured compensation range (R-031)
            // for this exact posting; harmless everywhere else (it resolves to null).
            handoffApplicationId
              ? { type: 'GET_APPLICATION_HANDOFF_PACKET', applicationId: handoffApplicationId }
              : {
                type: 'GENERATE_RESUME_AND_FILL_DATA',
                payload: {
                  company,
                  role: title,
                  jd_text: getJd(),
                  url: location.href,
                  initiation,
                  operation_id: operationId,
                },
              },
            (result: ResumeGenResult | undefined) => {
              clearTimeout(timer);
              // A dead service worker resolves the callback with lastError set (or with no
              // result), rather than the response object - treat both as a recoverable error
              // instead of letting `undefined` fall through as a fake success.
              if (chrome.runtime.lastError || !result) {
                done({ error: chrome.runtime.lastError?.message || 'Litos could not finish. Fill this form in yourself.' });
              } else if (expectedGatePacket && (
                result.resume?.handoff_version !== expectedGatePacket.handoffVersion
                || applicantEmailForGeneratedPacket(result.resume) !== expectedGatePacket.applicantEmail
              )) {
                done({ error: 'The saved application changed while you cleared the company gate. Return to your Litos Tracker and prepare it again.' });
              } else {
                done(result);
              }
            },
          );
        });
        resumeGenByJob.set(cacheKey, p);
        return p;
      };

      const getFillAccess = (): Promise<{
        can_tailor?: boolean;
        can_draft_answers?: boolean;
        hover_generation?: boolean;
        automatic_submission?: boolean;
      }> => new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_FILL_ACCESS' }, (response) => {
          resolve(response ?? {
            can_tailor: false,
            can_draft_answers: false,
            hover_generation: false,
            automatic_submission: false,
          });
        });
      });

      let secondaryAction: 'dismiss' | 'fill_free' | 'plans' = 'dismiss';
      let forceFreeFill = false;
      let actionStarted = false;
      const primaryControl = card.querySelector<HTMLButtonElement>('#wp-resume-yes');
      const secondaryControl = card.querySelector<HTMLButtonElement>('#wp-resume-no');
      const fillActionGate = handoffApplicationId ? null : createFillActionGate(getFillAccess);
      let resolvedFillPresentation: FillActionPresentation | null = null;
      const renderResolvedFillAction = (): void => {
        if (!card.isConnected || actionStarted) return;
        if (handoffApplicationId) {
          if (primaryControl) {
            primaryControl.textContent = 'Fill saved application';
            primaryControl.disabled = false;
            primaryControl.style.cursor = 'pointer';
          }
          return;
        }
        if (!handoffClaimSettled || !resolvedFillPresentation) return;
        if (dashboardFreeFillApplicationId) {
          secondaryAction = 'dismiss';
          if (primaryControl) {
            primaryControl.textContent = 'Fill application';
            primaryControl.disabled = false;
            primaryControl.style.cursor = 'pointer';
          }
          if (secondaryControl) secondaryControl.textContent = 'Not this time';
          return;
        }
        secondaryAction = resolvedFillPresentation.secondaryAction;
        if (primaryControl) {
          primaryControl.textContent = resolvedFillPresentation.primaryLabel;
          primaryControl.disabled = false;
          primaryControl.style.cursor = 'pointer';
        }
        if (secondaryControl) secondaryControl.textContent = resolvedFillPresentation.secondaryLabel;
      };
      if (!handoffApplicationId) {
        void fillActionGate!.ready().then((presentation) => {
          resolvedFillPresentation = presentation;
          renderResolvedFillAction();
        });
      } else renderResolvedFillAction();

      card.addEventListener('mouseenter', () => {
        void handoffClaimReady.then(() => {
          if (dashboardFreeFillApplicationId) return;
          void getFillAccess().then((access) => {
            if (!dashboardFreeFillApplicationId && access.can_tailor === true && access.hover_generation === true) {
              void startResumeGen('hover');
            }
          });
        });
      }, { once: true });

      const runFreeFactualFill = async (
        yesBtn: HTMLButtonElement | null,
        noBtn: HTMLButtonElement | null,
        showUpgrade = false,
      ): Promise<void> => {
        secondaryAction = 'dismiss';
        if (noBtn) noBtn.disabled = true;
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.textContent = 'Loading your saved answers. No paid generation will run.';
        }
        const data = await new Promise<{
          error?: string;
          profile?: Profile;
          applicationProfile?: ApplicationProfile;
          application_id?: string | null;
          selected_resume?: {
            artifact_id: string | null;
            file_name: string;
            resume_url: string;
          } | null;
          resume_error?: string;
          tracking_error?: string;
          posting_compensation?: PostingCompensation | null;
        }>((resolve) => {
          chrome.runtime.sendMessage({
            type: 'GET_FREE_FILL_DATA',
            payload: {
              ...(dashboardFreeFillApplicationId
                ? { application_id: dashboardFreeFillApplicationId }
                : {}),
              company,
              role: title,
              portal_url: window.location.href,
            },
          }, (response) => resolve(response ?? { error: chrome.runtime.lastError?.message ?? 'Litos did not respond.' }));
        });
        if (!data.profile || !data.applicationProfile) {
          if (statusEl) statusEl.textContent = `${asSentence(data.error) || 'Litos could not load your saved answers.'} Nothing was submitted.`;
          if (yesBtn) {
            yesBtn.disabled = false;
            yesBtn.textContent = 'Retry';
          }
          if (noBtn) {
            noBtn.disabled = false;
            noBtn.textContent = 'Close';
          }
          return;
        }

        const profile = data.profile;
        const applicationProfile: ApplicationProfile = {
          ...data.applicationProfile,
          school: data.applicationProfile.school ?? profile.school,
          degree: data.applicationProfile.degree ?? profile.degree,
          grad_date: data.applicationProfile.grad_date ?? profile.grad_date,
          grad_year: data.applicationProfile.grad_year ?? profile.grad_year,
          currently_enrolled: data.applicationProfile.currently_enrolled ?? profile.currently_enrolled,
        };
        const applicantEmail = profile.resume_email ?? profile.email;
        const resumeBlob = data.selected_resume
          ? (await fetchResumeBlob(data.selected_resume.resume_url)) ?? undefined
          : undefined;
        const resumeDownloadFailed = Boolean(data.resume_error || (data.selected_resume && !resumeBlob));
        if (statusEl) {
          statusEl.textContent = resumeBlob
            ? 'Filling factual fields and attaching your saved resume.'
            : 'Filling factual fields from your saved profile.';
        }

        let freeFillResult: AutofillResult;
        try {
          freeFillResult = await withInactivityTimeout((reportProgress, signal) => fill({
            fullName: profile.full_name ?? '',
            email: applicantEmail,
            profile,
            applicationProfile,
            resumeBlob,
            resumeFileName: data.selected_resume?.file_name,
            eeo: (applicationProfile.eeo_prefs as Record<string, string> | undefined) ?? {},
            postingCompensation: data.posting_compensation ?? null,
            signal,
            onProgress: (partial) => {
              reportProgress();
              if (statusEl) statusEl.textContent = `Filled ${partial.fields_filled} field${partial.fields_filled === 1 ? '' : 's'}.`;
            },
          }), 90_000);
        } catch {
          if (statusEl) statusEl.textContent = 'This form stopped responding. Some factual fields may be filled. Finish the rest yourself.';
          if (yesBtn) yesBtn.style.display = 'none';
          if (noBtn) {
            noBtn.disabled = false;
            noBtn.textContent = 'Close';
          }
          return;
        }

        if (resumeDownloadFailed) {
          freeFillResult.skipped_reasons = mergeValidationReasons(
            freeFillResult.skipped_reasons,
            [resumeFetchSkipReason],
          );
        }
        const resumeAttached = Boolean(resumeBlob)
          && !freeFillResult.skipped_reasons.some((reason) => /^resume:/i.test(reason));
        const resumeMissing = !resumeAttached;
        // GET_FREE_FILL_DATA has already owner-resolved this canonical application. Arm the native
        // final control before rendering completion or waiting on the separate fill-metadata write,
        // so a fast applicant click is still observed while Tracker sync is in flight.
        if (data.application_id) {
          armFreeManualSubmissionOutcomeWhenAvailable(data.application_id, freeFillResult.ats_name);
        }
        renderFillSummary(statusEl, freeFillResult, { resumeMissing, autoSubmitHeld: true });
        armValidationAuthority(statusEl, freeFillResult, resumeMissing);
        armCaptchaStall(card, statusEl, { company, role: title, atsName: freeFillResult.ats_name });
        const unansweredQuestions = selectNeedsYouReasons(freeFillResult.skipped_reasons)
          .filter((reason) => !/resume|attach/i.test(reason)).length;
        const trackerPayload: FreeFillTrackerPayload = {
          application_id: data.application_id ?? null,
          application_identity: { company, role: title, portal_url: window.location.href },
          selected_resume_artifact_id: resumeAttached ? data.selected_resume?.artifact_id ?? null : null,
          resume_attached: resumeAttached,
          resume_source: resumeAttached
            ? data.selected_resume?.artifact_id ? 'artifact' : 'base_resume'
            : 'none',
          unanswered_questions: unansweredQuestions,
        };
        chrome.runtime.sendMessage({
          type: 'AUTOFILL_EVENT',
          payload: {
            ats_name: freeFillResult.ats_name,
            job_context: { company, role: title },
            fields_filled: freeFillResult.fields_filled,
            fields_skipped: freeFillResult.fields_skipped,
            auto_submitted: false,
          },
        });
        const trackerSync = createFreeFillTrackerSync(trackerPayload);
        const syncTracker = async (): Promise<void> => {
          const result = await trackerSync.sync();
          statusEl?.querySelector('#litos-tracker-sync-warning')?.remove();
          if (result.application_id) {
            data.application_id = result.application_id;
            armFreeManualSubmissionOutcomeWhenAvailable(result.application_id, freeFillResult.ats_name);
          }
          if (result.ok) {
            return;
          }
          if (statusEl) {
            const warning = document.createElement('div');
            warning.id = 'litos-tracker-sync-warning';
            warning.setAttribute('role', 'alert');
            warning.style.cssText = `margin-top:8px;padding-top:8px;border-top:1px solid ${COLOR.border};line-height:1.4;color:${COLOR.muted};`;
            const message = document.createElement('div');
            message.textContent = `Your form stays filled, but Tracker did not update: ${result.error}`;
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.textContent = 'Retry Tracker sync';
            retryButton.style.cssText = `margin-top:6px;min-height:44px;background:none;border:0;padding:0;color:${COLOR.brand};font:500 12px ${FONT.sans};text-decoration:underline;text-underline-offset:3px;cursor:pointer;`;
            retryButton.addEventListener('click', () => {
              retryButton.disabled = true;
              retryButton.textContent = 'Retrying...';
              void syncTracker();
            });
            warning.append(message, retryButton);
            statusEl.appendChild(warning);
          }
        };
        await syncTracker();
        if (showUpgrade && statusEl) {
          const upgradeLine = document.createElement('div');
          upgradeLine.style.cssText = `margin-top:8px;padding-top:8px;border-top:1px solid ${COLOR.border};line-height:1.4;`;
          const explanation = document.createElement('div');
          explanation.style.cssText = `font-size:11px;color:${COLOR.muted};`;
          explanation.textContent = 'Your factual fields are filled. Litos+ adds a new tailored resume for this job.';
          const upgradeButton = document.createElement('button');
          upgradeButton.type = 'button';
          upgradeButton.textContent = 'See Litos+';
          upgradeButton.style.cssText = `margin-top:6px;min-height:44px;background:none;border:0;padding:0;color:${COLOR.brand};font:500 12px ${FONT.sans};text-decoration:underline;text-underline-offset:3px;cursor:pointer;`;
          upgradeButton.addEventListener('click', () => {
            upgradeButton.disabled = true;
            upgradeButton.textContent = 'Opening Litos+...';
            openLitosPlansFromPage('ai_resume_tailoring', {
                ...(data.application_id ? { application_id: data.application_id } : {}),
                company,
                role: title,
                portal_url: window.location.href,
            }, (result) => {
              if (result.ok) {
                upgradeButton.textContent = 'Opened Litos+';
                return;
              }
              upgradeButton.disabled = false;
              upgradeButton.textContent = 'Try Litos+ again';
              explanation.textContent = result.error ?? 'Litos+ options could not open.';
            });
          });
          upgradeLine.append(explanation, upgradeButton);
          statusEl.appendChild(upgradeLine);
        }
        if (yesBtn) yesBtn.style.display = 'none';
        if (noBtn) {
          noBtn.disabled = false;
          noBtn.textContent = 'Close';
        }
        generationController.announce('Factual fields are filled. Review the items that still need you, then submit on this site.');
      };

      // Tell the student when generation is waiting on model capacity rather than hung. Without
      // this the card sits on "Tailoring your resume..." for up to two minutes, which reads
      // exactly like a freeze - and a student who thinks it froze fills the form by hand or
      // re-clicks, which is what the live incident actually produced (6+ re-clicks). The card
      // stays dismissable throughout, so this is information, not a trap.
      // Scoped to THIS card's job: a background retry for another tab's posting must not repaint
      // this one's status.
      const onRetryPing = (msg: { type?: string; payload?: { company?: string; role?: string; attempt?: number } }) => {
        if (msg?.type !== 'RESUME_GEN_RETRYING') return;
        if (msg.payload?.company !== company || msg.payload?.role !== title) return;
        if (!statusEl || statusEl.style.display === 'none') return;
        const attempt = msg.payload?.attempt ?? 1;
        generationController.retry(attempt);
      };
      chrome.runtime.onMessage.addListener(onRetryPing);

      // If an auto-submit countdown is mid-flight, dismissing the card (the x or "No") must cancel
      // it too: the countdown's overlay and ticking interval live on document.body, OUTSIDE this
      // card, so just removing the card would leave them running and still fire ~15s later after the
      // student thought they'd dismissed everything. No-op when no countdown is active.
      // The retry listener is torn down here for the same reason it is registered at all: a
      // dismissed card must stop reacting to a generation that is still running in the background.
      const dismiss = () => {
        activeAutoSubmitCancel?.();
        chrome.runtime.onMessage.removeListener(onRetryPing);
        stopOrb?.();
        stopOrb = null;
        card.remove();
      };
      card.querySelector('#wp-resume-close')?.addEventListener('click', dismiss);
      card.querySelector('#wp-resume-no')?.addEventListener('click', () => {
        const secondaryButton = card.querySelector<HTMLButtonElement>('#wp-resume-no');
        if (secondaryAction === 'fill_free') {
          forceFreeFill = true;
          card.querySelector<HTMLButtonElement>('#wp-resume-yes')?.click();
          return;
        }
        if (secondaryAction === 'plans') {
          if (secondaryButton) {
            secondaryButton.disabled = true;
            secondaryButton.textContent = 'Opening Litos+...';
          }
          openLitosPlansFromPage('ai_resume_tailoring', {
            company,
            role: title,
            portal_url: window.location.href,
          }, (result) => {
            if (result.ok) {
              dismiss();
              return;
            }
            if (secondaryButton) {
              secondaryButton.disabled = false;
              secondaryButton.textContent = 'Try Litos+';
            }
            if (statusEl) {
              statusEl.style.display = 'block';
              statusEl.textContent = result.error ?? 'Litos+ options could not open.';
            }
          });
          return;
        }
        dismiss();
      });
      card.querySelector('#wp-resume-yes')?.addEventListener('click', async () => {
        actionStarted = true;
        const yesBtn = card.querySelector<HTMLButtonElement>('#wp-resume-yes');
        const noBtn = card.querySelector<HTMLButtonElement>('#wp-resume-no');
        if (yesBtn) yesBtn.disabled = true;
        if (statusEl) statusEl.style.display = 'block';
        if (orbCanvas) stopOrb = mountThinkingOrb(orbCanvas, 'composing', 20);
        generationController.tick(0);

        const progressTimer = setInterval(() => {
          if (!card.isConnected) {
            clearInterval(progressTimer);
            return;
          }
          const startedAt = resumeGenStartedAt ?? Date.now();
          generationController.tick((Date.now() - startedAt) / 1000);
        }, 1000);

        const fillRoute = fillActionGate
          ? await fillActionGate.resolvePrimary(forceFreeFill || Boolean(dashboardFreeFillApplicationId))
          : { action: 'tailor' as const, showUpgrade: false };
        forceFreeFill = false;
        if (!handoffApplicationId && fillRoute.action === 'free') {
          clearInterval(progressTimer);
          generationController.finish();
          stopOrb?.();
          stopOrb = null;
          if (orbCanvas) orbCanvas.style.display = 'none';
          await runFreeFactualFill(yesBtn, noBtn, fillRoute.showUpgrade);
          return;
        }

        const result = await startResumeGen('explicit');
        clearInterval(progressTimer);
        generationController.finish();
        stopOrb?.();
        stopOrb = null;
        if (orbCanvas) orbCanvas.style.display = 'none';
        // This await can now resolve minutes after the click: the background retries a model
        // overload for up to 150s (R-003), and the retry status above tells the student it will
        // be a while, which is an open invitation to give up, dismiss the card, and fill the form
        // by hand. A dismissed card is the student saying "leave this application alone", so a
        // late success must not fill over whatever they have typed since, and must never lead to
        // an auto-submit countdown for a card that no longer exists. isConnected is the dismissal
        // signal: every dismiss path ends in card.remove(). The generation result itself stays
        // cached per job, so nothing paid for is thrown away; re-opening the card reuses it.
        if (!card.isConnected) return;
        if (!handoffApplicationId && result?.api_error?.status === 402) {
          await runFreeFactualFill(yesBtn, noBtn, true);
          return;
        }
        if (!result || result.error || !result.profile || !result.applicationProfile || !result.resume) {
          if (statusEl) statusEl.textContent = `${asSentence(result?.error) || 'We could not build a resume.'} Nothing was attached or submitted.`;
          generationController.announce('The resume did not build. Try again.');
          if (yesBtn) {
            yesBtn.disabled = false;
            yesBtn.textContent = 'Retry';
          }
          return;
        }
        const { profile, applicationProfile, resume } = result;
        const parsedHandoffQuestions = handoffApplicationId ? reviewedQuestionsForHandoff(resume) : [];
        const initialPacketAudit = handoffApplicationId ? packetAuditForResume(resume) : null;
        if (handoffApplicationId && (
          !validHandoffVersion(resume.handoff_version)
          || parsedHandoffQuestions === null
          || !initialPacketAudit
        )) {
          if (statusEl) statusEl.textContent = 'The saved application packet is incomplete, so Litos did not touch this form.';
          generationController.announce('The saved application packet needs to be prepared again.');
          if (yesBtn) {
            yesBtn.disabled = false;
            yesBtn.textContent = 'Retry';
          }
          return;
        }
        let frozenHandoffQuestions = parsedHandoffQuestions ?? [];
        let exactSubmissionReady = false;
        let frozenAnswerReplayFailed = false;
        let activePacketVersion = initialPacketAudit?.packet_version ?? '';
        let activeAuditDigest = initialPacketAudit?.audit_digest ?? '';
        const applicantEmail = applicantEmailForGeneratedPacket(resume);
        if (!applicantEmail) {
          if (statusEl) statusEl.textContent = 'Litos could not verify the separate resume contact and tracked application routing emails, so nothing was filled.';
          generationController.announce('The application email did not save. Try again.');
          if (yesBtn) {
            yesBtn.disabled = false;
            yesBtn.textContent = 'Retry';
          }
          return;
        }

        if (!result.resume.quality?.ready_to_attach || result.resume.quality.issues.length > 0) {
          if (statusEl) statusEl.textContent = 'The resume did not come out right, so nothing was attached and nothing was sent.';
          generationController.announce('The resume did not come out right. Try again.');
          if (yesBtn) {
            yesBtn.disabled = false;
            yesBtn.textContent = 'Retry';
          }
          return;
        }

        if (!handoffApplicationId) {
          const reviewResult = await new Promise<{ ok?: boolean; error?: string }>((resolve) => {
            chrome.runtime.sendMessage({
              type: 'APPLICATION_PACKET_REVIEW_REQUIRED',
              payload: {
                applicationId: resume.resume_id,
              },
            }, (response: { ok?: boolean; error?: string } | undefined) => {
              resolve(response ?? { error: chrome.runtime.lastError?.message ?? 'The packet review could not open.' });
            });
          });
          if (statusEl) statusEl.textContent = reviewResult.ok
            ? 'Review and acknowledge the exact packet in Litos, then reopen this application from your Tracker. This form was not changed.'
            : `${reviewResult.error ?? 'The exact packet review could not open.'} This form was not changed.`;
          generationController.announce(reviewResult.ok
            ? 'Review the exact packet in Litos before filling this application.'
            : 'The exact packet review could not open. Nothing was filled.');
          if (yesBtn) yesBtn.style.display = 'none';
          if (noBtn) noBtn.style.display = 'none';
          return;
        }

        if (statusEl) statusEl.textContent = `${buildResumeReviewSummary(resume.quality)} Preparing your dashboard review...`;
        if (yesBtn) yesBtn.style.display = 'none';
        if (noBtn) noBtn.style.display = 'none';
        generationController.announce('Resume ready. Opening it for you to check.');

        // R-041: this fetch used to swallow every failure in a bare catch - the card stayed
        // clean, the fill read as a success, and the student could submit resume-less without
        // ever being told (Eight Sleep AI/ML, 2026-07-18, during the R-040 discovery).
        // fetchResumeBlob returns null on anything that is not a usable file (error status,
        // network throw, empty or HTML body), and that null is surfaced after the fill as
        // resumeFetchSkipReason. The fill itself still runs either way: a missing resume must
        // not cost the student the forty other fields the adapter can fill.
        const resumeBlob = (await fetchResumeBlob(result.resume.resume_url)) ?? undefined;
        if (handoffApplicationId && (
          !resumeBlob
          || !initialPacketAudit
          || !(await packetAuditPdfMatches(resumeBlob, initialPacketAudit))
        )) {
          if (statusEl) statusEl.textContent = 'The downloaded resume does not match the exact audited packet, so Litos did not touch this form.';
          generationController.announce('The audited application packet changed. Reload it from Litos.');
          if (yesBtn) {
            yesBtn.disabled = false;
            yesBtn.textContent = 'Retry';
          }
          return;
        }

        // Safety net: a stuck field (an unexpected widget, a listener that never fires) must
        // never leave the student staring at "Filling the application..." forever. This is an
        // INACTIVITY budget, not a total runtime budget. The shared draft queue deliberately
        // limits concurrent LLM calls, so a form may need multiple request waves. Every progress
        // event resets the clock, allowing healthy queued work to finish while still detecting a
        // worker that has genuinely stopped making progress.
        const FILL_INACTIVITY_TIMEOUT_MS = 90000;
        // R-030 observation: a previous run that timed out (the catch below returns without
        // reporting) may have left labels behind. Discard them so THIS report only ever carries
        // labels recorded by this fill.
        drainR030CandidateLabels();
        const draftedQuestions: Array<{ id: string; question: string; answer: string; kind: 'essay'; required: boolean }> = [];
        // Reuse an operation id when the same question is retried during this application fill.
        // The backend also meters trial answers by canonical application id, so multiple essay
        // fields in one application consume one application allowance, not one unit per field.
        const answerOperationIdByQuestion = new Map<string, string>();
        const fillApplicationProfile: ApplicationProfile = {
          ...applicationProfile,
          school: applicationProfile.school ?? profile.school,
          degree: applicationProfile.degree ?? profile.degree,
          grad_date: applicationProfile.grad_date ?? profile.grad_date,
          grad_year: applicationProfile.grad_year ?? profile.grad_year,
          currently_enrolled: applicationProfile.currently_enrolled ?? profile.currently_enrolled,
        };
        let fillResult: AutofillResult;
        try {
          fillResult = await withInactivityTimeout(
            (reportProgress, signal) => fill({
              fullName: profile.full_name ?? '',
              email: applicantEmail,
              profile,
              applicationProfile: fillApplicationProfile,
              resumeBlob,
              resumeFileName: resume.file_name,
              // Generic-adapter extras (ATS adapters ignore them): EEO prefs for demographic
              // questions, and an AI-draft hook for open-ended textareas routed through the
              // background to the backend. jdText/company/title are already in scope here.
              eeo: (fillApplicationProfile.eeo_prefs as Record<string, string> | undefined) ?? {},
              // The posting's structured salary range (R-031), when the background resolved one.
              postingCompensation: result.posting_compensation ?? null,
              signal,
              draftAnswer: (question: string) => {
                if (handoffApplicationId) {
                  return Promise.resolve(frozenAnswerForQuestion(frozenHandoffQuestions, question));
                }
                return new Promise<string | null>((resolve) => {
                  if (signal.aborted) {
                    resolve(null);
                    return;
                  }
                  let resolved = false;
                  const finish = (answer: string | null): void => {
                    if (resolved) return;
                    resolved = true;
                    signal.removeEventListener('abort', onAbort);
                    if (answer) {
                      draftedQuestions.push({
                        id: `essay-${draftedQuestions.length + 1}`,
                        question,
                        answer,
                        kind: 'essay',
                        required: true,
                      });
                    }
                    resolve(answer);
                  };
                  const onAbort = () => finish(null);
                  signal.addEventListener('abort', onAbort, { once: true });
                  const operationKey = question.trim().replace(/\s+/g, ' ').toLowerCase();
                  const operationId = answerOperationIdByQuestion.get(operationKey) ?? crypto.randomUUID();
                  answerOperationIdByQuestion.set(operationKey, operationId);
                  chrome.runtime.sendMessage(
                    {
                      type: 'ANSWER_QUESTION',
                      payload: {
                        company,
                        role: title,
                        jd_text: getJd(),
                        question,
                        application_id: resume.canonical_application_id,
                        operation_id: operationId,
                      },
                    },
                    (r: { answer?: string | null } | undefined) =>
                      finish(signal.aborted ? null : (r?.answer ?? null)),
                  );
                });
              },
              // Streamed progress: instant fields report immediately, then each essay updates
              // the count as its own draft call resolves, instead of the status text sitting on
              // "Filling the application..." until every essay in the form is done.
              onProgress: (partial) => {
                reportProgress();
                if (!statusEl) return;
                const essayNote = partial.pendingEssays > 0
                  ? ` Drafting ${partial.pendingEssays} more essay${partial.pendingEssays === 1 ? '' : 's'}...`
                  : '';
                statusEl.textContent = `Filled ${partial.fields_filled} field${partial.fields_filled === 1 ? '' : 's'}.${essayNote}`;
              },
            }),
            FILL_INACTIVITY_TIMEOUT_MS,
          );
        } catch {
          if (statusEl) statusEl.textContent = 'This form is taking too long. Some boxes may be half filled. Finish it yourself.';
          if (yesBtn) yesBtn.style.display = 'none';
          setTimeout(dismiss, DISMISS_MS.problem);
          return;
        }

        // R-041: the background generated a resume this tab could not download. The adapter
        // cannot report this (it just saw "no blob", same as any other absence), so content.ts
        // owns the reason: pushed into skipped_reasons so it rides R-010's exact rails -
        // selectNeedsYouReasons lists it on the card, skippedReasonsNeedReview holds
        // auto-submit. The counts are left alone: the adapter already counted the missing
        // resume as a skip, this entry is the WHY.
        if (!resumeBlob) {
          fillResult.skipped_reasons.push(resumeFetchSkipReason);
        }
        const replayOptions = fillResult.ats_name === 'jobvite' || fillResult.ats_name === 'icims'
          ? { allowControl: gatedReviewedAnswerControlAllowed }
          : undefined;
        type AttachedResumeEvidence = { input: HTMLInputElement; file: File; digest: string };
        const fileInputsAcrossOpenRoots = (): HTMLInputElement[] => {
          const roots: Array<Document | ShadowRoot> = [document];
          const inputs: HTMLInputElement[] = [];
          for (let index = 0; index < roots.length; index += 1) {
            for (const element of roots[index].querySelectorAll<HTMLElement>('*')) {
              if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
            }
            for (const input of roots[index].querySelectorAll<HTMLInputElement>('input[type="file"]')) {
              inputs.push(input);
            }
          }
          return inputs;
        };
        const sha256 = async (blob: Blob): Promise<string> => {
          const bytes = await blob.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        };
        const resumeFileInputs = (): HTMLInputElement[] => {
          const inputs = fileInputsAcrossOpenRoots().filter((input) => input.isConnected && !input.disabled && isElementVisible(input));
          const semantic = inputs.filter((input) => {
            const container = input.closest('label, [data-test], fieldset');
            const text = [
              input.name,
              input.id,
              input.getAttribute('aria-label') ?? '',
              input.getAttribute('data-test') ?? '',
              container?.getAttribute('data-test') ?? '',
              container?.textContent ?? '',
              ...Array.from(input.labels ?? []).map((label) => label.textContent ?? ''),
            ].join(' ').toLowerCase();
            return /\b(resume|résumé|cv)\b/.test(text) && !/cover\s*letter|portfolio/.test(text);
          });
          if (fillResult.ats_name === 'jobvite' || fillResult.ats_name === 'icims') {
            return semantic.length === 1 ? semantic : [];
          }
          if (inputs.length === 1) return inputs;
          return semantic;
        };
        const exactAttachment = async (blob: Blob, fileName: string): Promise<AttachedResumeEvidence | null> => {
          const expectedDigest = await sha256(blob);
          for (const input of resumeFileInputs()) {
            for (const file of Array.from(input.files ?? [])) {
              if (file.name !== fileName || file.size !== blob.size) continue;
              if (await sha256(file) === expectedDigest) return { input, file, digest: expectedDigest };
            }
          }
          return null;
        };
        let exactAttachedResume: AttachedResumeEvidence | null = null;
        if (handoffApplicationId) {
          const replay = replayReviewedAnswers(document, frozenHandoffQuestions, replayOptions);
          frozenAnswerReplayFailed = replay.failed.length > 0;
          for (const questionId of replay.denied ?? []) {
            const question = frozenHandoffQuestions.find((item) => item.id === questionId);
            if (question) fillResult.skipped_reasons.push(`human-owned answer left for you: ${question.question}`);
          }
          for (const questionId of replay.failed) {
            const question = frozenHandoffQuestions.find((item) => item.id === questionId);
            if (question) fillResult.skipped_reasons.push(`saved answer: ${question.question}`);
          }
          exactAttachedResume = resumeBlob ? await exactAttachment(resumeBlob, resume.file_name) : null;
          exactSubmissionReady = Boolean(exactAttachedResume) && !frozenAnswerReplayFailed
            && reviewedAnswersMatch(document, frozenHandoffQuestions, replayOptions).failed.length === 0;
        }
        const sameApplicationPage = (expected: string, current: string): boolean => {
          const expectedKey = applicationFormIdentityKey(expected);
          const currentKey = applicationFormIdentityKey(current);
          return Boolean(expectedKey && currentKey && expectedKey === currentKey);
        };
        let latestAdoptionRequest = 0;
        let adoptionTail: Promise<void> = Promise.resolve();
        const adoptAuthoritativePacketImpl = async (
          exactResume: GeneratedResume,
          expectedUrl: string,
          requestId: number,
        ): Promise<string | null> => {
          exactSubmissionReady = false;
          frozenAnswerReplayFailed = true;
          if (!expectedUrl || !sameApplicationPage(expectedUrl, window.location.href)) {
            return 'The company form changed before the exact packet could be loaded. Nothing was sent.';
          }
          if (
            exactResume.resume_id !== resume.resume_id
            || exactResume.application?.id !== resume.resume_id
            || !validHandoffVersion(exactResume.handoff_version)
          ) return 'The saved application packet no longer matches this form. Nothing was sent.';
          const exactAudit = packetAuditForResume(exactResume);
          if (!exactAudit) return 'The saved application packet has no complete current audit. Nothing was sent.';
          const exactQuestions = reviewedQuestionsForHandoff(exactResume);
          if (exactQuestions === null) return 'The saved reviewed answers are incomplete. Nothing was sent.';
          const exactFillData = frozenApplicantFillData(exactResume);
          if (!exactFillData) return 'The saved application packet has no complete frozen applicant data. Nothing was sent.';
          const exactApplicantEmail = applicantEmailForGeneratedPacket(exactResume);
          if (!exactApplicantEmail) return 'The saved application packet has no frozen applicant email. Nothing was sent.';
          if (handoffFormUrl && !sameApplicationPage(handoffFormUrl, window.location.href)) {
            return 'The company form changed after the exact packet was loaded. Return to Litos and retry it.';
          }
          const exactBlob = await fetchResumeBlob(exactResume.resume_url);
          if (!exactBlob) return 'The exact reviewed resume could not be downloaded. Nothing was sent.';
          if (!(await packetAuditPdfMatches(exactBlob, exactAudit))) {
            return 'The exact reviewed resume does not match the audited packet. Nothing was sent.';
          }
          if (!sameApplicationPage(expectedUrl, window.location.href)) {
            return 'The company form changed while the exact resume was downloading. Nothing was sent.';
          }
          let refill: AutofillResult;
          try {
            refill = await withInactivityTimeout((reportProgress, signal) => fill({
              fullName: exactFillData.profile.full_name ?? '',
              email: exactApplicantEmail,
              profile: exactFillData.profile,
              applicationProfile: exactFillData.applicationProfile,
              resumeBlob: exactBlob,
              resumeFileName: exactResume.file_name,
              eeo: (exactFillData.applicationProfile.eeo_prefs as Record<string, string> | undefined) ?? {},
              postingCompensation: result.posting_compensation ?? null,
              signal,
              onProgress: () => reportProgress(),
              draftAnswer: (question) => Promise.resolve(frozenAnswerForQuestion(exactQuestions, question)),
            }), 90_000);
          } catch {
            return 'The exact application refill did not finish safely. Nothing was sent.';
          }
          if (requestId !== latestAdoptionRequest) return null;
          if (!sameApplicationPage(expectedUrl, window.location.href)) {
            return 'The company form changed while the exact packet was being replayed. Nothing was sent.';
          }
          if (refill.skipped_reasons.some((reason) => /^resume:/i.test(reason))) {
            return 'The exact reviewed resume could not be attached. Nothing was sent.';
          }
          if (skippedReasonsNeedReview(refill.skipped_reasons, { allowGroundedDrafts: true })) {
            return 'The company form changed and now needs another answer. Nothing was sent.';
          }
          exactAttachedResume = await exactAttachment(exactBlob, exactResume.file_name);
          if (!exactAttachedResume) return 'The exact reviewed resume is not attached. Nothing was sent.';
          if (requestId !== latestAdoptionRequest) {
            exactAttachedResume = null;
            return null;
          }
          if (!sameApplicationPage(expectedUrl, window.location.href)) {
            exactAttachedResume = null;
            return 'The company form changed while the exact packet was being verified. Nothing was sent.';
          }
          frozenHandoffQuestions = exactQuestions;
          const replay = replayReviewedAnswers(document, frozenHandoffQuestions, replayOptions);
          frozenAnswerReplayFailed = replay.failed.length > 0
            || reviewedAnswersMatch(document, frozenHandoffQuestions, replayOptions).failed.length > 0;
          if (frozenAnswerReplayFailed) return 'A saved reviewed answer could not be replayed exactly. Nothing was sent.';
          handoffFormUrl = expectedUrl;
          activePacketVersion = exactAudit.packet_version;
          activeAuditDigest = exactAudit.audit_digest;
          exactSubmissionReady = true;
          return null;
        };
        const adoptAuthoritativePacket = (exactResume: GeneratedResume, expectedUrl: string): Promise<string | null> => {
          const requestId = ++latestAdoptionRequest;
          const run = adoptionTail.then(() => adoptAuthoritativePacketImpl(exactResume, expectedUrl, requestId));
          adoptionTail = run.then(() => undefined, () => undefined);
          return run.catch(() => 'The exact application packet could not be verified. Nothing was sent.');
        };
        prepareSubmissionFromDashboard = adoptAuthoritativePacket;
        const exactApplicantEmailError = (): string | null => {
          if (!expectedGatePacket) return null;
          const inputs = applicantOwnedEmailInputs(document);
          if (inputs.length !== 1) return 'The employer form does not show one exact applicant email field. Nothing was sent.';
          const expectedEmail = expectedGatePacket.applicantEmail.trim().toLowerCase();
          return inputs[0].value.trim().toLowerCase() === expectedEmail
            ? null
            : 'The employer form email no longer matches the exact saved application email. Nothing was sent.';
        };
        const handoffSubmissionGuard = (): string | null => {
          if (!exactSubmissionReady) return 'Litos has not verified the exact reviewed packet yet. Nothing was sent.';
          if (!validHandoffVersion(activePacketVersion) || !validHandoffVersion(activeAuditDigest)) {
            return 'The exact packet audit is no longer available. Nothing was sent.';
          }
          if (
            !exactAttachedResume
            || !exactAttachedResume.input.isConnected
            || exactAttachedResume.input.disabled
            || !isElementVisible(exactAttachedResume.input)
            || !resumeFileInputs().includes(exactAttachedResume.input)
            || !exactAttachedResume.digest
            || !Array.from(exactAttachedResume.input.files ?? []).includes(exactAttachedResume.file)
          ) {
            return 'The exact reviewed resume was removed or replaced. Nothing was sent.';
          }
          if (!handoffFormUrl || !sameApplicationPage(handoffFormUrl, window.location.href)) {
            return 'The company form changed after the exact packet was loaded. Return to Litos and retry it.';
          }
          if (frozenAnswerReplayFailed || reviewedAnswersMatch(document, frozenHandoffQuestions, replayOptions).failed.length > 0) {
            return 'A saved reviewed answer could not be replayed exactly. Nothing was sent.';
          }
          const emailError = exactApplicantEmailError();
          if (emailError) return emailError;
          return null;
        };

        const autoSubmitOn = await serverAutoSubmitEnabled();
        const finalSubmitBtn = findProgrammaticFinalSubmitButton(fillResult.ats_name);
        // Resume is "missing" if the blob never reached us (fetch failed upstream) or the adapter
        // reported it could not attach it. Never auto-submit an application with no resume.
        const resumeMissing = !resumeBlob || fillResult.skipped_reasons.some((r) => /^resume:/i.test(r));
        // Items the adapter flagged as still needing the student (agreements, questions it could not
        // answer, never-fill/sensitive fields, dropdowns left for manual selection, answers left
        // blank). Classified by the pure skippedReasonsNeedReview() so it stays unit-tested. If the
        // fill flagged ANYTHING for review, hold auto-submit and hand back rather than submit unread.
        const needsReview = skippedReasonsNeedReview(fillResult.skipped_reasons, {
          allowGroundedDrafts: autoSubmitOn,
        });

        const workdayStep = fillResult.ats_name === 'workday' ? readWorkdayApplicationStep() : null;
        const workdayNext = fillResult.ats_name === 'workday' ? findWorkdayNextButton() : null;
        if (workdayApplicationCanAdvance({
          step: workdayStep,
          nextButton: workdayNext,
          needsReview,
          hasEmptyRequiredFields: hasEmptyRequiredFields(),
          challengeWaiting: captchaWaiting || detectChallenge().waiting,
          accountGate: inspectWorkdayAccountGate(),
          tabVisible: !document.hidden,
        }) && workdayNext) {
          chrome.runtime.sendMessage({
            type: 'AUTOFILL_EVENT',
            payload: {
              ats_name: fillResult.ats_name,
              job_context: { company, role: title },
              fields_filled: fillResult.fields_filled,
              fields_skipped: fillResult.fields_skipped,
              auto_submitted: false,
            },
          });
          if (statusEl) statusEl.textContent = `Step ${workdayStep?.current ?? ''} filled. Moving to the next Workday step...`;
          dismiss();
          workdayNext.click();
          return;
        }

        // R-030 observation (register: the "cheapest next step"): labels where linkQuestion
        // committed with asksForLink false on an input[type=text] - the population that fills a
        // URL unconditionally. Shipped with the telemetry this event already posts, only when
        // non-empty, so one real label off a real board can finally say what the R-030 fix is.
        // The same drain also carries R-039's tagged populations ("r039-veto:..." where the
        // location-commitment veto suppressed a fill, "r039-third-party:..." where a bare
        // name/email/city matcher fired on a third-party label) - same field, same contract.
        const r030Labels = drainR030CandidateLabels();

        // Armed here, right after the fill and BEFORE any auto-submit countdown, so a challenge is
        // named the moment it appears rather than after the applicant has watched a countdown run
        // out on a form that was never going to send.
        armCaptchaStall(card, statusEl, { company, role: title, atsName: fillResult.ats_name }, () => {
          // A challenge that mounts DURING the countdown cancels it. Without this the countdown
          // keeps running and clicks Submit under an unsolved check.
          activeAutoSubmitCancel?.('This company asks you to prove you are human, so Litos held off. Solve the check, then send it yourself.');
        });

        const reportEvent = (autoSubmitted: boolean) => {
          chrome.runtime.sendMessage({
            type: 'AUTOFILL_EVENT',
            payload: {
              ats_name: fillResult.ats_name,
              job_context: { company, role: title },
              fields_filled: fillResult.fields_filled,
              fields_skipped: fillResult.fields_skipped,
              auto_submitted: autoSubmitted,
              ...(r030Labels.length > 0 ? { r030_candidate_labels: r030Labels } : {}),
            },
          });
        };

        // Same dismissal check as after the generation await, for the stretch the fill itself
        // takes (potentially multiple healthy request waves on an essay-heavy form). A dismissal
        // that lands while the fill is running must not be followed by an auto-submit countdown:
        // the card is the student's only handle on that countdown's context, and an application
        // they closed the card on is one they chose to finish themselves. The fill above already
        // happened, so report it honestly and hand the form back without submitting.
        if (!card.isConnected) {
          reportEvent(false);
          return;
        }

        const dashboardQuestions: HandoffQuestion[] = [
          ...frozenHandoffQuestions,
          ...draftedQuestions,
          ...selectNeedsYouReasons(fillResult.skipped_reasons, 20).map((reason, index) => ({
            id: `required-${index + 1}`,
            question: reason,
            answer: '',
            kind: 'required' as const,
            required: true,
          })),
        ].filter((question, index, all) => all.findIndex((candidate) => candidate.id === question.id) === index);
        const otherwiseReadyForAutomaticSubmission = autoSubmitOn
          && atsCanAutoSubmit(fillResult.ats_name)
          && Boolean(finalSubmitBtn)
          && !resumeMissing
          && !needsReview
          && !hasEmptyRequiredFields()
          && !hasApplicationDecisionControls()
          && !document.hidden
          && !captchaWaiting;
        const reviewCurrentUrl = window.location.href;
        const reviewPreparationError = await new Promise<string | null>((resolve) => {
          chrome.runtime.sendMessage({
            type: 'APPLICATION_REVIEW_READY',
            payload: {
              applicationId: resume.resume_id,
              atsName: fillResult.ats_name,
              portalUrl: window.location.href,
              attendedHandoff: Boolean(handoffApplicationId),
              openDashboard: !otherwiseReadyForAutomaticSubmission,
              questions: dashboardQuestions,
              skippedReasons: fillResult.skipped_reasons,
            },
          }, (response: { ok?: boolean; error?: string; resume?: GeneratedResume } | undefined) => {
            if (!response?.ok) {
              resolve(response?.error ?? 'Could not prepare the exact application packet. Nothing was sent.');
              return;
            }
            if (!response.resume) {
              resolve(handoffApplicationId && exactSubmissionReady
                ? null
                : 'The exact application packet was not returned. Nothing was sent.');
              return;
            }
            adoptAuthoritativePacket(response.resume, reviewCurrentUrl)
              .then(resolve)
              .catch(() => resolve('The exact application packet could not be verified. Nothing was sent.'));
          });
        });
        if (reviewPreparationError) {
          if (statusEl) statusEl.textContent = reviewPreparationError;
          reportEvent(false);
          return;
        }

        // Auto-submit is opt-in (AutofillSetupScreen toggle, off by default) AND only fires when it
        // is actually safe: a real FINAL-submit button exists (not a "Next"/"Continue" step button,
        // which would advance a multi-step form and then falsely report a submit), the resume
        // attached, and no required field is still empty (native validation would block the submit
        // anyway, after we'd already reported it sent). Otherwise fall through to highlight-and-
        // hand-back. It always fires from THIS student's own logged-in session, on data they
        // generated and can still cancel - never something Litos decides on its own.
        // document.hidden: never START a countdown while the student isn't looking at the tab (they
        // can't see the window to back out); going hidden mid-countdown is handled separately.
        // captchaWaiting is set synchronously by armCaptchaStall above when the challenge is
        // already on the page, so it is accurate by the time this reads it.
        const autoSubmitHeld =
          autoSubmitOn &&
          (!atsCanAutoSubmit(fillResult.ats_name) || !finalSubmitBtn || resumeMissing || needsReview
            || Boolean(handoffSubmissionGuard())
            || hasEmptyRequiredFields() || hasApplicationDecisionControls() || document.hidden || captchaWaiting);
        reportEvent(false);

        if (autoSubmitOn && !autoSubmitHeld && finalSubmitBtn) {
          runAutoSubmitCountdown(card, statusEl, yesBtn, noBtn, finalSubmitBtn, fillResult, resume.resume_id, reportEvent, 'Submitting', handoffSubmissionGuard, Boolean(handoffApplicationId));
          return;
        }

        if (finalSubmitBtn) armManualSubmissionTracking(finalSubmitBtn, resume.resume_id, statusEl, fillResult.ats_name, handoffSubmissionGuard, Boolean(handoffApplicationId));

        submitFromDashboard = async (_approvedQuestions) => {
          const handoffGuardError = handoffSubmissionGuard();
          if (handoffGuardError) return { ok: false, error: handoffGuardError };
          if (!atsCanAutoSubmit(fillResult.ats_name)) {
            return { ok: false, error: 'This application needs your direct confirmation on the company page. Nothing was sent.' };
          }
          if (!finalSubmitBtn || !finalSubmitBtn.isConnected) {
            return { ok: false, error: 'This page no longer has a Submit button. Finish it yourself.' };
          }
          if (hasEmptyRequiredFields()) return { ok: false, error: 'Some required boxes are still empty. Fill them in, then send it.' };
          if (hasApplicationDecisionControls()) {
            return { ok: false, error: 'This application includes a decision only you can confirm on the company page. Nothing was sent.' };
          }
          // The dashboard path clicks Submit directly and never enters runAutoSubmitCountdown, so
          // none of that function's guards apply here. Adding captchaWaiting to the auto-submit hold
          // made this URGENT rather than theoretical: a challenge now deterministically routes the
          // application AWAY from the guarded countdown and into this click.
          if (captchaWaiting || detectChallenge().waiting) {
            return { ok: false, error: 'This company asks you to prove you are human. Solve that check on the page, then send it yourself.' };
          }
          if (findProgrammaticFinalSubmitButton(fillResult.ats_name) !== finalSubmitBtn) {
            return { ok: false, error: 'The company page no longer shows the exact reviewed final submit control. Nothing was sent.' };
          }
          const finalHandoffGuardError = handoffSubmissionGuard();
          if (finalHandoffGuardError) return { ok: false, error: finalHandoffGuardError };
          if (!clickDashboardSubmitIfAllowed(fillResult.ats_name, finalSubmitBtn)) {
            return { ok: false, error: 'This application needs your direct confirmation on the company page. Nothing was sent.' };
          }
          const started = Date.now();
          while (Date.now() - started < 45_000) {
            const text = document.body.innerText;
            const failure = pageSubmissionFailureMessage(text);
            if (failure) return { ok: false, clicked: true, error: failure, finalUrl: window.location.href };
            if (pageShowsSubmissionConfirmation(text)) return { ok: true, clicked: true, finalUrl: window.location.href, confirmationText: text.slice(0, 2000) };
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          return { ok: false, clicked: true, error: 'The company never confirmed it. Open the tab and check whether it went through.' };
        };

        if (statusEl && !otherwiseReadyForAutomaticSubmission) {
          statusEl.textContent = 'Ready for you to check. This tab stays open.';
        }
      });

      /* The attended handoff from the Litos dashboard.
       *
       * The dashboard tells the background which portal URLs the applicant is about to be sent to,
       * and the background hands out each arming exactly once. A packet handoff keeps its existing
       * attended behavior. A dashboard Free fill is different: it names the saved application but
       * still waits for an explicit click on the employer page and never enters packet generation.
       *
       * This deliberately clicks the real button rather than calling the fill directly: the entire
       * consent, resume-quality, review and never-auto-submit path lives behind that handler, and a
       * second entrance into it is a second thing to keep in step. Nothing here submits anything;
       * auto-submit remains behind its own separate opt-in.
       */
      if (!initialHandoffApplicationId && !initialFreeFillApplicationId) chrome.runtime.sendMessage(
        { type: 'CLAIM_HANDOFF', url: window.location.href },
        (response: { armed?: boolean; applicationId?: string; mode?: 'packet' | 'free_fill' } | undefined) => {
          settleHandoffClaim();
          if (chrome.runtime.lastError || !response?.armed) {
            renderResolvedFillAction();
            return;
          }
          if (response.mode === 'free_fill') {
            dashboardFreeFillApplicationId = response.applicationId ?? null;
            renderResolvedFillAction();
            return;
          }
          if (response.applicationId) {
            handoffApplicationId = response.applicationId;
            handoffFormUrl = window.location.href;
          }
          if (!card.isConnected) return;
          renderResolvedFillAction();
          const yesBtn = card.querySelector<HTMLButtonElement>('#wp-resume-yes');
          if (!yesBtn || yesBtn.disabled) return;
          const heading = card.querySelector<HTMLElement>('#wp-resume-heading');
          if (heading) heading.textContent = 'Finishing this application';
          yesBtn.click();
        },
      );
      else if (initialHandoffApplicationId) {
        const yesBtn = card.querySelector<HTMLButtonElement>('#wp-resume-yes');
        const heading = card.querySelector<HTMLElement>('#wp-resume-heading');
        if (heading) heading.textContent = 'Finishing this application';
        if (yesBtn && !yesBtn.disabled) yesBtn.click();
      }
    }

    const AUTO_SUBMIT_COUNTDOWN_SECONDS = 15;

    // Cancel hook for an in-flight auto-submit countdown, exposed so SPA navigation (or any other
    // context change) can tear the countdown down. null whenever no countdown is running.
    // Takes the message to show, so a caller that knows WHY it is cancelling can say so. A CAPTCHA
    // stall is the case that needs it: 'Stopped' alone leaves the applicant guessing.
    let activeAutoSubmitCancel: ((msg?: string) => void) | null = null;

    // Opt-in only (AutofillSetupScreen toggle). Instead of clicking Submit the instant the fill
    // finishes, this anchors a live countdown timer directly onto the page's own Submit button:
    // a depleting ring with the seconds remaining and a big Cancel control, pinned over the
    // button and following it on scroll/resize. The student sees exactly what is about to be
    // clicked and has a full 15s + Cancel + Escape to stop it, so nothing real goes out without a
    // clear, on-the-button window to back out.
    function runAutoSubmitCountdown(
      card: HTMLElement,
      statusEl: HTMLElement | null,
      yesBtn: HTMLButtonElement | null,
      noBtn: HTMLButtonElement | null,
      submitBtn: HTMLElement,
      fillResult: AutofillResult,
      applicationId: string,
      reportEvent: (autoSubmitted: boolean) => void,
      actionLabel: string,
      submissionGuard: () => string | null = () => null,
      attendedHandoff = false,
    ) {
      // Tear down any countdown already running before standing up a new one. Combined with the SPA
      // navigation handler (which also calls this), there is never an orphaned interval/overlay or a
      // duplicate countdown firing behind this one. No-op the first time (handle starts null).
      activeAutoSubmitCancel?.();
      if (yesBtn) yesBtn.style.display = 'none';

      let remaining = AUTO_SUBMIT_COUNTDOWN_SECONDS;
      let cancelled = false;
      const RING_RADIUS = 20;
      const CIRC = 2 * Math.PI * RING_RADIUS;

      // The button itself gets a highlighted ring so it's unmistakable which control the timer
      // is counting down toward. Remember what the employer's own page had first, so backing off
      // can put it back exactly: this is someone else's page and Litos should leave no trace.
      const priorOutline = submitBtn.style.outline;
      const priorOutlineOffset = submitBtn.style.outlineOffset;
      const restoreSubmitButton = () => {
        submitBtn.style.outline = priorOutline;
        submitBtn.style.outlineOffset = priorOutlineOffset;
      };
      submitBtn.style.outline = `3px solid ${COLOR.brand}`;
      submitBtn.style.outlineOffset = '3px';

      const overlay = document.createElement('div');
      overlay.id = 'litos-autosubmit-overlay';
      overlay.style.cssText =
        `position:fixed;inset:0;z-index:${OVERLAY.z};pointer-events:none;` +
        `font-family:${FONT.sans};color-scheme:only light;`;
      overlay.innerHTML = `
        <div id="wp-as-panel" style="
          pointer-events:auto;position:absolute;display:flex;align-items:center;gap:12px;
          background:${COLOR.surface};color:${COLOR.ink};border:1px solid ${COLOR.border};
          border-radius:${RADIUS.card};padding:10px 12px;
          box-shadow:${SHADOW.raised};white-space:nowrap;
          animation:wp-slide-in 0.2s ease-out;
        ">
          <div style="position:relative;width:46px;height:46px;flex-shrink:0;">
            <svg width="46" height="46" viewBox="0 0 46 46" style="transform:rotate(-90deg);">
              <circle cx="23" cy="23" r="${RING_RADIUS}" fill="none" stroke="${COLOR.border}" stroke-width="4"/>
              <circle id="wp-as-ring" cx="23" cy="23" r="${RING_RADIUS}" fill="none" stroke="${COLOR.ink}"
                stroke-width="4" stroke-linecap="round" stroke-dasharray="${CIRC}"
                stroke-dashoffset="0" style="transition:stroke-dashoffset 1s linear;"/>
            </svg>
            <div id="wp-as-num" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:500;font-family:${FONT.mono};">${remaining}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <div style="font-size:12px;font-weight:500;">${actionLabel} your application</div>
            <div id="wp-as-sub" style="font-size:11px;color:${COLOR.muted};">${fillResult.fields_filled} field${fillResult.fields_filled === 1 ? '' : 's'} filled. Auto-submits in ${remaining}s.</div>
          </div>
          <button id="wp-as-cancel" style="
            pointer-events:auto;background:${COLOR.brand};color:#fff;border:none;border-radius:${RADIUS.control};
            min-height:44px;padding:0 18px;font-size:13px;font-weight:500;cursor:pointer;
            font-family:${FONT.sans};color-scheme:only light;
          ">Cancel</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const panel = overlay.querySelector<HTMLElement>('#wp-as-panel')!;
      const ring = overlay.querySelector<SVGCircleElement>('#wp-as-ring');
      const num = overlay.querySelector<HTMLElement>('#wp-as-num');
      const sub = overlay.querySelector<HTMLElement>('#wp-as-sub');

      // Keep the panel pinned just above the Submit button (falling back to just below it when
      // there isn't room), clamped inside the viewport, and re-anchored whenever the page scrolls
      // or resizes so it tracks the real button no matter where it sits on the form.
      const position = () => {
        const r = submitBtn.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        let top = r.top - p.height - 12;
        if (top < 8) top = Math.min(r.bottom + 12, window.innerHeight - p.height - 8);
        let left = r.left + r.width / 2 - p.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8));
        panel.style.top = `${Math.max(8, top)}px`;
        panel.style.left = `${left}px`;
      };
      position();
      // Bring the button into view so the countdown is actually on screen, then re-anchor once
      // the smooth scroll settles.
      submitBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(position, 380);
      const reposition = () => position();
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);

      const cleanupChrome = () => {
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
        window.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('input', onUserInteract, true);
        document.removeEventListener('pointerdown', onUserInteract, true);
        activeAutoSubmitCancel = null;
        overlay.remove();
      };

      const cancel = (msg = 'Stopped. Check it over, then send it yourself.') => {
        if (cancelled) return;
        cancelled = true;
        clearInterval(interval);
        cleanupChrome();
        // This re-applied the ring instead of clearing it, so backing off left the employer's own
        // Submit button permanently outlined in Litos blue.
        restoreSubmitButton();
        if (statusEl) statusEl.textContent = msg;
        reportEvent(false);
        setTimeout(() => card.remove(), DISMISS_MS.handoff);
      };

      // Anything that changes the context the student was watching cancels the pending submit: the
      // Escape key, switching away from the tab (visibilitychange), the page unloading, or the
      // student editing the form (a real input event, or a pointerdown on a form control). Guarded
      // on isTrusted so the adapter's own programmatic fill events never trip it, and scoped to
      // ignore clicks on our own overlay.
      const isOurNode = (t: EventTarget | null) =>
        t instanceof Element && !!t.closest('#litos-autosubmit-overlay, [id*="litos"]');
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
      // Going hidden does NOT cancel: the interval tick below freezes while document.hidden (it
      // never decrements or fires the click), so the countdown simply pauses and resumes when the
      // student returns. On return, re-anchor the panel since the layout may have shifted while away.
      const onVisibility = () => {
        if (!document.hidden) position();
      };
      const onPageHide = () => cancel();
      const onUserInteract = (e: Event) => {
        if (!e.isTrusted || isOurNode(e.target)) return;
        if (e.type === 'pointerdown') {
          const t = e.target;
          if (
            !(t instanceof Element) ||
            !t.closest('input, select, textarea, [role="combobox"], [role="listbox"], [role="option"], [contenteditable=""], [contenteditable="true"], [class*="select__control"], [class*="Select-control"]')
          )
            return;
        }
        cancel('You changed an answer, so Litos stopped. Send it yourself when you are ready.');
      };
      window.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);
      document.addEventListener('input', onUserInteract, true);
      document.addEventListener('pointerdown', onUserInteract, true);
      // Let a SPA navigation elsewhere in the content script tear this countdown down too.
      activeAutoSubmitCancel = () =>
        cancel('The page moved on, so Litos stopped. Send it yourself when you are ready.');
      overlay.querySelector('#wp-as-cancel')?.addEventListener('click', () => cancel());
      if (noBtn) { noBtn.textContent = 'Cancel'; noBtn.onclick = () => cancel(); }
      if (statusEl) {
        statusEl.textContent = `Filled ${fillResult.fields_filled} box${fillResult.fields_filled === 1 ? '' : 'es'}. ${actionLabel} in ${remaining} seconds. Tap Cancel to check it first.`;
      }

      const interval = setInterval(() => {
        if (cancelled) { clearInterval(interval); return; }
        // Freeze while the tab is hidden: never progress toward - or fire - a submit the student
        // can't see (no window in front of them to back out of). Resumes on the next tick once the
        // tab is visible again, so the countdown pauses rather than racing on in the background.
        if (document.hidden) return;
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(interval);
          if (num) num.textContent = '0';
          if (ring) ring.style.strokeDashoffset = String(CIRC);
          cleanupChrome();
          restoreSubmitButton();
          // Re-resolve the submit control at fire time: on a multi-step React form the button we
          // anchored to can be replaced during the countdown, and clicking a detached node is a
          // silent no-op that would falsely report a submit. If the live button is gone, stop and
          // hand back to the student rather than pretending we submitted.
          // Reuse the anchored button only if it's still live AND visible (a re-render can hide its
          // step container via an ancestor display:none without detaching the button); otherwise
          // re-resolve (findFinalSubmitButton already returns only visible controls).
          const target = fillResult.ats_name === 'workday'
            ? findProgrammaticFinalSubmitButton('workday')
            : submitBtn.isConnected && isElementVisible(submitBtn) ? submitBtn : findFinalSubmitButton();
          // Re-validate at the instant of click: 15s is long enough for the form - or the tab - to
          // change under us. Fire ONLY when the target is still live AND visible, the tab is visible
          // AND focused (never submit into a background or blurred tab), and no required field is now
          // empty. Anything else hands back to the student instead of clicking.
          const tabActive = !document.hidden && document.hasFocus();
          // Re-detected live rather than trusting the flag: a challenge can mount at any point in
          // the countdown window, and this is the last moment before the click.
          const challengeNow = captchaWaiting || detectChallenge().waiting;
          const handoffGuardError = submissionGuard();
          const portalStillSafe =
            target instanceof HTMLElement &&
            target.isConnected &&
            isElementVisible(target) &&
            tabActive &&
            !challengeNow &&
            !handoffGuardError &&
            !hasApplicationDecisionControls() &&
            findProgrammaticFinalSubmitButton(fillResult.ats_name) === target &&
            (fillResult.ats_name !== 'workday' || workdayProgrammaticFinalSubmitAllowed(target)) &&
            !hasEmptyRequiredFields();
          if (!portalStillSafe) {
            cleanupChrome();
            restoreSubmitButton();
            if (statusEl) {
              statusEl.textContent = handoffGuardError
                ?? (challengeNow
                ? 'This company asks you to prove you are human, so Litos held off. Solve the check, then send it yourself.'
                : tabActive
                  ? 'The page changed at the last moment. Check it over, then send it yourself.'
                  : 'You were on another tab, so Litos held off. Open this one and send it yourself.');
            }
            reportEvent(false);
            setTimeout(() => card.remove(), 2000);
            return;
          }
          // The server is the authority for standing consent. Recheck after the countdown and
          // immediately before the click so revoking permission in Settings stops an open tab too.
          if (statusEl) statusEl.textContent = 'Checking your settings. You can still cancel.';
          let permissionSettled = false;
          const finishPermissionCheck = async (settings: { automatic_submission_enabled?: boolean } | undefined) => {
            if (permissionSettled || cancelled) return;
            permissionSettled = true;
            window.clearTimeout(permissionTimer);
            const stillSafe = target.isConnected && isElementVisible(target) && !document.hidden && document.hasFocus()
              && !captchaWaiting && !detectChallenge().waiting && !hasEmptyRequiredFields()
              && !hasApplicationDecisionControls()
              && !submissionGuard()
              && findProgrammaticFinalSubmitButton(fillResult.ats_name) === target
              && (fillResult.ats_name !== 'workday' || workdayProgrammaticFinalSubmitAllowed(target));
            cleanupChrome();
            restoreSubmitButton();
            if (settings?.automatic_submission_enabled === true && stillSafe) {
              if (statusEl) statusEl.textContent = 'Reserving this application safely...';
              pendingRecoveryGate.beginLocal(applicationId);
              try {
                const started = await new Promise<{ ok?: boolean; error?: string }>((resolve) => {
                  chrome.runtime.sendMessage({
                    type: 'EXTENSION_SUBMISSION_START',
                    payload: { applicationId, authorization: 'standing_consent', attendedHandoff },
                  }, (response) => resolve(response ?? { ok: false, error: 'Litos did not respond.' }));
                });
                const safeAfterReservation = target.isConnected && isElementVisible(target) && !document.hidden && document.hasFocus()
                  && !captchaWaiting && !detectChallenge().waiting && !hasEmptyRequiredFields()
                  && !hasApplicationDecisionControls()
                  && !submissionGuard()
                  && findProgrammaticFinalSubmitButton(fillResult.ats_name) === target
                  && (fillResult.ats_name !== 'workday' || workdayProgrammaticFinalSubmitAllowed(target));
                if (started.ok && safeAfterReservation) {
                  if (statusEl) statusEl.textContent = `${actionLabel}...`;
                  const baselineTexts = new Set(visibleSubmissionOutcomeTexts());
                  if (!clickAtsSubmitIfAllowed(
                    fillResult.ats_name,
                    target,
                    () => monitorExtensionSubmission(applicationId, baselineTexts),
                  )) {
                    if (statusEl) statusEl.textContent = 'This application needs your direct confirmation. Nothing was sent.';
                    reportEvent(false);
                    return;
                  }
                  reportEvent(true);
                } else {
                  if (statusEl) statusEl.textContent = started.error ?? 'The page changed before Litos could submit. Check it yourself.';
                  if (started.ok) {
                    chrome.runtime.sendMessage({
                      type: 'EXTENSION_SUBMISSION_OUTCOME',
                      payload: {
                        applicationId,
                        outcome: 'cancelled',
                        finalUrl: window.location.href,
                        confirmationText: 'The final safety check failed after reservation. Nothing was clicked.',
                      },
                    }).catch(() => {});
                  }
                  reportEvent(false);
                }
              } finally {
                pendingRecoveryGate.endLocal(applicationId);
              }
            } else {
              if (statusEl) statusEl.textContent = settings?.automatic_submission_enabled === true
                ? 'The page changed at the last moment. Check it over, then send it yourself.'
                : 'You asked to check every application first, so this one is waiting for you.';
              reportEvent(false);
            }
            setTimeout(() => card.remove(), 2000);
          };
          const permissionTimer = window.setTimeout(() => finishPermissionCheck(undefined), 10_000);
          chrome.runtime.sendMessage({ type: 'GET_AUTOMATION_SETTINGS' }, (settings) => { void finishPermissionCheck(settings); });
          return;
        }
        if (num) num.textContent = String(remaining);
        if (ring) ring.style.strokeDashoffset = String(CIRC * (1 - remaining / AUTO_SUBMIT_COUNTDOWN_SECONDS));
        if (sub) sub.textContent = `${fillResult.fields_filled} field${fillResult.fields_filled === 1 ? '' : 's'} filled. Auto-submits in ${remaining}s.`;
      }, 1000);
    }

    // ─── Workday account-creation speed-up (2026-07-03) ────────────────────────
    // Litos can fill the frozen application email and derive a per-employer password. The card's
    // affirmative click authorizes only an exact Workday account action. Legal consent, an
    // attestation, CAPTCHA, an ambiguous control, or an existing claim always stops the click.

    function accountCreationCardShell(): string {
      return `
        <div style="
          position: relative;
          background: white; border: 1px solid ${COLOR.border}; border-radius: ${RADIUS.card};
          padding: 16px 16px 14px; font-family: ${FONT.sans}; color-scheme: only light;
          font-size: 13px; line-height: 1.4; box-shadow: ${SHADOW.raised};
          width: 272px; box-sizing: border-box; animation: wp-slide-in 0.25s ease-out;
        ">
          <button id="wp-account-close" style="position:absolute;top:10px;right:12px;background:none;border:none;cursor:pointer;font-size:17px;opacity:0.55;color:${COLOR.muted};padding:0;line-height:1;">×</button>
          <div style="display:flex;align-items:flex-start;gap:9px;margin-bottom:12px;line-height:1.4;">
            ${markSvg()}
            <div>
              <div style="font-weight:500;font-size:13px;color:${COLOR.ink};line-height:1.4;">${WORKDAY_ACCOUNT_PROMPT_TITLE}</div>
              <div style="font-size:12px;color:${COLOR.muted};margin-top:2px;line-height:1.4;">${WORKDAY_ACCOUNT_PROMPT_BODY}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;min-width:0;">
            <canvas id="wp-account-orb" style="display:none;flex-shrink:0;"></canvas>
            <div id="wp-account-status" style="font-size:11px;color:${COLOR.muted};display:none;line-height:1.4;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
          </div>
          <div style="display:flex;gap:8px;">
            <button id="wp-account-yes" style="
              flex:1;background:${COLOR.brand};color:white;border:none;border-radius:${RADIUS.control};
              min-height:44px;padding:0 12px;font-size:13px;font-weight:500;cursor:pointer;
              font-family:${FONT.sans};color-scheme:only light;
            ">Yes, fill it</button>
            <button id="wp-account-no" style="
              flex:1;background:${COLOR.surfaceAlt};color:${COLOR.ink};border:none;border-radius:${RADIUS.control};
              min-height:44px;padding:0 12px;font-size:13px;font-weight:500;cursor:pointer;
              font-family:${FONT.sans};color-scheme:only light;
            ">Not this time</button>
          </div>
        </div>
      `;
    }

    function workdayAccountMessage<T>(type: string, payload: Record<string, unknown>): Promise<T> {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, payload }, (response: T & { error?: string } | undefined) => {
          if (chrome.runtime.lastError || !response || response.error) {
            reject(new Error(response?.error ?? chrome.runtime.lastError?.message ?? 'The Workday account operation failed.'));
            return;
          }
          resolve(response);
        });
      });
    }

    function injectWorkdayAccountCreationCard() {
      if (document.getElementById('litos-account-card')) return;
      const card = document.createElement('div');
      card.id = 'litos-account-card';
      card.innerHTML = accountCreationCardShell();
      getCardStack().appendChild(card);

      const dismiss = () => card.remove();
      card.querySelector('#wp-account-close')?.addEventListener('click', dismiss);
      card.querySelector('#wp-account-no')?.addEventListener('click', dismiss);
      card.querySelector('#wp-account-yes')?.addEventListener('click', async (event) => {
        if (!isTrustedWorkdayAccountIntent(event)) return;
        const statusEl = card.querySelector<HTMLElement>('#wp-account-status');
        const yesBtn = card.querySelector<HTMLButtonElement>('#wp-account-yes');
        const orbCanvas = card.querySelector<HTMLCanvasElement>('#wp-account-orb');
        let stopOrb: (() => void) | null = null;
        const stopOrbAnd = (setText: () => void) => {
          stopOrb?.();
          stopOrb = null;
          if (orbCanvas) orbCanvas.style.display = 'none';
          setText();
        };
        if (yesBtn) yesBtn.disabled = true;
        if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Filling...'; }
        if (orbCanvas) stopOrb = mountThinkingOrb(orbCanvas, 'working', 20);

        if (workdayVerificationStage()) {
          const portalHost = portalKeyForHost(window.location.hostname);
          const gate = inspectWorkdayAccountGate();
          if (gate.kind !== 'clear') {
            stopOrbAnd(() => { if (statusEl) statusEl.textContent = gate.reason; });
            return;
          }
          const identity = await workdayAccountMessage<{ email: string; applicationId: string }>('GET_ACCOUNT_CREATION_DATA', {})
            .catch(() => null);
          const state = identity
            ? await workdayAccountMessage<{ pending: { applicationId: string; requestedAt: number } | null }>(
              'GET_WORKDAY_ACCOUNT_STATE',
              { host: portalHost, email: identity.email },
            ).catch(() => null)
            : null;
          const pendingCandidate = state?.pending ?? null;
          const pending = pendingCandidate?.applicationId === identity?.applicationId ? pendingCandidate : null;
          if (!pending) {
            stopOrbAnd(() => { if (statusEl) statusEl.textContent = 'Litos did not start this account, so enter the code yourself.'; });
            return;
          }
          chrome.runtime.sendMessage({
            type: 'GET_WORKDAY_VERIFICATION_CODE',
            payload: { applicationId: pending.applicationId, requestedAt: new Date(pending.requestedAt).toISOString() },
          }, (verification: { code?: string; error?: string } | undefined) => {
            if (!verification?.code) {
              stopOrbAnd(() => { if (statusEl) statusEl.textContent = verification?.error ?? 'The verification email is not ready yet.'; });
              return;
            }
            const filled = fillWorkdayVerificationCode(verification.code);
            const continueButton = findWorkdayVerificationContinue();
            if (!filled || !continueButton || inspectWorkdayAccountGate().kind !== 'clear') {
              stopOrbAnd(() => { if (statusEl) statusEl.textContent = 'Litos could not safely continue this verification. Enter the code yourself.'; });
              return;
            }
            continueButton.click();
            stopOrbAnd(() => { if (statusEl) statusEl.textContent = 'Verification code entered. Waiting for Workday to confirm the account.'; });
          });
          return;
        }

        chrome.runtime.sendMessage(
          { type: 'GET_ACCOUNT_CREATION_DATA' },
          async (result: { error?: string; email?: string; applicationId?: string }) => {
            if (!result || result.error) {
              stopOrbAnd(() => { if (statusEl) statusEl.textContent = result?.error || 'Could not load your account data.'; });
              return;
            }
            // Only type a password where Litos KNOWS it is the right one: a genuine create-account
            // stage (we are setting it right now), or a sign-in form for an account Litos itself
            // provisioned under the salt still in place. Everything else - account created by hand,
            // created before this feature, created on another device, salt drifted from a cross-tab
            // race - falls through to email-only. Submitting a wrong password is what gets a student
            // locked out of their own Workday account, so "don't know" always means "don't fill".
            // Nothing here touches storage unless a password is actually in play, so the salt is not
            // conjured into existence just by opening the card.
            const portalHost = portalKeyForHost(window.location.hostname);
            const creatingAccount = isWorkdayCreateAccountStage();
            const accountState = await workdayAccountMessage<{
              active: { saltFingerprint: string } | null;
              pending: { applicationId: string } | null;
              authEpoch: number;
            }>('GET_WORKDAY_ACCOUNT_STATE', { host: portalHost, email: result.email }).catch(() => ({ active: null, pending: null, authEpoch: Number.NaN }));
            const knownAccount = accountState.active;
            let password: string | undefined;
            let passwordWithheldReason: string | undefined;
            let saltFingerprint: string | undefined;
            if (creatingAccount || knownAccount) {
              saltFingerprint = await currentSaltFingerprint();
              if (creatingAccount || knownAccount?.saltFingerprint === saltFingerprint) {
                password = await derivePortalPassword(portalHost);
              } else {
                passwordWithheldReason =
                  'You set this account up on another device, so type your password in yourself.';
              }
            } else {
              // Signing in to an account Litos never provisioned: created by hand, created before
              // this feature, or created through Workday's "Sign in with Google" path, where there
              // is no password at all. Guessing here is what locks students out.
              passwordWithheldReason = 'Litos did not make this account, so type your password in yourself.';
            }
            const fillResult = await fillWorkdayAccountCreation({
              email: result.email,
              password,
              passwordWithheldReason,
            });

            // A password write is not account-creation proof. A crash, validation error, legal
            // checkbox or CAPTCHA can all leave the form standing after the write. Recording the
            // tenant here would later authorize a sign-in to an account Litos may never have made.
            // Account activation is intentionally deferred until a later stage can prove the
            // create form disappeared and an authenticated application marker replaced it.
            const gate = inspectWorkdayAccountGate();
            let actionStarted: 'create' | 'sign_in' | undefined;
            let blockingReason = gate.kind === 'clear' ? undefined : gate.reason;
            if (!blockingReason && password && fillResult.password_filled) {
              const action = creatingAccount ? 'create' : 'sign_in';
              const actionControl = findWorkdayAccountSubmit(action);
              if (!actionControl) {
                blockingReason = 'Litos could not identify a safe Workday account button. Complete this step yourself.';
              } else if (creatingAccount && (!saltFingerprint || !result.applicationId)) {
                blockingReason = 'Litos could not bind this account to the prepared application. Complete this step yourself.';
              } else if (!creatingAccount && !knownAccount) {
                blockingReason = 'Litos could not prove it made this account for this application email, so it did not sign in.';
              } else {
                const claimPayload = {
                  host: portalHost,
                  email: result.email,
                  applicationId: result.applicationId ?? '',
                };
                let claimedAuthEpoch: number | null = Number.isSafeInteger(accountState.authEpoch) ? accountState.authEpoch : null;
                const outcome = await runBoundedWorkdayAccountAction({
                  action,
                  control: actionControl,
                  claim: creatingAccount && saltFingerprint && result.applicationId
                    ? async () => {
                      const claim = await workdayAccountMessage<{ claimed: boolean; authEpoch?: number }>('CLAIM_WORKDAY_ACCOUNT', {
                        ...claimPayload,
                        saltFingerprint,
                        requestedAt: Date.now(),
                      });
                      claimedAuthEpoch = claim.claimed && Number.isSafeInteger(claim.authEpoch) ? claim.authEpoch! : null;
                      return claimedAuthEpoch !== null;
                    }
                    : undefined,
                  revalidateClaim: async () => claimedAuthEpoch !== null && (await workdayAccountMessage<{ valid: boolean }>(
                      'VALIDATE_WORKDAY_ACCOUNT_ACTION',
                      { ...claimPayload, authEpoch: claimedAuthEpoch, action },
                    )).valid,
                  abandon: creatingAccount && result.applicationId
                    ? () => workdayAccountMessage('ABANDON_WORKDAY_ACCOUNT_CLAIM', claimPayload)
                    : undefined,
                });
                if (outcome.started) actionStarted = action;
                else if (outcome.reason === 'claim_denied') {
                  blockingReason = 'Litos already has an unfinished account attempt for this Workday email. It stopped to avoid creating a duplicate.';
                } else if (outcome.reason === 'gate') {
                  blockingReason = outcome.gate?.kind === 'clear' || !outcome.gate
                    ? 'The Workday account page changed. Complete this step yourself.'
                    : outcome.gate.reason;
                } else if (outcome.reason === 'control_changed') {
                  blockingReason = 'The Workday account button changed before Litos could use it. Complete this step yourself.';
                } else {
                  blockingReason = 'Workday did not accept the account action. Complete this step yourself.';
                }
              }
            }

            chrome.runtime.sendMessage({
              type: 'AUTOFILL_EVENT',
              payload: {
                ats_name: 'workday',
                job_context: { company: 'account-creation', role: 'account-creation' },
                fields_filled: fillResult.fields_filled,
                fields_skipped: fillResult.fields_skipped,
                auto_submitted: false,
              },
            });

            stopOrbAnd(() => {
              if (statusEl) {
                statusEl.textContent = workdayAccountCompletion({
                  creatingAccount,
                  emailFilled: fillResult.email_filled,
                  passwordFilled: fillResult.password_filled,
                  passwordWithheldReason,
                  blockingReason,
                  actionStarted,
                });
              }
            });
            setTimeout(dismiss, 6000);
          },
        );
      });
    }

    // Guidance for Workday's "Start Your Application" triage screen (Autofill with Resume /
    // Apply Manually / Use My Last Application) - previously Litos said nothing here, leaving
    // the student to guess which option leads anywhere useful. This just points them at the
    // right one and clicks it for them - pure page navigation, not a form submission or account
    // action, so it isn't gated behind the auto-submit toggle the way real submits are.
    function injectWorkdayStartScreenCard() {
      if (document.getElementById('litos-start-card')) return;
      const card = document.createElement('div');
      card.id = 'litos-start-card';
      card.innerHTML = `
        <div style="
          position: relative;
          background: white; border: 1px solid ${COLOR.border}; border-radius: ${RADIUS.card};
          padding: 16px 16px 14px; font-family: ${FONT.sans}; color-scheme: only light;
          font-size: 13px; line-height: 1.4; box-shadow: ${SHADOW.raised};
          width: 272px; box-sizing: border-box; animation: wp-slide-in 0.25s ease-out;
        ">
          <button id="wp-start-close" style="position:absolute;top:10px;right:12px;background:none;border:none;cursor:pointer;font-size:17px;opacity:0.55;color:${COLOR.muted};padding:0;line-height:1;">×</button>
          <div style="display:flex;align-items:flex-start;gap:9px;margin-bottom:12px;line-height:1.4;">
            ${markSvg()}
            <div>
              <div style="font-weight:500;font-size:13px;color:${COLOR.ink};line-height:1.4;">This employer uses Workday</div>
              <div style="font-size:12px;color:${COLOR.muted};margin-top:2px;line-height:1.4;">
                You need to sign in or make an account first. That part is yours. Tap below
                and Litos will take you to the right screen, then speed up account setup and the
                application from there.
              </div>
            </div>
          </div>
          <button id="wp-start-go" style="
            width:100%;background:${COLOR.brand};color:white;border:none;border-radius:${RADIUS.control};
            min-height:44px;padding:0 12px;font-size:13px;font-weight:500;cursor:pointer;
            font-family:${FONT.sans};color-scheme:only light;
          ">Take me there</button>
        </div>
      `;
      getCardStack().appendChild(card);

      card.querySelector('#wp-start-close')?.addEventListener('click', () => card.remove());
      card.querySelector('#wp-start-go')?.addEventListener('click', () => {
        const btn = findApplyManuallyButton();
        if (btn instanceof HTMLElement) btn.click();
        card.remove();
      });
    }

    // ─── Entry point ────────────────────────────────────────────────────────

    // Company-hosted application forms (vercel.com/careers, lifeatspotify.com, ...): this
    // only ever runs when the student explicitly injected the script from the popup, since
    // no manifest match covers these domains. Re-clicking the popup button re-enters here
    // via the __litosGenericInit guard at the top of main().
    function genericInit() {
      if (contentInitRoute(window.location) !== 'generic') return;
      document.getElementById('litos-resume-card')?.remove();
      if (!isLikelyApplicationForm()) {
        const note = document.createElement('div');
        note.id = 'litos-generic-note';
        note.style.cssText =
          `position:fixed;bottom:${OVERLAY.bottom};right:${OVERLAY.right};z-index:${OVERLAY.z};background:${COLOR.surface};border:1px solid ${COLOR.border};` +
          `border-radius:${RADIUS.card};padding:12px 16px;font-family:${FONT.sans};color-scheme:only light;` +
          `font-size:12px;line-height:1.4;color:${COLOR.ink};max-width:${OVERLAY.width};`;
        note.textContent = "Litos could not find an application form on this page. Open the page that has the boxes to fill in, then try again.";
        document.getElementById('litos-generic-note')?.remove();
        document.body.appendChild(note);
        setTimeout(() => note.remove(), 6000);
        return;
      }
      const job = getGenericJobDetails();
      // Company-hosted forms count too: isLikelyApplicationForm() has already confirmed this page
      // is a real application (resume upload, or name AND email), which is the same bar the ATS
      // path uses. This branch only runs on an on-demand inject from the popup, so the student
      // has explicitly pointed Litos at this form.
      startHarvest();
      injectResumeFillCard(job.title, job.company, extractGenericJdText, fillGenericApplication);
    }
    w.__litosGenericInit = genericInit;

    // Jobvite / iCIMS / Oracle Cloud / UltiPro: say plainly why this page cannot be filled.
    //
    // Shown INSTEAD of the fill card, not alongside it, and it is the whole of Litos's behaviour on
    // these four. Each puts a data-consent choice, an account wall or an emailed one-time code
    // before any application field exists, so there is nothing to fill and a card offering to fill
    // it would be a promise Litos cannot keep. A job seeker who is told which gate she is facing can
    // clear it in seconds; one shown nothing assumes the extension is broken.
    function injectGatedPortalNotice(notice: string): void {
      if (document.getElementById('litos-gated-note')) return;
      const note = document.createElement('div');
      note.id = 'litos-gated-note';
      note.style.cssText =
        `position:fixed;bottom:${OVERLAY.bottom};right:${OVERLAY.right};z-index:${OVERLAY.z};background:${COLOR.surface};border:1px solid ${COLOR.border};` +
        `border-radius:${RADIUS.card};padding:12px 16px;font-family:${FONT.sans};color-scheme:only light;` +
        `font-size:12px;line-height:1.4;color:${COLOR.ink};max-width:${OVERLAY.width};`;
      note.textContent = notice;
      document.body.appendChild(note);
    }

    const preparedGatedStages = new Set<string>();
    const initializedGatedApplications = new Set<string>();
    const gatedStageRetryCounts = new Map<string, number>();
    const retryGatedStage = (
      stage: NonNullable<ReturnType<typeof inspectGatedAttendedStage>>,
      retry: () => void,
    ): void => {
      const key = `${stage.identity}:${stage.stage}`;
      const count = gatedStageRetryCounts.get(key) ?? 0;
      if (count >= 3) return;
      gatedStageRetryCounts.set(key, count + 1);
      window.setTimeout(() => {
        const current = inspectGatedAttendedStage(window.location.href);
        if (current?.identity === stage.identity && current.stage === stage.stage) retry();
      }, 2_000);
    };

    function prepareGatedAttendedStage(stage: NonNullable<ReturnType<typeof inspectGatedAttendedStage>>): void {
      injectGatedPortalNotice(gatedStageNotice(stage.stage));
      const preparationKey = `${stage.identity}:${stage.stage}`;
      if (preparedGatedStages.has(preparationKey)) return;
      preparedGatedStages.add(preparationKey);
      chrome.runtime.sendMessage(
        { type: 'PREPARE_GATED_ATTENDED_HANDOFF' },
        (response: {
          ok?: boolean;
          mode?: 'packet' | 'free_fill';
          email?: string;
          handoffVersion?: string;
          error?: string;
        } | undefined) => {
          if (chrome.runtime.lastError || !response?.ok) {
            preparedGatedStages.delete(preparationKey);
            const note = document.getElementById('litos-gated-note');
            if (note) note.textContent = response?.error ?? 'Litos could not verify this exact saved application. Return to your Tracker and try again.';
            retryGatedStage(stage, () => prepareGatedAttendedStage(stage));
            return;
          }
          gatedStageRetryCounts.delete(preparationKey);
          // A dashboard Free fill never needs an immutable packet or a frozen account email.
          // Leave the one-shot arm untouched until the actual employer application form appears.
          if (response.mode === 'free_fill') return;
          if (stage.family === 'icims' && stage.stage === 'security_code') {
            const guarded = guardTrustedSecurityCodeIntent({
              onTrustedSubmit: () => chrome.runtime.sendMessage({
                type: 'PROVE_GATED_ATTENDED_ACCOUNT',
                proofKind: 'security_code',
              }),
            });
            if (!guarded) chrome.runtime.sendMessage({ type: 'INVALIDATE_GATED_ATTENDED_CONTINUATION' });
            return;
          }
          if (stage.family === 'icims' && response.email) {
            const invalidate = () => chrome.runtime.sendMessage({ type: 'INVALIDATE_GATED_ATTENDED_CONTINUATION' });
            const bindAccountProof = () => guardFrozenIcimsLoginIntent({
              email: response.email!,
              onInvalid: invalidate,
              onTrustedSubmit: () => chrome.runtime.sendMessage({
                type: 'PROVE_GATED_ATTENDED_ACCOUNT',
                proofKind: 'login_email',
                email: response.email,
              }),
            });
            const before = frozenIcimsLoginEmailState(response.email);
            if (before === 'mismatch' || before === 'ambiguous') {
              invalidate();
              const note = document.getElementById('litos-gated-note');
              if (note) note.textContent = 'This iCIMS page contains a different account email than the saved application. Return to your Litos Tracker and reopen the exact application.';
              return;
            }
            if (before === 'match' && !bindAccountProof()) invalidate();
            if (before === 'empty') void fillFrozenIcimsLoginEmail(response.email).then((filled) => {
              const after = frozenIcimsLoginEmailState(response.email!);
              if (!filled || after !== 'match' || !bindAccountProof()) {
                invalidate();
                return;
              }
              const note = document.getElementById('litos-gated-note');
              if (note) note.textContent = `${gatedStageNotice(stage.stage)} Litos placed the exact saved application email in the email box.`;
            });
          }
        },
      );
    }

    function initializeGatedAttendedApplication(stage: NonNullable<ReturnType<typeof inspectGatedAttendedStage>>): void {
      if (initializedGatedApplications.has(stage.identity)) return;
      initializedGatedApplications.add(stage.identity);
      chrome.runtime.sendMessage(
        { type: 'PREPARE_GATED_ATTENDED_HANDOFF' },
        (prepared: {
          ok?: boolean;
          mode?: 'packet' | 'free_fill';
          applicationId?: string;
          handoffVersion?: string;
          email?: string;
          error?: string;
        } | undefined) => {
          if (prepared?.ok && prepared.mode === 'free_fill' && prepared.applicationId) {
            chrome.runtime.sendMessage(
              { type: 'CLAIM_HANDOFF', url: window.location.href },
              (claimed: {
                armed?: boolean;
                mode?: 'packet' | 'free_fill';
                applicationId?: string;
              } | undefined) => {
                if (
                  chrome.runtime.lastError
                  || !claimed?.armed
                  || claimed.mode !== 'free_fill'
                  || claimed.applicationId !== prepared.applicationId
                ) {
                  initializedGatedApplications.delete(stage.identity);
                  injectGatedPortalNotice('The saved Free fill request no longer matches this company form. Return to your Litos Tracker and try again.');
                  return;
                }
                gatedStageRetryCounts.delete(`${stage.identity}:${stage.stage}`);
                const job = getJobDetails() ?? getGenericJobDetails();
                document.getElementById('litos-gated-note')?.remove();
                startHarvest();
                injectActionCard(job.title, job.company, window.location.href);
                watchSubmitButton(job.title, job.company, window.location.href);
                injectResumeFillCard(
                  job.title,
                  job.company,
                  extractAtsJdText,
                  fillAtsApplication,
                  undefined,
                  undefined,
                  claimed.applicationId,
                );
              },
            );
            return;
          }
          if (
            chrome.runtime.lastError
            || !prepared?.ok
            || !prepared.applicationId
            || !validHandoffVersion(prepared.handoffVersion)
            || !prepared.email
          ) {
            initializedGatedApplications.delete(stage.identity);
            injectGatedPortalNotice(prepared?.error ?? 'Open this exact application from your Litos Tracker so the saved packet can be verified before anything is filled.');
            retryGatedStage(stage, () => initializeGatedAttendedApplication(stage));
            return;
          }
          const claimContinuation = () => chrome.runtime.sendMessage(
            { type: 'CLAIM_GATED_ATTENDED_CONTINUATION' },
            (claimed: { armed?: boolean; applicationId?: string; handoffVersion?: string; applicantEmail?: string } | undefined) => {
              if (
                chrome.runtime.lastError
                || !claimed?.armed
                || claimed.applicationId !== prepared.applicationId
                || claimed.handoffVersion !== prepared.handoffVersion
                || claimed.applicantEmail !== prepared.email
              ) {
                initializedGatedApplications.delete(stage.identity);
                injectGatedPortalNotice('The exact saved application changed before the form could be opened. Return to your Litos Tracker and retry it.');
                retryGatedStage(stage, () => initializeGatedAttendedApplication(stage));
                return;
              }
              gatedStageRetryCounts.delete(`${stage.identity}:${stage.stage}`);
              const job = getJobDetails() ?? getGenericJobDetails();
              document.getElementById('litos-gated-note')?.remove();
              startHarvest();
              injectActionCard(job.title, job.company, window.location.href);
              watchSubmitButton(job.title, job.company, window.location.href);
              injectResumeFillCard(
                job.title,
                job.company,
                extractAtsJdText,
                fillAtsApplication,
                claimed.applicationId,
                { handoffVersion: claimed.handoffVersion!, applicantEmail: claimed.applicantEmail! },
              );
            },
          );
          claimContinuation();
        },
      );
    }

    function init() {
      const h = window.location.hostname;
      const route = contentInitRoute(window.location);

      const gatedAttendedStage = inspectGatedAttendedStage(window.location.href);
      if (gatedAttendedStage) {
        if (gatedAttendedStage.stage === 'application') initializeGatedAttendedApplication(gatedAttendedStage);
        else if (gatedStageCanPrepare(gatedAttendedStage.stage)) prepareGatedAttendedStage(gatedAttendedStage);
        return;
      }

      // Checked before every other branch. These hosts are in KNOWN_ATS_HOSTS so they do not fall
      // through to genericInit, but they have no adapter, so without this they would reach
      // getJobDetails(), return null and go silent.
      const gated = route === 'gated'
        ? gatedPortalNotice(h, window.location.pathname, window.location.search)
        : null;
      if (gated) {
        injectGatedPortalNotice(gated);
        const job = getJobDetails();
        // The job is still worth capturing even though the form cannot be filled: it feeds the
        // dashboard and the outreach draft, which are useful on a page the student finishes by hand.
        if (job) {
          chrome.runtime.sendMessage({
            type: 'JOB_DETECTED',
            payload: { title: job.title, company: job.company, url: window.location.href },
          });
        }
        return;
      }

      if (route === 'ignore') return;

      if (route === 'generic') {
        genericInit();
        return;
      }

      if (h.includes('linkedin.com')) {
        const job = getJobDetails();
        if (job) watchLinkedInEasyApply(job.title, job.company);
        return;
      }

      const job = getJobDetails();
      if (!job) return;

      if (h === 'jobs.smartrecruiters.com' && !isAtsApplicationPage()) {
        const targetUrl = smartRecruitersApplicationUrl(
          window.location.href,
          [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map((link) => link.href),
        );
        if (!targetUrl) {
          chrome.runtime.sendMessage({
            type: 'JOB_DETECTED',
            payload: { title: job.title, company: job.company, url: window.location.href },
          });
          return;
        }
        chrome.runtime.sendMessage({
          type: 'CONTINUE_SMARTRECRUITERS_HANDOFF',
          targetUrl,
        }, (continued: { ok?: boolean } | undefined) => {
          if (continued?.ok) {
            window.location.assign(targetUrl);
            return;
          }
          chrome.runtime.sendMessage({
            type: 'JOB_DETECTED',
            payload: { title: job.title, company: job.company, url: window.location.href },
          });
        });
        return;
      }

      // Watch what the student types by hand, but only on a real application form. Idempotent and
      // self-latching: it stops for good the first time the backend says onboarding is complete,
      // so a returning user's later applications are filled and never read. See lib/harvest.ts.
      if (isApplicationPage()) startHarvest();

      // Workday multi-stages within one "application" (triage modal -> sign-in/account
      // creation -> real form), and two of those stages need handling the generic
      // isApplicationPage() URL gate can't express: the triage screen appears as a modal over
      // the /details/... URL (no /apply anywhere yet - live-tested on NVIDIA 2026-07-04), and
      // the outreach action card should NOT fire on sign-in/account screens, where no job
      // title exists in the DOM and getJobDetails() falls back to site chrome
      // ("CAREERS AT NVIDIA"). So Workday routes stage-by-stage here and returns early.
      if (h.includes('myworkdayjobs.com') || h.includes('workday.com')) {
        chrome.runtime.sendMessage(
          { type: 'GET_ACCOUNT_CREATION_DATA' },
          (identity: { email?: string; applicationId?: string } | undefined) => {
            if (!identity?.email || !identity.applicationId || !workdayAccountReceiptProof(identity.email)) return;
            chrome.runtime.sendMessage({
              type: 'ACTIVATE_WORKDAY_ACCOUNT',
              payload: {
                host: portalKeyForHost(window.location.hostname),
                email: identity.email,
                applicationId: identity.applicationId,
              },
            }).catch(() => undefined);
          },
        );
        if (isWorkdayApplicationPage()) {
          injectActionCard(job.title, job.company, window.location.href);
          watchSubmitButton(job.title, job.company, window.location.href);
          injectResumeFillCard(job.title, job.company, extractWorkdayJdText, fillWorkdayApplication);
        } else if (isWorkdayAccountCreationPage()) {
          injectWorkdayAccountCreationCard();
        } else if (isWorkdayStartScreen()) {
          injectWorkdayStartScreenCard();
        } else {
          chrome.runtime.sendMessage({
            type: 'JOB_DETECTED',
            payload: { title: job.title, company: job.company, url: window.location.href },
          });
        }
        return;
      }

      if (isApplicationPage()) {
        // Card 1: on form load
        injectActionCard(job.title, job.company, window.location.href);
        // Card 2: on submit click
        watchSubmitButton(job.title, job.company, window.location.href);
        // v2: resume-gen + fill-and-stop autofill (Section 7's build order: Lever, Greenhouse,
        // Ashby). isApplicationPage()/is<Ats>ApplicationPage() are evaluated against THIS frame's
        // own document, so for a cross-origin Greenhouse iframe embed, only the script instance
        // running inside that iframe ever sees a match here - it injects its own card and fills
        // its own DOM directly, no cross-frame messaging required.
        if (isLeverApplicationPage()) {
          injectResumeFillCard(job.title, job.company, extractLeverJdText, fillLeverApplication);
        } else if (isGreenhouseApplicationPage()) {
          injectResumeFillCard(job.title, job.company, extractGreenhouseJdText, fillGreenhouseApplication);
        } else if (isAshbyApplicationPage()) {
          injectResumeFillCard(job.title, job.company, extractAshbyJdText, fillAshbyApplication);
        } else if (isAtsApplicationPage()) {
          injectResumeFillCard(job.title, job.company, extractAtsJdText, fillAtsApplication);
        }
      } else {
        // Job listing page: silently notify the popup so it can pre-fill fields
        chrome.runtime.sendMessage({
          type: 'JOB_DETECTED',
          payload: { title: job.title, company: job.company, url: window.location.href },
        });
      }
    }

    // Workday's stage-to-stage transitions (account creation -> real application form) are
    // where speed matters most for a "under a minute, end to end" goal - every other adapter
    // only needs to detect one stage per page load, but Workday needs to notice a stage change
    // that can happen without warning as soon as the student comes back from verifying their
    // email. Shorter delays here; the other ATSes keep the original, more conservative timing
    // since their pages don't multi-stage this way.
    const isWorkdayHost = window.location.hostname.includes('myworkdayjobs.com') || window.location.hostname.includes('workday.com');
    const INIT_DELAY_MS = isWorkdayHost ? 300 : 1000;
    const NAV_RECHECK_DELAY_MS = isWorkdayHost ? 250 : 800;

    setTimeout(init, INIT_DELAY_MS);

    // Re-run on SPA navigation
    let lastUrl = location.href;
    let lastGatedStage = (() => {
      const stage = inspectGatedAttendedStage(location.href);
      return stage ? `${stage.identity}:${stage.stage}` : '';
    })();
    new MutationObserver(() => {
      const currentUrl = location.href;
      const stage = inspectGatedAttendedStage(currentUrl);
      const currentGatedStage = stage ? `${stage.identity}:${stage.stage}` : '';
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        lastGatedStage = currentGatedStage;
        // A navigation must kill any pending auto-submit countdown: the button it anchored to is
        // about to be torn down, and firing after the page changed could submit the wrong form.
        activeAutoSubmitCancel?.();
        cardInjected = false;
        approved = false;
        document.getElementById('litos-action-card')?.remove();
        document.getElementById('litos-submit-card')?.remove();
        document.getElementById('litos-resume-card')?.remove();
        document.getElementById('litos-account-card')?.remove();
        document.getElementById('litos-start-card')?.remove();
        setTimeout(init, NAV_RECHECK_DELAY_MS);
      } else if (currentGatedStage && currentGatedStage !== lastGatedStage) {
        lastGatedStage = currentGatedStage;
        activeAutoSubmitCancel?.();
        cardInjected = false;
        document.getElementById('litos-gated-note')?.remove();
        document.getElementById('litos-resume-card')?.remove();
        setTimeout(init, NAV_RECHECK_DELAY_MS);
      }
    }).observe(document.body, { childList: true, subtree: true });

    // Workday specifically can swap stages (start screen -> account creation -> real
    // application form) without a URL change in some tenants (a same-path client-side
    // re-render rather than a navigation), which the MutationObserver above wouldn't catch via
    // its URL-diff check. A cheap poll (just DOM marker lookups) re-runs init() whenever none of
    // Litos's three Workday cards is currently showing, so a stage change gets picked up within
    // ~500ms instead of waiting for the next navigation event.
    if (isWorkdayHost) {
      // Poll for Workday's URL-less stage swaps, but not aggressively or forever: at 500ms this
      // re-ran init() (and its JOB_DETECTED message + storage write + badge update) twice a
      // second for the entire life of the tab. 1.5s is still well under human stage-change speed,
      // and we stop after a bounded window so an idle Workday tab left open doesn't poll all day.
      const WORKDAY_POLL_MS = 1500;
      const WORKDAY_POLL_MAX_MS = 5 * 60 * 1000;
      const startedAt = Date.now();
      const workdayPoll = setInterval(() => {
        if (Date.now() - startedAt > WORKDAY_POLL_MAX_MS) {
          clearInterval(workdayPoll);
          return;
        }
        if (
          !document.getElementById('litos-account-card') &&
          !document.getElementById('litos-resume-card') &&
          !document.getElementById('litos-start-card')
        ) {
          init();
        }
      }, WORKDAY_POLL_MS);
    }
  },
});
