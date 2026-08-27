import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync('src/entrypoints/content.ts', 'utf8');

describe('automatic submission countdown panel', () => {
  it('fits within narrow viewport gutters without hiding the countdown copy', () => {
    const start = content.indexOf('function runAutoSubmitCountdown');
    const end = content.indexOf('function accountCreationCardShell', start);
    const countdown = content.slice(start, end);

    expect(countdown).toContain('max-width:calc(100vw - 16px);box-sizing:border-box;white-space:normal;');
    expect(countdown).toContain('display:flex;flex-direction:column;gap:2px;min-width:0;');
  });
});
