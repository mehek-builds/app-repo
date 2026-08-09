// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { openCombobox, closeOpenCombobox, pickComboOption } from './shared/dom';
import { fillGenericApplication, matchOption } from './generic';
import { fillAshbyApplication } from './ashby';
import { readControlValue } from '../harvest';
import type { ApplicationProfile, Profile } from '../types';

// The abandoned typeahead query. openCombobox types a query into a lookup-only widget to make its
// menu render at all; when nothing matches, the caller gives up and the fill card says "dropdown
// left for you". The typed text used to STAY in the box, which turned a skip into three separate
// lies:
//   1. the student sees a field that looks answered while the card says it was left for her,
//   2. on a plain input[role=combobox] backed by a real form field, that leftover text is what
//      submits - the exact uncommitted-value shape R-002 documents on the location picker, where
//      "Dubai" showed in the box while the form held nothing,
//   3. harvest reads a control's CURRENT value on her next trusted keystroke, so Litos's own query
//      would come back as something she typed - laundering a guess into the profile, which is the
//      one thing harvest.ts's isTrusted check exists to prevent and cannot catch on its own once
//      our text is sitting in the box she edits.
// These tests pin the retraction at the shared helper (every adapter reaches it) and at the two
// adapters that type a typeahead for BOTH desired shapes, plus the two directions it must NOT
// fire: a committed selection, and text we never typed.

const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

const profile = {} as Profile;
const ap = (o: Partial<ApplicationProfile> = {}): ApplicationProfile => o as ApplicationProfile;

beforeAll(() => {
  // jsdom has no layout, so every rect is 0x0 and both isVisible() and the option reader would
  // discard the whole fixture. Same shim the other adapter tests use.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }),
  });
  // jsdom implements no scrolling at all, and openCombobox brings the control into view before it
  // touches anything.
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
  if (typeof globalThis.CSS === 'undefined' || !globalThis.CSS?.escape) {
    (globalThis as Record<string, unknown>).CSS = {
      escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
    };
  }
});

beforeEach(() => {
  document.body.innerHTML = '';
});

let seq = 0;

/**
 * A combobox that behaves the way the live ones measured: its menu is populated from the query in
 * the box, and only a click on an option commits (the commit writes through the prototype setter
 * WITHOUT dispatching input, the way a React re-render lands, so it can never be mistaken for the
 * driver's own typing).
 *
 * `optionsFor('')` returning [] is the typeahead-only shape - the menu does not exist until
 * something is typed, which is the only reason openCombobox types at all. `openOnPointer` is the
 * preloaded shape, whose menu renders on the pointer sequence and so is never typed into.
 */
function combobox(opts: {
  labelText: string;
  optionsFor: (query: string) => string[];
  preset?: string;
  openOnPointer?: boolean;
  blockClass?: string;
  commitTo?: (optionText: string) => string;
}): { input: HTMLInputElement; block: HTMLElement } {
  const listboxId = `combo-lb-${++seq}`;
  const inputId = `combo-in-${seq}`;
  const block = document.createElement('div');
  block.className = opts.blockClass ?? 'field-block';
  const label = document.createElement('label');
  label.htmlFor = inputId;
  label.textContent = opts.labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = inputId;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listboxId);
  const listbox = document.createElement('div');
  listbox.id = listboxId;
  listbox.setAttribute('role', 'listbox');
  block.append(label, input, listbox);
  document.body.appendChild(block);

  const render = (): void => {
    listbox.textContent = '';
    for (const text of opts.optionsFor(input.value)) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.textContent = text;
      option.addEventListener('click', () => {
        nativeSet.call(input, opts.commitTo ? opts.commitTo(text) : text);
        listbox.textContent = '';
      });
      listbox.appendChild(option);
    }
  };

  input.addEventListener('input', render);
  if (opts.openOnPointer) input.addEventListener('mousedown', render);
  if (opts.preset) nativeSet.call(input, opts.preset);

  return { input, block };
}

