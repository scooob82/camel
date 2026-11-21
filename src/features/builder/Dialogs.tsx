import { useState } from 'react';
import { t } from '../../app/i18n';
import { api, type ApiError } from '../../app/api';
import { projects, toast, type Project } from '../../app/store';
import { routeFiles, slugify, springBootProject, zip, VERSIONS, type ExportDsl } from '../../core/export';
import type { CamelFile } from '../../core/model';
import { diffLines, diffStats } from '../../core/diff';
import { toYaml } from '../../core/yaml';
import { Modal } from '../../ui/Modal';
import { download } from './download';

export function ExportDialog({ project, file, onClose }: { project: Project; file: CamelFile; onClose(): void }) {
  const [kind, setKind] = useState<'routes' | 'spring'>('spring');
  const [dsl, setDsl] = useState<ExportDsl>('yaml');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const slug = slugify(project.name);
      if (kind === 'routes') download(`${slug}-routes.zip`, await zip(routeFiles(file, project.name)));
      else download(`${slug}.zip`, await zip(springBootProject(file, project.name, dsl), slug));
      toast('Export ready', 'success');
      onClose();
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Export')}
      description={t('Download your routes or a ready-to-run project.')}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn primary" onClick={run} disabled={busy}>
            {busy ? 'Preparing…' : '↓ Download ZIP'}
          </button>
        </>
      }
    >
      <div className="option-list">
        <button className={`option ${kind === 'spring' ? 'selected' : ''}`} onClick={() => setKind('spring')}>
          <div className="feature-icon" style={{ margin: 0 }}>
            ⇧
          </div>
          <div>
            <b>{t('Spring Boot project')}</b>
            <span>
              Maven project with the right Camel starters, application.properties, Dockerfile and docs. Camel {VERSIONS.camel} · Spring Boot {VERSIONS.springBoot} · Java {VERSIONS.java}.
            </span>
          </div>
        </button>
        <button className={`option ${kind === 'routes' ? 'selected' : ''}`} onClick={() => setKind('routes')}>
          <div className="feature-icon" style={{ margin: 0 }}>
            ▤
          </div>
          <div>
            <b>{t('Route files only')}</b>
            <span>YAML, XML and Java DSL versions of the routes plus ROUTES.md documentation.</span>
          </div>
        </button>
      </div>
      {kind === 'spring' && (
        <div className="field" style={{ marginTop: 16 }}>
          <label>
            <span>{t('Route DSL in the project')}</span>
          </label>
          <div className="chips" role="radiogroup">
            {(['yaml', 'xml', 'java'] as ExportDsl[]).map((d) => (
              <button key={d} role="radio" aria-checked={dsl === d} className={`chip ${dsl === d ? 'active' : ''}`} onClick={() => setDsl(d)}>
                {d === 'yaml' ? 'YAML DSL' : d === 'xml' ? 'XML DSL' : 'Java DSL'}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

const fmt = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function VersionDiff({ from, to, label, onBack }: { from: CamelFile; to: CamelFile; label: string; onBack(): void }) {
  const lines = diffLines(toYaml(from), toYaml(to));
  const st = diffStats(lines);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button className="tinybtn" onClick={onBack}>
          {t('← Versions')}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          “{label}” → current · <span className="c-ok">+{st.added}</span> <span className="c-err">−{st.removed}</span>
        </span>
      </div>
      {st.added + st.removed === 0 ? (
        <p className="muted">{t('No differences — the current project matches this version.')}</p>
      ) : (
        <div className="diff" role="table" aria-label={t('YAML differences')}>
          {lines.map((l, i) =>
            l.op === 'gap' ? (
              <div key={i} className="gap">
                ⋯ {l.count} unchanged line{l.count === 1 ? '' : 's'}
              </div>
            ) : (
              <div key={i} className={l.op}>
                {l.op === 'add' ? '+ ' : l.op === 'del' ? '− ' : '  '}
                {l.text}
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}

export function VersionsDialog({ project, current, onRestore, onClose }: { project: Project; current: CamelFile; onRestore(file: CamelFile): void; onClose(): void }) {
  const [label, setLabel] = useState('');
  const [comparing, setComparing] = useState<string>();
  const cmp = project.versions.find((v) => v.id === comparing);
  if (cmp) {
    return (
      <Modal title={t('Compare versions')} description={t('YAML of the saved version compared with the current canvas.')} onClose={onClose} className="wide">
        <VersionDiff from={cmp.file} to={current} label={cmp.label} onBack={() => setComparing(undefined)} />
      </Modal>
    );
  }
  return (
    <Modal title={t('Version history')} description={t('Snapshots are stored with the project. Restoring replaces the canvas (you can undo).')} onClose={onClose}>
      <form
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          projects.saveVersion(project.id, label.trim() || `Version ${project.versions.length + 1}`);
          setLabel('');
          toast('Version saved', 'success');
        }}
      >
        <input className="input" placeholder={t('Label, e.g. “before error handling”')} value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('Version label')} maxLength={80} />
        <button className="btn primary sm" type="submit">
          {t('Save version')}
        </button>
      </form>
      {!project.versions.length ? (
        <p className="muted" style={{ fontSize: 12.5 }}>
          No versions yet. Save one before a bigger change — <span className="kbd">{t('Ctrl S')}</span> {t('works too.')}
        </p>
      ) : (
        <table className="tbl">
          <tbody>
            {project.versions.map((v) => (
              <tr key={v.id}>
                <td>
                  <b>{v.label}</b>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {fmt(v.at)} · {v.file.routes.length} route(s)
                  </div>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="tinybtn" onClick={() => setComparing(v.id)}>
                    {t('Compare')}
                  </button>{' '}
                  <button
                    className="tinybtn"
                    onClick={() => {
                      onRestore(structuredClone(v.file));
                      toast(`Restored “${v.label}”`, 'success');
                      onClose();
                    }}
                  >
                    {t('Restore')}
                  </button>{' '}
                  <button className="tinybtn" onClick={() => projects.deleteVersion(project.id, v.id)} aria-label={`Delete version ${v.label}`}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export function ShareDialog({ project, onClose }: { project: Project; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const url = project.shareToken ? `${window.location.origin}${window.location.pathname}#/s/${project.shareToken}` : '';
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('Share')} description={t('Anyone with the link can view this project (read-only) and copy it into their own projects.')} onClose={onClose}>
      {url ? (
        <>
          <div className="field">
            <label htmlFor="share-url">
              <span>{t('Read-only link')}</span>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input id="share-url" className="input mono" readOnly value={url} onFocus={(e) => e.target.select()} />
              <button
                className="btn sm primary"
                onClick={() =>
                  navigator.clipboard?.writeText(url).then(
                    () => toast('Link copied', 'success'),
                    () => toast('Clipboard not available', 'error'),
                  )
                }
              >
                {t('Copy')}
              </button>
            </div>
            <span className="hint">{t('The link always shows the latest saved state of the project.')}</span>
          </div>
          <button
            className="btn sm danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api('DELETE', `/projects/${project.id}/share`);
                projects.setShareToken(project.id, null);
                toast('Link disabled');
              })
            }
          >
            {t('Stop sharing')}
          </button>
        </>
      ) : (
        <button
          className="btn primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api<{ token: string }>('POST', `/projects/${project.id}/share`, {});
              projects.setShareToken(project.id, r.token);
            })
          }
        >
          {busy ? 'Creating…' : 'Create read-only link'}
        </button>
      )}
    </Modal>
  );
}
