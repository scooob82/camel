import { useEffect, useMemo, useState } from 'react';
import type { ApiError } from '../../app/api';
import { t } from '../../app/i18n';
import { checkRunner, runnerStatus, runTransform } from '../../app/runner';
import { authStore } from '../../app/session';
import { storage, toast, useStore } from '../../app/store';
import { jsonToXml, jsonToXpathXml, samplePaths, xmlToJson } from '../../core/lab/convert';
import { csvToMapping, mappingToCsv, mappingToXslt, RULES, xsltToMapping, type MappingRow, type Rule } from '../../core/lab/mapping';
import { diffSchemas, impactOf, parseXsd, sampleJson, sampleXml, type SchemaChange } from '../../core/lab/xsd';
import type { TransformResult } from '../../core/runner';
import { CodeEditor } from '../../ui/CodeEditor';
import { download, pickTextFile } from '../builder/download';

type Engine = 'browser' | 'saxon-xslt' | 'saxon-xquery';
type Tab = 'transform' | 'mapper' | 'convert' | 'schema';

interface LabState {
  stylesheet: string;
  input: string;
  params: string;
  engine: Engine;
  rows: MappingRow[];
  sample: string;
  xsdA: string;
  xsdB: string;
}

const DEFAULT: LabState = {
  engine: 'browser',
  params: 'currency=EUR',
  input: '<?xml version="1.0"?>\n<order id="A-100">\n  <customer><name>Jana Nováková</name></customer>\n  <line sku="X1" qty="2" price="10.5"/>\n  <line sku="Y7" qty="1" price="99"/>\n</order>\n',
  stylesheet: `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes"/>
  <xsl:param name="currency" select="'CZK'"/>
  <xsl:template match="/order">
    <invoice number="{@id}" currency="{$currency}">
      <buyer><xsl:value-of select="customer/name"/></buyer>
      <xsl:for-each select="line">
        <item code="{@sku}"><xsl:value-of select="@qty * @price"/></item>
      </xsl:for-each>
      <total><xsl:value-of select="sum(line/@qty)"/></total>
    </invoice>
  </xsl:template>
</xsl:stylesheet>
`,
  rows: [
    { target: 'Invoice/@number', source: '/order/@id', rule: 'copy' },
    { target: 'Invoice/Buyer', source: '/order/customer/name', rule: 'copy' },
    { target: 'Invoice/Item', source: '/order/line', rule: 'loop' },
    { target: 'Invoice/Item/@code', source: '@sku', rule: 'copy' },
    { target: 'Invoice/Item/Quantity', source: '@qty', rule: 'copy' },
  ],
  sample: '',
  xsdA: '',
  xsdB: '',
};

function parseParams(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of text.split('\n')) {
    const i = l.indexOf('=');
    if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return out;
}

/** Chrome is removing XSLTProcessor; Firefox/Safari still ship it. */
export const browserXsltSupported = () => typeof XSLTProcessor !== 'undefined';

/** XSLT 1.0 in the browser (XSLTProcessor). */
function browserXslt(stylesheet: string, input: string, params: Record<string, string>): { output: string; ms: number } {
  if (!browserXsltSupported()) throw new Error(t('This browser no longer supports XSLT (Chrome removed it). Use the Saxon engine, or Firefox/Safari for XSLT 1.0.'));
  const parser = new DOMParser();
  const xsl = parser.parseFromString(stylesheet, 'application/xml');
  const xml = parser.parseFromString(input, 'application/xml');
  const err = xsl.querySelector('parsererror') ?? xml.querySelector('parsererror');
  if (err) throw new Error(`XML parse error: ${err.textContent?.split('\n')[0] ?? ''}`);
  const p = new XSLTProcessor();
  p.importStylesheet(xsl);
  for (const [k, v] of Object.entries(params)) p.setParameter(null, k, v);
  const t0 = performance.now();
  const doc = p.transformToDocument(xml);
  const ms = performance.now() - t0;
  if (!doc || !doc.documentElement) throw new Error('The transformation produced no output (check the stylesheet).');
  const text = new XMLSerializer().serializeToString(doc);
  return { output: text.replace(/></g, '>\n<'), ms };
}

