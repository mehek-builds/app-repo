import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync('src/entrypoints/content.ts', 'utf8');

describe('injected card close controls', () => {
  it('names each icon-only close button for its card context', () => {
    expect(content).toContain('id="wp-close" aria-label="Close Litos outreach prompt"');
    expect(content).toContain('id="wp-start-close" aria-label="Close Litos Workday guidance"');
    expect(content).toContain('id="wp-account-close" aria-label="Close Litos Workday account setup"');
  });
});
