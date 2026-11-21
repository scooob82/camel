import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiError } from '../../app/api';
import { t } from '../../app/i18n';
import { href } from '../../app/router';
import { checkRunner, runnerStatus, runRoutes } from '../../app/runner';
import { authStore } from '../../app/session';
import { storage, toast, useStore } from '../../app/store';
import { findNode } from '../../core/edit';
import type { CamelFile } from '../../core/model';
import { coverage, generateJUnitTest, nodeLabel, prepareRun, type Fault, type FaultKind, type MockMode, type PreparedRun, type RunResult } from '../../core/runner';
import { download } from './download';

export interface TraceView {
  visited: Set<string>;
  current?: string;
  uncovered?: Set<string>;
}

interface Props {
  file: CamelFile;
  projectId: string;
  projectName: string;
  selected?: string;
  breakpoints: Set<string>;
  onToggleBreakpoint(id: string): void;
  onTrace(view: TraceView | undefined): void;
  onSelect(id: string): void;
}

interface Saved {
  at: number;
  routeId: string;
  prepared: PreparedRun;
  result: RunResult;
}

const FAULTS: { kind: FaultKind; label: string }[] = [
  { kind: 'exception', label: 'Exception' },
  { kind: 'timeout', label: 'Timeout' },
  { kind: 'http500', label: 'HTTP 500' },
  { kind: 'invalid-data', label: 'Invalid data' },
];

