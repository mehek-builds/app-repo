// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { explicitWorkdayEeoAnswer, fillWorkdayApplication, isWorkdayProtectedClassQuestion } from './workday';
import type { Profile } from '../types';

const profile = {} as Profile;

describe('Workday explicit-only protected-class answers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('classifies the protected classes that must never reach generic decline inference', () => {
    for (const label of [
      'Sex',
      'Are you Hispanic or Latino?',
      'Race or ethnicity',
      'Military or protected veteran status',
      'Disability status',
      'Sexual orientation',
      'Gender identity or transgender status',
      'Demographic age group',
      'Religion',
      'Marital status',
      'National origin',
      'Genetic information',
      'Pregnancy status',
      'Indigenous or Aboriginal identity',
    ]) {
      expect(isWorkdayProtectedClassQuestion(label), label).toBe(true);
      expect(explicitWorkdayEeoAnswer(label, {}), label).toBeNull();
    }
  });

  it('uses only the exact reviewed protected-class value', () => {
    expect(explicitWorkdayEeoAnswer('Sexual orientation', { sexual_orientation: 'Bisexual' }))
      .toEqual({ mode: 'value', value: 'Bisexual', exact: true });
    expect(explicitWorkdayEeoAnswer('Demographic age group', { age_group: '25-34' }))
      .toEqual({ mode: 'value', value: '25-34', exact: true });
  });

  it('leaves sexual orientation and demographic age blank instead of auto-declining or answering', async () => {
    document.body.innerHTML = `
      <fieldset><legend>Sexual orientation</legend><select>
        <option value="">Select</option><option value="decline">Decline to self-identify</option>
      </select></fieldset>
      <fieldset><legend>Demographic age group</legend><select>
        <option value="">Select</option><option value="yes">Yes</option><option value="no">No</option>
      </select></fieldset>`;
    const result = await fillWorkdayApplication({ fullName: '', profile, applicationProfile: {}, eeo: {} });
    expect([...document.querySelectorAll<HTMLSelectElement>('select')].map((select) => select.value)).toEqual(['', '']);
    expect(result.skipped_reasons.filter((reason) => reason.startsWith('EEO field left for you'))).toHaveLength(2);
  });
});
