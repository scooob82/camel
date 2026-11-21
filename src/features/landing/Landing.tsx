import { useMemo } from 'react';
import { t } from '../../app/i18n';
import { navigate } from '../../app/router';
import { appStore, projects, useStore } from '../../app/store';
import { RECIPES } from '../../content/recipes';
import { validate } from '../../core/validate';
import { fromYaml, toYaml } from '../../core/yaml';
import { highlight } from '../../ui/highlight';
import { newProjectAndOpen } from '../../ui/Chrome';
import { FlowCanvas } from '../builder/Canvas';

const DEMO = RECIPES[0];

export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

function openDemo() {
  const p = projects.create('Orders integration', fromYaml(DEMO.yaml), 'Demo project created from the landing page');
  navigate(`/builder/${p.id}`);
}

export function Landing() {
  const hasProjects = useStore(appStore, (s) => s.projects.length > 0);
  const demoFile = useMemo(() => fromYaml(DEMO.yaml), []);
  const demoYaml = useMemo(() => toYaml(demoFile), [demoFile]);
  const issues = useMemo(() => validate(demoFile), [demoFile]);
  const start = () => (hasProjects ? navigate('/dashboard') : newProjectAndOpen());

  return (
    <main>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">
              <span className="dot" /> {t('Built for Apache Camel developers')}
            </div>
            <h1 className="display">
              {t('Build integrations.')}
              <br />
              <em>{t('Not complexity.')}</em>
            </h1>
            <p className="lead">{t('Design, edit and document Apache Camel routes in one focused workspace. From a visual flow to production-ready YAML, XML and Java DSL.')}</p>
            <div className="hero-actions">
              <button className="btn primary" onClick={start}>
                {t('Start building')} <span aria-hidden>→</span>
              </button>
              <button className="btn" onClick={openDemo}>
                {t('Open the demo project')}
              </button>
            </div>
            <div className="hero-meta">
              <span>
                ✓ <b>{t('Visual route builder')}</b>
              </span>
              <span>{t('✓ YAML · XML · Java export')}</span>
              <span>{t('✓ Free to start, no account needed')}</span>
            </div>
          </div>
          <div className="preview" aria-label={t('Route Builder preview')}>
            <div className="preview-top">
              <div className="lights">
                <i />
                <i />
                <i />
              </div>
              <span className="mono">orders-integration.camel.yaml</span>
              <span className="c-ok">{t('● Saved')}</span>
            </div>
            <div className="card hero-preview-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 230px', overflow: 'hidden', minHeight: 275 }}>
              <div className="canvas" style={{ overflow: 'hidden', pointerEvents: 'none' }}>
                <div style={{ transform: 'scale(.62)', transformOrigin: '0 0', width: '160%' }}>
                  <FlowCanvas file={demoFile} h={{ status: {}, readOnly: true, onSelect() {}, onDrop() {}, onQuickAdd() {}, onAddBranch() {} }} />
                </div>
              </div>
              <pre className="mono" style={{ margin: 0, padding: 12, fontSize: 8.5, lineHeight: 1.9, borderLeft: '1px solid var(--line)', overflow: 'hidden', color: 'var(--text2)' }} dangerouslySetInnerHTML={{ __html: highlight(demoYaml.split('\n').slice(0, 22).join('\n'), 'yaml') }} />
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="product">
        <div className="wrap">
          <div className="section-head">
            <div>
              <div className="tag">{t('One workspace · Complete workflow')}</div>
              <h2>{t('Everything around your routes.')}</h2>
            </div>
            <p>{t('A practical toolkit for designing Camel integrations. Start with the builder, then explore the knowledge and workflow tools around it.')}</p>
          </div>
          <div className="features">
            {[
              ['⌘', 'Visual Route Builder', 'Compose EIP patterns with drag & drop. The diagram and the Camel DSL stay in sync through one canonical route model.'],
              ['⌁', 'Code, your way', 'Edit and import YAML and XML. Generate Java DSL. Every edit is validated as you type.'],
              ['◉', 'Component Catalog', 'Search Camel components and EIP patterns, fill options in forms instead of guessing URI syntax.'],
              ['▤', 'Project & version history', 'Organize routes in projects, save versions and restore an earlier snapshot when needed.'],
              ['⇧', 'Export & documentation', 'Export YAML, XML, Java or a runnable Spring Boot project. Generate endpoint tables and Mermaid diagrams.'],
              ['◇', 'Knowledge Base', 'Learn EIP patterns through concise explanations, route examples and practical integration recipes.'],
              ['◎', 'Run & Debug', 'Sandbox execution, message tracing in the diagram, breakpoints, mock endpoints and generated tests.'],
              ['⇄', 'Transformation Lab', 'XSLT 3.0 and XQuery with Saxon, JSON/XML mapping, profiler and schema diff.'],
              ['⚡', 'Contract-first', 'Generate routes from OpenAPI, AsyncAPI or WSDL and keep REST APIs in a visual editor.'],
            ].map(([icon, title, text]) => (
              <article className="feature" key={title}>
                <div className="feature-icon">{icon}</div>
                <h3>{t(title)}</h3>
                <p>{t(text)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section builder-section" id="builder">
        <div className="wrap">
          <div className="section-head">
            <div>
              <div className="tag">{t('The core of the studio')}</div>
              <h2>{t('From visual flow to real Camel DSL.')}</h2>
            </div>
            <p>{t('One route model. Three code views. Your diagram and source stay aligned — and the linter tells you what Camel would complain about later.')}</p>
          </div>
          <div className="card" style={{ overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
            <div className="studio-bar" style={{ height: 52 }}>
              <span className="crumb">
                My projects / <b style={{ color: 'var(--text)' }}>{t('Orders integration')}</b> / order-router
              </span>
              <div className="bar-actions">
                <button className="tinybtn accent" onClick={openDemo}>
                  {t('Open in Builder ↗')}
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,380px)', minHeight: 395 }} className="landing-builder">
              <div className="canvas" style={{ overflow: 'auto' }}>
                <FlowCanvas file={demoFile} zoom={0.85} h={{ status: {}, readOnly: true, onSelect() {}, onDrop() {}, onQuickAdd() {}, onAddBranch() {} }} />
              </div>
              <pre className="mono" style={{ margin: 0, padding: 16, fontSize: 11, lineHeight: 1.9, borderLeft: '1px solid var(--line)', overflow: 'auto', color: 'var(--text2)', background: 'var(--panel)' }} dangerouslySetInnerHTML={{ __html: highlight(demoYaml, 'yaml') }} />
            </div>
            <div className="validation">
              <div className="validation-summary">
                <strong>{t('Route validation')}</strong>
                <span className="count c-ok">{t('✓ YAML valid')}</span>
                <span className="count c-ok">{t('✓ All nodes connected')}</span>
                {issues.map((i, k) => (
                  <span key={k} className={`count ${i.severity === 'error' ? 'c-err' : 'c-warn'}`}>
                    ! {i.message}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="knowledge">
        <div className="wrap">
          <div className="section-head">
            <div>
              <div className="tag">{t('Learn · Build · Reuse')}</div>
              <h2>{t('Knowledge that ships with examples.')}</h2>
            </div>
            <p>{t('Understand a pattern, inspect a working route and open it directly in the builder.')}</p>
          </div>
          <div className="features">
            {RECIPES.slice(0, 3).map((r) => (
              <a className="feature" key={r.slug} href={`#/kb/${r.slug}`}>
                <div className="tag">
                  {r.category} · {r.tags[0]}
                </div>
                <h3 style={{ marginTop: 10 }}>{r.title}</h3>
                <p>{r.summary}</p>
                <p style={{ marginTop: 14, color: 'var(--amber)' }}>{t('Open recipe ↗')}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="roadmap">
        <div className="wrap">
          <div className="section-head">
            <div>
              <div className="tag">{t('The roadmap')}</div>
              <h2>{t('More power is on the way.')}</h2>
            </div>
            <p>{t('Run & Debug and the Transformation Lab are available today. These modules come next.')}</p>
          </div>
          <div className="features">
            {[
              ['↗', 'Migration Center', 'OSB, MuleSoft, Fuse and Camel 2/3 → 4 assessment and migration assistance.'],
              ['✳', 'AI Assistant', 'Generate routes, explain integrations and analyse stack traces with project context.'],
              ['⌘', 'Team Workspace', 'Shared projects and libraries, reviews, team permissions and SSO.'],
              ['▦', 'Marketplace', 'Reusable route templates, Kamelets and community integrations.'],
            ].map(([icon, title, text]) => (
              <article className="feature soon" key={title}>
                <div className="feature-icon">{icon}</div>
                <h3>
                  {t(title)} <span className="pill soon">{t('COMING SOON')}</span>
                </h3>
                <p>{t(text)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta">
            <div>
              <div className="tag">{t('Start with the essentials')}</div>
              <h2>{t('Your next Camel route starts here.')}</h2>
              <p>{t('Design visually. Keep control of your code. Export when you\'re ready.')}</p>
            </div>
            <button className="btn primary" onClick={start}>
              {t('Open the Studio →')}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
