import { useState, type DragEvent, type ReactNode } from 'react';
import { EIP_BY_TYPE } from '../../core/eip';
import { isKnown, joinPath, type Branch, type CamelFile, type KnownStep, type OnException, type RestDef, type Route, type Step } from '../../core/model';
import type { Severity } from '../../core/validate';

export type DropPayload = { kind: 'eip'; type: string } | { kind: 'component'; uri: string } | { kind: 'move'; id: string } | { kind: 'snippet'; id: string };

export const DND_NEW = 'application/x-cas-new';
export const DND_MOVE = 'application/x-cas-move';

export interface CanvasHandlers {
  selected?: string;
  /** Additional selected steps (Shift/Ctrl+click). */
  multi?: Set<string>;
  collapsed?: Set<string>;
  onToggleCollapse?(id: string): void;
  status: Record<string, Severity>;
  readOnly?: boolean;
  onSelect(id: string | undefined, additive?: boolean): void;
  onDrop(containerId: string, index: number, payload: DropPayload): void;
  onQuickAdd(containerId: string, index: number, anchor: DOMRect): void;
  onAddBranch(stepId: string, kind: Branch['kind']): void;
}

function readPayload(e: DragEvent): DropPayload | undefined {
  const move = e.dataTransfer.getData(DND_MOVE);
  if (move) return { kind: 'move', id: move };
  const raw = e.dataTransfer.getData(DND_NEW);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as DropPayload;
  } catch {
    return undefined;
  }
}

const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DND_NEW) || e.dataTransfer.types.includes(DND_MOVE);

