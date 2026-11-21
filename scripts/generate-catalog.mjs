// Generate src/content/catalog.generated.json from the official camel-catalog.
//
//   node scripts/generate-catalog.mjs                     # newest camel-catalog jar in ~/.m2
//   node scripts/generate-catalog.mjs path/to/camel-catalog-4.x.y.jar
//   node scripts/generate-catalog.mjs path/to/dir         # dir with <name>.json component files
//
// Get the jar with Maven, e.g.:
//   mvn dependency:get -Dartifact=org.apache.camel:camel-catalog:4.10.0
//
// The builder merges the generated entries over its curated catalog (src/core/catalog.ts).
import JSZip from 'jszip';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CATEGORY = [
  [/messaging|mq|queue|kafka|jms/, 'Messaging'],
  [/file|ftp|storage/, 'Files'],
  [/http|rest|api|webservice|soap|websocket|graphql|networking/, 'HTTP & API'],
  [/database|sql|nosql|cache|bigdata/, 'Database'],
  [/cloud|aws|azure|google/, 'Cloud'],
  [/mail/, 'Mail'],
  [/transformation|xml|json|validation|template/, 'Transformation'],
  [/scheduling/, 'Scheduling'],
  [/testing|mock/, 'Testing'],
];

export function category(label = '') {
  for (const [re, name] of CATEGORY) if (re.test(label)) return name;
  return 'Core';
}

const MAX_OPTIONS = 14;

/** Convert one camel-catalog component JSON into the builder's ComponentDef shape. */
export function toComponentDef(json) {
  const c = json.component;
  if (!c || c.deprecated || c.kind !== 'component') return undefined;
  const props = Object.entries(json.properties ?? {})
    .filter(([, p]) => p.kind === 'parameter' && !p.deprecated && !/advanced/.test(`${p.group ?? ''} ${p.label ?? ''}`))
    .sort(([, a], [, b]) => Number(!!b.required) - Number(!!a.required) || (a.index ?? 0) - (b.index ?? 0))
    .slice(0, MAX_OPTIONS)
    .map(([name, p]) => {
      const o = { name, description: String(p.description ?? '').split('. ')[0].replace(/\.$/, '') };
      if (p.defaultValue !== undefined && p.defaultValue !== '') o.default = String(p.defaultValue);
      if (Array.isArray(p.enum) && p.enum.length) o.enum = p.enum.map(String);
      return o;
    });
  return {
    scheme: c.scheme,
    docs: c.name,
    title: c.title,
    category: category(c.label),
    description: String(c.description ?? '').replace(/\.$/, '') + '.',
    syntax: c.syntax,
    example: c.syntax,
    consumer: !c.producerOnly,
    producer: !c.consumerOnly,
    starter: `${c.artifactId}-starter`,
    options: props,
  };
}

function newestJar() {
  const dir = join(homedir(), '.m2/repository/org/apache/camel/camel-catalog');
  if (!existsSync(dir)) return undefined;
  const versions = readdirSync(dir).filter((v) => /^\d/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const v = versions.at(-1);
  return v && join(dir, v, `camel-catalog-${v}.jar`);
}

export async function readCatalog(source) {
  const jsons = [];
  if (statSync(source).isDirectory()) {
    for (const f of readdirSync(source)) if (f.endsWith('.json')) jsons.push(JSON.parse(readFileSync(join(source, f), 'utf8')));
  } else {
    const zip = await JSZip.loadAsync(readFileSync(source));
    const files = Object.values(zip.files).filter((f) => /org\/apache\/camel\/catalog\/components\/[^/]+\.json$/.test(f.name));
    for (const f of files) jsons.push(JSON.parse(await f.async('string')));
  }
  return jsons.map(toComponentDef).filter(Boolean).sort((a, b) => a.scheme.localeCompare(b.scheme));
}

async function main() {
  const source = process.argv[2] ?? newestJar();
  if (!source || !existsSync(source)) {
    console.error('camel-catalog not found. Pass the jar path, or run:\n  mvn dependency:get -Dartifact=org.apache.camel:camel-catalog:4.10.0');
    process.exit(1);
  }
  const out = process.argv[3] ?? 'src/content/catalog.generated.json';
  const defs = await readCatalog(source);
  writeFileSync(out, JSON.stringify(defs, null, 1) + '\n');
  console.log(`Wrote ${defs.length} components from ${source} → ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
