# Changelog

All notable changes to the Litos extension are documented here.

## [0.5.0] - 2026-07-27

Minor rather than patch: this changes how you get into the extension, and renames
what things are called on every screen.

### Added

- Sign in to an account you already have. Previously the popup only knew how to
  create accounts, so anyone who signed up on the website was shown "Set up
  Litos" and asked for their email and resume a second time. Signing in needs no
  resume; the profile already on the server is read back.
- The answers screen's four sections are reachable directly once setup is done,
  instead of being a strictly linear five-step walk.

### Changed

- One name per thing. "Profile", "Activity", "Account", "Settings" and "Your
  answers" described two datasets between them; they are **Answers** and
  **Emails** now, matching the website.
- The popup heading names the screen instead of saying "Litos" on all of them.
- One status vocabulary, shared between the main screen and the Emails screen.
  A sent email is no longer amber on one screen and blue on the next, and the
  raw API value is no longer printed as a status.
- The card injected into an employer's page asks "Fill this application for
  you?" instead of "Generate tailored resume + fill this application?", and its
  failure messages say what to do next. Neither "portal" nor "auto-submit"
  appears in anything a user reads.
- Each workflow row carries its own button, so the screen's visual primary is
  also its real one.
- Verifying an emailed code is no longer counted as a step of setup; the flow is
  five steps.

### Fixed

- Sign out moved out of the header, where it sat one mis-click away between two
  navigation items, and no longer uses a native browser dialog.
- Injected cards share one screen position, one stacking layer and three named
  dismiss durations; they previously disagreed by 4px and stacked in an
  unchosen order.
- Litos no longer writes a border radius onto the employer's own submit button,
  and restores what the page had rather than clearing it.
- Status icons are drawn, not typed, so they render the same on every platform.
- Injected cards declare a light color scheme, so a forced-dark page cannot
  invert them into an unreadable white-on-white card.
- A company name guessed from a URL now says that it was guessed.

## [0.4.12] - 2026-07-26

### Changed

- Standardized popup, page assistants, badge, and focus treatments on Litos action blue.
- Replaced the floating emoji launcher with the Litos mark.
- Named the popup header actions and raised interactive targets to at least 44px.
- Kept detected jobs compact, with one summary and an explicit Edit action.

### Fixed

- Removed competing action weight between application fill and contact search.
- Removed legacy indigo styling from page-level application helpers.

## [0.4.11] - 2026-07-25

### Added

- Autofill setup now synchronizes standing submission and verification-code permissions with the Litos account.
- The final countdown rechecks server-side consent immediately before clicking the portal submit control.

### Changed

- Grounded essay drafts can proceed under standing consent while sensitive, ambiguous, incomplete, and unsupported answers still hold submission.

### Fixed

- A failed consent refresh now holds the application instead of trusting stale local storage.

## [0.4.10] - 2026-07-23

### Changed

- Changed the brand mark to the Stack: a black stack of four tapering bars over a solid block, on a plain white ground. It replaces the paper dart everywhere, matching the website. Toolbar icons at every size are regenerated from that one artwork, and the popup header no longer sits the mark on a coloured square, because the mark carries its own ground.

## [0.4.9] - 2026-07-23

### Added

- Added password fill on Workday create-account forms. The password is derived per employer from a device-local secret, so the same account can be signed into again later, and no password is stored anywhere.
- Added bot-trap detection across every ATS, so hidden fields that exist only to catch automation are never written to.
- Added an explanation on the card when a password is deliberately left for the student, instead of leaving the box silently blank.

### Changed

- Changed the documented scope: the extension previously never touched password fields at all. It now fills them on Workday create-account forms only, and re-fills one on a sign-in form only for an account Litos itself created on this device. Every other case still leaves the password to the student, because submitting a wrong one locks a student out of their own account. Litos still never clicks Create Account and never completes email verification.

### Fixed

- Fixed the generic adapter treating a hidden bot-trap field as an ordinary question and filling it with the student's website, which marks the whole submission as automated traffic.
- Fixed password and its confirmation being counted as two filled fields instead of one.

## [0.4.8] - 2026-07-21

### Added

- Added changing, elapsed resume-generation phases and explicit submission states for waiting, confirmation, rejection, and unknown outcomes.
- Added inline resume review, persistent post-fill handoff, and a precise list of questions that still need the student.
- Added regression coverage for hostile portal metadata, retry-state precedence, submission-outcome precedence, and bounded monitoring.

### Fixed

- Fixed portal-controlled job titles and company names being interpreted as card markup.
- Fixed model-capacity retry messages being overwritten by the generic progress timer.
- Fixed submission monitoring repeatedly scanning the full portal without a deadline.
- Fixed Ashby portal styles collapsing Litos submission and review cards.
- Fixed resume-review focus and screen-reader announcements so keyboard users reach the replacement actions.
- Fixed completed review handoffs disappearing before the student could act on them.

## [0.4.7] - 2026-07-21

### Changed

- The production popup now ships only the Latin Geist variable font instead of bundling every language subset, cutting the packaged extension by about 48 kB while preserving system-font fallback for other scripts.

### Added

- Added a packaging regression test that prevents the full multi-subset font import from returning.

## [0.4.6] - 2026-07-20

### Added

- You now get consistent buttons, fields, headers, status indicators, and loading states throughout the extension.
- Contributors now have behavioral coverage for signup validation, asynchronous job detection, contact resolution, draft review, Gmail handoff, and outreach tracking.

### Changed

- Onboarding, application setup, job workflows, contact results, draft review, and outreach tracking now use a flatter layout that keeps the next action clear.
- Every popup screen and Chrome Web Store image now uses Geist and the Litos palette, with the interface rules recorded in `DESIGN.md`.
- Chrome Web Store screenshots now show the redesigned Litos workflow.

### Fixed

- Fields now keep their labels visible, keyboard focus is easier to see, switches have larger targets, headings are consistent, and status changes are announced more clearly.
- Tracking now handles unknown statuses safely, reports recent-outreach loading failures, and keeps Gmail launch errors from appearing as success.
- Production packages now default to the deployed Litos API, while development and QA builds can still override the backend.

### Removed

- Removed unused Inter assets, celebration confetti, stale animation tokens, and no-op visual styles to keep the production bundle focused.
