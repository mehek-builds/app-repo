/**
 * Join a reason to the sentence that follows it.
 *
 * The fill card composes its failure line as `<reason> Nothing was attached or submitted.` Reasons
 * come from several places - the background, the backend's own error field, a thrown Error - and
 * not all of them are sentences. The background used to answer `not signed in`, which rendered as
 *
 *     not signed in Nothing was attached or submitted.
 *
 * two statements welded together with no punctuation, which reads as one broken sentence and makes
 * a product look unfinished at the exact moment it is asking to be trusted. Terminal punctuation is
 * added only when it is missing, so a reason that already ends properly is left alone.
 */
export function asSentence(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
