import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../app/api';
import { href, navigate } from '../../app/router';
import { projects, toast } from '../../app/store';
import type { CamelFile } from '../../core/model';
import { toJava } from '../../core/java';
import { validate } from '../../core/validate';
import { toXml } from '../../core/xml';
import { toYaml } from '../../core/yaml';
import { CodeEditor } from '../../ui/CodeEditor';
import { EmptyState } from '../../ui/Modal';
import { FlowCanvas } from '../builder/Canvas';

interface Shared {
  name: string;
  description: string;
  owner: string;
  updatedAt: number;
  file: CamelFile;
}

export function SharedPage({ token }: { token: string }) {
  const [data, setData] = useState<Shared>();
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'yaml' | 'xml' | 'java'>('yaml');
  useEffect(() => {
    api<{ project: Shared }>('GET', `/shared/${encodeURIComponent(token)}`)
      .then((r) => {
        setData(r.project);
        document.title = `${r.project.name} · shared integration`;
      })
      .catch((e: ApiError) => setError(e.status === 404 ? 'This link is invalid or the owner stopped sharing it.' : e.message));
  }, [token]);
  const code = useMemo(() => (data ? (tab === 'yaml' ? toYaml(data.file) : tab === 'xml' ? toXml(data.file) : toJava(data.file, data.name)) : ''), [data, tab]);
  const errors = useMemo(() => (data ? validate(data.file).filter((i) => i.severity === 'error').length : 0), [data]);

  if (error) {
    return (
      <main className="wrap page">
        <EmptyState icon="⌁" title="Shared project not available" text={error} action={<a className="btn primary" href={href('/')}>Go home</a>} />
      </main>
    );
  }
  if (!data) return <main className="wrap page"><p className="muted">Loading shared project…</p></main>;

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <div className="tag">Shared · read-only</div>
          <h1>{data.name}</h1>
          <p>
            {data.description ? `${data.description} · ` : ''}
            {data.owner ? `by ${data.owner} · ` : ''}updated {new Date(data.updatedAt).toLocaleDateString()} · {data.file.routes.length} route(s) · {errors ? <span className="c-err">{errors} validation error(s)</span> : <span className="c-ok">valid</span>}
          </p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            const p = projects.create(`${data.name} (copy)`, structuredClone(data.file), data.description);
            toast('Copied to your projects', 'success');
            navigate(`/builder/${p.id}`);
          }}
        >
          Duplicate to my projects
        </button>
      </div>
      <div className="card canvas" style={{ height: 420, overflow: 'auto', marginBottom: 20 }}>
        <FlowCanvas file={data.file} zoom={0.85} h={{ status: {}, readOnly: true, onSelect() {}, onDrop() {}, onQuickAdd() {}, onAddBranch() {} }} />
      </div>
      <div className="recipe-code">
        <div className="tabs" role="tablist">
          {(['yaml', 'xml', 'java'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'yaml' ? 'YAML DSL' : t === 'xml' ? 'XML DSL' : 'Java DSL'}
            </button>
          ))}
        </div>
        <CodeEditor value={code} lang={tab} readOnly label="Shared route source" />
      </div>
    </main>
  );
}
