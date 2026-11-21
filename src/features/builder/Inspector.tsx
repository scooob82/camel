import { useMemo, useState, type ReactNode } from 'react';
import { COMPONENTS, COMPONENT_BY_SCHEME, docsUrl, parseUri, buildUri, setUriParam } from '../../core/catalog';
import type { NodeRef } from '../../core/edit';
import { EIP_BY_TYPE, type PropDef } from '../../core/eip';
import { jsonPath } from '../../core/jsonpath';
import { HTTP_VERBS, LANGUAGES, isKnown, uid, type Branch, type Expression, type HttpVerb, type KnownStep, type OnException, type RestDef, type RestVerb, type Route } from '../../core/model';
import type { Issue } from '../../core/validate';
import YAML from 'yaml';

type Mutate = (id: string, fn: (node: unknown) => void) => void;

interface Props {
  node?: NodeRef;
  issues: Issue[];
  mutate: Mutate;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  onSaveSnippet(id: string): void;
  multiCount?: number;
}

export function Inspector({ node, issues, mutate, onDelete, onDuplicate, onSaveSnippet, multiCount = 0 }: Props) {
  if (multiCount > 1) {
    return (
      <div className="inspector">
        <Head icon="▣" title={`${multiCount} steps selected`} text="Delete, copy (Ctrl C) or cut (Ctrl X) them together. Click without Shift to select a single step." />
        <div className="inspector-actions">
          <button className="tinybtn" onClick={() => node && onDelete(node.node.id)} style={{ color: 'var(--red)' }}>
            Delete selected <span className="kbd">Del</span>
          </button>
        </div>
      </div>
    );
  }
  if (!node) {
    return (
      <div className="inspector">
        <div className="empty" style={{ padding: '36px 18px' }}>
          <div className="feature-icon">◎</div>
          <h3 style={{ fontSize: 14 }}>Nothing selected</h3>
          <p style={{ fontSize: 12 }}>Click a node on the canvas to edit it. Drag components from the left panel between nodes, or click a “+” connector.</p>
        </div>
      </div>
    );
  }
  const own = issues.filter((i) => i.target === node.node.id);
  const issueList = own.length ? (
    <div style={{ marginBottom: 14 }}>
      {own.map((i, k) => (
        <div key={k} className={`issue c-${i.severity === 'error' ? 'err' : i.severity === 'warning' ? 'warn' : 'info'}`} style={{ padding: '3px 0' }}>
          <span>{i.severity === 'error' ? '✕' : i.severity === 'warning' ? '!' : 'i'}</span>
          <span style={{ color: 'var(--text2)' }}>{i.message}</span>
        </div>
      ))}
    </div>
  ) : null;

  switch (node.kind) {
    case 'route':
      return <RouteInspector route={node.node} mutate={mutate} onDelete={onDelete} issues={issueList} />;
    case 'onException':
      return <ExceptionInspector ex={node.node} mutate={mutate} onDelete={onDelete} issues={issueList} />;
    case 'rest':
      return <RestInspector rest={node.node} mutate={mutate} onDelete={onDelete} issues={issueList} />;
    case 'branch':
      return <BranchInspector branch={node.node} mutate={mutate} onDelete={onDelete} issues={issueList} />;
    case 'step': {
      const s = node.node;
      if (!isKnown(s)) {
        return (
          <div className="inspector">
            <Head icon="?" title={s.name} text="This step is not supported by the visual builder yet. It is preserved as-is in YAML; edit it in the code view." />
            <pre className="block">{s.yaml !== undefined ? YAML.stringify({ [s.name]: s.yaml }) : s.xml}</pre>
            <div className="inspector-actions">
              <button className="tinybtn" onClick={() => onDelete(s.id)}>
                Delete
              </button>
            </div>
          </div>
        );
      }
      return <StepInspector key={s.id} step={s} mutate={mutate} onDelete={onDelete} onDuplicate={onDuplicate} onSaveSnippet={onSaveSnippet} issues={issueList} />;
    }
  }
}

