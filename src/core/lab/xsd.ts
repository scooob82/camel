/**
 * XSD analysis for the Transformation Lab: flatten a schema into element/attribute paths,
 * diff two schema versions, find affected transformations and generate sample instances.
 * Covers the common XSD subset (global/local elements, refs, named & anonymous types,
 * sequence/choice/all, complexContent/simpleContent extension, attributes, enumerations).
 */
import { parseXml, type XmlNode } from '../xmlparse';

export interface SchemaNode {
  path: string;
  name: string;
  kind: 'element' | 'attribute';
  type: string;
  minOccurs: number;
  /** -1 = unbounded */
  maxOccurs: number;
  enumeration?: string[];
  /** Inside an xs:choice (only one alternative appears). */
  choice?: boolean;
  /** Element has child elements or attributes. */
  complex: boolean;
}

interface Ctx {
  elements: Map<string, XmlNode>;
  complexTypes: Map<string, XmlNode>;
  simpleTypes: Map<string, XmlNode>;
  groups: Map<string, XmlNode>;
  attributeGroups: Map<string, XmlNode>;
}

const local = (q: string | undefined) => (q ?? '').replace(/^.*:/, '');
const kids = (n: XmlNode, ...names: string[]) => n.children.filter((c) => names.includes(c.name));

function occurs(n: XmlNode): { min: number; max: number } {
  const min = n.attrs.minOccurs !== undefined ? parseInt(n.attrs.minOccurs, 10) : 1;
  const max = n.attrs.maxOccurs === 'unbounded' ? -1 : n.attrs.maxOccurs !== undefined ? parseInt(n.attrs.maxOccurs, 10) : 1;
  return { min, max };
}

function enumOf(simple: XmlNode | undefined, ctx: Ctx, depth = 0): { base: string; values?: string[] } {
  if (!simple || depth > 10) return { base: 'string' };
  const r = kids(simple, 'restriction')[0];
  if (!r) return { base: 'string' };
  const values = kids(r, 'enumeration').map((e) => e.attrs.value ?? '');
  const base = local(r.attrs.base) || 'string';
  if (!values.length && ctx.simpleTypes.has(base)) return enumOf(ctx.simpleTypes.get(base), ctx, depth + 1);
  return { base, values: values.length ? values : undefined };
}

