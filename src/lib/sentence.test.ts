import { describe, expect, it } from 'vitest';
import { asSentence } from './sentence';

describe('asSentence', () => {
  /* The exact string a live run produced on the Palantir handoff:
     "not signed in Nothing was attached or submitted." */
  it('closes a bare fragment so the next sentence does not run into it', () => {
    expect(`${asSentence('not signed in')} Nothing was attached or submitted.`).toBe(
      'not signed in. Nothing was attached or submitted.',
    );
  });

  it('leaves a reason that already ends properly alone', () => {
    expect(asSentence('We could not reach the company.')).toBe('We could not reach the company.');
    expect(asSentence('Is that really your email?')).toBe('Is that really your email?');
  });

  it('gives an empty reason back empty so the caller can fall through to its own default', () => {
    expect(asSentence('')).toBe('');
    expect(asSentence('   ')).toBe('');
    expect(asSentence(undefined)).toBe('');
    expect(asSentence(null)).toBe('');
  });
});
