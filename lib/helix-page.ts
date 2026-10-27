'use client';
// What Helix sees and fills on the page the person is on. Forms declare themselves (ActionForm `helix`, `lane`):
// readPage() maps the page (title, named items, each form's fields with labels, options and current values),
// fillForm() types values into a form live (each field lights up as it lands), and submitForm() saves it through
// the form's own action (only internal forms, only after the person's yes; Helix never presses outward buttons).
export type PageField = { name: string; label: string; type: string; required: boolean; value: string; options?: string[] };
export type PageForm = { key: string; title: string; lane: 'internal' | 'outward'; item?: string; fields: PageField[]; submit: string };
/** A card on the page (a partner, a lead): its name, the facts it shows, and a ref Helix's lookups take. */
export type PageCard = { name: string; facts: string; ref?: string };
export type PageMap = { page: string; path: string; items: string[]; cards: PageCard[]; forms: PageForm[] };

const clean = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const fieldsOf = (f: HTMLFormElement) => [...f.querySelectorAll<Field>('input, select, textarea')].filter((el) => el.name && !(el instanceof HTMLInputElement && ['hidden', 'submit', 'button'].includes(el.type)));
const submitOf = (f: HTMLFormElement) => clean(f.querySelector('button[type=submit], button:not([type])')?.textContent) || 'Save';
// Every form on the page, not only those that declare themselves: any other form is named from its label or the
// heading of the panel it sits in, and its lane is read from its button (send, publish, approve, pay, buy, invite,
// delete, run: outward, which Helix fills but never presses).
const titleOf = (f: HTMLFormElement) => f.dataset.helixTitle ?? f.dataset.helixForm ?? (clean(f.getAttribute('aria-label')) ||
  clean(f.closest('section, .panel')?.querySelector('h2, h3')?.textContent) || submitOf(f));
const OUTWARD = /\b(send|publish|post|approve|pay|charge|buy|purchase|invite|delete|remove|release|void|refund|run|spend|launch)\b/i;
const laneOf = (f: HTMLFormElement): 'internal' | 'outward' =>
  f.dataset.helixLane === 'outward' ? 'outward' : f.dataset.helixLane === 'internal' || f.dataset.helixForm ? 'internal' : OUTWARD.test(submitOf(f)) ? 'outward' : 'internal';