export function parseXsd(text: string): { roots: string[]; nodes: SchemaNode[] } {
  const root = parseXml(text);
  if (root.name !== 'schema') throw new Error('Not an XML Schema (root element must be xs:schema)');
  const ctx: Ctx = { elements: new Map(), complexTypes: new Map(), simpleTypes: new Map(), groups: new Map(), attributeGroups: new Map() };
  for (const c of root.children) {
    const name = c.attrs.name;
    if (!name) continue;
    if (c.name === 'element') ctx.elements.set(name, c);
    if (c.name === 'complexType') ctx.complexTypes.set(name, c);
    if (c.name === 'simpleType') ctx.simpleTypes.set(name, c);
    if (c.name === 'group') ctx.groups.set(name, c);
    if (c.name === 'attributeGroup') ctx.attributeGroups.set(name, c);
  }
  const nodes: SchemaNode[] = [];
  const visit = (el: XmlNode, parent: string, occ: { min: number; max: number }, choice: boolean, stack: string[]) => {
    const target = el.attrs.ref ? ctx.elements.get(local(el.attrs.ref)) ?? el : el;
    const name = local(el.attrs.ref) || el.attrs.name || '?';
    const path = parent ? `${parent}/${name}` : name;
    const typeName = local(target.attrs.type);
    const inlineComplex = kids(target, 'complexType')[0];
    const inlineSimple = kids(target, 'simpleType')[0];
    const complexDef = inlineComplex ?? (typeName ? ctx.complexTypes.get(typeName) : undefined);
    const simple = inlineSimple ?? (typeName ? ctx.simpleTypes.get(typeName) : undefined);
    const en = simple ? enumOf(simple, ctx) : undefined;
    const node: SchemaNode = { path, name, kind: 'element', type: complexDef ? typeName || '(complex)' : en?.base ?? (typeName || 'string'), minOccurs: occ.min, maxOccurs: occ.max, complex: !!complexDef, ...(en?.values ? { enumeration: en.values } : {}), ...(choice ? { choice: true } : {}) };
    nodes.push(node);
    // recursion guard: named types are expanded once per branch, anonymous ones are always unique
    if (complexDef && !(typeName && stack.includes(typeName))) walkComplex(complexDef, path, typeName ? [...stack, typeName] : stack);
  };
  const walkAttrs = (n: XmlNode, path: string) => {
    for (const a of kids(n, 'attribute')) {
      const name = a.attrs.name ?? local(a.attrs.ref);
      const st = kids(a, 'simpleType')[0] ?? ctx.simpleTypes.get(local(a.attrs.type));
      const en = st ? enumOf(st, ctx) : undefined;
      nodes.push({ path: `${path}/@${name}`, name, kind: 'attribute', type: en?.base ?? (local(a.attrs.type) || 'string'), minOccurs: a.attrs.use === 'required' ? 1 : 0, maxOccurs: 1, complex: false, ...(en?.values ? { enumeration: en.values } : {}) });
    }
    for (const g of kids(n, 'attributeGroup')) {
      const def = ctx.attributeGroups.get(local(g.attrs.ref));
      if (def) walkAttrs(def, path);
    }
  };
  const walkParticles = (n: XmlNode, path: string, inChoice: boolean, stack: string[], outer = { min: 1, max: 1 }) => {
    for (const c of n.children) {
      if (c.name === 'element') {
        const o = occurs(c);
        visit(c, path, { min: o.min * outer.min, max: o.max === -1 || outer.max === -1 ? -1 : o.max * outer.max }, inChoice, stack);
      } else if (c.name === 'sequence' || c.name === 'all') walkParticles(c, path, inChoice, stack, occurs(c));
      else if (c.name === 'choice') walkParticles(c, path, true, stack, { min: 0, max: occurs(c).max });
      else if (c.name === 'group') {
        const def = ctx.groups.get(local(c.attrs.ref));
        if (def) walkParticles(def, path, inChoice, stack, occurs(c));
      }
    }
  };
  const walkComplex = (ct: XmlNode, path: string, stack: string[]) => {
    const content = kids(ct, 'complexContent', 'simpleContent')[0];
    if (content) {
      const ext = kids(content, 'extension', 'restriction')[0];
      if (ext) {
        const base = ctx.complexTypes.get(local(ext.attrs.base));
        if (base && ext.name === 'extension' && !stack.includes(local(ext.attrs.base))) walkComplex(base, path, [...stack, local(ext.attrs.base)]);
        walkParticles(ext, path, false, stack);
        walkAttrs(ext, path);
      }
      return;
    }
    walkParticles(ct, path, false, stack);
    walkAttrs(ct, path);
  };
  for (const el of ctx.elements.values()) visit(el, '', { min: 1, max: 1 }, false, []);
  return { roots: [...ctx.elements.keys()], nodes };
}

// ---------------------------------------------------------------- diff

export type ChangeKind = 'added' | 'removed' | 'type' | 'occurs' | 'enumeration';

export interface SchemaChange {
  path: string;
  kind: ChangeKind;
  from?: string;
  to?: string;
  /** Existing messages or transformations may break. */
  breaking: boolean;
  message: string;
}

const occ = (n: SchemaNode) => `${n.minOccurs}..${n.maxOccurs === -1 ? '*' : n.maxOccurs}`;

