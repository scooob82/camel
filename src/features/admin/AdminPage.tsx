import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../app/api';
import { locale, t } from '../../app/i18n';
import { navigate } from '../../app/router';
import { authStore, type User } from '../../app/session';
import { toast, useStore } from '../../app/store';
import { Confirm, EmptyState } from '../../ui/Modal';

interface Stats {
  users: number;
  verified: number;
  newUsers7d: number;
  projects: number;
  versions: number;
  shared: number;
  plans: { plan: string; users: number }[];
  pageViews: { day: string; views: number }[];
  topPaths: { path: string; views: number }[];
  errors7d: number;
}
type AdminUser = User & { projects: number };
interface ClientError {
  id: string;
  at: number;
  message: string;
  stack: string | null;
  url: string | null;
  userAgent: string | null;
}

function Bars({ data }: { data: { day: string; views: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.views));
  if (!data.length) return <p className="muted">{t('No page views yet.')}</p>;
  return (
    <div className="bars" role="img" aria-label={t('Page views, last 30 days')}>
      {data.map((d) => (
        <div key={d.day} className="bar" style={{ height: `${Math.max(3, (d.views / max) * 100)}%` }} title={`${d.day}: ${d.views}`} />
      ))}
    </div>
  );
}

export function AdminPage() {
  const { status, user } = useStore(authStore, (s) => s);
  const [stats, setStats] = useState<Stats>();
  const [users, setUsers] = useState<{ users: AdminUser[]; total: number; page: number; pages: number }>();
  const [errors, setErrors] = useState<ClientError[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<AdminUser>();
  const [tab, setTab] = useState<'overview' | 'users' | 'errors'>('overview');

  useEffect(() => {
    document.title = `${t('Admin')} · Integration Studio`;
    if (status === 'anonymous') navigate('/login');
  }, [status]);

  const isAdmin = user?.role === 'admin';
  const loadUsers = useCallback(() => {
    api<{ users: AdminUser[]; total: number; page: number; pages: number }>('GET', `/admin/users?q=${encodeURIComponent(q)}&page=${page}`).then(setUsers, (e: ApiError) => toast(e.message, 'error'));
  }, [q, page]);

  useEffect(() => {
    if (!isAdmin) return;
    api<Stats>('GET', '/admin/stats').then(setStats, (e: ApiError) => toast(e.message, 'error'));
    api<{ errors: ClientError[] }>('GET', '/admin/errors').then((r) => setErrors(r.errors), () => undefined);
  }, [isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    const h = setTimeout(loadUsers, 250);
    return () => clearTimeout(h);
  }, [isAdmin, loadUsers]);

  if (status === 'loading') return <main className="wrap page muted">{t('Loading…')}</main>;
  if (!isAdmin) return <main className="wrap page"><EmptyState icon="⛨" title={t('Admins only')} text={t('This page is available to administrators.')} /></main>;

  const update = async (u: AdminUser, patch: { plan?: string; role?: string }) => {
    try {
      const r = await api<{ user: User }>('PATCH', `/admin/users/${u.id}`, patch);
      setUsers((x) => x && { ...x, users: x.users.map((y) => (y.id === u.id ? { ...y, ...r.user } : y)) });
      toast(t('Saved'), 'success');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };
  const fmt = (ms: number) => new Date(ms).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <div className="tag">{t('Administration')}</div>
          <h1>{t('Admin')}</h1>
          <p>{t('Users, plans, traffic and client errors.')}</p>
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 20 }} role="tablist">
        {(['overview', 'users', 'errors'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {k === 'overview' ? t('Overview') : k === 'users' ? t('Users') : `${t('Errors')} (${errors.length})`}
          </button>
        ))}
      </div>

      {tab === 'overview' && stats && (
        <>
          <div className="stat-row">
            <div className="card stat"><b>{stats.users}</b><span>{t('Users')} · {stats.verified} {t('verified')}</span></div>
            <div className="card stat"><b>{stats.newUsers7d}</b><span>{t('New users (7 days)')}</span></div>
            <div className="card stat"><b>{stats.projects}</b><span>{t('Projects')} · {stats.shared} {t('shared')}</span></div>
            <div className="card stat"><b className={stats.errors7d ? 'c-err' : 'c-ok'}>{stats.errors7d}</b><span>{t('Client errors (7 days)')}</span></div>
          </div>
          <div className="grid2">
            <section className="card settings-card">
              <h2>{t('Page views, last 30 days')}</h2>
              <Bars data={stats.pageViews} />
            </section>
            <section className="card settings-card">
              <h2>{t('Top pages')}</h2>
              <table className="tbl">
                <tbody>
                  {stats.topPaths.map((p) => (
                    <tr key={p.path}><td><code>{p.path}</code></td><td style={{ textAlign: 'right' }}>{p.views}</td></tr>
                  ))}
                </tbody>
              </table>
              <h2 style={{ marginTop: 18 }}>{t('Plans')}</h2>
              <div className="chips">{stats.plans.map((p) => <span key={p.plan} className="pill">{p.plan}: {p.users}</span>)}</div>
            </section>
          </div>
        </>
      )}

      {tab === 'users' && (
        <section className="card settings-card">
          <input className="input search-lg" placeholder={t('Search by e-mail or name…')} value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} aria-label={t('Search users')} style={{ marginBottom: 14 }} />
          <table className="tbl">
            <thead>
              <tr><th>{t('User')}</th><th>{t('Projects')}</th><th>{t('Plan')}</th><th>{t('Role')}</th><th>{t('Registered')}</th><th /></tr>
            </thead>
            <tbody>
              {users?.users.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.email}</b><div className="muted" style={{ fontSize: 11 }}>{u.name || '—'} {u.emailVerified ? '' : `· ${t('not verified')}`}</div></td>
                  <td>{u.projects}</td>
                  <td>
                    <select className="select" value={u.plan} onChange={(e) => update(u, { plan: e.target.value })} aria-label={t('Plan')}>
                      {['free', 'pro', 'team'].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="select" value={u.role} onChange={(e) => update(u, { role: e.target.value })} aria-label={t('Role')} disabled={u.id === user?.id}>
                      {['user', 'admin'].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="muted">{fmt(u.createdAt)}</td>
                  <td>{u.id !== user?.id && <button className="tinybtn" style={{ color: 'var(--red)' }} onClick={() => setDeleting(u)}>{t('Delete')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {users && users.pages > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <button className="tinybtn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</button>
              <span className="muted" style={{ fontSize: 12 }}>{page} / {users.pages} · {users.total}</span>
              <button className="tinybtn" disabled={page >= users.pages} onClick={() => setPage((p) => p + 1)}>→</button>
            </div>
          )}
        </section>
      )}

      {tab === 'errors' && (
        <section className="card settings-card">
          {!errors.length ? <p className="muted">{t('No client errors reported.')}</p> : errors.map((e) => (
            <details key={e.id} className="error-row">
              <summary><span className="c-err">✕</span> {e.message} <span className="muted">· {e.url} · {fmt(e.at)}</span></summary>
              <pre className="block">{e.stack ?? ''}{'\n'}{e.userAgent ?? ''}</pre>
            </details>
          ))}
        </section>
      )}

      {deleting && (
        <Confirm
          title={t('Delete user {email}?', { email: deleting.email })}
          message={t('Deletes the account with all {n} project(s). This cannot be undone.', { n: deleting.projects })}
          confirmLabel={t('Delete user')}
          danger
          onClose={() => setDeleting(undefined)}
          onConfirm={() =>
            api('DELETE', `/admin/users/${deleting.id}`).then(
              () => (toast(t('User deleted')), loadUsers()),
              (e: ApiError) => toast(e.message, 'error'),
            )
          }
        />
      )}
    </main>
  );
}
