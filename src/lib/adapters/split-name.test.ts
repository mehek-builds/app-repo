import { describe, it, expect } from 'vitest';
import { splitName } from './shared/dom';

/* "Miranda W. Hudson" - a real University of Washington sample resume, measured 2026-07-27 - used
 * to fill an employer's Last name box with "W. Hudson". */

describe('splitName', () => {
  it('does not put a middle initial in the surname', () => {
    expect(splitName('Miranda W. Hudson')).toEqual({ first: 'Miranda', last: 'Hudson' });
    expect(splitName('Samuel L Jackson')).toEqual({ first: 'Samuel', last: 'Jackson' });
    expect(splitName('John R. R. Tolkien')).toEqual({ first: 'John', last: 'Tolkien' });
  });

  it('keeps a spelled-out middle token, which may be half a compound surname', () => {
    expect(splitName('Maria Garcia Lopez')).toEqual({ first: 'Maria', last: 'Garcia Lopez' });
    expect(splitName('Jan van der Berg')).toEqual({ first: 'Jan', last: 'van der Berg' });
  });

  it('handles the ordinary two-token case unchanged', () => {
    expect(splitName('Mehek Mandal')).toEqual({ first: 'Mehek', last: 'Mandal' });
  });

  it('never strips the first or last token, however short', () => {
    expect(splitName('J Smith')).toEqual({ first: 'J', last: 'Smith' });
    expect(splitName('Miranda W')).toEqual({ first: 'Miranda', last: 'W' });
  });

  it('survives a single name, empty input and stray whitespace', () => {
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: '' });
    expect(splitName('')).toEqual({ first: '', last: '' });
    expect(splitName('   ')).toEqual({ first: '', last: '' });
    expect(splitName('  Miranda   W.   Hudson  ')).toEqual({ first: 'Miranda', last: 'Hudson' });
  });
});
