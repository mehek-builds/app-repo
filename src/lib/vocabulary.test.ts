import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findRetired, formatHits } from './vocabulary';

/* Everything a user can read in the extension: the popup screens and the cards
   the content script injects onto a real job page. Adapters and tests are
   excluded: adapters read the employer's DOM, they do not write to the user. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'adapters' || e.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes('.test.')) {
      out.push(p);
    }
  }
  return out;
}

const FILES = [...walk('src/components'), ...walk('src/entrypoints'), ...walk('src/lib')].filter(
  (f) => !f.endsWith('vocabulary.ts'),
);

describe('Litos vocabulary', () => {
  it('no user-facing copy uses a retired word', () => {
    expect(FILES.length).toBeGreaterThan(10);
    const hits = findRetired(FILES.map((path) => ({ path, source: readFileSync(path, 'utf8') })));
    expect(
      hits.length,
      `\n\nThe terminology audit retired these words. Reword, or add a \`vocab-allow\` comment on the line if you are certain.\n\n${formatHits(hits)}\n`,
    ).toBe(0);
  });

  it('the two automation switches carry the same names as the website', () => {
    const setup = readFileSync('src/components/AutofillSetupScreen.tsx', 'utf8');
    /* These two toggles are named in three places: here, /start on the website,
       and the dashboard's Account page. They drifted into three different pairs
       of names once already. */
    expect(setup).toContain('Send an application without asking me again');
    expect(setup).toContain('Read the code a company emails me');
  });
});
