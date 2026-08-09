import { describe, it, expect } from 'vitest';
import {
  detectCurrency,
  findStatedRanges,
  parseAshbyPostingRef,
  resolveSalary,
  salarySkipReason,
  selectPostingCompensation,
  statedRangeInJd,
  statedRangeInLabel,
  type SalaryQuestionContext,
  type StoredSalary,
} from './salary';
import { skippedReasonsNeedReview, selectNeedsYouReasons } from '../autosubmit-gate';

// The salary rule (R-031 + R-011), pinned in both directions per the repo's standing lesson:
// every case that must FILL (the median rule is useless if it never fires) and every case that
// must FLAG (the currency gate is the fix, and a flag that does not hold auto-submit is not a
// flag). The DOM halves - the adapter branches that route a real control here - live in
// salary-fill.test.ts.

const FIGURE_EUR: StoredSalary = { value: '80000', currency: 'EUR' };
const PROSE: StoredSalary = { value: 'Negotiable, open to your standard intern rate' };

const ctx = (over: Partial<SalaryQuestionContext>): SalaryQuestionContext => ({
  label: 'what are your salary expectations?',
  field: 'freetext',
  ...over,
});

describe('statedRangeInLabel / findStatedRanges', () => {
  it('parses "usd 90,000 - 110,000" (labels arrive lowercased) into its median, posting-formatted', () => {
    const r = statedRangeInLabel('expected salary (usd 90,000 - 110,000)');
    expect(r).not.toBeNull();
    expect(r!.median).toBe(100000);
    expect(r!.fillText).toBe('USD 100,000');
    expect(r!.fillNumeric).toBe('100000');
    expect(r!.currency).toBe('USD');
  });

  it('parses "$40-50/hr" and keeps the posting\'s own symbol and unit', () => {
    const r = statedRangeInLabel('hourly pay: $40-50/hr');
    expect(r).not.toBeNull();
    expect(r!.fillText).toBe('$45/hr');
    expect(r!.fillNumeric).toBe('45');
    // A bare $ is a dollar of unknown nationality: usable as the posting's own format, never as
    // a resolved currency for the stored-figure gate.
    expect(r!.currency).toBeNull();
  });

  it('parses EU-grouped "eur 55.000-65.000" and formats the median the same way', () => {
    const r = statedRangeInLabel('gehalt: eur 55.000-65.000');
    expect(r).not.toBeNull();
    expect(r!.median).toBe(60000);
    expect(r!.fillText).toBe('EUR 60.000');
    expect(r!.fillNumeric).toBe('60000');
    expect(r!.currency).toBe('EUR');
  });

  it('parses a k-suffixed shorthand ("90-110k") scaling both sides', () => {
    const r = statedRangeInLabel('salary band 90-110k');
    expect(r).not.toBeNull();
    expect(r!.min).toBe(90000);
    expect(r!.max).toBe(110000);
    expect(r!.fillText).toBe('100k');
    expect(r!.fillNumeric).toBe('100000');
  });

  it('a trailing currency code ("55,000 - 65,000 aed") is kept in the posting\'s position', () => {
    const r = statedRangeInLabel('monthly salary 55,000 - 65,000 aed');
    expect(r!.fillText).toBe('60,000 AED');
    expect(r!.currency).toBe('AED');
  });

  it('never reads a year pair or a small unqualified pair as a salary range', () => {
    expect(statedRangeInLabel('available 2024-2026, expected salary?')).toBeNull();
    expect(statedRangeInLabel('expected salary and availability (10-12 weeks)')).toBeNull();
  });

  it('two different ranges in one label resolve nothing (ambiguity never fills)', () => {
    expect(statedRangeInLabel('salary usd 90,000-110,000 or eur 80.000-95.000')).toBeNull();
  });

  it('a word-boundary guard keeps a code-shaped word tail from resolving', () => {
    expect(findStatedRanges('top 100-200 employees')).toHaveLength(0);
  });
});

describe('statedRangeInJd', () => {
  it('finds the single range adjacent to compensation wording', () => {
    const jd = `About us. Great team. Compensation: USD 90,000 - 110,000 per year plus benefits. Apply now.`;
    const r = statedRangeInJd(jd);
    expect(r).not.toBeNull();
    expect(r!.median).toBe(100000);
  });

  it('ignores a range with no salary wording anywhere near it', () => {
    expect(
      statedRangeInJd(
        'We serve 40,000 - 50,000 customers across many countries and regions worldwide. Compensation is not disclosed here.',
      ),
    ).toBeNull();
  });

  it('two distinct salary-adjacent ranges resolve nothing', () => {
    const jd = 'Salary: USD 90,000-110,000 for SF. Salary: USD 70,000-80,000 for Austin.';
    expect(statedRangeInJd(jd)).toBeNull();
  });
});

