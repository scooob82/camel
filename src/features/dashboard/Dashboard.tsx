import { useEffect, useMemo, useState } from 'react';
import { locale, plural, t } from '../../app/i18n';
import { href, navigate } from '../../app/router';
import { authStore } from '../../app/session';
import { appStore, importLocalProjects, localProjects, projects, toast, useStore, type Project } from '../../app/store';
import { RECIPES } from '../../content/recipes';
import { EIP_BY_TYPE } from '../../core/eip';
import { baseName, CONTRACT_LABEL, IMPORT_ACCEPT, importAny } from '../../core/importer';
import { emptyFile, isKnown, newRoute } from '../../core/model';
import { validate } from '../../core/validate';
import { fromYaml } from '../../core/yaml';
import { Confirm, EmptyState, Modal } from '../../ui/Modal';
import { pickTextFile } from '../builder/download';

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return t('edited just now');
  if (s < 3600) return t('edited {n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('edited {n} h ago', { n: Math.floor(s / 3600) });
  return t('edited {date}', { date: new Date(ts).toLocaleDateString(locale()) });
}

function MiniFlow({ p }: { p: Project }) {
  const r = p.file.routes[0];
  if (!r) return <div className="mini-flow muted" style={{ fontSize: 11 }}>{t('No routes yet')}</div>;
  const icons = ['⇢', ...r.steps.slice(0, 7).map((s) => (isKnown(s) ? EIP_BY_TYPE[s.type]?.icon ?? '•' : '?'))];
  return (
    <div className="mini-flow" aria-hidden>
      {icons.map((i, k) => (
        <span key={k} style={{ display: 'contents' }}>
          {k > 0 && <em />}
          <i>{i}</i>
        </span>
      ))}
      {r.steps.length > 7 && <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>+{r.steps.length - 7}</span>}
    </div>
  );
}

