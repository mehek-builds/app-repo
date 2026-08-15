import { describe, expect, it } from 'vitest';
import { contentScriptMatches } from './manifest-contract.mjs';

describe('release manifest source parsing', () => {
  it('reads only complete HTTPS match entries and ignores quoted comments', () => {
    const source = `
export default defineContentScript({
  matches: [
    // The user's page and the words "https://not-a-match.example/*" are comments.
    'https://jobs.example.com/*',
    "https://careers.example.org/apply/*",
  ],
});`;

    expect(contentScriptMatches(source, 'fixture')).toEqual([
      'https://careers.example.org/apply/*',
      'https://jobs.example.com/*',
    ]);
  });
});
