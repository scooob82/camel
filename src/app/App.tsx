import { lazy, Suspense, useEffect } from 'react';
import { t } from '../app/i18n';
import { BRAND } from '../config/brand';
import { Dashboard } from '../features/dashboard/Dashboard';
import { KnowledgeBase, RecipePage } from '../features/kb/KnowledgeBase';
import { Landing, scrollToSection } from '../features/landing/Landing';
import { Privacy, Terms } from '../features/legal/Legal';
import { AccountPage, ForgotPage, LoginPage, RegisterPage, ResetPage, VerifyPage } from '../features/auth/AuthPages';
import { SharedPage } from '../features/shared/SharedPage';
import { AdminPage } from '../features/admin/AdminPage';
import { LabPage } from '../features/lab/LabPage';
import { CommandPalette, Footer, Toasts, TopBar } from '../ui/Chrome';
import { EmptyState } from '../ui/Modal';
import { href, useRoute } from './router';
import { langStore } from './i18n';
import { useStore } from './store';

// The builder is the heaviest screen — load it on demand.
const Builder = lazy(() => import('../features/builder/Builder').then((m) => ({ default: m.Builder })));

/** Changing the language remounts the whole tree so every t() call re-renders. */
export function App() {
  const lang = useStore(langStore, (l) => l);
  return <Routes key={lang} />;
}

function Routes() {
  const route = useRoute();
  useEffect(() => {
    if (route.name === 'landing') document.title = `${BRAND.display} — Integration Studio for Apache Camel`;
  }, [route.name]);

  if (route.name === 'builder') {
    return (
      <>
        <Suspense fallback={<div className="wrap page muted">{t('Loading the builder…')}</div>}>
          <Builder id={route.id} />
        </Suspense>
        <CommandPalette />
        <Toasts />
      </>
    );
  }

  let page;
  switch (route.name) {
    case 'landing':
      page = <Landing />;
      break;
    case 'dashboard':
      page = <Dashboard />;
      break;
    case 'kb':
      page = <KnowledgeBase />;
      break;
    case 'recipe':
      page = <RecipePage slug={route.slug} />;
      break;
    case 'terms':
      page = <Terms />;
      break;
    case 'privacy':
      page = <Privacy />;
      break;
    case 'login':
      page = <LoginPage />;
      break;
    case 'register':
      page = <RegisterPage />;
      break;
    case 'forgot':
      page = <ForgotPage />;
      break;
    case 'reset':
      page = <ResetPage token={route.token} />;
      break;
    case 'verify':
      page = <VerifyPage token={route.token} />;
      break;
    case 'account':
      page = <AccountPage />;
      break;
    case 'shared':
      page = <SharedPage token={route.token} />;
      break;
    case 'admin':
      page = <AdminPage />;
      break;
    case 'lab':
      page = <LabPage />;
      break;
    default:
      page = (
        <main className="wrap page">
          <EmptyState icon="?" title={t('Page not found')} text={t('The page you are looking for does not exist.')} action={<a className="btn primary" href={href('/')}>{t('Go home')}</a>} />
        </main>
      );
  }
  return (
    <>
      <TopBar route={route} onSection={scrollToSection} />
      {page}
      <Footer />
      <CommandPalette />
      <Toasts />
    </>
  );
}