export function diffSchemas(oldXsd: string, newXsd: string): SchemaChange[] {
  const a = new Map(parseXsd(oldXsd).nodes.map((n) => [n.path, n]));
  const b = new Map(parseXsd(newXsd).nodes.map((n) => [n.path, n]));
  const out: SchemaChange[] = [];
  for (const [path, o] of a) {
    const n = b.get(path);
    if (!n) {
      out.push({ path, kind: 'removed', from: o.type, breaking: true, message: `${o.kind} removed` });
      continue;
    }
    if (o.type !== n.type) out.push({ path, kind: 'type', from: o.type, to: n.type, breaking: true, message: `type ${o.type} → ${n.type}` });
    if (o.minOccurs !== n.minOccurs || o.maxOccurs !== n.maxOccurs) {
      const breaking = n.minOccurs > o.minOccurs || (o.maxOccurs === -1 ? n.maxOccurs !== -1 : n.maxOccurs !== -1 && n.maxOccurs < o.maxOccurs);
      out.push({ path, kind: 'occurs', from: occ(o), to: occ(n), breaking, message: `occurrence ${occ(o)} → ${occ(n)}` });
    }
    const ev = (x?: string[]) => (x ?? []).join('|');
    if (ev(o.enumeration) !== ev(n.enumeration)) {
      const removed = (o.enumeration ?? []).filter((v) => !(n.enumeration ?? []).includes(v));
      const added = (n.enumeration ?? []).filter((v) => !(o.enumeration ?? []).includes(v));
      out.push({ path, kind: 'enumeration', from: ev(o.enumeration), to: ev(n.enumeration), breaking: removed.length > 0 || (!!o.enumeration && !n.enumeration ? false : !o.enumeration && !!n.enumeration), message: [added.length ? `values added: ${added.join(', ')}` : '', removed.length ? `values removed: ${removed.join(', ')}` : ''].filter(Boolean).join('; ') || 'enumeration changed' });
    }
  }
  for (const [path, n] of b) {
    if (!a.has(path)) out.push({ path, kind: 'added', to: n.type, breaking: n.minOccurs > 0 && a.has(path.split('/').slice(0, -1).join('/')), message: `${n.kind} added${n.minOccurs > 0 ? ' (required)' : ' (optional)'}` });
  }
  return out.sort((x, y) => Number(y.breaking) - Number(x.breaking) || x.path.localeCompare(y.path));
}

// ---------------------------------------------------------------- impact on transformations

export interface Impact {
  path: string;
  file: string;
  line: number;
  text: string;
}