describe('detectCurrency', () => {
  it('resolves a single named currency, lowercased or symbolic', () => {
    expect(detectCurrency('desired salary (eur)')).toBe('EUR');
    expect(detectCurrency('salary in €')).toBe('EUR');
    expect(detectCurrency('annual package, aed')).toBe('AED');
  });

  it('never resolves a bare $, an ambiguous pair, or common-word code shapes', () => {
    expect(detectCurrency('salary ($)')).toBeNull();
    expect(detectCurrency('salary in usd or eur')).toBeNull();
    // "try" is the word, not the lira; excluded from the code list on purpose.
    expect(detectCurrency('please try to state your salary')).toBeNull();
  });
});

describe('selectPostingCompensation', () => {
  const payload = (compensation: unknown) => ({
    jobs: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Intern', compensation }],
  });
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('pulls the salary component out of a tiered payload and uppercases the currency', () => {
    const comp = {
      compensationTiers: [
        {
          components: [
            { compensationType: 'Salary', currencyCode: 'usd', minValue: 90000, maxValue: 110000 },
            { compensationType: 'EquityPercentage', currencyCode: 'usd', minValue: 0.01, maxValue: 0.05 },
          ],
        },
      ],
    };
    expect(selectPostingCompensation(payload(comp), id)).toEqual({
      currencyCode: 'USD',
      minValue: 90000,
      maxValue: 110000,
    });
  });

  it('returns null on multi-tier ambiguity (two distinct bands is not one stated range)', () => {
    const comp = {
      compensationTiers: [
        { components: [{ compensationType: 'Salary', currencyCode: 'USD', minValue: 90000, maxValue: 110000 }] },
        { components: [{ compensationType: 'Salary', currencyCode: 'USD', minValue: 70000, maxValue: 80000 }] },
      ],
    };
    expect(selectPostingCompensation(payload(comp), id)).toBeNull();
  });

  it('returns null when the posting carries no usable compensation at all', () => {
    expect(selectPostingCompensation(payload(undefined), id)).toBeNull();
    expect(selectPostingCompensation(payload({ summaryComponents: [] }), id)).toBeNull();
    expect(selectPostingCompensation({ jobs: [] }, id)).toBeNull();
    expect(selectPostingCompensation(null, id)).toBeNull();
  });
});

describe('parseAshbyPostingRef (moved here from ashby.ts, contract unchanged)', () => {
  it('parses org + posting uuid from an /application URL', () => {
    expect(
      parseAshbyPostingRef('https://jobs.ashbyhq.com/espa/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/application'),
    ).toEqual({ org: 'espa', postingId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  });

  it('returns null off-host or without a uuid', () => {
    expect(parseAshbyPostingRef('https://jobs.lever.co/x/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBeNull();
    expect(parseAshbyPostingRef('https://jobs.ashbyhq.com/espa')).toBeNull();
  });
});

describe('resolveSalary: application expectations are always human-only', () => {
  it.each([
    ['label range', ctx({ label: 'expected salary (usd 90,000 - 110,000)' }), FIGURE_EUR],
    ['numeric range', ctx({ label: 'expected salary (usd 90,000 - 110,000)', field: 'numeric' }), FIGURE_EUR],
    ['structured posting', ctx({ posting: { currencyCode: 'USD', minValue: 90000, maxValue: 110000 } }), FIGURE_EUR],
    ['JD range', ctx({ jdText: 'Compensation: USD 90,000 - 110,000 per year.' }), FIGURE_EUR],
    ['stored figure', ctx({ label: 'desired salary (eur)' }), FIGURE_EUR],
    ['stored prose', ctx({}), PROSE],
    ['no stored answer', ctx({}), {}],
  ])('flags %s without calculating or filling', (_name, question, stored) => {
    const result = resolveSalary(question, stored);
    expect(result.action).toBe('flag');
    expect((result as { reason: string }).reason).toMatch(/left for you/);
    expect((result as { reason: string }).reason).toMatch(/current answer/);
  });
});

describe('the flag engages the auto-submit hold', () => {
  it('every flag variant matches REVIEW_FLAG and surfaces on the "Still needs you" list', () => {
    const flags = [
      resolveSalary(ctx({ field: 'numeric' }), FIGURE_EUR),
      resolveSalary(ctx({ label: 'desired salary (usd)' }), FIGURE_EUR),
      resolveSalary(ctx({ field: 'numeric' }), PROSE),
      resolveSalary(ctx({}), {}),
    ];
    for (const f of flags) {
      expect(f.action).toBe('flag');
      const reason = (f as { reason: string }).reason;
      // The hold: autosubmit-gate's REVIEW_FLAG must classify this as needing the student.
      expect(skippedReasonsNeedReview([reason])).toBe(true);
      // The card: it must survive the "Still needs you" filter, not just the hold.
      expect(selectNeedsYouReasons([reason])).toEqual([reason]);
    }
  });

  it('salarySkipReason carries the label and the load-bearing phrasing', () => {
    const reason = salarySkipReason('what are your salary expectations?', 'detail here');
    expect(reason).toBe('salary question left for you (detail here): "what are your salary expectations?"');
    expect(skippedReasonsNeedReview([reason])).toBe(true);
  });
});
