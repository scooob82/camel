import { useEffect } from 'react';
import { href } from '../../app/router';
import { BRAND } from '../../config/brand';

function Draft() {
  return (
    <p className="pill warn" style={{ fontSize: 11 }}>
      Draft — to be finalised before the public launch
    </p>
  );
}

export function Terms() {
  useEffect(() => {
    document.title = `Terms · ${BRAND.display}`;
  }, []);
  return (
    <main className="wrap page prose">
      <div className="tag">Legal</div>
      <h1 style={{ fontSize: 30 }}>Terms of use</h1>
      <Draft />
      <h2>The service</h2>
      <p>{BRAND.display} is a developer tool for designing Apache Camel routes. During the MVP it runs entirely in your browser and is provided free of charge, as is, without warranty.</p>
      <h2>Your content</h2>
      <p>Routes and projects you create belong to you. Generated code may be used in any project, commercial or not.</p>
      <h2>Trademarks</h2>
      <p>{BRAND.disclaimer}</p>
    </main>
  );
}

export function Privacy() {
  useEffect(() => {
    document.title = `Privacy · ${BRAND.display}`;
  }, []);
  return (
    <main className="wrap page prose">
      <div className="tag">Legal</div>
      <h1 style={{ fontSize: 30 }}>Privacy</h1>
      <Draft />
      <h2>What is stored</h2>
      <p>Projects, versions, theme and layout preferences are stored in your browser’s local storage. Nothing is sent to a server: there are no accounts, no analytics and no tracking cookies in this version.</p>
      <h2>Deleting your data</h2>
      <p>
        Delete projects on the <a href={href('/dashboard')}>Projects</a> page, or clear this site’s data in your browser settings.
      </p>
      <h2>Avoid secrets</h2>
      <p>Do not put real passwords or tokens into routes. Use {'{{property}}'} placeholders — the builder warns when it sees what looks like a hard-coded secret.</p>
    </main>
  );
}
