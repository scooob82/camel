import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { COMPONENTS, COMPONENT_CATEGORIES } from '../../core/catalog';
import { EIPS, EIP_CATEGORIES } from '../../core/eip';
import { DND_NEW, type DropPayload } from './Canvas';

interface Item {
  key: string;
  label: string;
  icon: string;
  hint: string;
  group: string;
  payload: DropPayload;
}

const ITEMS: Item[] = [
  ...EIPS.map((e) => ({ key: `eip:${e.type}`, label: e.label, icon: e.icon, hint: e.summary, group: e.category, payload: { kind: 'eip', type: e.type } as DropPayload })),
  ...COMPONENTS.filter((c) => c.producer).map((c) => ({ key: `c:${c.scheme}`, label: c.title, icon: '⇢', hint: `${c.description} (${c.scheme})`, group: `Components · ${c.category}`, payload: { kind: 'component', uri: c.example } as DropPayload })),
];

const GROUPS = [...EIP_CATEGORIES, ...COMPONENT_CATEGORIES.map((c) => `Components · ${c}`)];

function onDragStart(e: DragEvent, payload: DropPayload) {
  e.dataTransfer.setData(DND_NEW, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copy';
  document.querySelector('.canvas')?.classList.add('dragging');
}
const onDragEnd = () => document.querySelector('.canvas')?.classList.remove('dragging');

function match(i: Item, q: string) {
  return `${i.label} ${i.hint} ${i.group}`.toLowerCase().includes(q);
}

export function Palette({ onAdd, onAddErrorHandler, onAddRoute }: { onAdd(p: DropPayload): void; onAddErrorHandler(): void; onAddRoute(): void }) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => Object.fromEntries(COMPONENT_CATEGORIES.map((c) => [`Components · ${c}`, true])));
  const s = q.trim().toLowerCase();
  const items = useMemo(() => (s ? ITEMS.filter((i) => match(i, s)) : ITEMS), [s]);
  return (
    <aside className="side palette" aria-label="Components">
      <div className="side-head">
        <span>Components</span>
        <span className="muted" style={{ fontWeight: 400 }}>
          {ITEMS.length}
        </span>
      </div>
      <div style={{ padding: '0 14px 6px' }}>
        <input className="input" placeholder="Search EIPs & components…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search components" />
      </div>
      <div className="side-scroll">
        {!s && (
          <>
            <div className="group-title">Structure</div>
            <button className="component" onClick={onAddRoute} title="Add a new route to this file">
              <i>⇢</i> New route
            </button>
            <button className="component" onClick={onAddErrorHandler} title="Global onException handler with retries">
              <i style={{ color: 'var(--red)' }}>⚑</i> Error handler <small>onException</small>
            </button>
          </>
        )}
        {GROUPS.map((g) => {
          const list = items.filter((i) => i.group === g);
          if (!list.length) return null;
          const isCollapsed = !s && collapsed[g];
          return (
            <div key={g}>
              <button className="group-title" onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))} aria-expanded={!isCollapsed}>
                <span>{g}</span>
                <span>{isCollapsed ? `▸ ${list.length}` : '▾'}</span>
              </button>
              {!isCollapsed &&
                list.map((i) => (
                  <div
                    key={i.key}
                    className="component"
                    draggable
                    onDragStart={(e) => onDragStart(e, i.payload)}
                    onDragEnd={onDragEnd}
                    onClick={() => onAdd(i.payload)}
                    onKeyDown={(e) => e.key === 'Enter' && onAdd(i.payload)}
                    role="button"
                    tabIndex={0}
                    title={`${i.hint}\nDrag onto the canvas, or click to append to the selected block.`}
                  >
                    <i>{i.icon}</i> {i.label}
                  </div>
                ))}
            </div>
          );
        })}
        {!items.length && <p className="muted" style={{ fontSize: 12 }}>No component matches “{q}”.</p>}
      </div>
    </aside>
  );
}

export function QuickAdd({ anchor, onPick, onClose }: { anchor: DOMRect; onPick(p: DropPayload): void; onClose(): void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const s = q.trim().toLowerCase();
  const list = useMemo(() => (s ? ITEMS.filter((i) => match(i, s)) : ITEMS.filter((i) => !i.group.startsWith('Components'))).slice(0, 40), [s]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const top = Math.min(anchor.bottom + 6, window.innerHeight - 360);
  const left = Math.min(Math.max(8, anchor.left - 120), window.innerWidth - 290);
  return (
    <div className="quick-add" ref={ref} style={{ top, left }} role="dialog" aria-label="Insert step">
      <input
        className="input"
        autoFocus
        placeholder="Insert step… (try “split” or “kafka”)"
        value={q}
        onChange={(e) => (setQ(e.target.value), setActive(0))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, list.length - 1)));
          if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          if (e.key === 'Enter' && list[active]) onPick(list[active].payload);
        }}
      />
      <div className="list" role="listbox">
        {list.map((i, k) => (
          <button key={i.key} role="option" aria-selected={k === active} className={`component ${k === active ? 'active' : ''}`} onMouseEnter={() => setActive(k)} onClick={() => onPick(i.payload)}>
            <i>{i.icon}</i> {i.label}
            <small>{i.group.replace('Components · ', '')}</small>
          </button>
        ))}
        {!list.length && <div className="muted" style={{ padding: 10, fontSize: 12 }}>Nothing found</div>}
      </div>
    </div>
  );
}
