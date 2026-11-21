import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useContextCommands, openPalette } from '../../app/commands';
import { href, navigate } from '../../app/router';
import { appStore, projects, storage, toast, useStore, type Project } from '../../app/store';
import { addBranch, duplicateStep, findNode, insertStep, moveStep, removeNode, updateNode } from '../../core/edit';
import { newBranch, newStep } from '../../core/eip';
import { baseName, importText } from '../../core/importer';
import { isKnown, newOnException, newRoute, uid, type Branch, type CamelFile, type Step, type StepType } from '../../core/model';
import { validate, type Issue, type Severity } from '../../core/validate';
import { ThemeButton } from '../../ui/Chrome';
import { EmptyState } from '../../ui/Modal';
import { FlowCanvas, type CanvasHandlers, type DropPayload } from './Canvas';
import { CodePanel, type CodeTab } from './CodePanel';
import { ExportDialog, VersionsDialog } from './Dialogs';
import { Inspector } from './Inspector';
import { Palette, QuickAdd } from './Palette';
import { pickTextFile } from './download';

// ---------------------------------------------------------------- history

interface History {
  past: CamelFile[];
  present: CamelFile;
  future: CamelFile[];
}
const HISTORY_LIMIT = 100;

function useHistory(initial: CamelFile) {
  const [h, setH] = useState<History>({ past: [], present: initial, future: [] });
  const last = useRef<{ key?: string; at: number }>({ at: 0 });
  const commit = useCallback((next: CamelFile, coalesceKey?: string) => {
    setH((cur) => {
      if (next === cur.present) return cur;
      const now = Date.now();
      const coalesce = coalesceKey && last.current.key === coalesceKey && now - last.current.at < 1000;
      last.current = { key: coalesceKey, at: now };
      return { past: coalesce ? cur.past : [...cur.past, cur.present].slice(-HISTORY_LIMIT), present: next, future: [] };
    });
  }, []);
  const undo = useCallback(() => setH((c) => (c.past.length ? { past: c.past.slice(0, -1), present: c.past[c.past.length - 1], future: [c.present, ...c.future] } : c)), []);
  const redo = useCallback(() => setH((c) => (c.future.length ? { past: [...c.past, c.present], present: c.future[0], future: c.future.slice(1) } : c)), []);
  return { file: h.present, canUndo: h.past.length > 0, canRedo: h.future.length > 0, commit, undo, redo };
}

function reid(s: Step): Step {
  const copy: Step = { ...s, id: uid('s') };
  if (isKnown(copy)) {
    if (copy.steps) copy.steps = copy.steps.map(reid);
    if (copy.branches) copy.branches = copy.branches.map((b) => ({ ...b, id: uid('b'), steps: b.steps.map(reid) }));
  }
  return copy;
}

const rank: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

// ---------------------------------------------------------------- layout

interface Layout {
  left: number;
  right: number;
  showLeft: boolean;
  showRight: boolean;
}
const DEFAULT_LAYOUT: Layout = { left: 236, right: 390, showLeft: true, showRight: true };

