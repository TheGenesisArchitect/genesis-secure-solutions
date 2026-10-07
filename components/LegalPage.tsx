// Renders a published legal text (data/legal-texts.ts): headings, paragraphs, lists, simple tables and bold.
// The texts are ours and fixed, so a small renderer is enough; values come from data/legal.ts.
import { Fragment, type ReactNode } from 'react';
import { SiteChrome } from './SiteChrome';
import { LEGAL } from '@/data/legal';

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\{\{\w+\}\})/g);
  return parts.map((p, i) => {
    if (p.startsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
    const m = p.match(/^\{\{(\w+)\}\}$/);
    if (m) {
      const v = LEGAL[m[1]];
      return v === null || v === undefined ? <span key={i} className="chip pending" style={{ verticalAlign: 'middle' }}>to be confirmed</span> : <Fragment key={i}>{v}</Fragment>;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function LegalPage({ text }: { text: string }) {
  const src = text;
  const blocks = src.trim().split(/\n\s*\n/);
  return (
    <SiteChrome>
      <main className="wrapx sec legal" style={{ paddingTop: 48, maxWidth: 820 }}>
        {blocks.map((b, i) => {
          const lines = b.split('\n');
          if (b.startsWith('# ')) return <h1 key={i} style={{ font: '800 clamp(28px,4vw,44px)/1.1 var(--display)' }}>{inline(b.slice(2))}</h1>;
          if (b.startsWith('## ')) return <h2 key={i} style={{ font: '800 20px/1.3 var(--display)', marginTop: 12 }}>{inline(b.slice(3))}</h2>;
          if (lines.every((l) => l.startsWith('- '))) return <ul key={i} className="soft" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>;
          if (lines.every((l) => /^\d+\. /.test(l))) return <ol key={i} className="soft" style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 8 }}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\d+\. /, ''))}</li>)}</ol>;
          if (lines[0].startsWith('|')) {
            const rows = lines.filter((l) => !/^\|\s*-/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
            return (
              <div key={i} className="table-wrap"><table className="t">
                <thead><tr>{rows[0].map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
                <tbody>{rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
              </table></div>
            );
          }
          return <p key={i} className="soft" style={{ maxWidth: '72ch' }}>{inline(lines.join(' '))}</p>;
        })}
      </main>
    </SiteChrome>
  );
}