function DropZone({ h, containerId, index, empty, first }: { h: CanvasHandlers; containerId: string; index: number; empty?: boolean; first?: boolean }) {
  const [over, setOver] = useState(false);
  if (h.readOnly) return empty ? null : <div className={`drop ${first ? 'first' : ''}`} />;
  return (
    <div
      className={`drop ${empty ? 'empty' : ''} ${first ? 'first' : ''} ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DND_MOVE) ? 'move' : 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const p = readPayload(e);
        if (p) h.onDrop(containerId, index, p);
      }}
    >
      <button
        type="button"
        aria-label="Insert step here"
        title="Insert step (or drop a component here)"
        onClick={(e) => {
          e.stopPropagation();
          h.onQuickAdd(containerId, index, (e.currentTarget as HTMLElement).getBoundingClientRect());
        }}
      >
        {empty ? '+ Drop or click to add a step' : '+'}
      </button>
    </div>
  );
}

function StepList({ h, containerId, steps }: { h: CanvasHandlers; containerId: string; steps: Step[] }) {
  if (!steps.length) return <div className="flow"><DropZone h={h} containerId={containerId} index={0} empty /></div>;
  const items: ReactNode[] = [];
  steps.forEach((s, i) => {
    items.push(<DropZone key={`d${i}`} h={h} containerId={containerId} index={i} first={i === 0} />);
    items.push(<StepView key={s.id} h={h} step={s} />);
  });
  items.push(<DropZone key="dend" h={h} containerId={containerId} index={steps.length} />);
  return <div className="flow">{items}</div>;
}

function subtitle(s: KnownStep): string {
  const p = s.props;
  if (p.uri) return p.uri;
  switch (s.type) {
    case 'log':
      return p.message ?? '';
    case 'setHeader':
    case 'setProperty':
      return `${p.name ?? ''} = ${s.expression?.expression ?? ''}`;
    case 'removeHeader':
      return p.name ?? '';
    case 'convertBodyTo':
      return (p.type ?? '').split('.').pop() ?? '';
    case 'marshal':
    case 'unmarshal':
      return p.format ?? '';
    case 'bean':
      return `${p.ref ?? ''}${p.method ? `.${p.method}()` : ''}`;
    case 'process':
      return p.ref ?? '';
  }
  return s.expression ? `${s.expression.language}: ${s.expression.expression}` : '';
}

function drag(h: CanvasHandlers, id: string) {
  if (h.readOnly) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.setData(DND_MOVE, id);
      e.dataTransfer.effectAllowed = 'move';
      document.querySelector('.canvas')?.classList.add('dragging');
    },
    onDragEnd: () => document.querySelector('.canvas')?.classList.remove('dragging'),
  };
}

function Status({ sev }: { sev?: Severity }) {
  if (sev !== 'error' && sev !== 'warning') return null;
  return (
    <span className={`status ${sev}`} title={sev === 'error' ? 'Has errors' : 'Has warnings'}>
      {sev === 'error' ? '!' : '•'}
    </span>
  );
}

const isSel = (h: CanvasHandlers, id: string) => h.selected === id || !!h.multi?.has(id);

function Collapse({ h, id, count }: { h: CanvasHandlers; id: string; count: number }) {
  if (!h.onToggleCollapse) return null;
  const c = h.collapsed?.has(id);
  return (
    <button
      className="collapse-btn"
      aria-label={c ? 'Expand block' : 'Collapse block'}
      aria-expanded={!c}
      title={c ? 'Expand' : 'Collapse'}
      onClick={(e) => {
        e.stopPropagation();
        h.onToggleCollapse!(id);
      }}
    >
      {c ? `▸ ${count}` : '▾'}
    </button>
  );
}

function countSteps(s: KnownStep): number {
  const n = (list: Step[] | undefined): number => (list ?? []).reduce((a, x) => a + 1 + (isKnown(x) ? countSteps(x) : 0), 0);
  return n(s.steps) + (s.branches ?? []).reduce((a, b) => a + n(b.steps), 0);
}

function StepView({ h, step }: { h: CanvasHandlers; step: Step }) {
  const sel = isSel(h, step.id);
  const select = (e: { stopPropagation(): void; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    e.stopPropagation();
    h.onSelect(step.id, !!(e.shiftKey || e.ctrlKey || e.metaKey));
  };
  if (!isKnown(step)) {
    return (
      <div className={`node unknown ${sel ? 'selected' : ''}`} onClick={select} {...drag(h, step.id)} role="button" tabIndex={0} aria-label={`Unsupported step ${step.name}`}>
        <div className="ico">?</div>
        <b>{step.name}</b>
        <small>not editable visually</small>
      </div>
    );
  }
  const def = EIP_BY_TYPE[step.type];
  const sev = h.status[step.id];
  if (!def.container) {
    return (
      <div className={`node ${sel ? 'selected' : ''}`} onClick={select} onKeyDown={(e) => e.key === 'Enter' && select(e)} {...drag(h, step.id)} role="button" tabIndex={0} aria-label={`${def.label} step`} title={def.summary}>
        <Status sev={sev} />
        <div className="ico">{def.icon}</div>
        <b>{def.label}</b>
        <small>{subtitle(step) || ' '}</small>
      </div>
    );
  }
  const head = (
    <div className="box-head" onClick={select} {...drag(h, step.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && select(e)} aria-label={`${def.label} block`}>
      <span className="ico">{def.icon}</span>
      <b>{def.label}</b>
      <small>{subtitle(step)}</small>
      <Status sev={sev} />
      <Collapse h={h} id={step.id} count={countSteps(step)} />
    </div>
  );
  if (h.collapsed?.has(step.id)) {
    return <div className={`box collapsed ${def.container === 'choice' ? 'choice' : def.container === 'doTry' || def.container === 'circuitBreaker' ? 'dotry' : ''} ${sel ? 'selected' : ''}`}>{head}</div>;
  }
  if (def.container === 'circuitBreaker') {
    const hasFallback = (step.branches ?? []).some((b) => b.kind === 'onFallback');
    return (
      <div className={`box dotry ${sel ? 'selected' : ''}`}>
        {head}
        <div className="branches">
          <div className="branch">
            <span className="branch-label" onClick={select}>
              protected
            </span>
            <StepList h={h} containerId={step.id} steps={step.steps ?? []} />
          </div>
          {(step.branches ?? []).map((b) => (
            <BranchRow key={b.id} h={h} branch={b} />
          ))}
        </div>
        {!h.readOnly && !hasFallback && (
          <div className="box-actions">
            <button className="tinybtn" onClick={() => h.onAddBranch(step.id, 'onFallback')}>
              + onFallback
            </button>
          </div>
        )}
      </div>
    );
  }
  if (def.container === 'choice') {
    const hasOtherwise = (step.branches ?? []).some((b) => b.kind === 'otherwise');
    return (
      <div className={`box choice ${sel ? 'selected' : ''}`}>
        {head}
        <div className="branches">
          {(step.branches ?? []).map((b) => (
            <BranchRow key={b.id} h={h} branch={b} />
          ))}
        </div>
        {!h.readOnly && (
          <div className="box-actions">
            <button className="tinybtn" onClick={() => h.onAddBranch(step.id, 'when')}>
              + when
            </button>
            {!hasOtherwise && (
              <button className="tinybtn" onClick={() => h.onAddBranch(step.id, 'otherwise')}>
                + otherwise
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  if (def.container === 'doTry') {
    const hasFinally = (step.branches ?? []).some((b) => b.kind === 'doFinally');
    return (
      <div className={`box dotry ${sel ? 'selected' : ''}`}>
        {head}
        <div className="branches">
          <div className="branch">
            <span className="branch-label" onClick={select}>
              try
            </span>
            <StepList h={h} containerId={step.id} steps={step.steps ?? []} />
          </div>
          {(step.branches ?? []).map((b) => (
            <BranchRow key={b.id} h={h} branch={b} />
          ))}
        </div>
        {!h.readOnly && (
          <div className="box-actions">
            <button className="tinybtn" onClick={() => h.onAddBranch(step.id, 'doCatch')}>
              + doCatch
            </button>
            {!hasFinally && (
              <button className="tinybtn" onClick={() => h.onAddBranch(step.id, 'doFinally')}>
                + doFinally
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`box ${sel ? 'selected' : ''}`}>
      {head}
      <StepList h={h} containerId={step.id} steps={step.steps ?? []} />
    </div>
  );
}

function BranchRow({ h, branch }: { h: CanvasHandlers; branch: Branch }) {
  const sel = h.selected === branch.id;
  const label =
    branch.kind === 'when' ? `when ${branch.expression?.expression ?? ''}` :
    branch.kind === 'otherwise' ? 'otherwise' :
    branch.kind === 'doCatch' ? `catch ${(branch.exceptions ?? []).map((e) => e.split('.').pop()).join(', ')}` :
    branch.kind === 'onFallback' ? 'fallback' :
    'finally';
  const cls = branch.kind === 'doCatch' ? 'catch' : branch.kind === 'doFinally' || branch.kind === 'onFallback' ? 'finally' : '';
  return (
    <div className="branch">
      <span
        className={`branch-label ${cls} ${sel ? 'selected' : ''}`}
        role="button"
        tabIndex={0}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          h.onSelect(branch.id);
        }}
        onKeyDown={(e) => e.key === 'Enter' && h.onSelect(branch.id)}
      >
        {label}
        {h.status[branch.id] === 'error' ? ' !' : ''}
      </span>
      <StepList h={h} containerId={branch.id} steps={branch.steps} />
    </div>
  );
}

function RestLane({ h, rest }: { h: CanvasHandlers; rest: RestDef }) {
  const sel = h.selected === rest.id;
  const pick = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    h.onSelect(rest.id);
  };
  return (
    <section className="lane" aria-label={`REST ${rest.path}`}>
      <button className={`lane-head ${sel ? 'selected' : ''}`} onClick={pick}>
        <span className="badge rest">rest</span>
        <b>{rest.path}</b>
        {rest.description && <span>{rest.description}</span>}
        <Status sev={h.status[rest.id]} />
      </button>
      <div className={`rest-ops ${sel ? 'selected' : ''}`} onClick={pick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && pick(e)}>
        {rest.verbs.length === 0 && <span className="muted">No operations — select to add one</span>}
        {rest.verbs.map((v) => (
          <div key={v.id} className="rest-op">
            <span className={`verb verb-${v.method}`}>{v.method.toUpperCase()}</span>
            <code>{joinPath(rest.path, v.path)}</code>
            <span className="muted">→</span>
            <code className="to">{v.to || '(no target)'}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function RouteLane({ h, route }: { h: CanvasHandlers; route: Route }) {
  const sel = h.selected === route.id;
  return (
    <section className="lane" aria-label={`Route ${route.routeId}`}>
      <button className={`lane-head ${sel ? 'selected' : ''}`} onClick={(e) => (e.stopPropagation(), h.onSelect(route.id))}>
        <span className="badge">route</span>
        <b>{route.routeId || '(no id)'}</b>
        {route.description && <span>{route.description}</span>}
      </button>
      <div className="flow">
        <div className={`node from ${sel ? 'selected' : ''}`} onClick={(e) => (e.stopPropagation(), h.onSelect(route.id))} role="button" tabIndex={0} aria-label="from endpoint">
          <Status sev={h.status[route.id]} />
          <div className="ico">⇢</div>
          <b>from</b>
          <small>{route.from.uri || '(no uri)'}</small>
        </div>
        <StepList h={h} containerId={route.id} steps={route.steps} />
      </div>
    </section>
  );
}

function ExceptionLane({ h, ex }: { h: CanvasHandlers; ex: OnException }) {
  const sel = h.selected === ex.id;
  return (
    <section className="lane" aria-label="Error handler">
      <button className={`lane-head ${sel ? 'selected' : ''}`} onClick={(e) => (e.stopPropagation(), h.onSelect(ex.id))}>
        <span className="badge ex">onException</span>
        <b>{ex.exceptions.map((e) => e.split('.').pop()).join(', ') || '(no exception)'}</b>
        <span>
          {ex.maximumRedeliveries ? `retry ×${ex.maximumRedeliveries}` : 'no retry'}
          {ex.redeliveryDelay ? ` · ${ex.redeliveryDelay} ms` : ''}
          {ex.handled ? ' · handled' : ''}
        </span>
      </button>
      <div className="flow">
        <div className={`node ${sel ? 'selected' : ''}`} style={{ borderColor: 'var(--red)' }} onClick={(e) => (e.stopPropagation(), h.onSelect(ex.id))} role="button" tabIndex={0}>
          <Status sev={h.status[ex.id]} />
          <div className="ico" style={{ color: 'var(--red)' }}>
            ⚑
          </div>
          <b>on error</b>
          <small>then</small>
        </div>
        <StepList h={h} containerId={ex.id} steps={ex.steps} />
      </div>
    </section>
  );
}

export function FlowCanvas({ file, h, zoom = 1 }: { file: CamelFile; h: CanvasHandlers; zoom?: number }) {
  return (
    <div className="canvas-inner" style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }} onClick={() => h.onSelect(undefined)}>
      {file.onExceptions.map((ex) => (
        <ExceptionLane key={ex.id} h={h} ex={ex} />
      ))}
      {(file.rests ?? []).map((r) => (
        <RestLane key={r.id} h={h} rest={r} />
      ))}
      {file.routes.map((r) => (
        <RouteLane key={r.id} h={h} route={r} />
      ))}
    </div>
  );
}
