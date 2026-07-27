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

/* Findings from the code review of this branch. */
describe('splitName, Iberian and script edge cases', () => {
  it('does not eat the conjunction that joins two surnames', () => {
    expect(splitName('Maria Silva e Costa')).toEqual({ first: 'Maria', last: 'Silva e Costa' });
    expect(splitName('Jose Garcia y Lopez')).toEqual({ first: 'Jose', last: 'Garcia y Lopez' });
    expect(splitName('Francesc Puig i Serra')).toEqual({ first: 'Francesc', last: 'Puig i Serra' });
  });

  it('still drops a capitalised middle initial, with or without the period', () => {
    expect(splitName('Miranda W Hudson')).toEqual({ first: 'Miranda', last: 'Hudson' });
    expect(splitName('Miranda W. Hudson')).toEqual({ first: 'Miranda', last: 'Hudson' });
  });

  it('drops a lowercase initial only when it carries its period', () => {
    expect(splitName('Miranda w. Hudson')).toEqual({ first: 'Miranda', last: 'Hudson' });
  });

  it('leaves non-Latin names whole', () => {
    expect(splitName('Иван И. Петров')).toEqual({ first: 'Иван', last: 'Петров' });
    expect(splitName('José M. Rodríguez-Peña')).toEqual({ first: 'José', last: 'Rodríguez-Peña' });
  });

  it('keeps suffixes on the surname', () => {
    expect(splitName('Robert Downey Jr.')).toEqual({ first: 'Robert', last: 'Downey Jr.' });
    expect(splitName('Martin Luther King III')).toEqual({ first: 'Martin', last: 'Luther King III' });
  });
});
