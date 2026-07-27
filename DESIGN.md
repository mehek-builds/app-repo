# Litos extension design system

Litos should feel like a focused browser utility: quiet, direct, and trustworthy. The interface supports the workflow without trying to decorate it.

**This file describes the extension. It does not own any value.** The palette, type pair, radii and overlay geometry all live in [`src/styles/tokens.ts`](src/styles/tokens.ts), which mirrors the website's `app/globals.css`. If a number appears in both places, `tokens.ts` is right and this file is stale.

> Corrected 2026-07-27 after an end-to-end design audit found this document contradicting its own tokens on five points: it named **Geist** (the product moved to Hanken Grotesk + Azeret Mono on 2026-07-21), **`rounded-md`** for controls (the tokens ship 999px pills and a 12px inner radius), **`gray-200`/`gray-300`** borders (the warm `#e8e6e1` hairline), banned **glass** (the website is built on it), and described `SectionLabel` as uppercase when the implementation renders lowercase sans.

## Principles

1. Use one clear primary action per screen.
2. Prefer sections, rows, and dividers over nested cards.
3. Reserve the brand color for actions, focus, and small status cues.
4. Keep supporting copy readable. Use 12px as the minimum for persistent text.
5. Show meaningful state with text and semantics, not color alone.
6. Use motion only to explain a transition or confirm an action.

## Foundation

All from `src/styles/tokens.ts`:

- **Typeface:** Hanken Grotesk for the human voice, Azeret Mono for the machine voice. Every number, count, timestamp, status and label is mono, the same law the website runs. (The extension shipped Azeret Mono and used it zero times until 2026-07-27.)
- **Popup size:** 380 by 580 pixels
- **Page background:** white. Preview and store background: `surfaceAlt` `#faf9f7`
- **Brand action:** `brand-600`, which is `#6b84e8`, the website's signature blue
- **Text:** `gray-950` (`#12120f`, ink) primary, `gray-600` (`#6b6a64`, muted) supporting
- **Borders:** `gray-200`, which is the site's warm `#e8e6e1` hairline
- **Radius:** `rounded-control` (999px) for controls, `rounded-inner` (12px) for fields and inner blocks, `rounded-card` (20px) for cards
- **Elevation:** `SHADOW.raised`, one value, matching the website's `--shadow-raised`
- **Controls:** 44px minimum height, everywhere, including the cards injected into employer pages

## Components

- `PopupHeader`: consistent title, back navigation, and optional actions
- `fieldClass` and `textAreaClass`: labels required, minimum 44px control height
- `primaryButtonClass`: the screen's main action
- `secondaryButtonClass`: a lower-priority alternative
- `textButtonClass`: compact tertiary actions
- `iconButtonClass`: 44px icon targets with accessible names
- `SectionLabel`: a small plain-text section heading. Deliberately **not** mono and **not** uppercase: a section name is the product talking, not the machine.
- `Chip`: status, in the dashboard's five-look system (quiet / your turn / happened / stopped / failed). Mono, uppercase. Use this for `verified`, `sent`, `bounced` and friends so the popup and the web app say the same thing the same way.
- `StatusDot`: a supporting cue next to text, never the only signal

## The cards injected into employer pages

These render outside React, so they read `tokens.ts` directly. They are the only Litos surface a person sees without having opened Litos, and they must still look like Litos:

- One anchor, one z-index, one width (`OVERLAY.width`), one elevation.
- The mark, via `markSvg()`, never an emoji. Three different emoji used to stand in for the brand here.
- Numbers, counts and countdowns in `FONT.mono`.
- Buttons at 44px, like everywhere else.

## Interaction and accessibility

- Every visible field label must be programmatically associated with its control.
- Icon-only buttons need an `aria-label`.
- Toggle and selection controls must expose their current state.
- Loading, error, and completion states should be announced to assistive technology.
- Keyboard focus is a 2px brand outline at 2px offset, set once in `src/styles/globals.css`. Do not add per-control rings; that is how the two halves of the product ended up highlighting focus differently.
- Respect `prefers-reduced-motion`.

## Avoid

- Gradients, decorative blobs, confetti
- Multiple full-width primary buttons on one screen
- Tiny helper text or low-contrast gray copy
- Pill badges for ordinary metadata (status is not ordinary metadata: use `Chip`)
- Hover movement on functional controls
- Decorative icons where plain language is clearer
