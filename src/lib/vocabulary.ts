/* The Litos vocabulary gate.
 *
 * The 2026-07-27 terminology audit found 68 places where the product spoke in
 * the codebase's own nouns instead of the reader's. Fixing them once was not
 * enough: four separate sessions shipped features WHILE that pass was running,
 * and every one of them arrived carrying a retired word ("filler verb",
 * "throughput", "form fields", "01 DOCUMENTS"). Each was caught by hand.
 *
 * This is the gate that catches the next one. It reads only what a user can
 * actually see (JSX text and prose-shaped string literals, never comments,
 * never identifiers, never CSS classes) and fails on the retired vocabulary.
 *
 * The bar, set by Mehek: a ten-year-old with intermediate English who
 * understands the job market. Job-market words are IN (resume, recruiter,
 * posting, GPA, work authorization, sponsorship, bullet, fields). Engineering
 * nouns, compliance acronyms, vendor names, and terms we invented for
 * ourselves are OUT.
 *
 * To allow a specific line, put `vocab-allow` in a comment on it. Prefer
 * rewording. An allow is a decision to make a reader work harder.
 */

/** Retired word -> what to say instead. Keep this list tight and high-signal:
 *  a gate that cries wolf gets deleted, and then nothing is guarded. */
export const RETIRED: [string, string][] = [
  // Words we invented for ourselves
  ["experience bank", "everything you have done"],
  ["bullet variant", "different ways to write this line"],
  ["grounding check", "we checked every line against your real work"],
  ["grounded in", "comes from work you really did"],
  ["seed your profile", "we will fill it in from your resume"],
  ["base resume", "your main resume"],
  ["reusable answers", "answers you give every time"],
  // Engineering nouns on the glass
  ["secure portal", "the company's application page"],
  ["portal runner", "filling it in for you"],
  ["portal handoff", "whether it went through"],
  ["company portal", "the company's application page"],
  ["browser run", "Litos was not sure it finished"],
  ["high confidence", "we were not sure"],
  ["guest workspace", "not saved yet"],
  ["browser session", "your work"],
  ["the shipped version", "the real one"],
  ["machine-readable", "a robot can read it"],
  ["job-board scan", "we check for new ones"],
  ["monitored jobs", "the jobs we watch for you"],
  ["throughput", "applications you sent"],
  // Found 2026-07-28 by hand-scanning the extension. All three had already been
  // fixed in the STORE IMAGES and never in the product itself, which is the
  // per-surface-instead-of-per-product failure the round-2 UX register warned about.
  ["likelihood", "most likely to reply"],
  ["may bounce", "it may not arrive"],
  ["best matches", "most likely to reply"],
  ["senior ic", "senior on the team"],
  ["filler verb", "a weak word"],
  // Compliance vocabulary shown raw
  ["attestation", "something you have to swear to"],
  ["self-identification", "questions about race and gender"],
  ["EEO", "questions about race and gender"],
  // Idiom and marketing vague, which fail the intermediate-English bar
  ["applications get filed", "nobody reads applications"],
  ["thoughtful outreach", "a short email to a real person"],
  ["without the noise", "most likely to reply"],
  ["one quick step away", "one more step"],
  // Retired because one thing must carry one name
  ["posting detected", "job found"],
  ["grade average", "GPA"],
  ["try it first", "try it free"],
  ["real photos", "real screenshots"],
  ["for this jd", "for this job"],
  ["· documents", "· Resume"],
  ["· autofill", "· Forms"],
  ["· outreach", "· Emails"],
  // Nine pending words collapsed to three
  ["parsing...", "Reading..."],
  ["fetching...", "Reading..."],
  ["generating resume...", "Making..."],
  ["verifying...", "Saving..."],
  ["finishing...", "Saving..."],
];

/** Strip comments so a note ABOUT a retired word is not itself a failure.
 *  Newlines are preserved so reported line numbers still point at real code. */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank);
}

const TAILWINDISH =
  /(^|\s)(bg|text|border|m[trblxy]?|p[trblxy]?|w|h|max|min|gap|grid|flex|rounded|font|leading|tracking|opacity|hover|focus|group|sm|md|lg|xl|absolute|relative|inline|items|justify|space|divide|shadow|ring|overflow|whitespace|truncate|animate|transition|duration|ease|z|top|left|right|bottom|inset|col|row|order|shrink|basis|self|place|list|underline|decoration|accent|backdrop|pointer|cursor|select|sr|aria|data|placeholder|disabled|motion)[-:[]/i;

/** Everything a reader can actually see, and nothing else. */
export function userFacingStrings(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  /* JSX text nodes. The `[^<>{}]` class alone spans newlines, so a `>` and a `<`
     several lines apart swallow the code between them and the whole blob counts
     as visible text, reporting identifiers as copy. A gate that cries wolf gets
     switched off. Prose does not contain `;` or `=`. */
  for (const m of code.matchAll(/>([^<>{}]{4,})</g)) {
    if (/[;=]/.test(m[1])) continue;
    out.push(m[1]);
  }
  for (const m of code.matchAll(/(['"`])([^'"`\\\n]{6,})\1/g)) {
    const t = m[2];
    if (!t.includes(" ")) continue;
    if (TAILWINDISH.test(t)) continue;
    if (/^[a-z-]+\/[a-z-]+/.test(t)) continue; // mime types, paths
    out.push(t);
  }
  return out;
}

export interface Hit { file: string; term: string; instead: string; line: number; text: string }

export function findRetired(files: { path: string; source: string }[]): Hit[] {
  const hits: Hit[] = [];
  for (const { path, source } of files) {
    const lines = stripComments(source).split("\n");
    const allowed = new Set(
      source.split("\n").flatMap((l: string, i: number) => (/vocab-allow/.test(l) ? [i + 1] : []))
    );
    const visible = new Set(userFacingStrings(source).map((s) => s.toLowerCase()));
    for (const [term, instead] of RETIRED) {
      const needle = term.toLowerCase();
      if (![...visible].some((v) => v.includes(needle))) continue;
      // Report the first line that actually shows it, so the message is actionable.
      const idx = lines.findIndex(
        (l: string, i: number) => l.toLowerCase().includes(needle) && !allowed.has(i + 1)
      );
      if (idx === -1) continue;
      hits.push({
        file: path,
        term,
        instead,
        line: idx + 1,
        text: lines[idx].trim().slice(0, 120),
      });
    }
  }
  return hits;
}

export function formatHits(hits: Hit[]): string {
  return hits
    .map(
      (h: Hit) =>
        `  ${h.file}:${h.line}\n    says "${h.term}", say "${h.instead}" instead\n    ${h.text}`
    )
    .join("\n\n");
}
