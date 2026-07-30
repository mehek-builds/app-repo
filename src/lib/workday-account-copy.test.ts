import { describe, expect, it } from 'vitest';
import {
  WORKDAY_ACCOUNT_PROMPT_BODY,
  WORKDAY_ACCOUNT_PROMPT_TITLE,
  workdayAccountCompletion,
} from './workday-account-copy';

describe('Workday account disclosure', () => {
  it('says before the click that Litos can make and fill a password', () => {
    expect(WORKDAY_ACCOUNT_PROMPT_TITLE).toBe('Fill in your account details?');
    expect(WORKDAY_ACCOUNT_PROMPT_BODY).toContain('makes a unique password');
    expect(WORKDAY_ACCOUNT_PROMPT_BODY).toContain('never submits this form');
  });

  it('reports exactly which account fields were filled', () => {
    expect(workdayAccountCompletion({
      creatingAccount: true,
      emailFilled: true,
      passwordFilled: true,
    })).toBe('Email and password filled. Review the fields, then click Create Account yourself.');
    expect(workdayAccountCompletion({
      creatingAccount: false,
      emailFilled: false,
      passwordFilled: true,
    })).toBe('Password filled. Review the fields, then sign in yourself.');
  });

  it('preserves the safety explanation when a password is withheld', () => {
    expect(workdayAccountCompletion({
      creatingAccount: false,
      emailFilled: true,
      passwordFilled: false,
      passwordWithheldReason: 'Litos did not make this account, so type your password in yourself.',
    })).toBe('Email filled. Litos did not make this account, so type your password in yourself.');
  });

  it('distinguishes an email-only write from a page where nothing changed', () => {
    expect(workdayAccountCompletion({
      creatingAccount: true,
      emailFilled: true,
      passwordFilled: false,
    })).toBe('Email filled. Enter your password yourself. Litos did not submit the form.');
    expect(workdayAccountCompletion({
      creatingAccount: true,
      emailFilled: false,
      passwordFilled: false,
    })).toBe('Nothing was changed. Complete the account fields yourself.');
  });
});