function Head({ icon, title, text, docs }: { icon: string; title: string; text: string; docs?: string }) {
  return (
    <div className="inspector-head">
      <div className="feature-icon">{icon}</div>
      <div>
        <h3>{title}</h3>
        <p>
          {text}{' '}
          {docs && (
            <a href={docs} target="_blank" rel="noreferrer">
              Docs ↗
            </a>
          )}
        </p>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, required, hint, mono = true, type = 'text' }: { label: string; value: string; onChange(v: string): void; placeholder?: string; required?: boolean; hint?: string; mono?: boolean; type?: string }) {
  const id = useMemo(() => `f${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div className="field">
      <label htmlFor={id}>
        <span>
          {label} {required && <span className="req">*</span>}
        </span>
      </label>
      <input id={id} className={`input ${mono ? 'mono' : ''}`} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={required && !value.trim() ? true : undefined} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function PropField({ def, value, onChange }: { def: PropDef; value: string; onChange(v: string): void }) {
  if (def.kind === 'boolean') {
    return (
      <label className="check">
        <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : '')} />
        {def.label}
        {def.help && <span className="hint">— {def.help}</span>}
      </label>
    );
  }
  if (def.kind === 'select') {
    return (
      <div className="field">
        <label>
          <span>
            {def.label} {def.required && <span className="req">*</span>}
          </span>
        </label>
        <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.label}>
          {def.options!.map((o) => (
            <option key={o} value={o}>
              {o || '(default)'}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return <TextField label={def.label} value={value} onChange={onChange} placeholder={def.placeholder} required={def.required} hint={def.help} type={def.kind === 'number' ? 'number' : 'text'} />;
}

// ---------------------------------------------------------------- expression

const SAMPLES: Record<string, string> = {
  jsonpath: '{\n  "orderId": "A-100",\n  "lines": [\n    { "sku": "X1", "qty": 2 },\n    { "sku": "Y7", "qty": 10 }\n  ]\n}',
  xpath: '<order id="A-100" type="B2B">\n  <line sku="X1" qty="2"/>\n  <line sku="Y7" qty="10"/>\n</order>',
};

function evaluate(lang: string, expr: string, sample: string): { ok: boolean; text: string } {
  try {
    if (lang === 'jsonpath') {
      const res = jsonPath(JSON.parse(sample), expr);
      return { ok: true, text: JSON.stringify(res.length === 1 ? res[0] : res, null, 2) };
    }
    if (lang === 'xpath') {
      const doc = new DOMParser().parseFromString(sample, 'application/xml');
      const err = doc.querySelector('parsererror');
      if (err) return { ok: false, text: `Sample is not valid XML: ${err.textContent?.split('\n')[0]}` };
      const r = doc.evaluate(expr, doc, null, XPathResult.ANY_TYPE, null);
      switch (r.resultType) {
        case XPathResult.NUMBER_TYPE:
          return { ok: true, text: String(r.numberValue) };
        case XPathResult.STRING_TYPE:
          return { ok: true, text: JSON.stringify(r.stringValue) };
        case XPathResult.BOOLEAN_TYPE:
          return { ok: true, text: String(r.booleanValue) };
        default: {
          const out: string[] = [];
          const ser = new XMLSerializer();
          for (let n = r.iterateNext(); n; n = r.iterateNext()) out.push(n.nodeType === Node.ELEMENT_NODE ? ser.serializeToString(n) : (n.textContent ?? ''));
          return { ok: true, text: out.length ? out.join('\n') : '(no nodes matched)' };
        }
      }
    }
    return { ok: false, text: '' };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

function ExpressionEditor({ label, value, onChange }: { label: string; value?: Expression; onChange(e: Expression): void }) {
  const e = value ?? { language: 'simple', expression: '' };
  const [testing, setTesting] = useState(false);
  const [sample, setSample] = useState<Record<string, string>>(SAMPLES);
  const testable = e.language === 'jsonpath' || e.language === 'xpath';
  const result = testing && testable ? evaluate(e.language, e.expression, sample[e.language]) : undefined;
  return (
    <>
      <div className="field">
        <label>
          <span>
            {label} <span className="req">*</span>
          </span>
          {testable ? (
            <button className="tinybtn" onClick={() => setTesting((t) => !t)} aria-expanded={testing}>
              {testing ? 'Hide tester' : '▶ Test'}
            </button>
          ) : null}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6 }}>
          <select className="select" value={e.language} onChange={(ev) => onChange({ ...e, language: ev.target.value as Expression['language'] })} aria-label="Expression language">
            {LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <input className="input mono" value={e.expression} onChange={(ev) => onChange({ ...e, expression: ev.target.value })} aria-label={label} aria-invalid={!e.expression.trim() || undefined} />
        </div>
        {e.language === 'simple' && <span className="hint">Simple is evaluated by Camel at runtime — live evaluation arrives with Run &amp; Debug. Example: {'${header.type} == "B2B"'}</span>}
        {e.language === 'header' && <span className="hint">Name of the header whose value is used.</span>}
      </div>
      {result !== undefined && (
        <div className="tester">
          <div className="field-label">Sample {e.language === 'jsonpath' ? 'JSON' : 'XML'} body</div>
          <textarea className="textarea" rows={6} value={sample[e.language]} onChange={(ev) => setSample((s) => ({ ...s, [e.language]: ev.target.value }))} aria-label="Sample message body" />
          <div className="field-label" style={{ marginTop: 8 }}>
            Result <span className={result.ok ? 'ok' : 'bad'}>{result.ok ? '✓ evaluated' : '✕ error'}</span>
          </div>
          <pre className={result.ok ? '' : 'bad'}>{result.text}</pre>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- endpoint

export function EndpointEditor({ uri, onChange, role }: { uri: string; onChange(v: string): void; role: 'consumer' | 'producer' }) {
  const parsed = parseUri(uri);
  const comp = COMPONENT_BY_SCHEME[parsed.scheme];
  const usable = COMPONENTS.filter((c) => (role === 'consumer' ? c.consumer : c.producer));
  const value = (name: string) => parsed.params.find(([k]) => k === name)?.[1] ?? '';
  return (
    <>
      <div className="field">
        <label>
          <span>
            Component <span className="req">*</span>
          </span>
        </label>
        <select
          className="select"
          value={comp ? comp.scheme : ''}
          onChange={(e) => {
            const c = COMPONENT_BY_SCHEME[e.target.value];
            if (c) onChange(c.example);
          }}
          aria-label="Component"
        >
          {!comp && <option value="">{parsed.scheme ? `${parsed.scheme} (not in catalog)` : 'Choose a component…'}</option>}
          {usable.map((c) => (
            <option key={c.scheme} value={c.scheme}>
              {c.title} — {c.scheme}
            </option>
          ))}
        </select>
      </div>
      <TextField label="Endpoint URI" value={uri} onChange={onChange} required hint={comp ? `Syntax: ${comp.syntax}` : 'scheme:path?option=value'} />
      {comp && (
        <>
          <div className="comp-card">
            <b>{comp.title}</b> · {comp.description}{' '}
            <a href={docsUrl(comp)} target="_blank" rel="noreferrer">
              Docs ↗
            </a>
          </div>
          <TextField
            label="Path"
            value={parsed.path}
            onChange={(v) => onChange(buildUri({ ...parsed, path: v }))}
            hint={comp.syntax}
          />
          {comp.options.length > 0 && <div className="subhead">Options</div>}
          {comp.options.map((o) =>
            o.enum ? (
              <div className="field" key={o.name}>
                <label>
                  <span>{o.name}</span>
                  <span className="hint">{o.description}</span>
                </label>
                <select className="select" value={value(o.name)} onChange={(e) => onChange(setUriParam(uri, o.name, e.target.value))} aria-label={o.name}>
                  <option value="">{o.default ? `(default: ${o.default})` : '(not set)'}</option>
                  {o.enum.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
            ) : (
              <TextField key={o.name} label={o.name} value={value(o.name)} placeholder={o.default ? `default: ${o.default}` : ''} hint={o.description} onChange={(v) => onChange(setUriParam(uri, o.name, v))} />
            ),
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- per kind

function StepInspector({ step, mutate, onDelete, onDuplicate, onSaveSnippet, issues }: { step: KnownStep; mutate: Mutate; onDelete(id: string): void; onDuplicate(id: string): void; onSaveSnippet(id: string): void; issues: ReactNode }) {
  const def = EIP_BY_TYPE[step.type];
  const set = (fn: (s: KnownStep) => void) => mutate(step.id, (n) => fn(n as KnownStep));
  return (
    <div className="inspector">
      <Head icon={def.icon} title={def.label} text={def.summary} docs={def.docs} />
      {issues}
      {def.uri && <EndpointEditor uri={step.props.uri ?? ''} role="producer" onChange={(v) => set((s) => (s.props.uri = v))} />}
      {def.expression && <ExpressionEditor label={def.expressionLabel ?? 'Expression'} value={step.expression} onChange={(e) => set((s) => (s.expression = e))} />}
      {def.props.map((p) => (
        <PropField key={p.name} def={p} value={step.props[p.name] ?? ''} onChange={(v) => set((s) => (s.props[p.name] = v))} />
      ))}
      {def.container === 'choice' && <p className="hint">Conditions are evaluated top to bottom. Select a “when” label on the canvas to edit its condition.</p>}
      <div className="inspector-actions">
        <button className="tinybtn" onClick={() => onDuplicate(step.id)}>
          Duplicate <span className="kbd">Ctrl D</span>
        </button>
        <button className="tinybtn" onClick={() => onSaveSnippet(step.id)} title="Reuse this step (with everything inside it) from the palette">
          ☆ Save as snippet
        </button>
        <button className="tinybtn" onClick={() => onDelete(step.id)} style={{ color: 'var(--red)' }}>
          Delete <span className="kbd">Del</span>
        </button>
      </div>
    </div>
  );
}

function RouteInspector({ route, mutate, onDelete, issues }: { route: Route; mutate: Mutate; onDelete(id: string): void; issues: ReactNode }) {
  const set = (fn: (r: Route) => void) => mutate(route.id, (n) => fn(n as Route));
  return (
    <div className="inspector">
      <Head icon="⇢" title="Route" text="A route consumes from one endpoint and runs its steps for every message." docs="https://camel.apache.org/manual/routes.html" />
      {issues}
      <TextField label="Route id" value={route.routeId} onChange={(v) => set((r) => (r.routeId = v))} required />
      <TextField label="Description" value={route.description ?? ''} mono={false} onChange={(v) => set((r) => (r.description = v || undefined))} />
      <div className="subhead">From</div>
      <EndpointEditor uri={route.from.uri} role="consumer" onChange={(v) => set((r) => (r.from.uri = v))} />
      <div className="inspector-actions">
        <button className="tinybtn" onClick={() => onDelete(route.id)} style={{ color: 'var(--red)' }}>
          Delete route
        </button>
      </div>
    </div>
  );
}

function ExceptionInspector({ ex, mutate, onDelete, issues }: { ex: OnException; mutate: Mutate; onDelete(id: string): void; issues: ReactNode }) {
  const set = (fn: (e: OnException) => void) => mutate(ex.id, (n) => fn(n as OnException));
  return (
    <div className="inspector">
      <Head icon="⚑" title="onException" text="Global error handler for the routes in this file: retries, then runs its steps." docs="https://camel.apache.org/manual/exception-clause.html" />
      {issues}
      <div className="field">
        <label>
          <span>
            Exception classes <span className="req">*</span>
          </span>
          <span className="hint">one per line</span>
        </label>
        <textarea className="textarea" rows={3} value={ex.exceptions.join('\n')} onChange={(e) => set((x) => (x.exceptions = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)))} aria-label="Exception classes" />
      </div>
      <label className="check">
        <input type="checkbox" checked={ex.handled} onChange={(e) => set((x) => (x.handled = e.target.checked))} />
        Handled — do not propagate the exception to the caller
      </label>
      <TextField label="Maximum redeliveries" type="number" value={ex.maximumRedeliveries ?? ''} onChange={(v) => set((x) => (x.maximumRedeliveries = v || undefined))} placeholder="0" />
      <TextField label="Redelivery delay (ms)" type="number" value={ex.redeliveryDelay ?? ''} onChange={(v) => set((x) => (x.redeliveryDelay = v || undefined))} placeholder="1000" />
      <label className="check">
        <input type="checkbox" checked={!!ex.useExponentialBackOff} onChange={(e) => set((x) => (x.useExponentialBackOff = e.target.checked || undefined))} />
        Exponential back-off
      </label>
      {ex.useExponentialBackOff && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <TextField label="Multiplier" type="number" value={ex.backOffMultiplier ?? ''} onChange={(v) => set((x) => (x.backOffMultiplier = v || undefined))} placeholder="2" />
          <TextField label="Max delay (ms)" type="number" value={ex.maximumRedeliveryDelay ?? ''} onChange={(v) => set((x) => (x.maximumRedeliveryDelay = v || undefined))} placeholder="60000" />
        </div>
      )}
      <RedeliveryTimeline ex={ex} />
      <div className="inspector-actions">
        <button className="tinybtn" onClick={() => onDelete(ex.id)} style={{ color: 'var(--red)' }}>
          Delete error handler
        </button>
      </div>
    </div>
  );
}

function BranchInspector({ branch, mutate, onDelete, issues }: { branch: Branch; mutate: Mutate; onDelete(id: string): void; issues: ReactNode }) {
  const set = (fn: (b: Branch) => void) => mutate(branch.id, (n) => fn(n as Branch));
  const titles: Record<Branch['kind'], [string, string]> = {
    when: ['when', 'Steps run when the condition is true. The first matching branch wins.'],
    otherwise: ['otherwise', 'Steps run when no condition matched.'],
    doCatch: ['doCatch', 'Steps run when one of the listed exceptions is thrown in the try block.'],
    doFinally: ['doFinally', 'Steps always run after the try block.'],
    onFallback: ['onFallback', 'Steps run when the circuit is open or the protected call fails.'],
  };
  const [title, text] = titles[branch.kind];
  return (
    <div className="inspector">
      <Head icon={branch.kind === 'doCatch' ? '⚑' : branch.kind === 'doFinally' ? '↧' : branch.kind === 'onFallback' ? '⚡' : '◇'} title={title} text={text} />
      {issues}
      {branch.kind === 'when' && <ExpressionEditor label="Condition" value={branch.expression} onChange={(e) => set((b) => (b.expression = e))} />}
      {branch.kind === 'doCatch' && (
        <div className="field">
          <label>
            <span>
              Exception classes <span className="req">*</span>
            </span>
            <span className="hint">one per line</span>
          </label>
          <textarea className="textarea" rows={3} value={(branch.exceptions ?? []).join('\n')} onChange={(e) => set((b) => (b.exceptions = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)))} aria-label="Exception classes" />
        </div>
      )}
      <div className="inspector-actions">
        <button className="tinybtn" onClick={() => onDelete(branch.id)} style={{ color: 'var(--red)' }}>
          Delete branch
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- redelivery timeline

/** Delays Camel will wait before each redelivery attempt. */
export function redeliverySchedule(ex: OnException): number[] {
  const n = Math.min(Math.max(0, parseInt(ex.maximumRedeliveries ?? '0', 10) || 0), 50);
  const base = Math.max(0, parseInt(ex.redeliveryDelay ?? '1000', 10) || 0);
  const mult = ex.useExponentialBackOff ? Math.max(1, parseFloat(ex.backOffMultiplier ?? '2') || 2) : 1;
  const max = parseInt(ex.maximumRedeliveryDelay ?? '60000', 10) || 60000;
  const out: number[] = [];
  let d = base;
  for (let i = 0; i < n; i++) {
    out.push(Math.min(d, max));
    d = d * mult;
  }
  return out;
}

const fmtMs = (ms: number) => (ms >= 60000 ? `${(ms / 60000).toFixed(ms % 60000 ? 1 : 0)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} s` : `${ms} ms`);

function RedeliveryTimeline({ ex }: { ex: OnException }) {
  const delays = redeliverySchedule(ex);
  const total = delays.reduce((a, b) => a + b, 0);
  return (
    <div className="timeline" aria-label="Redelivery timeline">
      <div className="field-label">
        <span>Timeline</span>
        <span>{delays.length ? `gives up after ~${fmtMs(total)}` : 'no retries'}</span>
      </div>
      <div className="timeline-bar">
        <span className="tl-attempt" title="First attempt">1</span>
        {delays.slice(0, 12).map((d, i) => (
          <span key={i} style={{ display: 'contents' }}>
            <span className="tl-wait" style={{ flexGrow: Math.max(1, Math.log2(d + 2)) }} title={`wait ${fmtMs(d)}`}>
              {fmtMs(d)}
            </span>
            <span className="tl-attempt" title={`Redelivery ${i + 1}`}>
              {i + 2}
            </span>
          </span>
        ))}
        {delays.length > 12 && <span className="tl-wait">+{delays.length - 12}</span>}
        <span className={`tl-end ${ex.handled ? 'handled' : ''}`}>{ex.handled ? 'handled → steps' : 'fails → steps'}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- REST

function RestInspector({ rest, mutate, onDelete, issues }: { rest: RestDef; mutate: Mutate; onDelete(id: string): void; issues: ReactNode }) {
  const set = (fn: (r: RestDef) => void) => mutate(rest.id, (n) => fn(n as RestDef));
  const setVerb = (id: string, fn: (v: RestVerb) => void) => set((r) => r.verbs.forEach((v) => v.id === id && fn(v)));
  return (
    <div className="inspector">
      <Head icon="⇄" title="REST API" text="Maps HTTP operations to routes. Each operation usually calls a direct: route." docs="https://camel.apache.org/manual/rest-dsl.html" />
      {issues}
      <TextField label="Base path" value={rest.path} onChange={(v) => set((r) => (r.path = v))} required />
      <TextField label="Description" value={rest.description ?? ''} mono={false} onChange={(v) => set((r) => (r.description = v || undefined))} />
      <div className="subhead">Operations</div>
      {rest.verbs.map((v) => (
        <div key={v.id} className="verb-card">
          <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr auto', gap: 6, marginBottom: 6 }}>
            <select className="select" value={v.method} onChange={(e) => setVerb(v.id, (x) => (x.method = e.target.value as HttpVerb))} aria-label="HTTP method">
              {HTTP_VERBS.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </select>
            <input className="input mono" value={v.path} onChange={(e) => setVerb(v.id, (x) => (x.path = e.target.value))} aria-label="Path" placeholder="/orders/{id}" />
            <button className="tinybtn" onClick={() => set((r) => (r.verbs = r.verbs.filter((x) => x.id !== v.id)))} aria-label="Remove operation">
              ✕
            </button>
          </div>
          <input className="input mono" value={v.to} onChange={(e) => setVerb(v.id, (x) => (x.to = e.target.value))} aria-label="Target endpoint" placeholder="direct:get-order" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
            <input className="input" value={v.consumes ?? ''} onChange={(e) => setVerb(v.id, (x) => (x.consumes = e.target.value || undefined))} aria-label="Consumes" placeholder="consumes" />
            <input className="input" value={v.produces ?? ''} onChange={(e) => setVerb(v.id, (x) => (x.produces = e.target.value || undefined))} aria-label="Produces" placeholder="produces" />
          </div>
        </div>
      ))}
      <button
        className="tinybtn"
        onClick={() =>
          set((r) => {
            r.verbs.push({ id: uid('verb'), method: 'get', path: '/new', to: 'direct:new' });
            r.verbs.sort((a, b) => HTTP_VERBS.indexOf(a.method) - HTTP_VERBS.indexOf(b.method));
          })
        }
      >
        + Operation
      </button>
      <div className="inspector-actions">
        <button className="tinybtn" onClick={() => onDelete(rest.id)} style={{ color: 'var(--red)' }}>
          Delete REST API
        </button>
      </div>
    </div>
  );
}