function NewProjectDialog({ onClose }: { onClose(): void }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('blank');
  const create = () => {
    const recipe = RECIPES.find((r) => r.slug === template);
    const file = recipe ? fromYaml(recipe.yaml) : emptyFile();
    if (!recipe) file.routes.push(newRoute('route-1'));
    const p = projects.create(name || recipe?.title || 'New integration', file, recipe?.summary ?? '');
    navigate(`/builder/${p.id}`);
  };
  return (
    <Modal
      title={t('New project')}
      description={t('Projects group related routes, error handlers and versions.')}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn primary" onClick={create}>
            {t('Create project')}
          </button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), create())}>
        <div className="field">
          <label htmlFor="np-name">
            <span>{t('Name')}</span>
          </label>
          <input id="np-name" className="input" style={{ fontSize: 13, padding: '10px 12px' }} placeholder={t('e.g. Orders integration')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
      </form>
      <div className="field-label" style={{ marginBottom: 8 }}>
        {t('Start from')}
      </div>
      <div className="option-list">
        <button className={`option ${template === 'blank' ? 'selected' : ''}`} onClick={() => setTemplate('blank')}>
          <div className="feature-icon" style={{ margin: 0 }}>
            ＋
          </div>
          <div>
            <b>{t('Blank project')}</b>
            <span>{t('One empty route with a timer trigger.')}</span>
          </div>
        </button>
        {RECIPES.map((r) => (
          <button key={r.slug} className={`option ${template === r.slug ? 'selected' : ''}`} onClick={() => setTemplate(r.slug)}>
            <div className="feature-icon" style={{ margin: 0 }}>
              ◇
            </div>
            <div>
              <b>{r.title}</b>
              <span>{r.summary}</span>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function Dashboard() {
  const list = useStore(appStore, (s) => s.projects);
  const mode = useStore(appStore, (s) => s.mode);
  const auth = useStore(authStore, (s) => s);
  const [localCount, setLocalCount] = useState(0);
  const [importing, setImporting] = useState(false);
  useEffect(() => setLocalCount(mode === 'remote' ? localProjects().length : 0), [mode]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Project>();
  useEffect(() => {
    document.title = 'Projects · Integration Studio';
  }, []);
  const sorted = useMemo(() => [...list].sort((a, b) => b.openedAt - a.openedAt), [list]);
  const filtered = q.trim() ? sorted.filter((p) => `${p.name} ${p.description} ${p.file.routes.map((r) => r.routeId).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())) : sorted;
  const routes = list.reduce((n, p) => n + p.file.routes.length, 0);
  const versions = list.reduce((n, p) => n + p.versions.length, 0);
  const errors = useMemo(() => list.reduce((n, p) => n + validate(p.file).filter((i) => i.severity === 'error').length, 0), [list]);

  const importFile = async () => {
    const picked = await pickTextFile(IMPORT_ACCEPT);
    if (!picked) return;
    try {
      const { file, contract } = importAny(picked.name, picked.text);
      const p = projects.create(baseName(picked.name), file, contract ? `Generated from the ${CONTRACT_LABEL[contract]} contract ${picked.name}` : `Imported from ${picked.name}`);
      toast(contract ? `Generated ${file.routes.length} route(s) from ${CONTRACT_LABEL[contract]}` : `Imported ${file.routes.length} route(s)`, 'success');
      navigate(`/builder/${p.id}`);
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <div className="tag">{t('Workspace')}</div>
          <h1>{t('Projects')}</h1>
          <p>
            {mode === 'remote' ? (
              <>{t('Synced to your account ({email}) — available on every device.', { email: auth.user?.email ?? '' })}</>
            ) : auth.status === 'anonymous' ? (
              <>
                {t('Saved in this browser.')} <a href={href('/register')}>{t('Create a free account')}</a> {t('or')} <a href={href('/login')}>{t('sign in')}</a> {t('to sync across devices.')}
              </>
            ) : (
              <>{t('Saved in this browser.')}</>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={importFile}>
            {t('↑ Import routes / API contract')}
          </button>
          <button className="btn primary" onClick={() => setCreating(true)}>
            {t('+ New project')}
          </button>
        </div>
      </div>

      {localCount > 0 && (
        <div className="banner">
          <span>
            <b>{localCount}</b> project{localCount === 1 ? ' is' : 's are'} still stored only in this browser.
          </span>
          <button
            className="btn sm primary"
            disabled={importing}
            onClick={async () => {
              setImporting(true);
              const n = await importLocalProjects();
              setImporting(false);
              setLocalCount(localProjects().length);
              if (n) toast(`Imported ${n} project${n === 1 ? '' : 's'} to your account`, 'success');
            }}
          >
            {importing ? 'Importing…' : 'Import to my account'}
          </button>
        </div>
      )}
      {auth.user && !auth.user.emailVerified && (
        <div className="banner subtle">
          <span>{t('Please confirm your e-mail address — we sent a link to {email}.', { email: auth.user.email })}</span>
          <a className="btn sm" href={href('/account')}>
            {t('Resend')}
          </a>
        </div>
      )}

      <div className="stat-row">
        <div className="card stat">
          <b>{list.length}</b>
          <span>{t('Projects')}</span>
        </div>
        <div className="card stat">
          <b>{routes}</b>
          <span>{t('Routes')}</span>
        </div>
        <div className="card stat">
          <b>{versions}</b>
          <span>{t('Saved versions')}</span>
        </div>
        <div className="card stat">
          <b className={errors ? 'c-err' : 'c-ok'}>{errors}</b>
          <span>{t('Validation errors')}</span>
        </div>
      </div>

      {list.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <input className="input search-lg" placeholder={t('Search projects and routes…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search projects')} />
        </div>
      )}

      {!list.length ? (
        <EmptyState
          icon="⇢"
          title={t('No projects yet')}
          text={t('Create a blank project, start from a proven recipe, import Camel routes you already have — or generate routes from an OpenAPI, AsyncAPI or WSDL contract.')}
          action={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => setCreating(true)}>
                {t('+ New project')}
              </button>
              <button className="btn" onClick={importFile}>
                {t('↑ Import file')}
              </button>
            </div>
          }
        />
      ) : !filtered.length ? (
        <EmptyState icon="⌕" title={t('Nothing matches')} text={`No project or route matches “${q}”.`} action={<button className="btn" onClick={() => setQ('')}>{t('Clear search')}</button>} />
      ) : (
        <div className="grid3">
          {filtered.map((p) => (
            <article key={p.id} className="card project">
              <h3>
                <a href={href(`/builder/${p.id}`)}>{p.name}</a>
              </h3>
              {p.description && <p className="muted" style={{ margin: 0, fontSize: 12 }}>{p.description}</p>}
              <MiniFlow p={p} />
              <div className="meta">
                <span>
                  {plural(p.file.routes.length, '{n} route', '{n} routes')}
                </span>
                <span>
                  {plural(p.versions.length, '{n} version', '{n} versions')}
                </span>
                <span>{ago(p.updatedAt)}</span>
              </div>
              <div className="actions">
                <button className="tinybtn" onClick={() => navigate(`/builder/${p.id}`)}>
                  {t('Open')}
                </button>
                <button
                  className="tinybtn"
                  onClick={() => {
                    projects.duplicate(p.id);
                    toast('Project duplicated', 'success');
                  }}
                >
                  {t('Duplicate')}
                </button>
                <button className="tinybtn" onClick={() => setDeleting(p)} style={{ marginLeft: 'auto', color: 'var(--red)' }} aria-label={`Delete ${p.name}`}>
                  {t('Delete')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="section-head" style={{ marginTop: 54 }}>
        <div>
          <div className="tag">{t('Templates')}</div>
          <h2 style={{ fontSize: 22 }}>{t('Start from a recipe')}</h2>
        </div>
        <a className="btn ghost" href={href('/kb')}>
          {t('All recipes →')}
        </a>
      </div>
      <div className="features">
        {RECIPES.slice(0, 6).map((r) => (
          <a key={r.slug} className="feature" href={href(`/kb/${r.slug}`)} style={{ minHeight: 0 }}>
            <div className="tag">{r.category}</div>
            <h3 style={{ marginTop: 8 }}>{r.title}</h3>
            <p>{r.summary}</p>
          </a>
        ))}
      </div>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm
          title={`Delete “${deleting.name}”?`}
          message={`This removes the project, its ${deleting.file.routes.length} route(s) and ${deleting.versions.length} saved version(s) from this browser. This cannot be undone.`}
          confirmLabel={t('Delete project')}
          danger
          onConfirm={() => {
            projects.remove(deleting.id);
            toast('Project deleted');
          }}
          onClose={() => setDeleting(undefined)}
        />
      )}
    </main>
  );
}
