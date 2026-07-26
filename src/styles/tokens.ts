/**
 * The one source of Litos design values in this repo.
 *
 * Before this file the extension had its own palette, its own type stack and its own radii, and
 * none of them matched the website. The blue was #3157d5 where the brand blue is #6b84e8; the
 * greys were near-misses of the site's warm neutrals, close enough to read as a rendering bug;
 * the injected in-page cards used Tailwind's default indigo, which matched neither. Five radii
 * and four type stacks shipped at once.
 *
 * The values below are copied from role-quick-website/app/globals.css, which is the shipped
 * truth. The brand deck (vault: 1-ventures/products/student-outreach/brand-guidelines.html) still
 * specifies Geist and is stale; the site moved to Hanken Grotesk + Azeret Mono and the extension
 * had kept following the old deck. When the deck is updated, update it FROM here.
 *
 * Anything that renders outside React - the cards content.ts injects into an employer's page -
 * cannot use Tailwind classes, so it reads these constants directly. That is the whole reason
 * this is a .ts file of strings rather than only a CSS block.
 */

export const COLOR = {
  bg: '#ffffff',
  surface: '#ffffff',
  surfaceAlt: '#faf9f7',
  border: '#e8e6e1',

  ink: '#12120f',
  muted: '#6b6a64',
  faint: '#a3a19a',

  brand: '#6b84e8',
  brandInk: '#3d51ad',
  brandSoft: '#eef1fe',

  coral: '#dd9273',
  coralInk: '#a35f3f',
  coralSoft: '#fbefe8',

  teal: '#68ad95',
  tealInk: '#3f7d67',
  tealSoft: '#eaf5f0',

  positive: '#15803d',
  positiveSoft: '#eaf6ee',
  warn: '#b45309',
  warnSoft: '#fdf3e7',
  danger: '#b91c1c',
  dangerSoft: '#fbeaea',
} as const;

/** Deck section 04: two radii cover the whole system. Pills for controls, 20px for cards. */
export const RADIUS = {
  card: '20px',
  control: '999px',
  /** Inner blocks only, never a card. */
  inner: '12px',
} as const;

export const FONT = {
  sans: "'Hanken Grotesk Variable', 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'Azeret Mono Variable', 'Azeret Mono', ui-monospace, SFMono-Regular, monospace",
} as const;

/**
 * Display type is weight 450 and never bold: calm things do not shout. The injected cards were
 * setting 700 on every headline.
 */
export const WEIGHT = { display: 450, body: 400, medium: 500 } as const;
