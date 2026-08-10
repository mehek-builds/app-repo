# Changelog

All notable changes to the Litos extension are documented here.

## [0.5.10] - 2026-08-10

### Added
- SmartRecruiters one-click forms are included in the published Chrome manifest and use the exact
  reviewed application packet during an attended handoff.
- The attended flow binds the current employer, publication URL, reviewed answers, and exact PDF
  before a user-initiated submission can start.

### Fixed
- A stale packet, changed job URL, failed answer replay, changed resume attachment, or concurrent
  dashboard action now stops before submission.
- Release checks now reject ATS manifest changes that reuse the base branch's version, and verify
  the built Chrome artifact carries its package version and the SmartRecruiters content-script
  match.

### Release note
- The public store already used the number 0.5.9 before the SmartRecruiters handoff work merged.
  This release uses a new number so Chrome can distinguish and install the reviewed artifact.

## [0.5.9] - 2026-07-31

### Added
- Privacy-limited PostHog product analytics for extension opens, authentication, job detection,
  application generation and fill, submission outcomes, and outreach drafts.
- A fixed event and property allowlist prevents job URLs, company names, role names, resume data,
  answers, and account details from entering analytics.
- A capped local outbox retries safe events after offline or interrupted worker wakes without
  duplicating accepted events.

### Changed
- Logout now rotates the anonymous analytics identifier so separate accounts using one Chrome
  profile are not linked.
- Analytics uses the background worker and existing CORS behavior, with no new Chrome permission.

## [0.5.8] - 2026-07-30

### Fixed
- Workday completion messages now report only fields the extension actually changed, including
  clear handoff copy when a password is deliberately withheld.
- A Workday account is recorded as Litos-managed only after a password was successfully filled,
  preventing a partial or changed page from poisoning later sign-in attempts.
- The manifest and API client version now come from package metadata, eliminating the duplicate
  version pin that produced a stale release artifact after a package bump.

## [0.5.7] - 2026-07-30

### Changed
- Backend calls from the popup and background worker now share one transport helper for the API
  base, product headers, session token, and request timeout.
- The Workday account prompt now says before the click that Litos can make and fill a password.
  The completion message reports whether the password was filled or left for the user.

### Fixed
- Removed a partial duplicate of the application profile type from the background worker. The
  worker now uses the same profile contract as the rest of the extension.

## [0.5.6] - 2026-07-30