const formKey = (f: HTMLFormElement) => { const item = f.closest<HTMLElement>('[data-helix-item]')?.dataset.helixItem; const t = titleOf(f); return item ? `${item} · ${t}` : t; };
/** The forms Helix works with: every form built for it, and any other form with fields; never search boxes or Helix's own drawer. */
const helixForms = () => [...document.querySelectorAll<HTMLFormElement>('main form')].filter((f) => f.getAttribute('role') !== 'search' && !f.closest('.helix-drawer, [data-helix-skip]') && (!!f.dataset.helixForm || fieldsOf(f).length > 0));
/** Checkboxes sharing a name are one choice (lines of business): filled as "auto, boat, rv". */
const groupOf = (f: HTMLFormElement, el: Field) => (el instanceof HTMLInputElement && el.type === 'checkbox' ? [...f.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${CSS.escape(el.name)}"]`)] : []);
const boxLabel = (b: HTMLInputElement) => clean(b.closest('label')?.textContent) || b.value;
const matchesBox = (b: HTMLInputElement, x: string) => x === b.value.toLowerCase() || x === boxLabel(b).toLowerCase() || boxLabel(b).toLowerCase().startsWith(x);
function labelOf(el: Field): string {
  const own = el.closest('label');
  const span = own?.querySelector('span');
  return clean(span?.textContent || (own ? own.textContent : '') || el.getAttribute('aria-label') || (el as HTMLInputElement).placeholder || el.name);
}

/** Wait until the page's forms have rendered and stopped changing (a page loading after navigation), up to 3 s. */
export async function settled(): Promise<void> {
  let prev = -1;
  for (let t = 0; t < 3000; t += 250) {
    const n = helixForms().length + document.querySelectorAll('main [data-helix-item]').length;
    if (n === prev && n > 0) return;
    prev = n;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The page as Helix needs it, compact (about 4,500 characters at most). */
export function readPage(): PageMap {
  const declared = new Set<PageForm>(); // forms built for Helix (ActionForm), kept longest when trimming
  const forms = helixForms().map((f): PageForm => {
    const groups = new Set<string>();
    const fields: PageField[] = [];
    for (const el of fieldsOf(f)) {
      const group = groupOf(f, el);
      if (group.length > 1) {
        if (groups.has(el.name)) continue;
        groups.add(el.name);
        const legend = clean(group[0].closest('[data-helix-group]')?.getAttribute('data-helix-group')) || clean(group[0].closest('fieldset')?.querySelector('legend')?.textContent) || el.name;
        fields.push({ name: el.name, label: legend, type: 'choices', required: false, value: group.filter((b) => b.checked).map(boxLabel).join(', '), options: group.map(boxLabel).slice(0, 20) });
        continue;
      }
      fields.push({
        name: el.name, label: labelOf(el), type: el instanceof HTMLSelectElement ? 'select' : el instanceof HTMLTextAreaElement ? 'text' : el.type, required: el.required,
        value: el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : clean(el.value).slice(0, 80),
        ...(el instanceof HTMLSelectElement ? { options: [...el.options].map((o) => o.value ? `${o.value}${clean(o.textContent) && clean(o.textContent) !== o.value ? ` (${clean(o.textContent)})` : ''}` : '').filter(Boolean).slice(0, 20) } : {}),
      });
    }
    const pf: PageForm = { key: formKey(f), title: titleOf(f), lane: laneOf(f), item: f.closest<HTMLElement>('[data-helix-item]')?.dataset.helixItem, fields, submit: submitOf(f) };
    if (f.dataset.helixForm) declared.add(pf);
    return pf;
  });
  const map: PageMap = {
    page: clean(document.querySelector('.topbar h1')?.textContent),
    path: location.pathname,
    items: [...new Set([...document.querySelectorAll<HTMLElement>('main [data-helix-item]')].map((e) => e.dataset.helixItem!))].slice(0, 30),
    cards: [],
    forms,
  };
  // Cards carry their facts (data-helix-facts) with their own budget, in page order (the Call Desk first), so a long
  // list never pushes out the forms.
  let room = 2600;
  for (const e of document.querySelectorAll<HTMLElement>('main [data-helix-facts]')) {
    const c: PageCard = { name: clean(e.dataset.helixItem).slice(0, 80), facts: clean(e.dataset.helixFacts).slice(0, 240), ...(e.dataset.helixRef ? { ref: e.dataset.helixRef } : {}) };
    if (map.cards.some((x) => x.name === c.name && x.facts === c.facts)) continue;
    room -= JSON.stringify(c).length;
    if (room < 0) break;
    map.cards.push(c);
  }
  // Keep it small. Long lists repeat the same row form many times: shorten row forms to their name and field names
  // first (fill_form still matches options by their text), and only then drop what still doesn't fit.
  const size = () => JSON.stringify({ ...map, cards: [] }).length;
  if (size() > 4400) map.forms = map.forms.map((f) => (f.item || !declared.has(f) ? { ...f, fields: f.fields.map((x) => ({ name: x.name, label: x.label, type: x.type, required: x.required, value: '' })) } : f));
  // Still too big: drop repeated row forms (keeping one of each kind) before any of the page's own forms.
  // A form repeated down a list (one per row, named or not) counts as repeated; forms nobody declared for Helix go
  // before declared ones, so a page's own actions ("Run the scan now") are never pushed out by a long table.
  const repeated = (f: PageForm) => map.forms.filter((x) => x.title === f.title).length > 1;
  const undeclared = (f: PageForm) => !declared.has(f);
  const dropLast = (test: (f: PageForm) => boolean) => { const i = map.forms.map((f, n) => (test(f) ? n : -1)).filter((n) => n >= 0).pop(); if (i === undefined) return false; map.forms.splice(i, 1); return true; };
  while (size() > 4400 && dropLast(repeated)) { /* one of each kind stays */ }
  while (size() > 4400 && dropLast(undeclared)) { /* then forms not built for Helix */ }
  while (size() > 4400 && map.forms.length > 1) map.forms.pop();
  return map;
}

/** The form a name refers to: exact key, else the best partial match ("campaign", "Riverside · status"). */
export function findForm(name: string): HTMLFormElement | null {
  const want = clean(name).toLowerCase();
  const all = helixForms();
  // A row's form ("Riverside Agency · Inquiry status") must be that row's: never the same form on another row.
  if (want.includes(' · ')) {
    const [item, title] = want.split(' · ');
    return all.find((f) => formKey(f).toLowerCase() === want)
      ?? all.find((f) => (f.closest<HTMLElement>('[data-helix-item]')?.dataset.helixItem ?? '').toLowerCase().includes(item) && titleOf(f).toLowerCase() === title)
      ?? null;
  }
  return all.find((f) => formKey(f).toLowerCase() === want)
    ?? all.find((f) => (f.dataset.helixForm ?? '').toLowerCase() === want)
    ?? all.find((f) => formKey(f).toLowerCase().includes(want) || (f.dataset.helixTitle ? want.includes(f.dataset.helixTitle.toLowerCase()) : false))
    ?? null;
}

const setValue = (el: Field, v: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type FillResult = { ok: true; form: string; lane: 'internal' | 'outward'; filled: string[]; missing: string[]; unknown: string[]; submit: string } | { ok: false; error: string; forms?: string[] };

/** Fill a form live: opens it if folded away, then types each value in turn (each field lights up as it lands). */
export async function fillForm(name: string, values: { name: string; value: string }[]): Promise<FillResult> {
  let f = findForm(name);
  for (let t = 0; !f && t < 2000; t += 250) { await sleep(250); f = findForm(name); } // the page may still be loading
  if (!f) return { ok: false, error: `No form called “${name}” on this page.`, forms: readPage().forms.map((x) => x.key) };
  for (let d = f.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  f.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const fields = fieldsOf(f);
  const filled: string[] = [], unknown: string[] = [];
  for (const { name: n, value } of values) {
    const want = clean(n).toLowerCase();
    const legendOf = (x: Field) => clean(x.closest('[data-helix-group]')?.getAttribute('data-helix-group')).toLowerCase();
    const el = fields.find((x) => x.name.toLowerCase() === want) ?? fields.find((x) => legendOf(x) && legendOf(x) === want) ?? fields.find((x) => labelOf(x).toLowerCase() === want) ?? fields.find((x) => labelOf(x).toLowerCase().includes(want));
    if (!el) { unknown.push(n); continue; }
    const v = String(value ?? '');
    const group = groupOf(f, el);
    if (group.length > 1) {
      // "auto, boat and RV": tick exactly those (by value or label), untick the rest.
      const picks = v.split(/,|;|\band\b/i).map((x) => clean(x).toLowerCase()).filter(Boolean);
      for (const b of group) if (b.checked !== picks.some((x) => matchesBox(b, x))) b.click();
      const bad = picks.filter((x) => !group.some((b) => matchesBox(b, x)));
      if (bad.length) unknown.push(`${n}=${bad.join(', ')}`);
      for (const b of group) { const l = (b.closest('label') ?? b) as HTMLElement; l.classList.remove('helix-filled'); void l.offsetWidth; l.classList.add('helix-filled'); }
      filled.push(legendOf(el) || n);
      await sleep(140);
      continue;
    }
    if (el instanceof HTMLInputElement && el.type === 'checkbox') { if (el.checked !== /^(true|yes|on|1)$/i.test(v)) el.click(); }
    else if (el instanceof HTMLSelectElement) {
      const o = [...el.options].find((x) => x.value.toLowerCase() === v.toLowerCase()) ?? [...el.options].find((x) => clean(x.textContent).toLowerCase() === v.toLowerCase()) ?? [...el.options].find((x) => clean(x.textContent).toLowerCase().includes(v.toLowerCase()) && v);
      if (!o) { unknown.push(`${n}=${v}`); continue; }
      setValue(el, o.value);
    } else setValue(el, v);
    el.classList.remove('helix-filled'); void el.offsetWidth; el.classList.add('helix-filled');
    filled.push(labelOf(el));
    await sleep(140);
  }
  const missing = fields.filter((x) => x.required && !x.value).map(labelOf);
  return { ok: true, form: formKey(f), lane: laneOf(f), filled, missing, unknown, submit: submitOf(f) };
}

/** Save a filled internal form through its own action (the person already said yes). Outward forms never. */
export function submitForm(name: string): { ok: true; form: string } | { ok: false; error: string } {
  const f = findForm(name);
  if (!f) return { ok: false, error: `No form called “${name}” on this page.` };
  if (laneOf(f) === 'outward') return { ok: false, error: 'That one goes out (send, publish, approve or spend): the person taps it themselves.' };
  if (!f.reportValidity()) return { ok: false, error: 'Some required fields are still empty or invalid.' };
  const submitter = f.querySelector<HTMLButtonElement>('button[type=submit], button:not([type])');
  f.requestSubmit(submitter ?? undefined);
  return { ok: true, form: formKey(f) };
}
