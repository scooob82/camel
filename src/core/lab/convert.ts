/** JSON ⇄ XML conversion for the Transformation Lab. */
import { decodeEntities, escapeXml, parseXml, type XmlNode } from '../xmlparse';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const validName = (k: string) => (/^[A-Za-z_][\w.-]*$/.test(k) ? k : `_${k.replace(/[^\w.-]/g, '_')}`);

/** Element style: object keys → elements, arrays → repeated elements, "@x" keys → attributes, "#text" → text. */
export function jsonToXml(value: Json, root = 'root', indent = '  '): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const write = (name: string, v: Json, depth: number) => {
    const pad = indent.repeat(depth);
    const tag = validName(name);
    if (Array.isArray(v)) {
      for (const item of v) write(name, item, depth);
      return;
    }
    if (v === null) return void out.push(`${pad}<${tag}/>`);
    if (typeof v !== 'object') return void out.push(`${pad}<${tag}>${escapeXml(String(v))}</${tag}>`);
    const attrs = Object.entries(v)
      .filter(([k]) => k.startsWith('@'))
      .map(([k, x]) => ` ${validName(k.slice(1))}="${escapeXml(String(x), true)}"`)
      .join('');
    const children = Object.entries(v).filter(([k]) => !k.startsWith('@') && k !== '#text');
    const text = v['#text'];
    if (!children.length) return void out.push(text === undefined ? `${pad}<${tag}${attrs}/>` : `${pad}<${tag}${attrs}>${escapeXml(String(text))}</${tag}>`);
    out.push(`${pad}<${tag}${attrs}>`);
    for (const [k, x] of children) write(k, x, depth + 1);
    out.push(`${pad}</${tag}>`);
  };
  const isWrapper = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && !Object.keys(value)[0].startsWith('@');
  if (isWrapper) {
    const [k, v] = Object.entries(value as Record<string, Json>)[0];
    write(k, v, 0);
  } else write(root, value, 0);
  return out.join('\n') + '\n';
}

function scalar(s: string): Json {
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s) && s.length < 16) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  return s;
}

/** XML → JSON. Attributes become "@name"; repeated elements become arrays. */
export function xmlToJson(xml: string, opts: { typed?: boolean; keepRoot?: boolean } = {}): Json {
  const conv = (n: XmlNode): Json => {
    const obj: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(n.attrs)) obj[`@${k}`] = opts.typed ? scalar(v) : v;
    for (const c of n.children) {
      const v = conv(c);
      if (c.name in obj) {
        const cur = obj[c.name];
        obj[c.name] = Array.isArray(cur) ? [...cur, v] : [cur, v];
      } else obj[c.name] = v;
    }
    const text = decodeEntities(n.text).trim();
    if (!n.children.length && !Object.keys(n.attrs).length) return text === '' ? null : opts.typed ? scalar(text) : text;
    if (text) obj['#text'] = opts.typed ? scalar(text) : text;
    return obj;
  };
  const root = parseXml(xml);
  return opts.keepRoot === false ? conv(root) : { [root.name]: conv(root) };
}

/** XPath 3.1 fn:json-to-xml representation (what XSLT 3.0 json-to-xml() produces). */
export function jsonToXpathXml(value: Json): string {
  const out: string[] = [];
  const w = (v: Json, depth: number, key?: string) => {
    const pad = '  '.repeat(depth);
    const k = key !== undefined ? ` key="${escapeXml(key, true)}"` : '';
    const ns = depth === 0 ? ' xmlns="http://www.w3.org/2005/xpath-functions"' : '';
    if (v === null) out.push(`${pad}<null${k}${ns}/>`);
    else if (Array.isArray(v)) {
      out.push(`${pad}<array${k}${ns}>`);
      v.forEach((x) => w(x, depth + 1));
      out.push(`${pad}</array>`);
    } else if (typeof v === 'object') {
      out.push(`${pad}<map${k}${ns}>`);
      Object.entries(v).forEach(([kk, x]) => w(x, depth + 1, kk));
      out.push(`${pad}</map>`);
    } else out.push(`${pad}<${typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string'}${k}${ns}>${escapeXml(String(v))}</${typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string'}>`);
  };
  w(value, 0);
  return out.join('\n') + '\n';
}

/** Leaf paths of a JSON/XML sample, used by the mapper's source tree. */
export function samplePaths(input: string): { path: string; sample: string; repeated: boolean }[] {
  const t = input.trim();
  const json: Json = t.startsWith('<') ? xmlToJson(t) : JSON.parse(t);
  const out = new Map<string, { path: string; sample: string; repeated: boolean }>();
  const walk = (v: Json, path: string, repeated: boolean) => {
    if (Array.isArray(v)) {
      out.set(path, { path, sample: `[${v.length}]`, repeated: true });
      v.slice(0, 3).forEach((x) => walk(x, path, true));
      return;
    }
    if (v && typeof v === 'object') {
      if (path && !out.has(path)) out.set(path, { path, sample: '', repeated });
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}/${k}` : k, false);
      return;
    }
    if (!out.has(path)) out.set(path, { path, sample: String(v ?? ''), repeated });
  };
  walk(json, '', false);
  return [...out.values()].filter((p) => p.path);
}
