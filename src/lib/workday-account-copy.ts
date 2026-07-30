export const WORKDAY_ACCOUNT_PROMPT_TITLE = 'Fill in your account details?';

export const WORKDAY_ACCOUNT_PROMPT_BODY =
  'For a new account, Litos fills your email and makes a unique password. ' +
  'For sign-in, it fills a password only if Litos made the account. Litos never submits this form.';

export interface WorkdayAccountCompletion {
  creatingAccount: boolean;
  emailFilled: boolean;
  passwordFilled: boolean;
  passwordWithheldReason?: string;
}

export function workdayAccountCompletion(result: WorkdayAccountCompletion): string {
  if (result.passwordFilled) {
    const fields = result.emailFilled ? 'Email and password' : 'Password';
    return result.creatingAccount
      ? `${fields} filled. Review the fields, then click Create Account yourself.`
      : `${fields} filled. Review the fields, then sign in yourself.`;
  }

  if (result.emailFilled) {
    return result.passwordWithheldReason
      ? `Email filled. ${result.passwordWithheldReason}`
      : 'Email filled. Enter your password yourself. Litos did not submit the form.';
  }

  return result.passwordWithheldReason
    ? `Nothing was changed. ${result.passwordWithheldReason}`
    : 'Nothing was changed. Complete the account fields yourself.';
}
