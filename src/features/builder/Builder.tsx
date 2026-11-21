import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { plural, t } from '../../app/i18n';
import { useContextCommands, openPalette } from '../../app/commands';
import { href, navigate } from '../../app/router';
import { authStore } from '../../app/session';
import { appStore, projects, storage, toast, useStore, type Project } from '../../app/store';
import { addBranch, BEANS_ID, duplicateStep, findNode, insertStep, moveStep, removeNode, updateNode } from '../../core/edit';
import { newBranch, newStep } from '../../core/eip';
import { baseName, CONTRACT_LABEL, IMPORT_ACCEPT, importAny } from '../../core/importer';
import { isKnown, newBean, newOnException, newRest, newRoute, newRouteConfiguration, allOnExceptions, uid, type Branch, type CamelFile, type Container, type Step, type StepType } from '../../core/model';
import { parseStep, stepToYaml } from '../../core/yaml';
import { snippets } from '../../app/snippets';
import YAML from 'yaml';
import { validate, type Issue, type Severity } from '../../core/validate';
import { LangButton, ThemeButton } from '../../ui/Chrome';
import { EmptyState } from '../../ui/Modal';
import { FlowCanvas, type CanvasHandlers, type DropPayload } from './Canvas';
import { CodePanel, type CodeTab } from './CodePanel';
import { ExportDialog, ShareDialog, VersionsDialog } from './Dialogs';
import { Inspector } from './Inspector';
import { Palette, QuickAdd } from './Palette';
import { Minimap } from './Minimap';
import { RunPanel, type TraceView } from './RunPanel';
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
    <div className="validation" aria-label={t('Validation')}>
      <button className="validation-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <strong>{t('Route validation')}</strong>
        {errors === 0 ? (
          <span className="count c-ok">{t('✓ No errors')}</span>
        ) : (
          <span className="count c-err">
            ✕ {plural(errors, '{n} error', '{n} errors')}
          </span>
        )}
        <span className={`count ${warnings ? 'c-warn' : 'muted'}`}>
          ! {plural(warnings, '{n} warning', '{n} warnings')}
        </span>
        <span className="count c-info">
          i <b>{n('info')}</b>
        </span>
        <span className="chev">{open ? t('Hide ▾') : t('Details ▸')}</span>
      </button>
      {open && (
        <div className="issues">
          {!issues.length && <div className="issue c-ok">{t('✓ Everything looks good.')}</div>}
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
  const authStatus = useStore(authStore, (s) => s.status);
  useEffect(() => {
    if (project) projects.touch(project.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!project && authStatus === 'loading') {
    return (
      <div className="wrap page">
        <p className="muted">{t('Loading project…')}</p>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="wrap page">
        <EmptyState
          icon="?"
          title={t('Project not found')}
          text={t('It may have been deleted, belong to another account, or live in another browser. Sign in to see projects synced to your account.')}
          action={
            <a className="btn primary" href={href('/dashboard')}>
              {t('Back to projects')}
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
  const mode = useStore(appStore, (s) => s.mode);
  const pending = useStore(appStore, (s) => s.pending);
  const [selected, setSelected] = useState<string>();
  const [multi, setMulti] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const canvasRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<'props' | 'run' | CodeTab>('props');
  const [traceView, setTraceView] = useState<TraceView>();
  const [breakpoints, setBreakpoints] = useState<Set<string>>(() => new Set());
  const [quick, setQuick] = useState<{ containerId: string; index: number; anchor: DOMRect }>();
  const [dialog, setDialog] = useState<'export' | 'versions' | 'share'>();
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

  const select = useCallback(
    (id?: string, additive = false) => {
      if (tab === 'run' && !additive) {
        setMulti(new Set());
        setSelected(id);
        return;
      }
      if (additive && id && selected && findNode(file, id)?.kind === 'step' && findNode(file, selected)?.kind === 'step') {
        setMulti((m) => {
          const next = new Set(m.size ? m : [selected]);
          if (next.has(id) && next.size > 1) next.delete(id);
          else next.add(id);
          return next;
        });
        setSelected(id);
        setTab('props');
        return;
      }
      setMulti(new Set());
      setSelected(id);
      if (id) setTab('props');
    },
    [file, selected, tab],
  );

  const create = (p: DropPayload): Step | undefined => {
    if (p.kind === 'eip') return newStep(p.type as StepType);
    if (p.kind === 'component') return newStep('to', p.uri);
    if (p.kind === 'snippet') {
      const sn = snippets.get(p.id);
      return sn ? reid(structuredClone(sn.step)) : undefined;
    }
    return undefined;
  };

  /** Where pasted/added steps go: after the selected step, or at the end of the selected container. */
  const insertionPoint = (f: CamelFile): { file: CamelFile; id: string; index: number } => {
    const n = selected ? findNode(f, selected) : undefined;
    if (n) {
      if (n.kind === 'route' || n.kind === 'onException' || n.kind === 'branch') return { file: f, id: n.node.id, index: n.node.steps.length };
      if (n.kind === 'step') {
        if (isKnown(n.node) && n.node.steps && !n.node.branches?.length) return { file: f, id: n.node.id, index: n.node.steps.length };
        return { file: f, id: n.parent.id, index: n.parent.steps.findIndex((x) => x.id === n.node.id) + 1 };
      }
    }
    if (f.routes.length) {
      const r = f.routes[f.routes.length - 1];
      return { file: f, id: r.id, index: r.steps.length };
    }
    const r = newRoute('route-1');
    return { file: { ...f, routes: [r] }, id: r.id, index: 0 };
  };

  /** Selected steps in document order (for copy / delete). */
  const selectedSteps = (): Step[] => {
    const ids = multi.size ? multi : selected ? new Set([selected]) : new Set<string>();
    const out: Step[] = [];
    const visit = (list: Step[]) => {
      for (const st of list) {
        if (ids.has(st.id)) {
          out.push(st);
          continue;
        }
        if (isKnown(st)) {
          visit(st.steps ?? []);
          for (const b of st.branches ?? []) visit(b.steps);
        }
      }
    };
    [...file.routes, ...allOnExceptions(file)].forEach((c: Container) => visit(c.steps));
    return out;
  };

  const handlers: CanvasHandlers = {
    selected,
    multi,
    collapsed,
    onToggleCollapse: (id) =>
      setCollapsed((c) => {
        const n = new Set(c);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    status,
    trace: traceView || breakpoints.size ? { visited: traceView?.visited ?? new Set(), current: traceView?.current, uncovered: traceView?.uncovered, breakpoints } : undefined,
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
    const st = create(p);
    if (!st) return;
    const t = insertionPoint(file);
    commit(insertStep(t.file, t.id, t.index, st));
    select(st.id);
  };

  const copySelection = (cut = false) => {
    const list = selectedSteps();
    if (!list.length) return false;
    clipboard.current = list.map((x) => structuredClone(x));
    const text = YAML.stringify(list.map(stepToYaml), { lineWidth: 0 });
    navigator.clipboard?.writeText(text).catch(() => undefined);
    if (cut) {
      let f = file;
      for (const x of list) f = removeNode(f, x.id);
      commit(f);
      setSelected(undefined);
      setMulti(new Set());
    }
    toast(`${cut ? 'Cut' : 'Copied'} ${list.length} step${list.length > 1 ? 's' : ''}`, 'success');
    return true;
  };

  const pasteSteps = (stepsToPaste: Step[]) => {
    if (!stepsToPaste.length) return;
    const t = insertionPoint(file);
    let f = t.file;
    stepsToPaste.forEach((st, i) => (f = insertStep(f, t.id, t.index + i, reid(st))));
    commit(f);
    toast(`Pasted ${stepsToPaste.length} step${stepsToPaste.length > 1 ? 's' : ''}`, 'success');
  };

  const addBeans = () => {
    commit({ ...file, beans: [...(file.beans ?? []), newBean()] });
    select(BEANS_ID);
  };
  const addRouteConfig = () => {
    const n = (file.routeConfigurations ?? []).length;
    const c = newRouteConfiguration(n ? `errorHandling${n + 1}` : 'errorHandling');
    const ex = newOnException();
    c.onExceptions.push(ex);
    commit({ ...file, routeConfigurations: [...(file.routeConfigurations ?? []), c] });
    select(c.id);
  };
  const addConfigHandler = (configId: string) => {
    const ex = newOnException();
    commit(updateNode(file, configId, (n) => (n as { onExceptions: typeof ex[] }).onExceptions.push(ex)));
    select(ex.id);
  };

  const addRest = () => {
    const r = newRest();
    const target = r.verbs[0].to;
    const routes = file.routes.some((x) => x.from.uri === target) ? file.routes : [...file.routes, newRoute('hello', target)];
    commit({ ...file, rests: [...(file.rests ?? []), r], routes });
    select(r.id);
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
  const clipboard = useRef<Step[]>([]);
  const remove = (id: string) => {
    if (multi.size > 1) {
      let f = file;
      for (const x of multi) f = removeNode(f, x);
      commit(f);
      setMulti(new Set());
    } else commit(removeNode(file, id));
    setSelected(undefined);
  };
  const saveSnippet = (id: string) => {
    const n = findNode(file, id);
    if (n?.kind !== 'step') return;
    const sn = snippets.add(n.node);
    toast(`Saved “${sn.name}” to My snippets`, 'success');
  };
  /** Move selection to the previous/next sibling step. */
  const moveSelection = (dir: -1 | 1) => {
    const n = selected ? findNode(file, selected) : undefined;
    if (n?.kind !== 'step') return;
    const i = n.parent.steps.findIndex((x) => x.id === n.node.id);
    const next = n.parent.steps[i + dir];
    if (next) select(next.id);
  };
  const duplicate = (id: string) => {
    const before = findNode(file, id);
    if (before?.kind !== 'step') return;
    commit(duplicateStep(file, id, reid));
  };
  const importFile = async () => {
    const picked = await pickTextFile(IMPORT_ACCEPT);
    if (!picked) return;
    try {
      const { file: imported, contract } = importAny(picked.name, picked.text);
      const extras = [...(file.extras ?? []), ...(imported.extras ?? [])];
      commit({
        ...file,
        routes: [...file.routes, ...imported.routes],
        onExceptions: [...file.onExceptions, ...imported.onExceptions],
        rests: [...(file.rests ?? []), ...(imported.rests ?? [])],
        ...(extras.length ? { extras } : {}),
      });
      toast(contract ? `Generated ${imported.routes.length} route(s) from the ${CONTRACT_LABEL[contract]} contract` : `Imported ${imported.routes.length} route(s) from ${picked.name}`, 'success');
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
  const keyState = useRef({ selected, remove, duplicate, undo, redo, saveVersion, copySelection, pasteSteps, moveSelection });
  keyState.current = { selected, remove, duplicate, undo, redo, saveVersion, copySelection, pasteSteps, moveSelection };
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
      } else if (mod && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
        if (window.getSelection()?.toString()) return;
        if (k.copySelection(e.key.toLowerCase() === 'x')) e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (k.selected) {
          e.preventDefault();
          k.moveSelection(e.key === 'ArrowLeft' ? -1 : 1);
        }
      } else if (e.key === 'Escape') {
        setSelected(undefined);
        setMulti(new Set());
      }
    };
    /** Paste steps copied in the builder, or Camel YAML steps / routes from the clipboard. */
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      let list: Step[] = [];
      try {
        const doc = YAML.parse(text);
        if (Array.isArray(doc) && doc.length && doc.every((x) => x && typeof x === 'object' && Object.keys(x).length === 1 && !['route', 'from', 'rest', 'onException'].includes(Object.keys(x)[0]))) {
          list = doc.map((x) => parseStep(x));
        }
      } catch {
        /* not YAML */
      }
      if (!list.length && clipboard.current.length) list = clipboard.current;
      if (!list.length) return;
      e.preventDefault();
      keyState.current.pasteSteps(list);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  // pan the canvas by dragging the background
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let start: { x: number; y: number; left: number; top: number } | undefined;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (e.button !== 0 || t.closest('.node, .box-head, .branch-label, button, .lane-head, .rest-ops, input, a, .drop')) return;
      start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.classList.add('panning');
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      el.scrollLeft = start.left - (e.clientX - start.x);
      el.scrollTop = start.top - (e.clientY - start.y);
    };
    const up = () => {
      start = undefined;
      el.classList.remove('panning');
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  useContextCommands(
    [
      { id: 'b-route', title: 'Add route', group: 'Builder', run: addRoute },
      { id: 'b-ex', title: 'Add error handler (onException)', group: 'Builder', run: addErrorHandler },
      { id: 'b-rest', title: 'Add REST API (REST DSL)', group: 'Builder', run: addRest },
      { id: 'b-collapse', title: 'Collapse all blocks', group: 'Builder', run: () => {
        const ids = new Set<string>();
        const visit = (list: Step[]) => list.forEach((x) => { if (isKnown(x) && (x.steps || x.branches)) { ids.add(x.id); visit(x.steps ?? []); (x.branches ?? []).forEach((b) => visit(b.steps)); } });
        [...file.routes, ...file.onExceptions].forEach((c) => visit(c.steps));
        setCollapsed(ids);
      } },
      { id: 'b-expand', title: 'Expand all blocks', group: 'Builder', run: () => setCollapsed(new Set()) },
      { id: 'b-import', title: 'Import routes or API contract (YAML, XML, OpenAPI, AsyncAPI, WSDL)…', group: 'Builder', run: importFile },
      { id: 'b-export', title: 'Export project…', group: 'Builder', run: () => setDialog('export') },
      { id: 'b-version', title: 'Save version', group: 'Builder', shortcut: 'Ctrl S', run: saveVersion },
      { id: 'b-history', title: 'Version history…', group: 'Builder', run: () => setDialog('versions') },
      { id: 'b-undo', title: 'Undo', group: 'Builder', shortcut: 'Ctrl Z', run: undo },
      { id: 'b-redo', title: 'Redo', group: 'Builder', shortcut: 'Ctrl Shift Z', run: redo },
      { id: 'b-yaml', title: 'Show YAML', group: 'Builder', run: () => setTab('yaml') },
      { id: 'b-xml', title: 'Show XML', group: 'Builder', run: () => setTab('xml') },
      { id: 'b-java', title: 'Show Java DSL', group: 'Builder', run: () => setTab('java') },
      { id: 'b-docs', title: 'Show documentation', group: 'Builder', run: () => setTab('docs') },
      { id: 'b-run', title: 'Run & Debug', group: 'Builder', run: () => setTab('run') },
      { id: 'b-left', title: 'Toggle components panel', group: 'Builder', run: () => setLayout((l) => ({ ...l, showLeft: !l.showLeft })) },
      { id: 'b-right', title: 'Toggle editor panel', group: 'Builder', run: () => setLayout((l) => ({ ...l, showRight: !l.showRight })) },
    ],
    [file, selected, project],
  );

  const cols = [layout.showLeft ? `${layout.left}px 5px` : '', 'minmax(320px, 1fr)', layout.showRight ? `5px ${layout.right}px` : ''].filter(Boolean).join(' ');
  const empty = !file.routes.length && !file.onExceptions.length && !(file.rests ?? []).length && !(file.beans ?? []).length && !(file.routeConfigurations ?? []).length;

  return (
    <div className="studio">
      <header className="studio-bar">
        <a className="brandmark" href={href('/')} aria-label={t('Home')}>
          🐪
        </a>
        <nav className="crumb" aria-label={t('Breadcrumb')}>
          <a href={href('/dashboard')}>{t('Projects')}</a>
          <span>/</span>
          <input
            value={project.name}
            onChange={(e) => projects.update(project.id, { name: e.target.value })}
            onBlur={(e) => !e.target.value.trim() && projects.update(project.id, { name: 'Untitled project' })}
            aria-label={t('Project name')}
            maxLength={80}
          />
        </nav>
        <span
          className={`save-state hide-sm ${saveFailed ? 'err' : pending ? 'busy' : ''}`}
          title={mode === 'remote' ? 'Synced to your account' : saveFailed ? 'Browser storage is full or blocked' : 'Saved in this browser'}
          role="status"
        >
          <i /> {t(saveFailed ? 'Not saved' : pending ? 'Saving…' : mode === 'remote' ? 'Saved to cloud' : 'Saved in browser')}
        </span>
        <div className="bar-actions">
          <button className="tinybtn" onClick={undo} disabled={!canUndo} title={t('Undo (Ctrl Z)')} aria-label={t('Undo')}>
            ↶
          </button>
          <button className="tinybtn" onClick={redo} disabled={!canRedo} title={t('Redo (Ctrl Shift Z)')} aria-label={t('Redo')}>
            ↷
          </button>
          <span className="sep" />
          <button className="tinybtn hide-sm" onClick={importFile}>
            {t('↑ Import')}
          </button>
          <button className="tinybtn hide-sm" onClick={() => setDialog('versions')}>
            ⟲ {t('Versions')} {project.versions.length ? `(${project.versions.length})` : ''}
          </button>
          {mode === 'remote' && (
            <button className="tinybtn hide-sm" onClick={() => setDialog('share')}>
              ⌁ {t('Share')}{project.shareToken ? ' · ✓' : ''}
            </button>
          )}
          <button className="tinybtn accent" onClick={() => setDialog('export')}>
            {t('↓ Export')}
          </button>
          <span className="sep" />
          <button className="tinybtn hide-sm" onClick={openPalette} title={t('Command palette')}>
            ⌘K
          </button>
          <LangButton />
          <ThemeButton />
        </div>
      </header>

      <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="mobile-note">{t('The builder is designed for desktop screens. On mobile you can review routes and code.')}</div>
        <div className="studio-main" style={{ gridTemplateColumns: cols, flex: 1 }}>
          {layout.showLeft && (
            <>
              <Palette onAdd={addFromPalette} onAddErrorHandler={addErrorHandler} onAddRoute={addRoute} onAddRest={addRest} onAddBeans={addBeans} onAddRouteConfig={addRouteConfig} />
              <Resizer onDrag={(dx) => setLayout((l) => ({ ...l, left: Math.min(420, Math.max(180, l.left + dx)) }))} />
            </>
          )}
          <div className="canvas-wrap">
          <main className="canvas" aria-label={t('Route canvas')} ref={canvasRef}>
            <div className="canvas-head">
              <span>{t('CANVAS')} · {plural(file.routes.length, '{n} route', '{n} routes')}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {!layout.showLeft && (
                  <button className="tinybtn" onClick={() => setLayout((l) => ({ ...l, showLeft: true }))}>
                    {t('☰ Components')}
                  </button>
                )}
                <span className="canvas-zoom" role="group" aria-label={t('Zoom')}>
                  <button className="tinybtn" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label={t('Zoom out')}>
                    −
                  </button>
                  <button className="tinybtn" onClick={() => setZoom(1)} aria-label={t('Reset zoom')} title={t('Reset zoom')}>
                    {Math.round(zoom * 100)}%
                  </button>
                  <button className="tinybtn" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))} aria-label={t('Zoom in')}>
                    ＋
                  </button>
                </span>
                <button className="tinybtn" onClick={addRoute}>
                  {t('+ Route')}
                </button>
                {!layout.showRight && (
                  <button className="tinybtn" onClick={() => setLayout((l) => ({ ...l, showRight: true }))}>
                    {t('Editor ▸')}
                  </button>
                )}
              </span>
            </div>
            {empty ? (
              <div className="canvas-empty">
                <EmptyState
                  icon="⇢"
                  title={t('Start your first route')}
                  text={t('A route reads from one endpoint and runs steps for each message. Create one, import an existing YAML/XML file, or start from a recipe.')}
                  action={
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="btn primary" onClick={addRoute}>
                        {t('+ New route')}
                      </button>
                      <button className="btn" onClick={importFile}>
                        {t('↑ Import file')}
                      </button>
                      <button className="btn ghost" onClick={() => navigate('/kb')}>
                        {t('Browse recipes')}
                      </button>
                    </div>
                  }
                />
              </div>
            ) : (
              <FlowCanvas file={file} h={handlers} zoom={zoom} />
            )}
          </main>
          {!empty && <Minimap canvas={canvasRef} version={`${zoom}:${collapsed.size}:${JSON.stringify(file).length}`} />}
          </div>
          {layout.showRight && (
            <>
              <Resizer onDrag={(dx) => setLayout((l) => ({ ...l, right: Math.min(760, Math.max(300, l.right - dx)) }))} />
              <aside className="side right" aria-label={t('Editor')}>
                <div className="tabs" role="tablist">
                  {(
                    [
                      ['props', 'Properties'],
                      ['run', '▶ Run'],
                      ['yaml', 'route.yaml'],
                      ['xml', 'route.xml'],
                      ['java', 'route.java'],
                      ['docs', 'Docs'],
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                      {t(label)}
                    </button>
                  ))}
                  <button style={{ marginLeft: 'auto' }} onClick={() => setLayout((l) => ({ ...l, showRight: false }))} aria-label={t('Hide editor panel')} title={t('Hide panel')}>
                    ⇥
                  </button>
                </div>
                {tab === 'run' ? (
                  <RunPanel
                    file={file}
                    projectId={project.id}
                    projectName={project.name}
                    selected={selected}
                    breakpoints={breakpoints}
                    onToggleBreakpoint={(id) =>
                      setBreakpoints((b) => {
                        const n = new Set(b);
                        if (n.has(id)) n.delete(id);
                        else n.add(id);
                        return n;
                      })
                    }
                    onTrace={setTraceView}
                    onSelect={(id) => setSelected(id)}
                  />
                ) : tab === 'props' ? (
                  <Inspector node={node} issues={issues} mutate={(nid, fn) => commit(updateNode(file, nid, fn), nid)} onDelete={remove} onDuplicate={duplicate} onSaveSnippet={saveSnippet} multiCount={multi.size} beans={file.beans ?? []} onBeansChange={(beans) => commit(beans.length ? { ...file, beans } : (({ beans: _b, ...rest }) => rest)(file), BEANS_ID)} configIds={(file.routeConfigurations ?? []).map((c) => c.configId)} onAddConfigHandler={addConfigHandler} />
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
      {dialog === 'share' && <ShareDialog project={project} onClose={() => setDialog(undefined)} />}
      {dialog === 'versions' && <VersionsDialog project={project} current={file} onRestore={(f) => commit(f)} onClose={() => setDialog(undefined)} />}
    </div>
  );
}
