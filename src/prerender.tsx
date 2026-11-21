/**
 * Static, crawlable Knowledge Base pages (/kb/ and /kb/<slug>/) generated at build time.
 * The SPA uses #hash routes, which search engines index poorly — these pages carry the
 * same content as real URLs and link into the app.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { BRAND } from './config/brand';
import { RECIPES, type Recipe } from './content/recipes';
import { COMPONENTS, docsUrl } from './core/catalog';
import { EIPS } from './core/eip';
import { toJava } from './core/java';
import { toXml } from './core/xml';
import { fromYaml } from './core/yaml';
import { FlowCanvas } from './features/builder/Canvas';
import { highlight } from './ui/highlight';

export interface Page {
  path: string;
  html: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(o: { site: string; css: string; path: string; title: string; description: string; body: string; jsonLd?: object }): string {
  const url = `${o.site}${o.path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base href="/">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0c1018">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="${esc(o.css)}">
${o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="topbar"><div class="wrap nav">
  <a class="brand" href="/"><span class="brandmark">🐪</span><span>${esc(BRAND.name)}<small>${esc(BRAND.tagline)}</small></span></a>
  <nav class="navlinks"><a href="/">Product</a><a href="/#/dashboard">Projects</a><a class="active" href="/kb/">Knowledge Base</a></nav>
  <div class="navright"><a class="btn primary" href="/#/dashboard">Open Studio ↗</a></div>
</div></header>
${o.body}
<footer class="footer"><div class="wrap footer-inner"><div style="max-width:520px"><b>🐪 ${esc(BRAND.name)}</b><div style="margin-top:5px">${esc(BRAND.disclaimer)}</div></div>
<div class="footer-links"><a href="/kb/">Knowledge Base</a><a href="/#/terms">Terms</a><a href="/#/privacy">Privacy</a></div><div>© ${BRAND.year} ${esc(BRAND.display)}</div></div></footer>
</body>
</html>
`;
}

const noop = { status: {}, readOnly: true, onSelect() {}, onDrop() {}, onQuickAdd() {}, onAddBranch() {} };

function code(lang: 'yaml' | 'xml' | 'java', label: string, text: string): string {
  return `<h3 class="code-title">${label}</h3><pre class="block static-code">${highlight(text.trimEnd(), lang)}</pre>`;
}

function recipePage(r: Recipe, site: string, css: string): Page {
  const file = fromYaml(r.yaml);
  const flow = renderToStaticMarkup(<FlowCanvas file={file} zoom={0.8} h={noop} />);
  const related = RECIPES.filter((x) => x.slug !== r.slug && (x.category === r.category || x.tags.some((t) => r.tags.includes(t)))).slice(0, 4);
  const body = `<main class="wrap page"><a href="/kb/" class="muted" style="font-size:12px;text-decoration:none">← Knowledge Base</a>
<div class="kb-layout" style="margin-top:14px"><article class="prose" style="max-width:none">
<div class="tag">${esc(r.category)} · ${r.tags.map(esc).join(' · ')}</div>
<h1 style="font-size:34px;letter-spacing:-1.4px;margin:8px 0 6px">${esc(r.title)}</h1>
<p style="font-size:16px;color:var(--muted);margin-top:0">${esc(r.summary)}</p>
<div class="recipe-preview canvas">${flow}</div>
${r.body.map((p) => `<p>${esc(p)}</p>`).join('\n')}
<h2>Example</h2>
${code('yaml', 'YAML DSL', r.yaml)}
${code('xml', 'XML DSL', toXml(file))}
${code('java', 'Java DSL', toJava(file, r.title))}
<h2>Tips</h2><ul class="tips">${r.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
</article>
<aside class="card kb-aside"><a class="btn primary" style="width:100%;justify-content:center" href="/#/kb/${r.slug}">Open in the Studio ↗</a>
<p class="hint" style="margin-top:10px">Edit this recipe visually, validate it and export a runnable Spring Boot project.</p>
${related.length ? `<div class="subhead">Related</div><div style="display:grid;gap:8px">${related.map((x) => `<a class="ref" href="/kb/${x.slug}/"><b>${esc(x.title)}</b><span>${esc(x.summary)}</span></a>`).join('')}</div>` : ''}
</aside></div></main>`;
  return {
    path: `/kb/${r.slug}/`,
    html: layout({
      site,
      css,
      path: `/kb/${r.slug}/`,
      title: `${r.title} — Apache Camel recipe (YAML, XML, Java)`,
      description: `${r.summary} Working Apache Camel example in YAML, XML and Java DSL with tips.`,
      body,
      jsonLd: { '@context': 'https://schema.org', '@type': 'TechArticle', headline: r.title, description: r.summary, about: 'Apache Camel', proficiencyLevel: 'Beginner' },
    }),
  };
}

function indexPage(site: string, css: string): Page {
  const body = `<main class="wrap page"><div class="page-head"><div><div class="tag">Learn · Build · Reuse</div><h1>Apache Camel Knowledge Base</h1>
<p>${RECIPES.length} practical recipes with YAML, XML and Java DSL, plus EIP and component references.</p></div>
<a class="btn primary" href="/#/kb">Search in the Studio ↗</a></div>
<h2 style="font-size:18px;margin:8px 0 14px">Recipes</h2>
<div class="features">${RECIPES.map((r) => `<a class="feature" href="/kb/${r.slug}/"><div class="tag">${esc(r.category)}</div><h3 style="margin-top:10px">${esc(r.title)}</h3><p>${esc(r.summary)}</p></a>`).join('')}</div>
<h2 style="font-size:18px;margin:44px 0 14px">Enterprise Integration Patterns</h2>
<div class="ref-list">${EIPS.map((e) => `<a class="ref" href="${esc(e.docs)}" rel="noopener"><b><i>${esc(e.icon)}</i> ${esc(e.label)}</b><span>${esc(e.summary)}</span></a>`).join('')}</div>
<h2 style="font-size:18px;margin:44px 0 14px">Components</h2>
<div class="ref-list">${COMPONENTS.map((c) => `<a class="ref" href="${esc(docsUrl(c))}" rel="noopener"><b><i>⇢</i> ${esc(c.title)}</b><span>${esc(c.description)}</span></a>`).join('')}</div>
</main>`;
  return {
    path: '/kb/',
    html: layout({ site, css, path: '/kb/', title: 'Apache Camel recipes and EIP reference — Knowledge Base', description: `Practical Apache Camel recipes (${RECIPES.length}) with YAML, XML and Java DSL examples, EIP and component reference.`, body }),
  };
}

export function renderSite(site: string, css: string): { pages: Page[]; sitemap: string; robots: string } {
  const base = site.replace(/\/$/, '');
  const pages = [indexPage(base, css), ...RECIPES.map((r) => recipePage(r, base, css))];
  const urls = ['/', ...pages.map((p) => p.path)];
  const today = new Date().toISOString().slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(base + u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`;
  const robots = `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`;
  return { pages, sitemap, robots };
}