describe('closeOpenCombobox: retracting the query openCombobox typed', () => {
  it('clears the typed query when the menu never rendered', async () => {
    const { input } = combobox({ labelText: 'Country', optionsFor: () => [] });

    const options = await openCombobox(input, 'India', 150);
    expect(options).toHaveLength(0);
    expect(input.value).toBe('India'); // typed to try to open it, and nothing committed

    closeOpenCombobox();

    expect(input.value).toBe('');
  });

  it('clears the typed query when options rendered but none matched', async () => {
    const { input } = combobox({
      labelText: 'Country',
      optionsFor: (q) => (q ? ['Argentina', 'Brazil'] : []),
    });

    const options = await openCombobox(input, 'India', 400);
    expect(options.map((o) => o.text)).toEqual(['Argentina', 'Brazil']);
    expect(matchOption(options, { mode: 'value', value: 'India' })).toBeNull();

    closeOpenCombobox();

    expect(input.value).toBe('');
  });

  it('leaves a committed selection alone', async () => {
    const { input } = combobox({
      labelText: 'Country',
      optionsFor: (q) => (q ? ['India'] : []),
    });

    const options = await openCombobox(input, 'India', 400);
    const match = matchOption(options, { mode: 'value', value: 'India' })!;
    await pickComboOption(match);
    // A later abandon on a DIFFERENT widget must never reach back and blank this one.
    closeOpenCombobox();

    expect(input.value).toBe('India');
  });

  it('never clears text it did not type', async () => {
    // Preloaded menu: it opens on the pointer sequence, so step 4 never types and the value in the
    // box is the student's (or the form's) own. An unmatched option list must leave it untouched.
    const { input } = combobox({
      labelText: 'Country',
      optionsFor: () => ['Argentina', 'Brazil'],
      preset: 'Germany',
      openOnPointer: true,
    });

    const options = await openCombobox(input, 'India', 150);
    expect(options).toHaveLength(2);
    expect(matchOption(options, { mode: 'value', value: 'India' })).toBeNull();

    closeOpenCombobox();

    expect(input.value).toBe('Germany');
  });

  it('leaves a query the widget transformed, rather than guessing at it', async () => {
    // Only the EXACT recorded text in the EXACT input is retracted. A widget that rewrites what
    // was typed (autocompleting, upper-casing, appending a unit) owns its box, and blanking it
    // would be a write we cannot justify.
    const { input } = combobox({
      labelText: 'Country',
      optionsFor: (q) => (q ? ['Argentina'] : []),
    });
    input.addEventListener('input', () => {
      if (input.value === 'India') nativeSet.call(input, 'India, Republic of');
    });

    await openCombobox(input, 'India', 400);
    closeOpenCombobox();

    expect(input.value).toBe('India, Republic of');
  });

  it('retracts once: a second close is a no-op on text typed since', async () => {
    const { input } = combobox({ labelText: 'Country', optionsFor: () => [] });

    await openCombobox(input, 'India', 150);
    closeOpenCombobox();
    // The student now types the answer herself into the same box.
    nativeSet.call(input, 'India');
    closeOpenCombobox();

    expect(input.value).toBe('India');
  });

  it('restores what the box held before, rather than blanking it', async () => {
    // Step 4 types OVER whatever is in the field. On a resumed application that field can already
    // hold her committed answer (ashby.ts's known-answer branch drives a block with no
    // already-answered guard), so retracting to "" would delete it while the card only claims the
    // dropdown was skipped. The probe must be undoable, not destructive.
    const { input } = combobox({ labelText: 'Country', optionsFor: () => [], preset: 'Germany' });

    await openCombobox(input, 'India', 150);
    expect(input.value).toBe('India'); // the probe overwrote her value

    closeOpenCombobox();

    expect(input.value).toBe('Germany');
  });

  it('restores a pre-existing value that is identical to the query', async () => {
    // The sharp case the equality guard cannot see: her stored answer and our typeahead are the
    // same string, so "is this text mine?" has no answer. Restoring the prior value is what makes
    // it safe either way - the box ends holding "India" because it started holding "India".
    const { input } = combobox({ labelText: 'Country', optionsFor: () => [], preset: 'India' });

    await openCombobox(input, 'India', 150);
    closeOpenCombobox();

    expect(input.value).toBe('India');
  });

  it('settles both widgets when two drives overlap', async () => {
    // Overlap is reachable: the 90s inactivity timeout rejects the fill promise while the adapter
    // loop keeps running, so a second fill can start on top of the first. Neither box may be left
    // holding Litos's uncommitted query, and neither student value may be lost.
    const a = combobox({ labelText: 'Country', optionsFor: () => [], preset: 'Germany' });
    const b = combobox({ labelText: 'State', optionsFor: () => [] });

    const driveA = openCombobox(a.input, 'India', 150);
    const driveB = openCombobox(b.input, 'Dubai', 150);
    await Promise.all([driveA, driveB]);
    closeOpenCombobox();

    expect(a.input.value).toBe('Germany');
    expect(b.input.value).toBe('');
  });
});