### Added
- Fill support for Rippling and BreezyHR, and BambooHR now fills and stops at the point it cannot
  go further rather than failing silently. Four more platforms are recognised and explained to the
  user when they are not fillable (PR #62).

### Fixed
- The captured resume selectors were decorative and matched nothing on the live pages.

### Note
- Cut because PR #62 landed on `main` after 0.5.5 was tagged. Per the standing rule, a tree that has
  moved gets a new number rather than reusing the old one. 0.5.3, 0.5.4 and 0.5.5 were all built and
  never uploaded; this release carries everything from all three, so users moving from the published
  0.5.2 receive the full terminology pass and the earned-consent gate as well.

## [0.5.5] - 2026-07-28

### Changed
- Terminology, found by hand-scanning the extension's own copy rather than trusting the CI gate,
  which only catches words already on its list. **Three of these had already been fixed in the
  STORE IMAGES and never in the product**, the per-surface-instead-of-per-product failure the
  round-2 UX register warned about:
  - "Ranked by likelihood of a reply" and "Best matches" on the contact list
  - "Email is a guess, so it may bounce" on the contact card ("bounce" is email-ops jargon)
- "Senior IC" and "Near peer" were unexplained industry shorthand on every contact card. They now
  say what they mean: "Senior on the team", "Doing the job you want".
- One name for the thing being found. The button and aria-label said "Find people" while the
  loading and empty states said "contacts".
- "automation permissions" in an error a user actually reads.

### Fixed
- The vocabulary gate's own extractor. Its JSX text-node regex spanned newlines, so a `>` and a
  `<` several lines apart swallowed the code between them and reported identifiers as copy. A gate
  with false positives gets switched off, which defeats its purpose. Ported from the website fix.

## [0.5.4] - 2026-07-27

### Changed
- Terminology, the last three "Beyond 50" findings from the 2026-07-27 audit. `Never ask on this
  site` sat beside `No thanks` with nothing to say one was permanent, so the transient answer now
  says it is transient (`Not this time`) on all three dismissal prompts. One action carried three
  names (`Find people to email` on the aria-label, `Find people` on the button, `Yes, find people`
  on the injected card) and is now `Find people` everywhere. The setup's four sections each carried
  a DIFFERENT name in their tab and in their own header, eight names for four sections; one each now.
- Store screenshots re-rendered so their baked copy matches their sources ("job seekers", and the
  mock role is no longer an intern).

### Note on the version number
- **0.5.3 was cut and merged, then three more changes landed on `main` before it was ever
  uploaded.** The artifact staged as 0.5.3 therefore does not match the tree now tagged 0.5.3.
  Rather than ship an ambiguous number, this is 0.5.4. Nothing that was in 0.5.3 is lost; 0.5.4
  contains all of it.

## [0.5.3] - 2026-07-27

### Fixed
- The setup screen threw `ReferenceError: consentEligibility is not defined` the moment a student
  reached the step holding the auto-submit toggle, so the earned-consent lock never rendered and
  the screen every new user walks through was broken. `main` did not typecheck. Restored the state
  declaration, the loader assignment and the `StandingConsentEligibility` / `AutomationState` types.

### Changed
- The automation permissions are saved separately from the experience bank and the application
  profile. Unattended submission is now refused by the backend until the student has personally
  approved three real submissions, and that refusal used to throw inside the same try as the data
  save: it reported "Could not save your setup" and bounced the student back to a form whose
  contents had already been written. A refusal now keeps the data save, forces the local
  auto-submit switch off so the extension cannot count down and click submit on a permission the
  server never granted, and shows the server's own sentence.
- The auto-submit toggle is disabled while the student is short of the bar, with the count and the
  reason, and is never disabled while it is ON so it can always be turned back off.

### Added
- `/onboarding/state` in the preview mock backend now serves `standing_consent_eligibility`, so the
  harness renders the locked toggle rather than the unlocked state no new student ever sees.

Also carries the design-consistency pass and the vocabulary CI gate, which landed after the 0.5.2
package was submitted and are therefore not in the version currently with Google.

## [0.5.2] - 2026-07-27

Submitted to the Chrome Web Store on 2026-07-27 and pending review at the time 0.5.3 was cut.

### Changed
- Terminology pass across the extension and the store images, plus a rewritten listing description.

_The repo kept moving after that zip was packaged: the design-consistency pass, the vocabulary CI
gate and the earned-consent work all landed while the version pin still read `0.5.2`. So the tree
tagged 0.5.2 here is **not** the tree Google is reviewing. 0.5.3 exists to end that ambiguity rather
than ship a second, different 0.5.2._

## [0.5.1] - 2026-07-27

### Fixed

- Your middle initial no longer ends up in the employer's "Last name" box. A
  resume header reading "Miranda W. Hudson" was filling a surname of
  "W. Hudson". You never see that box, but the employer's system stores it, and
  an offer letter and a background check are cut from what it stored. Only
  initials are dropped now, never the first or last part of your name.
- Compound surnames survive. The word that joins two surnames in Portuguese,
  Spanish and Catalan names ("Silva e Costa", "Garcia y Lopez", "Puig i Serra")
  was being read as a middle initial and thrown away, which quietly turned half
  a surname into none.
- The same fix now applies on company-hosted careers pages, not just Greenhouse,
  Lever, Ashby and Workday. Those pages are the broadest path the extension
  takes, and they had their own older copy of the name-splitting code.

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