/** Lines in XSLT/XQuery/mapping sources that reference removed or changed elements/attributes. */
export function impactOf(changes: SchemaChange[], sources: { name: string; text: string }[]): Impact[] {
  const out: Impact[] = [];
  for (const c of changes) {
    if (c.kind === 'added' || !c.breaking) continue;
    const parts = c.path.split('/');
    const leaf = parts[parts.length - 1];
    const parent = parts.length > 1 ? parts[parts.length - 2] : '';
    const isAttr = leaf.startsWith('@');
    const name = isAttr ? leaf.slice(1) : leaf;
    const re = isAttr ? new RegExp(`@${name}\\b`) : new RegExp(`(^|[/:\\s"'(\\[])${name}(?=$|[/\\s"'\\[)\\]=,|<>!])`);
    for (const s of sources) {
      s.text.split('\n').forEach((line, i) => {
        // only lines that look like XPath usage (select, match, test, value-of, for-each …) or XQuery paths
        if (!/select=|match=|test=|\{|\/|for \$|let \$|where |return /.test(line)) return;
        if (re.test(line) && (!parent || parts.length < 3 || line.includes(parent) || !isAttr)) out.push({ path: c.path, file: s.name, line: i + 1, text: line.trim().slice(0, 160) });
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- sample instances

const SAMPLE: Record<string, string> = {
  string: 'text', normalizedString: 'text', token: 'TOKEN', boolean: 'true', int: '42', integer: '42', long: '42', short: '7', byte: '1',
  decimal: '19.99', double: '1.5', float: '1.5', positiveInteger: '1', nonNegativeInteger: '0', date: '2026-01-31', dateTime: '2026-01-31T12:00:00Z',
  time: '12:00:00', gYear: '2026', anyURI: 'https://example.com', base64Binary: 'SGVsbG8=', ID: 'id1', IDREF: 'id1', QName: 'ns:name', language: 'cs',
};

export function sampleValue(n: SchemaNode, index = 0): string {
  if (n.enumeration?.length) return n.enumeration[index % n.enumeration.length];
  const v = SAMPLE[n.type];
  if (v === 'text') return `${n.name}${index ? ` ${index + 1}` : ''}`;
  return v ?? `${n.name}`;
}

/** Generate a sample XML instance. `optional` includes optional nodes; repeated nodes appear `repeat` times. */
export function sampleXml(xsd: string, opts: { root?: string; optional?: boolean; repeat?: number } = {}): string {
  const { roots, nodes } = parseXsd(xsd);
  const root = opts.root ?? roots[0];
  if (!root) throw new Error('The schema has no global element');
  const repeat = Math.max(1, Math.min(opts.repeat ?? 2, 5));
  const byParent = new Map<string, SchemaNode[]>();
  for (const n of nodes) {
    const parent = n.path.split('/').slice(0, -1).join('/');
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(n);
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const render = (n: SchemaNode, depth: number, idx: number) => {
    const children = byParent.get(n.path) ?? [];
    const attrs = children.filter((c) => c.kind === 'attribute' && (c.minOccurs > 0 || opts.optional !== false)).map((c) => ` ${c.name}="${esc(sampleValue(c, idx))}"`).join('');
    let elems = children.filter((c) => c.kind === 'element' && (c.minOccurs > 0 || opts.optional !== false));
    // a choice: keep only the first alternative
    let choiceTaken = false;
    elems = elems.filter((c) => !c.choice || (!choiceTaken && (choiceTaken = true)));
    const pad = '  '.repeat(depth);
    if (!elems.length) {
      lines.push(n.complex ? `${pad}<${n.name}${attrs}/>` : `${pad}<${n.name}${attrs}>${esc(sampleValue(n, idx))}</${n.name}>`);
      return;
    }
    lines.push(`${pad}<${n.name}${attrs}>`);
    for (const c of elems) {
      const times = c.maxOccurs === -1 || c.maxOccurs > 1 ? Math.min(repeat, c.maxOccurs === -1 ? repeat : c.maxOccurs) : 1;
      for (let i = 0; i < times; i++) render(c, depth + 1, i);
    }
    lines.push(`${pad}</${n.name}>`);
  };
  const rootNode = nodes.find((n) => n.path === root);
  if (!rootNode) throw new Error(`Element ${root} not found`);
  render(rootNode, 0, 0);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- JSON Schema sample

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: Json[]; format?: string; example?: Json; examples?: Json[]; default?: Json; $ref?: string; definitions?: Record<string, JsonSchema>; $defs?: Record<string, JsonSchema>; oneOf?: JsonSchema[]; anyOf?: JsonSchema[]; allOf?: JsonSchema[]; minimum?: number };

export function sampleJson(schema: JsonSchema, opts: { optional?: boolean } = {}): Json {
  const defs = { ...(schema.definitions ?? {}), ...(schema.$defs ?? {}) };
  const go = (s: JsonSchema, name: string, depth: number): Json => {
    if (depth > 12) return null;
    if (s.$ref) return go(defs[s.$ref.split('/').pop()!] ?? {}, name, depth + 1);
    if (s.example !== undefined) return s.example;
    if (s.examples?.length) return s.examples[0];
    if (s.default !== undefined) return s.default;
    if (s.enum?.length) return s.enum[0];
    if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => go(x, name, depth + 1)));
    if (s.oneOf?.length || s.anyOf?.length) return go((s.oneOf ?? s.anyOf)![0], name, depth + 1);
    const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type ?? (s.properties ? 'object' : s.items ? 'array' : 'string');
    switch (type) {
      case 'object': {
        const out: { [k: string]: Json } = {};
        for (const [k, v] of Object.entries(s.properties ?? {})) if (opts.optional !== false || s.required?.includes(k)) out[k] = go(v, k, depth + 1);
        return out;
      }
      case 'array':
        return [go(s.items ?? {}, name, depth + 1)];
      case 'integer':
        return s.minimum ?? 1;
      case 'number':
        return 9.99;
      case 'boolean':
        return true;
      default:
        return s.format === 'date' ? '2026-01-31' : s.format === 'date-time' ? '2026-01-31T12:00:00Z' : s.format === 'email' ? 'user@example.com' : s.format === 'uuid' ? '3fa85f64-5717-4562-b3fc-2c963f66afa6' : name || 'text';
    }
  };
  return go(schema, '', 0);
}
