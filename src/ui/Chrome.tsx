import { useEffect, useMemo, useState } from 'react';
import { contextCommands, openPalette, paletteOpen, type Command } from '../app/commands';
import { navigate, href, type Route } from '../app/router';
import { authStore } from '../app/session';
import { appStore, projects, themeStore, toastStore, toggleTheme, useStore } from '../app/store';
import { BRAND } from '../config/brand';
import { RECIPES } from '../content/recipes';
import { emptyFile, newRoute } from '../core/model';

export function Brand() {
  return (
    <a className="brand" href={href('/')} aria-label={`${BRAND.display} home`}>
      <span className="brandmark" aria-hidden>
        🐪
      </span>
      <span>
        {BRAND.name}
        <small>{BRAND.tagline}</small>
      </span>
    </a>
  );
}

export function ThemeButton() {
  const theme = useStore(themeStore, (t) => t);
  return (
    <button className="btn ghost icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title="Toggle theme">
      {theme === 'dark' ? '☼' : '☾'}
    </button>
  );
}

export function AccountButton() {
  const auth = useStore(authStore, (s) => s);
  if (auth.status === 'authenticated' && auth.user) {
    const label = auth.user.name || auth.user.email;
    return (
      <a className="btn ghost hide-xs account-btn" href={href('/account')} title={auth.user.email}>
        <span className="avatar" aria-hidden>
          {label.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name">{label}</span>
      </a>
    );
  }
  if (auth.status === 'anonymous') {
    return (
      <a className="btn ghost hide-xs" href={href('/login')}>
        Sign in
      </a>
    );
  }
  return null;
}

export function TopBar({ route, onSection }: { route: Route; onSection?: (id: string) => void }) {
  const link = (label: string, path: string, active: boolean) => (
    <a className={active ? 'active' : undefined} href={href(path)}>
      {label}
    </a>
  );
  return (
    <header className="topbar">
      <div className="wrap nav">
        <Brand />
        <nav className="navlinks" aria-label="Main">
          {link('Product', '/', route.name === 'landing')}
          {link('Projects', '/dashboard', route.name === 'dashboard')}
          {link('Knowledge Base', '/kb', route.name === 'kb' || route.name === 'recipe')}
          {route.name === 'landing' && onSection ? (
            <a href={href('/')} onClick={(e) => (e.preventDefault(), onSection('roadmap'))}>
              Roadmap
            </a>
          ) : null}
        </nav>
        <div className="navright">
          <button className="kbd" onClick={openPalette} aria-label="Open command palette">
            ⌘ K
          </button>
          <ThemeButton />
          <AccountButton />
          <button className="btn primary" onClick={() => navigate('/dashboard')}>
            Open Studio <span aria-hidden>↗</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div style={{ maxWidth: 520 }}>
          <b style={{ color: 'var(--text)' }}>🐪 {BRAND.name}</b>
          <div style={{ marginTop: 5 }}>{BRAND.disclaimer}</div>
        </div>
        <div className="footer-links">
          <a href={href('/dashboard')}>Projects</a>
          <a href={href('/kb')}>Knowledge Base</a>
          <a href={href('/terms')}>Terms</a>
          <a href={href('/privacy')}>Privacy</a>
        </div>
        <div>
          © {BRAND.year} {BRAND.display}
        </div>
      </div>
    </footer>
  );
}

export function Toasts() {
  const list = useStore(toastStore, (t) => t);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <b>{t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}</b>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export function newProjectAndOpen(name = 'New integration') {
  const file = emptyFile();
  file.routes.push(newRoute('route-1'));
  const p = projects.create(name, file);
  navigate(`/builder/${p.id}`);
}

export function CommandPalette() {
  const open = useStore(paletteOpen, (o) => o);
  const extra = useStore(contextCommands, (c) => c);
  const list = useStore(appStore, (s) => s.projects);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        paletteOpen.set((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(
    () => [
      ...extra,
      { id: 'nav-dashboard', title: 'Go to projects', group: 'Navigate', run: () => navigate('/dashboard') },
      { id: 'nav-kb', title: 'Open Knowledge Base', group: 'Navigate', run: () => navigate('/kb') },
      { id: 'nav-home', title: 'Go to home page', group: 'Navigate', run: () => navigate('/') },
      { id: 'new-project', title: 'New project', group: 'Create', run: () => newProjectAndOpen() },
      { id: 'theme', title: 'Toggle light / dark mode', group: 'Preferences', run: toggleTheme },
      ...[...list].sort((a, b) => b.openedAt - a.openedAt).slice(0, 8).map((p) => ({ id: `open-${p.id}`, title: `Open project: ${p.name}`, group: 'Projects', run: () => navigate(`/builder/${p.id}`) })),
      ...RECIPES.map((r) => ({ id: `kb-${r.slug}`, title: `Recipe: ${r.title}`, group: 'Knowledge Base', run: () => navigate(`/kb/${r.slug}`) })),
    ],
    [extra, list],
  );
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands.filter((c) => c.group !== 'Knowledge Base');
    return commands.filter((c) => `${c.title} ${c.group}`.toLowerCase().includes(s));
  }, [q, commands]);

  if (!open) return null;
  const close = () => paletteOpen.set(() => false);
  const run = (c?: Command) => {
    if (!c) return;
    close();
    c.run();
  };
  let lastGroup = '';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal palette-modal" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          className="palette-input"
          autoFocus
          placeholder="Type a command or search…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, filtered.length - 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
            if (e.key === 'Enter') run(filtered[active]);
          }}
        />
        <div className="palette-list" role="listbox">
          {!filtered.length && <div className="palette-group">No matching commands</div>}
          {filtered.map((c, i) => {
            const head = c.group !== lastGroup ? <div className="palette-group">{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head}
                <button role="option" aria-selected={i === active} className={`palette-item ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => run(c)}>
                  <span>{c.title}</span>
                  {c.shortcut && <span className="kbd">{c.shortcut}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
