import { useEffect, useMemo, useState } from 'react';
import { t } from '../../app/i18n';
import { href, navigate } from '../../app/router';
import { projects, toast } from '../../app/store';
import { RECIPES, RECIPE_BY_SLUG, type Recipe } from '../../content/recipes';
import { COMPONENTS, docsUrl } from '../../core/catalog';
import { EIPS } from '../../core/eip';
import { toJava } from '../../core/java';
import { toXml } from '../../core/xml';
import { fromYaml } from '../../core/yaml';
import { CodeEditor } from '../../ui/CodeEditor';
import { EmptyState } from '../../ui/Modal';
import { FlowCanvas } from '../builder/Canvas';

const CATEGORIES = ['All', ...Array.from(new Set(RECIPES.map((r) => r.category)))];

function openInBuilder(r: Recipe) {
  const p = projects.create(r.title, fromYaml(r.yaml), r.summary);
  toast(`Project “${r.title}” created`, 'success');
  navigate(`/builder/${p.id}`);
}

export function KnowledgeBase() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  useEffect(() => {
    document.title = 'Knowledge Base · Apache Camel recipes & EIP reference';
  }, []);
  const s = q.trim().toLowerCase();
  const recipes = RECIPES.filter((r) => (cat === 'All' || r.category === cat) && (!s || `${r.title} ${r.summary} ${r.tags.join(' ')}`.toLowerCase().includes(s)));
  const eips = EIPS.filter((e) => !s || `${e.label} ${e.summary}`.toLowerCase().includes(s));
  const comps = COMPONENTS.filter((c) => !s || `${c.title} ${c.scheme} ${c.description}`.toLowerCase().includes(s));
  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <div className="tag">{t('Learn · Build · Reuse')}</div>
          <h1>{t('Knowledge Base')}</h1>
          <p>{t('Practical Apache Camel recipes with YAML, XML and Java DSL — open any of them in the builder.')}</p>
        </div>
        <input className="input search-lg" placeholder={t('Search recipes, EIPs, components…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search the knowledge base')} />
      </div>
      <div className="chips" style={{ marginBottom: 20 }}>
        {CATEGORIES.map((c) => (
          <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)} aria-pressed={cat === c}>
            {c}
          </button>
        ))}
      </div>

      <h2 style={{ fontSize: 18, margin: '8px 0 14px' }}>Recipes ({recipes.length})</h2>
      {recipes.length ? (
        <div className="features">
          {recipes.map((r) => (
            <a key={r.slug} className="feature" href={href(`/kb/${r.slug}`)}>
              <div className="tag">
                {r.category} · {r.tags.join(' · ')}
              </div>
              <h3 style={{ marginTop: 10 }}>{r.title}</h3>
              <p>{r.summary}</p>
              <p style={{ marginTop: 14, color: 'var(--amber)' }}>{t('Open recipe ↗')}</p>
            </a>
          ))}
        </div>
      ) : (
        <EmptyState icon="⌕" title={t('No recipes found')} text={t('Try another search term or category.')} />
      )}

      <h2 style={{ fontSize: 18, margin: '44px 0 14px' }} id="eips">
        EIP reference ({eips.length})
      </h2>
      <div className="ref-list">
        {eips.map((e) => (
          <a key={e.type} className="ref" href={e.docs} target="_blank" rel="noreferrer">
            <b>
              <i>{e.icon}</i> {e.label}
            </b>
            <span>{e.summary}</span>
          </a>
        ))}
      </div>

      <h2 style={{ fontSize: 18, margin: '44px 0 14px' }} id="components">
        Component reference ({comps.length})
      </h2>
      <div className="ref-list">
        {comps.map((c) => (
          <a key={c.scheme} className="ref" href={docsUrl(c)} target="_blank" rel="noreferrer">
            <b>
              <i>⇢</i> {c.title} <span className="pill" style={{ marginLeft: 'auto' }}>{c.scheme}</span>
            </b>
            <span>{c.description}</span>
          </a>
        ))}
      </div>
    </main>
  );
}

export function RecipePage({ slug }: { slug: string }) {
  const r = RECIPE_BY_SLUG[slug];
  const [tab, setTab] = useState<'yaml' | 'xml' | 'java'>('yaml');
  const file = useMemo(() => (r ? fromYaml(r.yaml) : undefined), [r]);
  useEffect(() => {
    if (r) document.title = `${r.title} · Apache Camel recipe`;
  }, [r]);
  if (!r || !file) {
    return (
      <main className="wrap page">
        <EmptyState icon="?" title={t('Recipe not found')} text={t('It may have been renamed.')} action={<a className="btn primary" href={href('/kb')}>{t('All recipes')}</a>} />
      </main>
    );
  }
  const code = tab === 'yaml' ? r.yaml : tab === 'xml' ? toXml(file) : toJava(file, r.title);
  const related = RECIPES.filter((x) => x.slug !== r.slug && (x.category === r.category || x.tags.some((t) => r.tags.includes(t)))).slice(0, 4);
  return (
    <main className="wrap page">
      <a href={href('/kb')} className="muted" style={{ fontSize: 12, textDecoration: 'none' }}>
        {t('← Knowledge Base')}
      </a>
      <div className="kb-layout" style={{ marginTop: 14 }}>
        <article className="prose" style={{ maxWidth: 'none' }}>
          <div className="tag">
            {r.category} · {r.tags.join(' · ')}
          </div>
          <h1 style={{ fontSize: 34, letterSpacing: -1.4, margin: '8px 0 6px' }}>{r.title}</h1>
          <p style={{ fontSize: 16, color: 'var(--muted)', marginTop: 0 }}>{r.summary}</p>
          <div className="recipe-preview canvas">
            <FlowCanvas file={file} zoom={0.8} h={{ status: {}, readOnly: true, onSelect() {}, onDrop() {}, onQuickAdd() {}, onAddBranch() {} }} />
          </div>
          {r.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <h2>{t('Example')}</h2>
          <div className="recipe-code">
            <div className="tabs" role="tablist">
              {(['yaml', 'xml', 'java'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t === 'yaml' ? 'YAML DSL' : t === 'xml' ? 'XML DSL' : 'Java DSL'}
                </button>
              ))}
              <button
                style={{ marginLeft: 'auto' }}
                onClick={() =>
                  navigator.clipboard?.writeText(code).then(
                    () => toast('Copied', 'success'),
                    () => toast('Clipboard not available', 'error'),
                  )
                }
              >
                {t('Copy')}
              </button>
            </div>
            <CodeEditor value={code} lang={tab} readOnly label={`${tab} example`} />
          </div>
          <h2>{t('Tips')}</h2>
          <ul className="tips">
            {r.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </article>
        <aside className="card kb-aside">
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => openInBuilder(r)}>
            {t('Open in Builder ↗')}
          </button>
          <p className="hint" style={{ marginTop: 10 }}>
            {t('Creates a new project with this recipe so you can adapt it.')}
          </p>
          {related.length > 0 && (
            <>
              <div className="subhead">{t('Related')}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {related.map((x) => (
                  <a key={x.slug} className="ref" href={href(`/kb/${x.slug}`)}>
                    <b>{x.title}</b>
                    <span>{x.summary}</span>
                  </a>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
