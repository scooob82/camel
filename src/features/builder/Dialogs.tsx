import { useState } from 'react';
import { projects, toast, type Project } from '../../app/store';
import { routeFiles, slugify, springBootProject, zip, VERSIONS, type ExportDsl } from '../../core/export';
import type { CamelFile } from '../../core/model';
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
      title="Export"
      description="Download your routes or a ready-to-run project."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
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
            <b>Spring Boot project</b>
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
            <b>Route files only</b>
            <span>YAML, XML and Java DSL versions of the routes plus ROUTES.md documentation.</span>
          </div>
        </button>
      </div>
      {kind === 'spring' && (
        <div className="field" style={{ marginTop: 16 }}>
          <label>
            <span>Route DSL in the project</span>
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

export function VersionsDialog({ project, onRestore, onClose }: { project: Project; onRestore(file: CamelFile): void; onClose(): void }) {
  const [label, setLabel] = useState('');
  return (
    <Modal title="Version history" description="Snapshots are stored with the project. Restoring replaces the canvas (you can undo)." onClose={onClose}>
      <form
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          projects.saveVersion(project.id, label.trim() || `Version ${project.versions.length + 1}`);
          setLabel('');
          toast('Version saved', 'success');
        }}
      >
        <input className="input" placeholder="Label, e.g. “before error handling”" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Version label" maxLength={80} />
        <button className="btn primary sm" type="submit">
          Save version
        </button>
      </form>
      {!project.versions.length ? (
        <p className="muted" style={{ fontSize: 12.5 }}>
          No versions yet. Save one before a bigger change — <span className="kbd">Ctrl S</span> works too.
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
                  <button
                    className="tinybtn"
                    onClick={() => {
                      onRestore(structuredClone(v.file));
                      toast(`Restored “${v.label}”`, 'success');
                      onClose();
                    }}
                  >
                    Restore
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
