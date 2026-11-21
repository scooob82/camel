import { useEffect } from 'react';
import { BRAND } from '../config/brand';
import { Builder } from '../features/builder/Builder';
import { Dashboard } from '../features/dashboard/Dashboard';
import { KnowledgeBase, RecipePage } from '../features/kb/KnowledgeBase';
import { Landing, scrollToSection } from '../features/landing/Landing';
import { Privacy, Terms } from '../features/legal/Legal';
import { CommandPalette, Footer, Toasts, TopBar } from '../ui/Chrome';
import { EmptyState } from '../ui/Modal';
import { href, useRoute } from './router';

export function App() {
  const route = useRoute();
  useEffect(() => {
    if (route.name === 'landing') document.title = `${BRAND.display} — Integration Studio for Apache Camel`;
  }, [route.name]);

  if (route.name === 'builder') {
    return (
      <>
        <Builder id={route.id} />
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
    default:
      page = (
        <main className="wrap page">
          <EmptyState icon="?" title="Page not found" text="The page you are looking for does not exist." action={<a className="btn primary" href={href('/')}>Go home</a>} />
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
