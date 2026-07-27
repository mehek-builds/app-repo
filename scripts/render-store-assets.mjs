#!/usr/bin/env node
/**
 * Render every Chrome Web Store screenshot and promo tile from its HTML source.
 *
 * Why this exists: the assets used to be rendered by hand with ad-hoc headless-Chrome
 * invocations, and the results drifted. Three of the six screenshots were still in the
 * pre-Litos indigo months after the brand changed, two had their pillar colours swapped,
 * and the same set existed twice under two naming schemes (design audit 2026-07-27,
 * findings 51 to 70). One script, one output folder, one naming scheme.
 *
 * Sources live in the vault next to the listing copy they illustrate; the PNGs land in
 * this repo, which is what gets uploaded. Set LITOS_STORE_SRC to override the source dir.
 *
 * No new dependency on purpose: this shells out to the Chrome already on the machine, so
 * the script keeps working in a clean checkout without an install step.
 *
 *   node scripts/render-store-assets.mjs                # render everything
 *   node scripts/render-store-assets.mjs screenshot-3   # render one, by output stem
 *
 * The STORE ICON is deliberately not rendered here. scripts/generate-brand-assets.mjs in
 * role-quick-website owns the mark artwork, and a second producer is what left two
 * different 128px icons on disk under the same filename. Run `npm run brand` there and
 * copy public/brand/litos-store-icon-128.png across.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { access, stat } from 'node:fs/promises';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'store-assets');
const SRC =
  process.env.LITOS_STORE_SRC ??
  resolve(
    process.env.HOME,
    'Documents/Second Brain/1-ventures/products/student-outreach/store-assets-v2/src',
  );

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * The carousel order a visitor sees, top to bottom. `out` is the filename, and this table
 * is the ONLY place the ordering is written down: the previous set numbered the same
 * slides differently in two folders, which is how a submission once went out with the
 * right images against the wrong description.
 */
const ASSETS = [
  { src: 'shot-1-hero.html', out: 'litos-screenshot-1.png', w: 1280, h: 800 },
  { src: 'shot-2-resume.html', out: 'litos-screenshot-2.png', w: 1280, h: 800 },
  { src: 'shot-3-autofill.html', out: 'litos-screenshot-3.png', w: 1280, h: 800 },
  { src: 'shot-4-outreach.html', out: 'litos-screenshot-4.png', w: 1280, h: 800 },
  { src: 'shot-5-control.html', out: 'litos-screenshot-5.png', w: 1280, h: 800 },
  { src: 'shot-6-voices.html', out: 'litos-screenshot-6.png', w: 1280, h: 800 },
  { src: 'tile-small.html', out: 'litos-promo-small-440x280.png', w: 440, h: 280 },
  { src: 'tile-marquee.html', out: 'litos-promo-marquee-1400x560.png', w: 1400, h: 560 },
];

const only = process.argv[2];
const targets = only ? ASSETS.filter((a) => a.out.includes(only) || a.src.includes(only)) : ASSETS;

if (!targets.length) {
  console.error(`No asset matches "${only}".\nKnown: ${ASSETS.map((a) => a.out).join('\n       ')}`);
  process.exit(1);
}

for (const [path, what] of [
  [SRC, 'source directory (set LITOS_STORE_SRC)'],
  [CHROME, 'Chrome binary (set CHROME_PATH)'],
]) {
  await access(path).catch(() => {
    console.error(`Not found: ${path}\n  ${what}`);
    process.exit(1);
  });
}

let failed = 0;
for (const a of targets) {
  const dest = join(OUT, a.out);
  try {
    await run(
      CHROME,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        // The brand faces load from local woff2. Screenshotting before they resolve
        // silently bakes the fallback font into a PNG nobody re-checks afterwards.
        '--virtual-time-budget=3000',
        `--window-size=${a.w},${a.h}`,
        `--screenshot=${dest}`,
        `file://${join(SRC, a.src)}`,
      ],
      { timeout: 60_000 },
    );
    const { size } = await stat(dest);
    console.log(`${a.out.padEnd(34)} ${String(a.w).padStart(4)}x${a.h}  ${(size / 1024).toFixed(0)}KB  <- ${a.src}`);
  } catch (err) {
    failed++;
    console.error(`FAILED ${a.out}: ${err.message.split('\n')[0]}`);
  }
}

console.log(`\n${targets.length - failed}/${targets.length} written to ${OUT}`);
process.exit(failed ? 1 : 0);