describe('realPointerSequence: the view fallback is a fallback, not the path', () => {
  it('passes view when the DOM implementation accepts it', async () => {
    // jsdom refuses `view`, so every other test in this file exercises only the catch branch. Stub
    // a permissive MouseEvent to prove the primary construction is the one a real browser gets,
    // and that `view` survives to the widget's handlers.
    const seen: Array<Window | null | undefined> = [];
    const RealMouseEvent = globalThis.MouseEvent;
    class PermissiveMouseEvent extends RealMouseEvent {
      constructor(type: string, init: MouseEventInit = {}) {
        super(type, { ...init, view: undefined });
        seen.push(init.view);
      }
    }
    (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent =
      PermissiveMouseEvent as unknown as typeof MouseEvent;
    try {
      const { input } = combobox({ labelText: 'Country', optionsFor: () => [] });
      await openCombobox(input, 'India', 150);
    } finally {
      (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent = RealMouseEvent;
    }

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === window)).toBe(true);
  });
});

describe('fillGenericApplication: an abandoned dropdown is left empty, not filled-looking', () => {
  const run = () =>
    fillGenericApplication({
      fullName: 'Mehek Mandal',
      email: 'mehekman@usc.edu',
      profile,
      applicationProfile: ap({ citizenship: 'India' }),
    });

  it('clears the typeahead when the picker offers no matching option', async () => {
    const { input } = combobox({
      labelText: 'Country of citizenship',
      optionsFor: (q) => (q ? ['Argentina', 'Brazil'] : []),
    });

    const result = await run();

    expect(input.value).toBe('');
    expect(result.skipped_reasons.some((r) => /dropdown left for you/.test(r))).toBe(true);
    // The card's claim and the field now agree, which is the whole point of the retraction.
    expect(result.fields_filled).toBe(0);
  }, 20000);

  it('clears the typeahead when the picker never opens', async () => {
    const { input } = combobox({ labelText: 'Country of citizenship', optionsFor: () => [] });

    const result = await run();

    expect(input.value).toBe('');
    expect(result.skipped_reasons.some((r) => /dropdown left for you/.test(r))).toBe(true);
  }, 20000);

  it('leaves nothing for harvest to mistake for the student answering', async () => {
    // harvest.ts's first guarantee - we only learn what the student typed - is upheld by the
    // isTrusted check on the event, but the VALUE it then reads is whatever the control holds at
    // that moment. Leftover query text in the box would ride her next real keystroke into the
    // profile as though she had typed it.
    const { input } = combobox({
      labelText: 'Country of citizenship',
      optionsFor: (q) => (q ? ['Argentina'] : []),
    });

    await run();

    expect(readControlValue(input)).toBeNull();
  }, 20000);

  it('still commits when the picker does offer the answer', async () => {
    const { input } = combobox({
      labelText: 'Country of citizenship',
      optionsFor: (q) => (q ? ['India', 'Indonesia'] : []),
    });

    const result = await run();

    expect(input.value).toBe('India');
    expect(result.fields_filled).toBeGreaterThan(0);
    expect(result.skipped_reasons.some((r) => /dropdown left for you/.test(r))).toBe(false);
  }, 20000);
});

describe('fillAshbyApplication: an abandoned dropdown is left empty, not filled-looking', () => {
  const run = () =>
    fillAshbyApplication({
      fullName: '',
      profile,
      applicationProfile: ap({ citizenship: 'India' }),
    });

  it('clears the typeahead when the picker offers no matching option', async () => {
    const { input } = combobox({
      labelText: 'Country of citizenship',
      optionsFor: (q) => (q ? ['Argentina', 'Brazil'] : []),
      blockClass: '_fieldEntry_ab1',
    });

    const result = await run();

    expect(input.value).toBe('');
    expect(result.skipped_reasons.some((r) => /no matching control, left blank/.test(r))).toBe(true);
  }, 20000);

  it('clears the typeahead when the picker never opens', async () => {
    const { input } = combobox({
      labelText: 'Country of citizenship',
      optionsFor: () => [],
      blockClass: '_fieldEntry_ab2',
    });

    await run();

    expect(input.value).toBe('');
    expect(readControlValue(input)).toBeNull();
  }, 20000);

  it('still commits when the picker does offer the answer', async () => {
    const { input } = combobox({
      labelText: 'Country of citizenship',
      optionsFor: (q) => (q ? ['India', 'Indonesia'] : []),
      blockClass: '_fieldEntry_ab3',
    });

    const result = await run();

    expect(input.value).toBe('India');
    expect(result.fields_filled).toBeGreaterThan(0);
  }, 20000);
});
