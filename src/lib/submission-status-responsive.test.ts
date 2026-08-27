import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync('src/entrypoints/content.ts', 'utf8');

describe('injected submission status card', () => {
  it('keeps the desktop width while fitting inside the viewport gutters', () => {
    const start = content.indexOf('function injectSubmitCard');
    const end = content.indexOf('// v2: resume-gen', start);
    const submitCard = content.slice(start, end);

    expect(submitCard).toContain('width:${OVERLAY.width};max-width:calc(100vw - 40px);');
  });
});
