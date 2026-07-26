import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const popupEntry = readFileSync(new URL('../entrypoints/popup/main.tsx', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

// The typeface moved from Geist to the website's Hanken Grotesk + Azeret Mono pair on 2026-07-26:
// the extension and the site were running two different typefaces for one product. The invariant
// this test exists for is unchanged - self-host the latin subset only, never the whole family.
describe('popup font packaging', () => {
  it('bundles only the Latin variable subsets instead of every language', () => {
    expect(popupEntry).not.toContain("import '@fontsource-variable/");
    expect(globalStyles).toContain(
      "url('@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2')",
    );
    expect(globalStyles).toContain(
      "url('@fontsource-variable/azeret-mono/files/azeret-mono-latin-wght-normal.woff2')",
    );
    expect(globalStyles).not.toMatch(/-(?:cyrillic|latin-ext|vietnamese)-/);
    expect(globalStyles).toContain('font-display: swap');
    expect(globalStyles).toContain(
      "font-family: 'Hanken Grotesk Variable', 'Hanken Grotesk', sans-serif",
    );
  });

  it('matches the website palette rather than a near-miss of it', () => {
    expect(globalStyles).toContain('--litos-ink: #12120f');
    expect(globalStyles).toContain('--litos-accent: #6b84e8');
  });
});
