// Build: bundles src/main.tsx with esbuild into dist/ (static files for Apache).
//   npm run build          → production build in dist/
//   npm run dev            → watch + local server on http://localhost:5173
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const outputs = Object.keys(metafile.outputs).map((p) => p.replace(`${out}/`, ''));
  const js = outputs.find((p) => p.endsWith('.js'));
  const css = outputs.find((p) => p.endsWith('.css'));
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
  const size = readdirSync(join(out, 'assets'))
    .filter((f) => !f.endsWith('.map'))
    .map((f) => `${f} ${(readFileSync(join(out, 'assets', f)).length / 1024).toFixed(0)} kB`);
  const hash = createHash('sha1').update(readFileSync(join(out, 'index.html'))).digest('hex').slice(0, 8);
  console.log(`\n  dist/ ready (${hash})\n  ${size.join('\n  ')}\n`);
}
