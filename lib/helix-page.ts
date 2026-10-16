'use client';
// What Helix sees and fills on the page the person is on. Forms declare themselves (ActionForm `helix`, `lane`):
// readPage() maps the page (title, named items, each form's fields with labels, options and current values),
// fillForm() types values into a form live (each field lights up as it lands), and submitForm() saves it through
// the form's own action (only internal forms, only after the person's yes; Helix never presses outward buttons).
export type PageField = { name: string; label: string; type: string; required: boolean; value: string; options?: string[] };
export type PageForm = { key: string; title: string; lane: 'internal' | 'outward'; item?: string; fields: PageField[]; submit: string };
export type PageMap = { page: string; path: string; items: string[]; forms: PageForm[] };

const clean = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
const formKey = (f: HTMLFormElement) => { const item = f.closest<HTMLElement>('[data-helix-item]')?.dataset.helixItem; const t = f.dataset.helixTitle ?? f.dataset.helixForm ?? ''; return item ? `${item} · ${t}` : t; };
const helixForms = () => [...document.querySelectorAll<HTMLFormElement>('main form[data-helix-form]')];
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const fieldsOf = (f: HTMLFormElement) => [...f.querySelectorAll<Field>('input, select, textarea')].filter((el) => el.name && !(el instanceof HTMLInputElement && ['hidden', 'submit', 'button'].includes(el.type)));
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

/** The page as Helix needs it, compact (about 3,000 characters at most). */
export function readPage(): PageMap {
  const forms = helixForms().map((f): PageForm => ({
    key: formKey(f),
    title: f.dataset.helixTitle ?? f.dataset.helixForm ?? '',
    lane: f.dataset.helixLane === 'outward' ? 'outward' : 'internal',
    item: f.closest<HTMLElement>('[data-helix-item]')?.dataset.helixItem,
    fields: fieldsOf(f).map((el) => ({
      name: el.name, label: labelOf(el), type: el instanceof HTMLSelectElement ? 'select' : el instanceof HTMLTextAreaElement ? 'text' : el.type, required: el.required,
      value: el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : clean(el.value).slice(0, 80),
      ...(el instanceof HTMLSelectElement ? { options: [...el.options].map((o) => o.value ? `${o.value}${clean(o.textContent) && clean(o.textContent) !== o.value ? ` (${clean(o.textContent)})` : ''}` : '').filter(Boolean).slice(0, 20) } : {}),
    })),
    submit: clean(f.querySelector('button[type=submit], button:not([type])')?.textContent) || 'Save',
  }));
  const map: PageMap = {
    page: clean(document.querySelector('.topbar h1')?.textContent),
    path: location.pathname,
    items: [...new Set([...document.querySelectorAll<HTMLElement>('main [data-helix-item]')].map((e) => e.dataset.helixItem!))].slice(0, 30),
    forms,
  };
  // Keep it small. Long lists repeat the same row form many times: shorten row forms to their name and field names
  // first (fill_form still matches options by their text), and only then drop what still doesn't fit.
  if (JSON.stringify(map).length > 3200) map.forms = map.forms.map((f) => (f.item ? { ...f, fields: f.fields.map((x) => ({ name: x.name, label: x.label, type: x.type, required: x.required, value: '' })) } : f));
  // Still too big: drop repeated row forms (keeping one of each kind) before any of the page's own forms.
  const repeated = (f: PageForm) => !!f.item && map.forms.filter((x) => x.title === f.title).length > 1;
  while (JSON.stringify(map).length > 3200) {
    const i = map.forms.map((f, n) => (repeated(f) ? n : -1)).filter((n) => n >= 0).pop();
    if (i === undefined) break;
    map.forms.splice(i, 1);
  }
  while (JSON.stringify(map).length > 3200 && map.forms.length > 1) map.forms.pop();
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
      ?? all.find((f) => (f.closest<HTMLElement>('[data-helix-item]')?.dataset.helixItem ?? '').toLowerCase().includes(item) && (f.dataset.helixTitle ?? '').toLowerCase() === title)
      ?? null;
  }
  return all.find((f) => formKey(f).toLowerCase() === want)
    ?? all.find((f) => (f.dataset.helixForm ?? '').toLowerCase() === want)
    ?? all.find((f) => formKey(f).toLowerCase().includes(want) || want.includes((f.dataset.helixTitle ?? '').toLowerCase()))
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
    const el = fields.find((x) => x.name.toLowerCase() === want) ?? fields.find((x) => labelOf(x).toLowerCase() === want) ?? fields.find((x) => labelOf(x).toLowerCase().includes(want));
    if (!el) { unknown.push(n); continue; }
    const v = String(value ?? '');
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
  return { ok: true, form: formKey(f), lane: f.dataset.helixLane === 'outward' ? 'outward' : 'internal', filled, missing, unknown, submit: clean(f.querySelector('button[type=submit], button:not([type])')?.textContent) || 'Save' };
}

/** Save a filled internal form through its own action (the person already said yes). Outward forms never. */
export function submitForm(name: string): { ok: true; form: string } | { ok: false; error: string } {
  const f = findForm(name);
  if (!f) return { ok: false, error: `No form called “${name}” on this page.` };
  if (f.dataset.helixLane === 'outward') return { ok: false, error: 'That one goes out (send, publish, approve or spend): the person taps it themselves.' };
  if (!f.reportValidity()) return { ok: false, error: 'Some required fields are still empty or invalid.' };
  const submitter = f.querySelector<HTMLButtonElement>('button[type=submit], button:not([type])');
  f.requestSubmit(submitter ?? undefined);
  return { ok: true, form: formKey(f) };
}