function Resizer({ onDrag }: { onDrag(dx: number): void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`resizer ${dragging ? 'dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        const startX = e.clientX;
        let lastX = startX;
        setDragging(true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          onDrag(ev.clientX - lastX);
          lastX = ev.clientX;
        };
        const up = () => {
          setDragging(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}

// ---------------------------------------------------------------- validation bar

function ValidationBar({ issues, onPick }: { issues: Issue[]; onPick(id?: string): void }) {
  const [open, setOpen] = useState(false);
  const n = (s: Severity) => issues.filter((i) => i.severity === s).length;
  const errors = n('error');
  const warnings = n('warning');
  return (
    <div className="validation" aria-label="Validation">
      <button className="validation-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <strong>Route validation</strong>
        {errors === 0 ? (
          <span className="count c-ok">✓ No errors</span>
        ) : (
          <span className="count c-err">
            ✕ <b>{errors}</b> error{errors > 1 ? 's' : ''}
          </span>
        )}
        <span className={`count ${warnings ? 'c-warn' : 'muted'}`}>
          ! <b>{warnings}</b> warning{warnings === 1 ? '' : 's'}
        </span>
        <span className="count c-info">
          i <b>{n('info')}</b>
        </span>
        <span className="chev">{open ? 'Hide ▾' : 'Details ▸'}</span>
      </button>
      {open && (
        <div className="issues">
          {!issues.length && <div className="issue c-ok">✓ Everything looks good.</div>}
          {[...issues]
            .sort((a, b) => rank[b.severity] - rank[a.severity])
            .map((i, k) => (
              <button key={k} className="issue" onClick={() => onPick(i.target)}>
                <span className={i.severity === 'error' ? 'c-err' : i.severity === 'warning' ? 'c-warn' : 'c-info'}>{i.severity === 'error' ? '✕' : i.severity === 'warning' ? '!' : 'i'}</span>
                <span>{i.message}</span>
                <span className="rule">{i.rule}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- studio

export function Builder({ id }: { id: string }) {
  const project = useStore(appStore, (s) => s.projects.find((p) => p.id === id));
  useEffect(() => {
    if (project) projects.touch(project.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!project) {
    return (
      <div className="wrap page">
        <EmptyState
          icon="?"
          title="Project not found"
          text="It may have been deleted, or it was created in another browser. Projects are stored locally until accounts are available."
          action={
            <a className="btn primary" href={href('/dashboard')}>
              Back to projects
            </a>
          }
        />
      </div>
    );
  }
  return <Studio key={project.id} project={project} />;
}

function Studio({ project }: { project: Project }) {
  const { file, commit, undo, redo, canUndo, canRedo } = useHistory(project.file);
  const saveFailed = useStore(appStore, (s) => s.saveFailed);
  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState<'props' | CodeTab>('props');
  const [quick, setQuick] = useState<{ containerId: string; index: number; anchor: DOMRect }>();
  const [dialog, setDialog] = useState<'export' | 'versions'>();
  const [zoom, setZoom] = useState(1);
  const [layout, setLayoutState] = useState<Layout>(() => ({ ...DEFAULT_LAYOUT, ...storage.read<Partial<Layout>>('cas.layout', {}) }));
  const setLayout = (fn: (l: Layout) => Layout) =>
    setLayoutState((l) => {
      const next = fn(l);
      storage.write('cas.layout', next);
      return next;
    });

  // persist every change
  useEffect(() => {
    if (file !== project.file) projects.update(project.id, { file });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  useEffect(() => {
    document.title = `${project.name} · Builder`;
  }, [project.name]);

  const issues = useMemo(() => validate(file), [file]);
  const status = useMemo(() => {
    const m: Record<string, Severity> = {};
    for (const i of issues) if (i.target && (!m[i.target] || rank[i.severity] > rank[m[i.target]])) m[i.target] = i.severity;
    return m;
  }, [issues]);
  const node = selected ? findNode(file, selected) : undefined;

  const select = useCallback((id?: string) => {
    setSelected(id);
    if (id) setTab('props');
  }, []);

  const create = (p: DropPayload): Step | undefined => {
    if (p.kind === 'eip') return newStep(p.type as StepType);
    if (p.kind === 'component') return newStep('to', p.uri);
    return undefined;
  };

  const handlers: CanvasHandlers = {
    selected,
    status,
    onSelect: select,
    onDrop(containerId, index, payload) {
      if (payload.kind === 'move') {
        commit(moveStep(file, payload.id, containerId, index));
        return;
      }
      const s = create(payload);
      if (!s) return;
      commit(insertStep(file, containerId, index, s));
      select(s.id);
    },
    onQuickAdd: (containerId, index, anchor) => setQuick({ containerId, index, anchor }),
    onAddBranch(stepId, kind: Branch['kind']) {
      const b = newBranch(kind);
      commit(addBranch(file, stepId, b));
      select(b.id);
    },
  };

  /** Append from the palette next to / inside the current selection. */
  const addFromPalette = (p: DropPayload) => {
    const s = create(p);
    if (!s) return;
    let f = file;
    let target: { id: string; index: number } | undefined;
    if (node) {
      if (node.kind === 'route' || node.kind === 'onException' || node.kind === 'branch') target = { id: node.node.id, index: node.node.steps.length };
      else if (isKnown(node.node) && node.node.steps && !node.node.branches?.length) target = { id: node.node.id, index: node.node.steps.length };
      else target = { id: node.parent.id, index: node.parent.steps.findIndex((x) => x.id === node.node.id) + 1 };
    } else if (f.routes.length) {
      const r = f.routes[f.routes.length - 1];
      target = { id: r.id, index: r.steps.length };
    } else {
      const r = newRoute('route-1');
      f = { ...f, routes: [r] };
      target = { id: r.id, index: 0 };
    }
    commit(insertStep(f, target.id, target.index, s));
    select(s.id);
  };

  const addRoute = () => {
    const n = file.routes.length + 1;
    const r = newRoute(`route-${n}`, `direct:route-${n}`);
    commit({ ...file, routes: [...file.routes, r] });
    select(r.id);
  };
  const addErrorHandler = () => {
    const ex = newOnException();
    ex.steps.push(newStep('log'));
    const step = ex.steps[0];
    if (isKnown(step)) {
      step.props.message = 'Failed: ${exception.message}';
      step.props.loggingLevel = 'ERROR';
    }
    commit({ ...file, onExceptions: [...file.onExceptions, ex] });
    select(ex.id);
  };
  const remove = (id: string) => {
    commit(removeNode(file, id));
    setSelected(undefined);
  };
  const duplicate = (id: string) => {
    const before = findNode(file, id);
    if (before?.kind !== 'step') return;
    commit(duplicateStep(file, id, reid));
  };
  const importFile = async () => {
    const picked = await pickTextFile('.yaml,.yml,.xml');
    if (!picked) return;
    try {
      const imported = importText(picked.name, picked.text);
      commit({ ...file, routes: [...file.routes, ...imported.routes], onExceptions: [...file.onExceptions, ...imported.onExceptions], extras: [...(file.extras ?? []), ...(imported.extras ?? [])] });
      toast(`Imported ${imported.routes.length} route(s) from ${picked.name}`, 'success');
      if (!project.name || project.name === 'New integration') projects.update(project.id, { name: baseName(picked.name) });
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, 'error');
    }
  };
  const saveVersion = () => {
    projects.saveVersion(project.id, `Snapshot ${new Date().toLocaleTimeString()}`);
    toast('Version saved', 'success');
  };

  // keyboard shortcuts
  const keyState = useRef({ selected, remove, duplicate, undo, redo, saveVersion });
  keyState.current = { selected, remove, duplicate, undo, redo, saveVersion };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest('input, textarea, select, [contenteditable]');
      const k = keyState.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        k.saveVersion();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) k.redo();
        else k.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        k.redo();
      } else if (mod && e.key.toLowerCase() === 'd' && k.selected) {
        e.preventDefault();
        k.duplicate(k.selected);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && k.selected) {
        e.preventDefault();
        k.remove(k.selected);
      } else if (e.key === 'Escape') setSelected(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useContextCommands(
    [
      { id: 'b-route', title: 'Add route', group: 'Builder', run: addRoute },
      { id: 'b-ex', title: 'Add error handler (onException)', group: 'Builder', run: addErrorHandler },
      { id: 'b-import', title: 'Import YAML / XML file…', group: 'Builder', run: importFile },
      { id: 'b-export', title: 'Export project…', group: 'Builder', run: () => setDialog('export') },
      { id: 'b-version', title: 'Save version', group: 'Builder', shortcut: 'Ctrl S', run: saveVersion },
      { id: 'b-history', title: 'Version history…', group: 'Builder', run: () => setDialog('versions') },
      { id: 'b-undo', title: 'Undo', group: 'Builder', shortcut: 'Ctrl Z', run: undo },
      { id: 'b-redo', title: 'Redo', group: 'Builder', shortcut: 'Ctrl Shift Z', run: redo },
      { id: 'b-yaml', title: 'Show YAML', group: 'Builder', run: () => setTab('yaml') },
      { id: 'b-xml', title: 'Show XML', group: 'Builder', run: () => setTab('xml') },
      { id: 'b-java', title: 'Show Java DSL', group: 'Builder', run: () => setTab('java') },
      { id: 'b-docs', title: 'Show documentation', group: 'Builder', run: () => setTab('docs') },
      { id: 'b-left', title: 'Toggle components panel', group: 'Builder', run: () => setLayout((l) => ({ ...l, showLeft: !l.showLeft })) },
      { id: 'b-right', title: 'Toggle editor panel', group: 'Builder', run: () => setLayout((l) => ({ ...l, showRight: !l.showRight })) },
    ],
    [file, selected, project],
  );

  const cols = [layout.showLeft ? `${layout.left}px 5px` : '', 'minmax(320px, 1fr)', layout.showRight ? `5px ${layout.right}px` : ''].filter(Boolean).join(' ');
  const empty = !file.routes.length && !file.onExceptions.length;

  return (
    <div className="studio">
      <header className="studio-bar">
        <a className="brandmark" href={href('/')} aria-label="Home">
          🐪
        </a>
        <nav className="crumb" aria-label="Breadcrumb">
          <a href={href('/dashboard')}>Projects</a>
          <span>/</span>
          <input
            value={project.name}
            onChange={(e) => projects.update(project.id, { name: e.target.value })}
            onBlur={(e) => !e.target.value.trim() && projects.update(project.id, { name: 'Untitled project' })}
            aria-label="Project name"
            maxLength={80}
          />
        </nav>
        <span className={`save-state hide-sm ${saveFailed ? 'err' : ''}`} title={saveFailed ? 'Browser storage is full or blocked' : 'Saved in this browser'}>
          <i /> {saveFailed ? 'Not saved' : 'Saved'}
        </span>
        <div className="bar-actions">
          <button className="tinybtn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl Z)" aria-label="Undo">
            ↶
          </button>
          <button className="tinybtn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl Shift Z)" aria-label="Redo">
            ↷
          </button>
          <span className="sep" />
          <button className="tinybtn hide-sm" onClick={importFile}>
            ↑ Import
          </button>
          <button className="tinybtn hide-sm" onClick={() => setDialog('versions')}>
            ⟲ Versions {project.versions.length ? `(${project.versions.length})` : ''}
          </button>
          <button className="tinybtn accent" onClick={() => setDialog('export')}>
            ↓ Export
          </button>
          <span className="sep" />
          <button className="tinybtn hide-sm" onClick={openPalette} title="Command palette">
            ⌘K
          </button>
          <ThemeButton />
        </div>
      </header>

      <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="mobile-note">The builder is designed for desktop screens. On mobile you can review routes and code.</div>
        <div className="studio-main" style={{ gridTemplateColumns: cols, flex: 1 }}>
          {layout.showLeft && (
            <>
              <Palette onAdd={addFromPalette} onAddErrorHandler={addErrorHandler} onAddRoute={addRoute} />
              <Resizer onDrag={(dx) => setLayout((l) => ({ ...l, left: Math.min(420, Math.max(180, l.left + dx)) }))} />
            </>
          )}
          <main className="canvas" aria-label="Route canvas">
            <div className="canvas-head">
              <span>CANVAS · {file.routes.length} route{file.routes.length === 1 ? '' : 's'}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {!layout.showLeft && (
                  <button className="tinybtn" onClick={() => setLayout((l) => ({ ...l, showLeft: true }))}>
                    ☰ Components
                  </button>
                )}
                <span className="canvas-zoom" role="group" aria-label="Zoom">
                  <button className="tinybtn" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">
                    −
                  </button>
                  <button className="tinybtn" onClick={() => setZoom(1)} aria-label="Reset zoom" title="Reset zoom">
                    {Math.round(zoom * 100)}%
                  </button>
                  <button className="tinybtn" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">
                    ＋
                  </button>
                </span>
                <button className="tinybtn" onClick={addRoute}>
                  + Route
                </button>
                {!layout.showRight && (
                  <button className="tinybtn" onClick={() => setLayout((l) => ({ ...l, showRight: true }))}>
                    Editor ▸
                  </button>
                )}
              </span>
            </div>
            {empty ? (
              <div className="canvas-empty">
                <EmptyState
                  icon="⇢"
                  title="Start your first route"
                  text="A route reads from one endpoint and runs steps for each message. Create one, import an existing YAML/XML file, or start from a recipe."
                  action={
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="btn primary" onClick={addRoute}>
                        + New route
                      </button>
                      <button className="btn" onClick={importFile}>
                        ↑ Import file
                      </button>
                      <button className="btn ghost" onClick={() => navigate('/kb')}>
                        Browse recipes
                      </button>
                    </div>
                  }
                />
              </div>
            ) : (
              <FlowCanvas file={file} h={handlers} zoom={zoom} />
            )}

          </main>
          {layout.showRight && (
            <>
              <Resizer onDrag={(dx) => setLayout((l) => ({ ...l, right: Math.min(760, Math.max(300, l.right - dx)) }))} />
              <aside className="side right" aria-label="Editor">
                <div className="tabs" role="tablist">
                  {(
                    [
                      ['props', 'Properties'],
                      ['yaml', 'route.yaml'],
                      ['xml', 'route.xml'],
                      ['java', 'route.java'],
                      ['docs', 'Docs'],
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                      {label}
                    </button>
                  ))}
                  <button style={{ marginLeft: 'auto' }} onClick={() => setLayout((l) => ({ ...l, showRight: false }))} aria-label="Hide editor panel" title="Hide panel">
                    ⇥
                  </button>
                </div>
                {tab === 'props' ? (
                  <Inspector node={node} issues={issues} mutate={(nid, fn) => commit(updateNode(file, nid, fn), nid)} onDelete={remove} onDuplicate={duplicate} />
                ) : (
                  <CodePanel tab={tab} file={file} onChange={(f) => commit(f, `code-${tab}`)} projectName={project.name} />
                )}
              </aside>
            </>
          )}
        </div>
      </div>

      <ValidationBar issues={issues} onPick={(id) => id && select(id)} />

      {quick && (
        <QuickAdd
          anchor={quick.anchor}
          onClose={() => setQuick(undefined)}
          onPick={(p) => {
            handlers.onDrop(quick.containerId, quick.index, p);
            setQuick(undefined);
          }}
        />
      )}
      {dialog === 'export' && <ExportDialog project={project} file={file} onClose={() => setDialog(undefined)} />}
      {dialog === 'versions' && <VersionsDialog project={project} onRestore={(f) => commit(f)} onClose={() => setDialog(undefined)} />}
    </div>
  );
}
