// Build: bundles src/main.tsx with esbuild into dist/ (static files for Apache).
//   npm run build          → production build in dist/
//   npm run dev            → watch + local server on http://localhost:5173
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const serve = process.argv.includes('--serve');
const out = 'dist';

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });
if (existsSync('public')) cpSync('public', out, { recursive: true });

const options = {
  entryPoints: ['src/main.tsx'],
  bundle: true,
  outdir: join(out, 'assets'),
  entryNames: serve ? '[name]' : '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  splitting: true,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  minify: !serve,
  sourcemap: serve ? 'inline' : 'linked',
  metafile: true,
  legalComments: 'linked',
  define: { 'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production') },
  logLevel: 'info',
};

function writeHtml(metafile) {
  const entries = Object.entries(metafile.outputs).filter(([, o]) => o.entryPoint === 'src/main.tsx');
  const rel = (p) => p.replace(`${out}/`, '');
  const js = rel(entries.find(([p]) => p.endsWith('.js'))[0]);
  const cssOut = Object.entries(metafile.outputs).find(([p, o]) => p.endsWith('.css') && (o.entryPoint === 'src/main.tsx' || !o.entryPoint));
  const css = cssOut && rel(cssOut[0]);
  let html = readFileSync('index.html', 'utf8');
  html = html.replace('<!--STYLES-->', css ? `<link rel="stylesheet" href="${css}" />` : '');
  html = html.replace('<!--SCRIPTS-->', `<script type="module" src="${js}"></script>`);
  writeFileSync(join(out, 'index.html'), html);
}

if (serve) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'html', setup: (b) => b.onEnd((r) => r.metafile && writeHtml(r.metafile)) }],
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: 5173 });
  console.log(`\n  Dev server: http://localhost:${port}\n`);
} else {
  const result = await esbuild.build(options);
  writeHtml(result.metafile);
  await prerender(result.metafile);
  copyApi();
  const size = Object.entries(result.metafile.outputs)
    .filter(([f]) => !f.endsWith('.map') && !f.endsWith('.txt'))
    .map(([f, o]) => `${f.replace(`${out}/assets/`, '')} ${(o.bytes / 1024).toFixed(0)} kB`);
  const hash = createHash('sha1').update(readFileSync(join(out, 'index.html'))).digest('hex').slice(0, 8);
  console.log(`\n  dist/ ready (${hash})\n  ${size.join('\n  ')}\n`);
}

/** Static Knowledge Base pages + sitemap for search engines (see src/prerender.tsx). */
async function prerender(metafile) {
  const site = process.env.SITE_URL || JSON.parse(readFileSync('package.json', 'utf8')).homepage || 'https://www.example.com';
  if (site.includes('example.com')) console.warn('  ! SITE_URL not set — sitemap uses ' + site + ' (set "homepage" in package.json or SITE_URL)');
  const css = Object.keys(metafile.outputs).find((p) => p.endsWith('.css')).replace(`${out}/`, '');
  const tmp = join('node_modules', '.cache', 'prerender.mjs');
  await esbuild.build({ entryPoints: ['src/prerender.tsx'], bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: tmp, logLevel: 'warning', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' }, banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
  const { renderSite } = await import(pathToFileURL(join(process.cwd(), tmp)).href + `?t=${Date.now()}`);
  const { pages, sitemap, robots } = renderSite(site, css);
  for (const p of pages) {
    const file = join(out, p.path, 'index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, p.html);
  }
  writeFileSync(join(out, 'sitemap.xml'), sitemap);
  writeFileSync(join(out, 'robots.txt'), robots);
  console.log(`  prerendered ${pages.length} Knowledge Base pages + sitemap.xml`);
}

/** Ship the PHP API inside dist/ so one folder can be uploaded (config and storage stay on the server). */
function copyApi() {
  if (!existsSync('api')) return;
  cpSync('api', join(out, 'api'), {
    recursive: true,
    filter: (src) => !/api[\\/](tests|config\.php$|storage[\\/](?!\.htaccess$|\.gitignore$).+)/.test(src),
  });
}
