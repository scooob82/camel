import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { t } from '../../app/i18n';
import { api, ApiError } from '../../app/api';
import { href, navigate } from '../../app/router';
import { authStore, login, logout, register, resetPassword, setUser, signedOut, type User } from '../../app/session';
import { appStore, toast, useStore } from '../../app/store';
import { download } from '../builder/download';
import { Confirm } from '../../ui/Modal';

// ---------------------------------------------------------------- shared form bits

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = async (e: FormEvent, fn: () => Promise<void>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    try {
      await fn();
    } catch (err) {
      const a = err as ApiError;
      setError(a.message);
      setFields(a.fields ?? {});
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, fields, run };
}

function Field({ id, label, type = 'text', value, onChange, error, autoComplete, hint, autoFocus }: { id: string; label: string; type?: string; value: string; onChange(v: string): void; error?: string; autoComplete?: string; hint?: string; autoFocus?: boolean }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <input
        id={id}
        className="input"
        style={{ fontSize: 13.5, padding: '10px 12px' }}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        autoFocus={autoFocus}
      />
      {error ? (
        <span id={`${id}-err`} className="hint c-err">
          {error}
        </span>
      ) : (
        hint && <span className="hint">{hint}</span>
      )}
    </div>
  );
}

function AuthCard({ title, text, children, footer }: { title: string; text?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="wrap page" style={{ display: 'grid', placeItems: 'start center' }}>
      <div className="card auth-card">
        <div className="tag">{t('Account')}</div>
        <h1>{title}</h1>
        {text && <p className="muted">{text}</p>}
        {children}
        {footer && <div className="auth-foot">{footer}</div>}
      </div>
    </main>
  );
}

function FormError({ message, fields }: { message: string; fields: Record<string, string> }) {
  if (!message || Object.keys(fields).length) return null;
  return (
    <div className="form-error" role="alert">
      {message}
    </div>
  );
}

function Unavailable() {
  return (
    <AuthCard title={t('Accounts are not available')} text={t('This installation runs without the server API, so projects are stored in your browser only.')}>
      <a className="btn primary" href={href('/dashboard')}>
        {t('Go to projects')}
      </a>
    </AuthCard>
  );
}

function useAuthRedirect() {
  const status = useStore(authStore, (s) => s.status);
  useEffect(() => {
    if (status === 'authenticated') navigate('/dashboard');
  }, [status]);
  return status;
}

// ---------------------------------------------------------------- pages

