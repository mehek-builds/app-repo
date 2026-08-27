import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const content = readFileSync('src/entrypoints/content.ts', 'utf8');

describe('Workday account status layout', () => {
  it('wraps the full status instead of clipping it to one line', () => {
    const statusStyle = content.match(/id="wp-account-status" style="([^"]+)"/)?.[1] ?? '';

    expect(statusStyle).toContain('white-space:normal');
    expect(statusStyle).toContain('overflow-wrap:anywhere');
    expect(statusStyle).not.toContain('overflow:hidden');
    expect(statusStyle).not.toContain('text-overflow:ellipsis');
  });
});