export function LabPage() {
  const [state, setState] = useState<LabState>(() => ({ ...DEFAULT, ...storage.read<Partial<LabState>>('cas.lab', {}) }));
  const [tab, setTab] = useState<Tab>('transform');
  const set = (patch: Partial<LabState>) =>
    setState((s) => {
      const next = { ...s, ...patch };
      storage.write('cas.lab', next);
      return next;
    });
  const runner = useStore(runnerStatus, (s) => s);
  const auth = useStore(authStore, (s) => s.status);
  useEffect(() => {
    document.title = `${t('Transformation Lab')} · Integration Studio`;
    if (runner === undefined) void checkRunner();
  }, [runner]);
  const saxon = !!runner?.available && auth === 'authenticated';
  // no browser engine (recent Chrome) → default to Saxon when it is available
  useEffect(() => {
    if (state.engine === 'browser' && !browserXsltSupported() && runner?.available) set({ engine: 'saxon-xslt' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner?.available]);

  return (
    <main className="wrap page lab">
      <div className="page-head">
        <div>
          <div className="tag">{t('Transformation Lab')}</div>
          <h1>{t('XSLT, XQuery, mapping & schemas')}</h1>
          <p>{t('Develop and test transformations next to your routes. XSLT 3.0 and XQuery run on Saxon in the sandbox; XSLT 1.0 also runs directly in browsers that still support it.')}</p>
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 18 }} role="tablist">
        {(
          [
            ['transform', t('Transform & debug')],
            ['mapper', t('Mapper')],
            ['convert', 'JSON ⇄ XML'],
            ['schema', t('Schemas')],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'transform' && <TransformTab state={state} set={set} saxon={saxon} runnerAvailable={!!runner?.available} />}
      {tab === 'mapper' && <MapperTab state={state} set={set} onOpen={() => setTab('transform')} />}
      {tab === 'convert' && <ConvertTab onUse={(input) => (set({ input }), setTab('transform'))} />}
      {tab === 'schema' && <SchemaTab state={state} set={set} onUse={(input) => (set({ input }), setTab('transform'))} />}
    </main>
  );
}

// ---------------------------------------------------------------- transform & debug

function TransformTab({ state, set, saxon, runnerAvailable }: { state: LabState; set(p: Partial<LabState>): void; saxon: boolean; runnerAvailable: boolean }) {
  const [out, setOut] = useState<{ output: string; ms: number; messages: string[]; error?: string; errorLine?: number; profile?: string }>();
  const [trace, setTrace] = useState<TransformResult['trace']>();
  const [pos, setPos] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [bpText, setBpText] = useState('');
  const bps = useMemo(() => new Set(bpText.split(/[\s,]+/).map(Number).filter(Boolean)), [bpText]);
  const isSaxon = state.engine !== 'browser';

  const run = async (mode: 'run' | 'profile' | 'debug') => {
    setBusy(true);
    setTrace(undefined);
    setPos(-1);
    try {
      if (!isSaxon) {
        if (mode === 'debug') throw new Error(t('Step-by-step debugging needs the Saxon engine (sandbox).'));
        if (/version="[23]/.test(state.stylesheet)) toast(t('This stylesheet declares XSLT 2.0/3.0 — the browser engine supports only 1.0. Use Saxon for full support.'), 'error');
        const n = mode === 'profile' ? 25 : 1;
        let total = 0;
        let r = { output: '', ms: 0 };
        for (let i = 0; i < n; i++) {
          r = browserXslt(state.stylesheet, state.input, parseParams(state.params));
          total += r.ms;
        }
        setOut({ output: r.output, ms: r.ms, messages: [], profile: mode === 'profile' ? t('{n} runs · average {ms} ms', { n, ms: (total / n).toFixed(2) }) : undefined });
      } else {
        const res = await runTransform({ kind: state.engine === 'saxon-xquery' ? 'xquery' : 'xslt', source: state.stylesheet, input: state.input, params: parseParams(state.params), trace: mode !== 'run' });
        setOut({ output: res.output, ms: res.durationMs, messages: res.messages, error: res.error?.message, errorLine: res.error?.line });
        if (mode !== 'run' && res.trace) {
          setTrace(res.trace);
          if (mode === 'debug') setPos(0);
        }
      }
    } catch (e) {
      setOut({ output: '', ms: 0, messages: [], error: (e as ApiError | Error).message });
    } finally {
      setBusy(false);
    }
  };

  const profile = useMemo(() => {
    if (!trace) return [];
    const by = new Map<string, { line: number; instruction: string; count: number; ms: number }>();
    for (const e of trace) {
      const k = `${e.line}:${e.instruction}`;
      const x = by.get(k) ?? { line: e.line, instruction: e.instruction, count: 0, ms: 0 };
      x.count++;
      x.ms += e.tookMs ?? 0;
      by.set(k, x);
    }
    return [...by.values()].sort((a, b) => b.ms - a.ms || b.count - a.count).slice(0, 15);
  }, [trace]);
  const cur = trace && pos >= 0 ? trace[pos] : undefined;
  const nextBreak = () => {
    if (!trace) return;
    const i = trace.findIndex((e, k) => k > pos && bps.has(e.line));
    setPos(i >= 0 ? i : trace.length - 1);
  };

  return (
    <div className="lab-grid">
      <section className="card lab-pane">
        <div className="lab-toolbar">
          <select className="select" style={{ width: 'auto' }} value={state.engine} onChange={(e) => set({ engine: e.target.value as Engine })} aria-label={t('Engine')}>
            <option value="browser">{browserXsltSupported() ? t('XSLT 1.0 · browser') : t('XSLT 1.0 · browser (not supported here)')}</option>
            <option value="saxon-xslt" disabled={!runnerAvailable}>XSLT 3.0 · Saxon</option>
            <option value="saxon-xquery" disabled={!runnerAvailable}>XQuery 3.1 · Saxon</option>
          </select>
          <button className="btn primary sm" disabled={busy || (isSaxon && !saxon)} onClick={() => run('run')}>
            ▶ {t('Run')}
          </button>
          <button className="tinybtn" disabled={busy || (isSaxon && !saxon)} onClick={() => run('profile')}>
            ⏱ {t('Profile')}
          </button>
          <button className="tinybtn" disabled={busy || !isSaxon || !saxon} onClick={() => run('debug')} title={t('Needs the Saxon engine')}>
            🐞 {t('Debug')}
          </button>
          <span className="grow" />
          <button className="tinybtn" onClick={() => download(state.engine === 'saxon-xquery' ? 'query.xq' : 'transform.xsl', state.stylesheet, 'application/xml')}>
            ↓
          </button>
        </div>
        {isSaxon && !saxon && <p className="hint" style={{ margin: '0 12px 8px' }}>{runnerAvailable ? t('Sign in to use the Saxon engine.') : t('The sandbox runner is not configured on this server.')}</p>}
        <div className="lab-label">{state.engine === 'saxon-xquery' ? 'XQuery' : 'XSLT'}</div>
        <CodeEditor value={state.stylesheet} lang="xml" onChange={(stylesheet) => set({ stylesheet })} errorLine={out?.errorLine} activeLine={cur?.line} label={t('Stylesheet')} minHeight={320} />
      </section>
      <section className="lab-side">
        <div className="card lab-pane">
          <div className="lab-label">{t('Input XML')}</div>
          <CodeEditor value={state.input} lang="xml" onChange={(input) => set({ input })} label={t('Input XML')} minHeight={150} />
          <div className="lab-label">{t('Parameters')} <span className="hint">name=value</span></div>
          <textarea className="textarea" style={{ margin: '0 12px 12px', width: 'calc(100% - 24px)' }} rows={2} value={state.params} onChange={(e) => set({ params: e.target.value })} aria-label={t('Parameters')} />
        </div>
        <div className="card lab-pane">
          <div className="lab-label">
            {t('Output')}
            {out && !out.error && <span className="c-ok">✓ {out.ms.toFixed ? out.ms.toFixed(1) : out.ms} ms</span>}
            {out?.profile && <span className="muted">{out.profile}</span>}
          </div>
          {out?.error && <div className="form-error" style={{ margin: '0 12px 8px' }}>{out.error}</div>}
          <CodeEditor value={out?.output ?? ''} lang="xml" readOnly label={t('Output')} minHeight={150} />
          {!!out?.messages.length && <pre className="block" style={{ margin: 12 }}>{out.messages.join('\n')}</pre>}
        </div>
        {trace && (
          <div className="card lab-pane">
            <div className="lab-label">{pos >= 0 ? t('Debugger') : t('Profile (Saxon trace)')}</div>
            {pos >= 0 ? (
              <div style={{ padding: '0 12px 12px' }}>
                <div className="player">
                  <button className="tinybtn" onClick={() => setPos(0)}>⏮</button>
                  <button className="tinybtn" onClick={() => setPos((p) => Math.max(0, p - 1))}>◀</button>
                  <button className="tinybtn" onClick={() => setPos((p) => Math.min(trace.length - 1, p + 1))}>▶|</button>
                  <button className="tinybtn run" onClick={nextBreak}>{t('Continue to breakpoint')}</button>
                  <span className="muted" style={{ marginLeft: 'auto' }}>{pos + 1}/{trace.length}</span>
                </div>
                <div className="field" style={{ marginTop: 8 }}>
                  <label><span>{t('Breakpoints (line numbers)')}</span></label>
                  <input className="input mono" value={bpText} onChange={(e) => setBpText(e.target.value)} placeholder="7, 12" aria-label={t('Breakpoints (line numbers)')} />
                </div>
                {cur && (
                  <p className="mono" style={{ fontSize: 12 }}>
                    {t('line')} {cur.line} · {'  '.repeat(cur.depth)}
                    {cur.instruction}
                  </p>
                )}
              </div>
            ) : (
              <table className="tbl" style={{ margin: '0 12px 12px', width: 'calc(100% - 24px)' }}>
                <thead>
                  <tr><th>{t('Line')}</th><th>{t('Instruction')}</th><th>{t('Calls')}</th><th>ms</th></tr>
                </thead>
                <tbody>
                  {profile.map((p) => (
                    <tr key={`${p.line}:${p.instruction}`}><td>{p.line}</td><td className="mono">{p.instruction}</td><td>{p.count}</td><td>{p.ms}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- mapper

function MapperTab({ state, set, onOpen }: { state: LabState; set(p: Partial<LabState>): void; onOpen(): void }) {
  const [version, setVersion] = useState<'1.0' | '3.0'>('1.0');
  const [focus, setFocus] = useState<number>();
  const sample = state.sample || state.input;
  const paths = useMemo(() => {
    try {
      return samplePaths(sample);
    } catch {
      return [];
    }
  }, [sample]);
  const rows = state.rows;
  const setRow = (i: number, patch: Partial<MappingRow>) => set({ rows: rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });

  return (
    <div className="lab-grid mapper">
      <section className="card lab-pane">
        <div className="lab-label">{t('Source sample (XML or JSON)')}</div>
        <textarea className="textarea" style={{ margin: '0 12px', width: 'calc(100% - 24px)' }} rows={7} value={sample} onChange={(e) => set({ sample: e.target.value })} aria-label={t('Source sample')} />
        <div className="lab-label">{t('Source fields')} <span className="hint">{t('click to use in the focused row')}</span></div>
        <div className="source-tree">
          {paths.map((p) => (
            <button
              key={p.path}
              className="component"
              onClick={() => {
                if (focus === undefined) return toast(t('Click into a row first'));
                const row = rows[focus];
                const loop = rows.slice(0, focus).reverse().find((r) => r.rule === 'loop' && row.target.startsWith(r.target + '/'));
                const xp = '/' + p.path;
                const rel = loop && xp.startsWith(loop.source + '/') ? xp.slice(loop.source.length + 1) : xp;
                setRow(focus, { source: rel });
              }}
            >
              <i>{p.repeated ? '⋮' : '·'}</i> <span className="mono">{p.path}</span>
              <small>{p.sample}</small>
            </button>
          ))}
          {!paths.length && <p className="muted" style={{ fontSize: 12 }}>{t('Paste a sample message to see its fields.')}</p>}
        </div>
      </section>
      <section className="card lab-pane" style={{ minWidth: 0 }}>
        <div className="lab-toolbar">
          <button className="tinybtn" onClick={() => set({ rows: [...rows, { target: '', source: '', rule: 'copy' }] })}>+ {t('Row')}</button>
          <button
            className="tinybtn"
            onClick={async () => {
              const f = await pickTextFile('.csv,.txt');
              if (!f) return;
              const r = csvToMapping(f.text);
              set({ rows: r });
              toast(t('Imported {n} rows', { n: r.length }), 'success');
            }}
          >
            ↑ CSV / Excel
          </button>
          <button className="tinybtn" onClick={() => download('mapping.csv', '﻿' + mappingToCsv(rows), 'text/csv')}>↓ CSV</button>
          <button
            className="tinybtn"
            onClick={() => {
              try {
                const r = xsltToMapping(state.stylesheet);
                set({ rows: r });
                toast(t('Read {n} rows from the stylesheet', { n: r.length }), 'success');
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          >
            {t('From XSLT')}
          </button>
          <span className="grow" />
          <select className="select" style={{ width: 'auto' }} value={version} onChange={(e) => setVersion(e.target.value as '1.0' | '3.0')} aria-label="XSLT version">
            <option value="1.0">XSLT 1.0</option>
            <option value="3.0">XSLT 3.0</option>
          </select>
          <button
            className="btn primary sm"
            onClick={() => {
              const xsl = mappingToXslt(rows.filter((r) => r.target.trim()), { version });
              set({ stylesheet: xsl, engine: version === '1.0' && browserXsltSupported() ? 'browser' : 'saxon-xslt', ...(sample.trim().startsWith('<') ? { input: sample } : {}) });
              onOpen();
            }}
          >
            {t('Generate XSLT')} →
          </button>
        </div>
        <table className="tbl mapping">
          <thead>
            <tr><th>{t('Target')}</th><th>{t('Source / value')}</th><th>{t('Rule')}</th><th>{t('Note')}</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={focus === i ? 'focused' : r.rule === 'loop' ? 'loop' : ''}>
                <td><input className="input mono" value={r.target} onFocus={() => setFocus(i)} onChange={(e) => setRow(i, { target: e.target.value })} aria-label={t('Target')} placeholder="Invoice/Number" /></td>
                <td><input className="input mono" value={r.source} onFocus={() => setFocus(i)} onChange={(e) => setRow(i, { source: e.target.value })} aria-label={t('Source / value')} /></td>
                <td>
                  <select className="select" value={r.rule} onChange={(e) => setRow(i, { rule: e.target.value as Rule })} aria-label={t('Rule')}>
                    {RULES.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </td>
                <td><input className="input" value={r.note ?? ''} onFocus={() => setFocus(i)} onChange={(e) => setRow(i, { note: e.target.value || undefined })} aria-label={t('Note')} /></td>
                <td><button className="tinybtn" onClick={() => set({ rows: rows.filter((_, k) => k !== i) })} aria-label={t('Delete row')}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ margin: 12 }}>{t('Rule "loop" repeats the target element for every source node; rows below it with a longer target path are relative to the loop. Attributes: Target/@name. CSV opens directly in Excel (columns target;source;rule;note).')}</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- JSON ⇄ XML

function ConvertTab({ onUse }: { onUse(xml: string): void }) {
  const [mode, setMode] = useState<'json-xml' | 'xml-json' | 'json-xpath'>('json-xml');
  const [input, setInput] = useState('{\n  "order": {\n    "@id": "A-100",\n    "line": [{ "sku": "X1", "qty": 2 }, { "sku": "Y7", "qty": 1 }]\n  }\n}');
  const [root, setRoot] = useState('root');
  const [typed, setTyped] = useState(true);
  const result = useMemo(() => {
    try {
      if (mode === 'json-xml') return { text: jsonToXml(JSON.parse(input), root) };
      if (mode === 'json-xpath') return { text: jsonToXpathXml(JSON.parse(input)) };
      return { text: JSON.stringify(xmlToJson(input, { typed }), null, 2) };
    } catch (e) {
      return { error: (e as Error).message, text: '' };
    }
  }, [mode, input, root, typed]);
  return (
    <div className="lab-grid">
      <section className="card lab-pane">
        <div className="lab-toolbar">
          <select className="select" style={{ width: 'auto' }} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label={t('Direction')}>
            <option value="json-xml">JSON → XML</option>
            <option value="xml-json">XML → JSON</option>
            <option value="json-xpath">JSON → XML (fn:json-to-xml)</option>
          </select>
          {mode === 'json-xml' && <input className="input" style={{ width: 120 }} value={root} onChange={(e) => setRoot(e.target.value)} aria-label={t('Root element')} placeholder="root" />}
          {mode === 'xml-json' && (
            <label className="check" style={{ margin: 0 }}>
              <input type="checkbox" checked={typed} onChange={(e) => setTyped(e.target.checked)} /> {t('numbers & booleans')}
            </label>
          )}
        </div>
        <CodeEditor value={input} lang={mode === 'xml-json' ? 'xml' : 'json'} onChange={setInput} label={t('Input')} minHeight={360} />
      </section>
      <section className="card lab-pane">
        <div className="lab-toolbar">
          <span className="lab-label" style={{ padding: 0 }}>{t('Result')}</span>
          <span className="grow" />
          {mode !== 'xml-json' && result.text && <button className="tinybtn" onClick={() => onUse(result.text)}>{t('Use as XSLT input')} →</button>}
        </div>
        {result.error && <div className="form-error" style={{ margin: '0 12px 8px' }}>{result.error}</div>}
        <CodeEditor value={result.text} lang={mode === 'xml-json' ? 'json' : 'xml'} readOnly label={t('Result')} minHeight={360} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- schemas

function SchemaTab({ state, set, onUse }: { state: LabState; set(p: Partial<LabState>): void; onUse(xml: string): void }) {
  const [changes, setChanges] = useState<SchemaChange[]>();
  const [error, setError] = useState('');
  const [sampleOut, setSampleOut] = useState('');
  const [optional, setOptional] = useState(true);
  const roots = useMemo(() => {
    try {
      return parseXsd(state.xsdB || state.xsdA).roots;
    } catch {
      return [];
    }
  }, [state.xsdA, state.xsdB]);
  const [root, setRoot] = useState('');
  const impact = useMemo(() => (changes ? impactOf(changes, [{ name: 'XSLT (Transform tab)', text: state.stylesheet }, { name: 'Mapping', text: state.rows.map((r) => `/${r.source}`).join('\n') }]) : []), [changes, state.stylesheet, state.rows]);

  const load = async (k: 'xsdA' | 'xsdB') => {
    const f = await pickTextFile('.xsd,.xml,.json');
    if (f) set({ [k]: f.text } as Partial<LabState>);
  };

  return (
    <>
      <div className="lab-grid">
        <section className="card lab-pane">
          <div className="lab-toolbar">
            <span className="lab-label" style={{ padding: 0 }}>{t('Old schema (XSD)')}</span>
            <span className="grow" />
            <button className="tinybtn" onClick={() => load('xsdA')}>↑ {t('Open')}</button>
          </div>
          <CodeEditor value={state.xsdA} lang="xml" onChange={(xsdA) => set({ xsdA })} label={t('Old schema')} minHeight={240} />
        </section>
        <section className="card lab-pane">
          <div className="lab-toolbar">
            <span className="lab-label" style={{ padding: 0 }}>{t('New schema (XSD) or JSON Schema')}</span>
            <span className="grow" />
            <button className="tinybtn" onClick={() => load('xsdB')}>↑ {t('Open')}</button>
          </div>
          <CodeEditor value={state.xsdB} lang={state.xsdB.trim().startsWith('{') ? 'json' : 'xml'} onChange={(xsdB) => set({ xsdB })} label={t('New schema')} minHeight={240} />
        </section>
      </div>
      <div className="row" style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn primary sm"
          disabled={!state.xsdA.trim() || !state.xsdB.trim()}
          onClick={() => {
            try {
              setError('');
              setChanges(diffSchemas(state.xsdA, state.xsdB));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {t('Compare schemas')}
        </button>
        <span className="sep" />
        <select className="select" style={{ width: 'auto' }} value={root} onChange={(e) => setRoot(e.target.value)} aria-label={t('Root element')}>
          <option value="">{t('(first root element)')}</option>
          {roots.map((r) => <option key={r}>{r}</option>)}
        </select>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} /> {t('include optional')}
        </label>
        <button
          className="btn sm"
          disabled={!(state.xsdB || state.xsdA).trim()}
          onClick={() => {
            try {
              setError('');
              const src = (state.xsdB || state.xsdA).trim();
              setSampleOut(src.startsWith('{') ? JSON.stringify(sampleJson(JSON.parse(src), { optional }), null, 2) : sampleXml(src, { root: root || undefined, optional }));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {t('Generate test data')}
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {changes && (
        <section className="card settings-card" style={{ marginBottom: 14 }}>
          <h2>
            {t('Changes')} · <span className="c-err">{changes.filter((c) => c.breaking).length} {t('breaking')}</span> · {changes.length} {t('total')}
          </h2>
          {!changes.length ? <p className="muted">{t('The schemas are equivalent.')}</p> : (
            <table className="tbl">
              <tbody>
                {changes.map((c) => (
                  <tr key={`${c.path}:${c.kind}`}>
                    <td>{c.breaking ? <span className="pill err">{t('breaking')}</span> : <span className="pill ok">{t('safe')}</span>}</td>
                    <td className="mono">{c.path}</td>
                    <td>{c.kind}</td>
                    <td className="muted">{c.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2 style={{ marginTop: 18 }}>{t('Impact on transformations')}</h2>
          {!impact.length ? <p className="muted">{t('No references to changed elements found in the current XSLT or mapping.')}</p> : (
            <table className="tbl">
              <tbody>
                {impact.map((i, k) => (
                  <tr key={k}><td className="mono">{i.path}</td><td>{i.file}:{i.line}</td><td className="mono">{i.text}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {sampleOut && (
        <section className="card lab-pane">
          <div className="lab-toolbar">
            <span className="lab-label" style={{ padding: 0 }}>{t('Test data')}</span>
            <span className="grow" />
            {sampleOut.startsWith('<') && <button className="tinybtn" onClick={() => onUse(sampleOut)}>{t('Use as XSLT input')} →</button>}
            <button className="tinybtn" onClick={() => download(sampleOut.startsWith('<') ? 'sample.xml' : 'sample.json', sampleOut)}>↓</button>
          </div>
          <CodeEditor value={sampleOut} lang={sampleOut.startsWith('<') ? 'xml' : 'json'} readOnly label={t('Test data')} minHeight={200} />
        </section>
      )}
    </>
  );
}