export function LoginPage() {
  const status = useAuthRedirect();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const f = useSubmit();
  useEffect(() => {
    document.title = 'Sign in · Integration Studio';
  }, []);
  if (status === 'unavailable') return <Unavailable />;
  return (
    <AuthCard
      title={t('Sign in')}
      text={t('Your projects sync across devices when you are signed in.')}
      footer={
        <>
          No account? <a href={href('/register')}>{t('Create one')}</a> · <a href={href('/forgot')}>{t('Forgot password?')}</a>
        </>
      }
    >
      <form onSubmit={(e) => f.run(e, () => login(email, password))} noValidate>
        <Field id="email" label={t('E-mail')} type="email" value={email} onChange={setEmail} autoComplete="email" error={f.fields.email} autoFocus />
        <Field id="password" label={t('Password')} type="password" value={password} onChange={setPassword} autoComplete="current-password" error={f.fields.password} />
        <FormError message={f.error} fields={f.fields} />
        <button className="btn primary full" disabled={f.busy}>
          {f.busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const status = useAuthRedirect();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const f = useSubmit();
  useEffect(() => {
    document.title = 'Create account · Integration Studio';
  }, []);
  if (status === 'unavailable') return <Unavailable />;
  return (
    <AuthCard title={t('Create your account')} text={t('Free plan: 50 projects, 30 versions per project, sharing links.')} footer={<>{t('Already have an account?')} <a href={href('/login')}>{t('Sign in')}</a></>}>
      <form
        onSubmit={(e) =>
          f.run(e, async () => {
            await register(name, email, password);
            toast('Welcome! Check your inbox to confirm your e-mail.', 'success');
          })
        }
        noValidate
      >
        <Field id="name" label={t('Name (optional)')} value={name} onChange={setName} autoComplete="name" error={f.fields.name} autoFocus />
        <Field id="email" label={t('E-mail')} type="email" value={email} onChange={setEmail} autoComplete="email" error={f.fields.email} />
        <Field id="password" label={t('Password')} type="password" value={password} onChange={setPassword} autoComplete="new-password" error={f.fields.password} hint="At least 10 characters. A short sentence works well." />
        <FormError message={f.error} fields={f.fields} />
        <button className="btn primary full" disabled={f.busy}>
          {f.busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="hint" style={{ marginTop: 12 }}>
          By creating an account you agree to the <a href={href('/terms')}>terms</a> and <a href={href('/privacy')}>{t('privacy policy')}</a>.
        </p>
      </form>
    </AuthCard>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const f = useSubmit();
  return (
    <AuthCard title={t('Reset your password')} text={t('We will e-mail you a link to choose a new password.')} footer={<a href={href('/login')}>{t('← Back to sign in')}</a>}>
      {sent ? (
        <div className="form-ok" role="status">
          If an account exists for <b>{email}</b>, the e-mail is on its way. The link is valid for 1 hour.
        </div>
      ) : (
        <form
          onSubmit={(e) =>
            f.run(e, async () => {
              await api('POST', '/auth/forgot', { email });
              setSent(true);
            })
          }
          noValidate
        >
          <Field id="email" label={t('E-mail')} type="email" value={email} onChange={setEmail} autoComplete="email" error={f.fields.email} autoFocus />
          <FormError message={f.error} fields={f.fields} />
          <button className="btn primary full" disabled={f.busy || !email.trim()}>
            {f.busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPage({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const f = useSubmit();
  return (
    <AuthCard title={t('Choose a new password')} text={t('You will be signed out on all other devices.')}>
      <form
        onSubmit={(e) =>
          f.run(e, async () => {
            await resetPassword(token, password);
            toast('Password changed', 'success');
            navigate('/dashboard');
          })
        }
        noValidate
      >
        <Field id="password" label={t('New password')} type="password" value={password} onChange={setPassword} autoComplete="new-password" error={f.fields.password} hint="At least 10 characters." autoFocus />
        <FormError message={f.error} fields={f.fields} />
        <button className="btn primary full" disabled={f.busy}>
          {f.busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
      {f.error && !Object.keys(f.fields).length && (
        <p className="hint" style={{ marginTop: 10 }}>
          <a href={href('/forgot')}>{t('Request a new link')}</a>
        </p>
      )}
    </AuthCard>
  );
}

export function VerifyPage({ token }: { token: string }) {
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  useEffect(() => {
    api<{ user: User | null }>('POST', '/auth/verify', { token })
      .then((r) => {
        if (r.user) setUser(r.user);
        setState('ok');
      })
      .catch((e: ApiError) => {
        setMessage(e.message);
        setState('error');
      });
  }, [token]);
  return (
    <AuthCard title={state === 'ok' ? 'E-mail confirmed' : state === 'error' ? 'Link not valid' : 'Confirming…'}>
      {state === 'ok' && <div className="form-ok">{t('Thanks — your e-mail address is confirmed.')}</div>}
      {state === 'error' && <div className="form-error">{message}</div>}
      <div style={{ marginTop: 16 }}>
        <a className="btn primary" href={href('/dashboard')}>
          {t('Go to projects')}
        </a>
      </div>
    </AuthCard>
  );
}

export function AccountPage() {
  const { status, user } = useStore(authStore, (s) => s);
  const count = useStore(appStore, (s) => s.projects.length);
  const [name, setName] = useState(user?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const profile = useSubmit();
  const pw = useSubmit();
  const del = useSubmit();
  useEffect(() => {
    document.title = 'Account · Integration Studio';
    if (status === 'anonymous') navigate('/login');
  }, [status]);
  useEffect(() => setName(user?.name ?? ''), [user?.name]);
  if (!user) return <main className="wrap page" />;

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <div className="tag">{t('Account')}</div>
          <h1>{user.name || user.email}</h1>
          <p>
            {user.email} · <span className="pill">{user.plan} plan</span> · {count} project{count === 1 ? '' : 's'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {user.role === 'admin' && (
            <a className="btn" href={href('/admin')}>
              Admin
            </a>
          )}
          <button className="btn" onClick={() => logout().then(() => navigate('/'))}>
            {t('Sign out')}
          </button>
        </div>
      </div>

      <div className="settings">
        {!user.emailVerified && (
          <section className="card settings-card">
            <h2>{t('Confirm your e-mail')}</h2>
            <p className="muted">We sent a confirmation link to {user.email}. Confirming lets us reach you about your account.</p>
            <button
              className="btn sm"
              onClick={() =>
                api('POST', '/auth/resend-verification', {}).then(
                  () => toast('Confirmation e-mail sent', 'success'),
                  (e: ApiError) => toast(e.message, 'error'),
                )
              }
            >
              {t('Resend e-mail')}
            </button>
          </section>
        )}

        <section className="card settings-card">
          <h2>{t('Profile')}</h2>
          <form
            onSubmit={(e) =>
              profile.run(e, async () => {
                const r = await api<{ user: User }>('PATCH', '/account', { name });
                setUser(r.user);
                toast('Profile saved', 'success');
              })
            }
          >
            <Field id="acc-name" label={t('Name')} value={name} onChange={setName} autoComplete="name" error={profile.fields.name} />
            <FormError message={profile.error} fields={profile.fields} />
            <button className="btn sm primary" disabled={profile.busy || name === user.name}>
              {t('Save')}
            </button>
          </form>
        </section>

        <section className="card settings-card">
          <h2>{t('Password')}</h2>
          <form
            onSubmit={(e) =>
              pw.run(e, async () => {
                await api('POST', '/account/password', { current, password: next });
                setCurrent('');
                setNext('');
                toast('Password changed — other devices were signed out', 'success');
              })
            }
            noValidate
          >
            <Field id="pw-current" label={t('Current password')} type="password" value={current} onChange={setCurrent} autoComplete="current-password" error={pw.fields.current} />
            <Field id="pw-new" label={t('New password')} type="password" value={next} onChange={setNext} autoComplete="new-password" error={pw.fields.password} hint="At least 10 characters." />
            <FormError message={pw.error} fields={pw.fields} />
            <button className="btn sm primary" disabled={pw.busy || !current || !next}>
              {t('Change password')}
            </button>
          </form>
        </section>

        <section className="card settings-card">
          <h2>{t('Your data')}</h2>
          <p className="muted">{t('Download everything we store about you and your projects as JSON.')}</p>
          <button
            className="btn sm"
            onClick={() =>
              api('GET', '/account/export').then(
                (r) => download(`studio-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(r, null, 2), 'application/json'),
                (e: ApiError) => toast(e.message, 'error'),
              )
            }
          >
            {t('↓ Export my data')}
          </button>
        </section>

        <section className="card settings-card danger-zone">
          <h2>{t('Delete account')}</h2>
          <p className="muted">{t('Permanently deletes your account, all projects, versions and share links. This cannot be undone.')}</p>
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="del-pw">
              <span>{t('Confirm with your password')}</span>
            </label>
            <input id="del-pw" className="input" type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} autoComplete="current-password" aria-invalid={del.fields.password ? true : undefined} />
            {del.fields.password && <span className="hint c-err">{del.fields.password}</span>}
          </div>
          <button className="btn sm danger" disabled={!deletePassword} onClick={() => setDeleting(true)}>
            {t('Delete my account')}
          </button>
        </section>
      </div>

      {deleting && (
        <Confirm
          title={t('Delete your account?')}
          message={`All ${count} project(s) and their versions will be permanently deleted.`}
          confirmLabel={t('Delete account')}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={() =>
            del.run({ preventDefault() {} } as FormEvent, async () => {
              await api('DELETE', '/account', { password: deletePassword });
              signedOut();
              toast('Your account was deleted');
              navigate('/');
            })
          }
        />
      )}
    </main>
  );
}
