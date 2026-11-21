import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../app/i18n';
import { toast } from '../../app/store';
import { endpointTableMarkdown, toMermaid } from '../../core/docs';
import { endpoints, type CamelFile } from '../../core/model';
import { toJava } from '../../core/java';
import { fromXml, toXml } from '../../core/xml';
import { DslParseError, fromYaml, toYaml } from '../../core/yaml';
import { slugify } from '../../core/export';
import { CodeEditor } from '../../ui/CodeEditor';
import { download } from './download';

export type CodeTab = 'yaml' | 'xml' | 'java' | 'docs';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'success');
  } catch {
    toast('Clipboard is not available in this browser', 'error');
  }
}

/** Editable DSL view. Parses on the fly; only valid text updates the model. */
function DslEditor({ file, lang, onChange, projectName }: { file: CamelFile; lang: 'yaml' | 'xml'; onChange(f: CamelFile): void; projectName: string }) {
  const gen = lang === 'yaml' ? toYaml : toXml;
  const parse = lang === 'yaml' ? fromYaml : fromXml;
  const [text, setText] = useState(() => gen(file));
  const [error, setError] = useState<{ message: string; line?: number }>();
  const mine = useRef<CamelFile | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (file === mine.current) return;
    setText(gen(file));
    setError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const edit = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const f = parse(v);
        mine.current = f;
        setError(undefined);
        onChange(f);
      } catch (e) {
        const err = e as DslParseError;
        setError({ message: err.message, line: err.line });
      }
    }, 350);
  };

  return (
    <div className="code-wrap">
      <div className="code-tools">
        <span className="muted" style={{ fontSize: 11 }}>
          {lang === 'yaml' ? 'Camel YAML DSL · editable' : 'Camel XML DSL (xml-io) · editable'}
        </span>
        <span className="grow" />
        <button className="tinybtn" onClick={() => copy(text)}>
          {t('Copy')}
        </button>
        <button className="tinybtn" onClick={() => download(`${slugify(projectName)}.camel.${lang}`, text, lang === 'yaml' ? 'application/yaml' : 'application/xml')}>
          ↓ .{lang}
        </button>
      </div>
      <CodeEditor value={text} lang={lang} onChange={edit} errorLine={error?.line} label={`${lang.toUpperCase()} source`} />
      {error ? (
        <div className="code-error" role="alert">
          ✕ {error.message} — the canvas keeps the last valid version.
        </div>
      ) : (
        <div className="editor-foot">
          <span>{lang === 'yaml' ? 'YAML DSL · Camel 4' : 'XML IO DSL · Camel 4'}</span>
          <span className="c-ok">{t('✓ in sync with canvas')}</span>
        </div>
      )}
    </div>
  );
}

function JavaView({ file, projectName }: { file: CamelFile; projectName: string }) {
  const code = useMemo(() => toJava(file, projectName), [file, projectName]);
  return (
    <div className="code-wrap">
      <div className="code-tools">
        <span className="muted" style={{ fontSize: 11 }}>
          Java DSL · generated (read-only)
        </span>
        <span className="grow" />
        <button className="tinybtn" onClick={() => copy(code)}>
          {t('Copy')}
        </button>
      </div>
      <CodeEditor value={code} lang="java" readOnly label={t('Java source')} />
      <div className="editor-foot">
        <span>Java import arrives in a later release</span>
        <span>{t('RouteBuilder')}</span>
      </div>
    </div>
  );
}

function DocsView({ file, projectName }: { file: CamelFile; projectName: string }) {
  const rows = useMemo(() => endpoints(file), [file]);
  const mermaid = useMemo(() => toMermaid(file), [file]);
  return (
    <div className="docs-pane">
      <div className="subhead" style={{ marginTop: 0 }}>
        Endpoints ({rows.length})
      </div>
      {rows.length ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('Route')}</th>
              <th>{t('Dir')}</th>
              <th>{t('Endpoint')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.routeId}</td>
                <td className={r.direction === 'consumer' ? 'c-ok' : 'c-info'}>{r.direction === 'consumer' ? 'in' : 'out'}</td>
                <td>
                  <code>{r.uri}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">{t('No endpoints yet.')}</p>
      )}
      <div className="subhead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{t('Mermaid diagram')}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button className="tinybtn" onClick={() => copy(mermaid)}>
            {t('Copy')}
          </button>
          <button
            className="tinybtn"
            onClick={() =>
              download(
                'ROUTES.md',
                `# ${projectName}\n\n## Flow\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n\n## Endpoints\n\n${endpointTableMarkdown(file)}`,
                'text/markdown',
              )
            }
          >
            ↓ ROUTES.md
          </button>
        </span>
      </div>
      <pre className="block">{mermaid}</pre>
      <p className="hint">{t('Paste into GitHub, GitLab or Confluence markdown — they render Mermaid natively.')}</p>
    </div>
  );
}

export function CodePanel({ tab, file, onChange, projectName }: { tab: CodeTab; file: CamelFile; onChange(f: CamelFile): void; projectName: string }) {
  if (tab === 'yaml') return <DslEditor key="yaml" file={file} lang="yaml" onChange={onChange} projectName={projectName} />;
  if (tab === 'xml') return <DslEditor key="xml" file={file} lang="xml" onChange={onChange} projectName={projectName} />;
  if (tab === 'java') return <JavaView file={file} projectName={projectName} />;
  return <DocsView file={file} projectName={projectName} />;
}