function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function Kv({ map }: { map: Record<string, string> }) {
  const entries = Object.entries(map ?? {});
  if (!entries.length) return <p className="muted" style={{ margin: '4px 0' }}>—</p>;
  return (
    <table className="kv">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="mono">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RunPanel({ file, projectId, projectName, selected, breakpoints, onToggleBreakpoint, onTrace, onSelect }: Props) {
  const status = useStore(runnerStatus, (s) => s);
  const auth = useStore(authStore, (s) => s.status);
  const key = `cas.runs.${projectId}`;
  const [routeId, setRouteId] = useState(file.routes[0]?.routeId ?? '');
  const [body, setBody] = useState('{"orderId": "A-100", "total": 120}');
  const [headers, setHeaders] = useState('');
  const [mocks, setMocks] = useState<MockMode>('external');
  const [faults, setFaults] = useState<Fault[]>([]);
  const [faultKind, setFaultKind] = useState<FaultKind>('exception');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [runs, setRuns] = useState<Saved[]>(() => storage.read<Saved[]>(key, []));
  const [active, setActive] = useState(0);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [showUncovered, setShowUncovered] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (status === undefined) void checkRunner();
  }, [status]);
  useEffect(() => {
    if (!file.routes.some((r) => r.routeId === routeId) && file.routes[0]) setRouteId(file.routes[0].routeId);
  }, [file.routes, routeId]);

  const run = runs[active];
  const cov = useMemo(() => coverage(file, runs.map((r) => r.result)), [file, runs]);

  // canvas overlay
  useEffect(() => {
    if (!run) return onTrace(undefined);
    const events = run.result.trace;
    const upto = step < 0 ? events : events.slice(0, step + 1);
    onTrace({
      visited: new Set(upto.map((e) => e.nodeId)),
      current: step >= 0 ? events[step]?.nodeId : undefined,
      uncovered: showUncovered ? new Set(cov.uncovered) : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, step, showUncovered, cov]);
  useEffect(() => () => onTrace(undefined), [onTrace]);
  useEffect(() => () => clearInterval(timer.current), []);

  const persist = (list: Saved[]) => {
    setRuns(list);
    // keep history small: bodies can be large
    storage.write(key, list.slice(0, 10).map((r) => ({ ...r, result: { ...r.result, trace: r.result.trace.slice(0, 200) } })));
  };

  const start = async () => {
    setBlocked([]);
    let prepared: PreparedRun;
    try {
      prepared = prepareRun(file, routeId, { body, headers: parseHeaders(headers) }, { mocks, faults });
    } catch (e) {
      toast((e as Error).message, 'error');
      return;
    }
    if (prepared.blocked.length) {
      setBlocked(prepared.blocked);
      return;
    }
    setBusy(true);
    try {
      const result = await runRoutes(prepared.request);
      for (const m of result.mocks) if (prepared.mocks[m.uri]) (m as { original?: string }).original = prepared.mocks[m.uri];
      persist([{ at: Date.now(), routeId, prepared, result }, ...runs].slice(0, 10));
      setActive(0);
      setStep(-1);
      if (!result.ok) toast(result.error ?? t('Run failed'), 'error');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const play = () => {
    if (!run) return;
    clearInterval(timer.current);
    setPlaying(true);
    let i = step;
    timer.current = setInterval(() => {
      i++;
      const ev = run.result.trace[i];
      if (!ev) {
        clearInterval(timer.current);
        setPlaying(false);
        return;
      }
      setStep(i);
      if (breakpoints.has(ev.nodeId)) {
        clearInterval(timer.current);
        setPlaying(false);
        toast(t('Breakpoint: {node}', { node: nodeLabel(file, ev.nodeId) }));
      }
    }, 450);
  };
  const pause = () => {
    clearInterval(timer.current);
    setPlaying(false);
  };

  if (status === undefined) return <div className="run-panel muted">{t('Checking the sandbox…')}</div>;
  if (status === null || !status.available) {
    return (
      <div className="run-panel">
        <div className="notice">
          <b>{t('Run & Debug needs the sandbox runner')}</b>
          <p style={{ margin: '6px 0 0' }}>{status === null ? t('This installation runs without the server API.') : t('The server has no runner configured yet. Deploy runner/ (Docker) and set runner.url and runner.token in cas-config.php — see runner/README.md.')}</p>
        </div>
      </div>
    );
  }
  if (auth !== 'authenticated') {
    return (
      <div className="run-panel">
        <div className="notice">
          {t('Sign in to run routes in the sandbox.')}{' '}
          <a href={href('/login')}>{t('Sign in')}</a>
        </div>
      </div>
    );
  }

  const ev = run && step >= 0 ? run.result.trace[step] : undefined;
  const selectedIsStep = selected ? findNode(file, selected)?.kind === 'step' : false;

  return (
    <div className="run-panel">
      <div className="field">
        <label>
          <span>{t('Route to run')}</span>
          {status.dailyRuns !== null && <span className="hint">{t('{n} runs per day on your plan', { n: status.dailyRuns })}</span>}
        </label>
        <select className="select" value={routeId} onChange={(e) => setRouteId(e.target.value)} aria-label={t('Route to run')}>
          {file.routes.map((r) => (
            <option key={r.id} value={r.routeId}>
              {r.routeId} — {r.from.uri}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>
          <span>{t('Input body')}</span>
        </label>
        <textarea className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} aria-label={t('Input body')} />
      </div>
      <div className="field">
        <label>
          <span>{t('Headers')}</span>
          <span className="hint">name=value</span>
        </label>
        <textarea className="textarea" rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} aria-label={t('Headers')} placeholder="type=B2B" />
      </div>
      <div className="field">
        <label>
          <span>{t('Mock endpoints')}</span>
        </label>
        <select className="select" value={mocks} onChange={(e) => setMocks(e.target.value as MockMode)} aria-label={t('Mock endpoints')}>
          <option value="external">{t('External systems (recommended)')}</option>
          <option value="all">{t('All endpoints')}</option>
          <option value="none">{t('None')}</option>
        </select>
      </div>
      <div className="subhead">{t('Chaos testing')}</div>
      {faults.map((f, i) => (
        <div key={i} className="row" style={{ marginBottom: 4 }}>
          <span className="pill err">{FAULTS.find((x) => x.kind === f.kind)?.label}</span>
          <span className="mono" style={{ fontSize: 11 }}>
            {nodeLabel(file, f.nodeId)}
          </span>
          <button className="tinybtn" onClick={() => setFaults(faults.filter((_, j) => j !== i))} aria-label={t('Remove fault')}>
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <select className="select" style={{ width: 'auto' }} value={faultKind} onChange={(e) => setFaultKind(e.target.value as FaultKind)} aria-label={t('Fault type')}>
          {FAULTS.map((f) => (
            <option key={f.kind} value={f.kind}>
              {t(f.label)}
            </option>
          ))}
        </select>
        <button className="tinybtn" disabled={!selectedIsStep} onClick={() => selected && setFaults([...faults.filter((f) => f.nodeId !== selected), { nodeId: selected, kind: faultKind }])} title={t('Select a step on the canvas first')}>
          + {t('Fault before selected step')}
        </button>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary sm" onClick={start} disabled={busy || !file.routes.length}>
          {busy ? t('Running…') : `▶ ${t('Run')}`}
        </button>
        <button className="tinybtn" disabled={!selectedIsStep} onClick={() => selected && onToggleBreakpoint(selected)}>
          ● {selected && breakpoints.has(selected) ? t('Remove breakpoint') : t('Breakpoint on selected step')}
        </button>
      </div>
      {blocked.length > 0 && (
        <div className="form-error" style={{ marginTop: 10 }}>
          {blocked.map((b) => (
            <div key={b}>{b}</div>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <div className="run-result">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <select className="select" style={{ width: 'auto' }} value={active} onChange={(e) => (setActive(+e.target.value), setStep(-1))} aria-label={t('Run history')}>
              {runs.map((r, i) => (
                <option key={r.at} value={i}>
                  {new Date(r.at).toLocaleTimeString()} · {r.routeId} · {r.result.ok ? 'OK' : t('failed')}
                </option>
              ))}
            </select>
            <span className={run.result.ok ? 'c-ok' : 'c-err'}>
              {run.result.ok ? '✓' : '✕'} {run.result.durationMs} ms · {run.result.trace.length} {t('steps')}
            </span>
          </div>
          {run.result.error && <div className="form-error" style={{ marginTop: 8 }}>{run.result.error}</div>}

          <div style={{ marginTop: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                {t('Coverage')} {cov.percent}% ({cov.covered}/{cov.total}) · {cov.uncoveredBranches.length} {t('branches never taken')}
              </span>
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={showUncovered} onChange={(e) => setShowUncovered(e.target.checked)} /> {t('show')}
              </label>
            </div>
            <div className="coverage-bar">
              <i style={{ width: `${cov.percent}%` }} />
            </div>
          </div>

          <div className="player" role="group" aria-label={t('Replay')}>
            <button className="tinybtn" onClick={() => setStep(-1)} aria-label={t('Show all')}>⏮</button>
            <button className="tinybtn" onClick={() => setStep((s) => Math.max(0, s - 1))} aria-label={t('Previous step')}>◀</button>
            {playing ? (
              <button className="tinybtn" onClick={pause} aria-label={t('Pause')}>⏸</button>
            ) : (
              <button className="tinybtn run" onClick={play} aria-label={t('Play')}>▶ {t('Replay')}</button>
            )}
            <button className="tinybtn" onClick={() => setStep((s) => Math.min(run.result.trace.length - 1, s + 1))} aria-label={t('Next step')}>▶|</button>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
              {step >= 0 ? `${step + 1}/${run.result.trace.length}` : t('all steps')}
            </span>
          </div>

          <div className="trace-list" role="listbox" aria-label={t('Trace')}>
            {run.result.trace.map((e, i) => (
              <button
                key={i}
                role="option"
                aria-selected={i === step}
                className={`trace-item ${i === step ? 'active' : ''} ${e.exception ? 'err' : ''}`}
                onClick={() => {
                  setStep(i);
                  onSelect(e.nodeId);
                }}
              >
                <span className="muted">{i + 1}</span>
                <span>
                  {breakpoints.has(e.nodeId) ? '● ' : ''}
                  {nodeLabel(file, e.nodeId)}
                </span>
                <span className="muted">{e.tookMs} ms</span>
              </button>
            ))}
          </div>

          {ev && (
            <>
              <div className="subhead">{t('Message at this step')}</div>
              {ev.exception && <div className="form-error">{ev.exception}</div>}
              <pre className="block" style={{ maxHeight: 160 }}>{ev.body || '∅'}</pre>
              <div className="subhead">{t('Headers')}</div>
              <Kv map={ev.headers} />
              <div className="subhead">{t('Properties')}</div>
              <Kv map={ev.properties} />
            </>
          )}
          {!ev && run.result.output && (
            <>
              <div className="subhead">{t('Output')}</div>
              <pre className="block" style={{ maxHeight: 160 }}>{run.result.output.body || '∅'}</pre>
            </>
          )}
          {run.result.mocks.length > 0 && (
            <>
              <div className="subhead">{t('Mocks')}</div>
              <table className="kv">
                <tbody>
                  {run.result.mocks.map((m) => (
                    <tr key={m.uri}>
                      <td>{m.count}×</td>
                      <td className="mono">{run.prepared.mocks[m.uri] ?? m.uri}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {run.result.logs.length > 0 && (
            <>
              <div className="subhead">{t('Logs')}</div>
              <pre className="block" style={{ maxHeight: 120 }}>{run.result.logs.join('\n')}</pre>
            </>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="tinybtn accent"
              onClick={() => {
                const java = generateJUnitTest(file, run.routeId, run.prepared, run.result, projectName);
                download(`${java.match(/class (\w+)/)?.[1] ?? 'RouteTest'}.java`, java, 'text/x-java');
              }}
            >
              ↓ {t('Generate JUnit test')}
            </button>
            <button className="tinybtn" onClick={() => persist([])}>
              {t('Clear history')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
