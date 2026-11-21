/**
 * Field mapping (the "Excel mapping" analysts write) ⇄ XSLT.
 *
 * A row maps a target path to a source expression:
 *   rule "copy"     target Invoice/Number      ← source order/id
 *   rule "xpath"    target Invoice/Name        ← concat(first, ' ', last)
 *   rule "constant" target Invoice/@currency   ← EUR
 *   rule "loop"     target Invoice/Lines/Line  ← order/items/item   (repeats; rows below it are relative)
 */
import { escapeXml, parseXml, type XmlNode } from '../xmlparse';

export type Rule = 'copy' | 'xpath' | 'constant' | 'loop';
export const RULES: Rule[] = ['copy', 'xpath', 'constant', 'loop'];

export interface MappingRow {
  target: string;
  source: string;
  rule: Rule;
  note?: string;
}

interface TNode {
  name: string;
  attrs: Map<string, MappingRow>;
  children: TNode[];
  value?: MappingRow;
  loop?: MappingRow;
}

const clean = (p: string) => p.trim().replace(/^\/+|\/+$/g, '');

function buildTree(rows: MappingRow[]): TNode[] {
  const roots: TNode[] = [];
  const find = (list: TNode[], name: string) => {
    let n = list.find((x) => x.name === name);
    if (!n) list.push((n = { name, attrs: new Map(), children: [] }));
    return n;
  };
  for (const r of rows) {
    const parts = clean(r.target).split('/').filter(Boolean);
    if (!parts.length) continue;
    let list = roots;
    let node: TNode | undefined;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.startsWith('@')) {
        if (node) node.attrs.set(p.slice(1), r);
        break;
      }
      node = find(list, p);
      list = node.children;
      if (i === parts.length - 1) {
        if (r.rule === 'loop') node.loop = r;
        else node.value = r;
      }
    }
  }
  return roots;
}

function valueXml(r: MappingRow): string {
  if (r.rule === 'constant') return escapeXml(r.source);
  return `<xsl:value-of select="${escapeXml(r.source.trim() || '.', true)}"/>`;
}

export function mappingToXslt(rows: MappingRow[], opts: { version?: '1.0' | '3.0' } = {}): string {
  const version = opts.version ?? '1.0';
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xsl:stylesheet version="${version}" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">`,
    '  <xsl:output method="xml" indent="yes"/>',
    '',
    '  <xsl:template match="/">',
  ];
  const emit = (n: TNode, depth: number) => {
    const pad = '  '.repeat(depth);
    const inner = (d: number) => {
      const p2 = '  '.repeat(d);
      const out: string[] = [];
      const literalAttrs: string[] = [];
      for (const [name, r] of n.attrs) {
        if (r.rule === 'constant') literalAttrs.push(` ${name}="${escapeXml(r.source, true)}"`);
        else out.push(`${p2}  <xsl:attribute name="${name}"><xsl:value-of select="${escapeXml(r.source.trim() || '.', true)}"/></xsl:attribute>`);
      }
      const open = `${p2}<${n.name}${literalAttrs.join('')}`;
      if (!n.children.length && !out.length && n.value) return [`${open}>${valueXml(n.value)}</${n.name}>`];
      if (!n.children.length && !out.length) return [`${open}/>`];
      const body = [...out];
      if (n.value) body.push(`${p2}  ${valueXml(n.value)}`);
      const sub: string[] = [];
      for (const c of n.children) emitInto(c, d + 1, sub);
      return [`${open}>`, ...body, ...sub, `${p2}</${n.name}>`];
    };
    if (n.loop) return [`${pad}<xsl:for-each select="${escapeXml(n.loop.source.trim() || '.', true)}">`, ...inner(depth + 1), `${pad}</xsl:for-each>`];
    return inner(depth);
  };
  const emitInto = (n: TNode, depth: number, out: string[]) => out.push(...emit(n, depth));
  for (const r of buildTree(rows)) emitInto(r, 3, lines);
  lines.push('  </xsl:template>', '</xsl:stylesheet>', '');
  return lines.join('\n');
}

/** Best-effort reverse: read the main template of a stylesheet back into mapping rows. */
export function xsltToMapping(xslt: string): MappingRow[] {
  const root = parseXml(xslt);
  const templates = root.children.filter((c) => c.name === 'template');
  const main = templates.find((t) => t.attrs.match === '/') ?? templates[0];
  if (!main) throw new Error('No xsl:template found');
  const rows: MappingRow[] = [];
  const isXsl = (n: XmlNode) => ['value-of', 'for-each', 'attribute', 'if', 'choose', 'apply-templates', 'copy-of', 'text', 'variable', 'call-template', 'sequence'].includes(n.name);
  const ruleFor = (select: string): Rule => (/^[\w@/.:*-]+(\[[^\]]*\])?(\/[\w@.:*-]+(\[[^\]]*\])?)*$/.test(select.trim()) ? 'copy' : 'xpath');
  const walk = (n: XmlNode, path: string) => {
    for (const c of n.children) {
      if (c.name === 'for-each') {
        // the loop target is the literal element directly inside the for-each
        for (const el of c.children.filter((x) => !isXsl(x))) {
          const p = `${path}/${el.name}`;
          rows.push({ target: p.replace(/^\//, ''), source: c.attrs.select ?? '.', rule: 'loop' });
          visitElement(el, p);
        }
      } else if (c.name === 'value-of' || c.name === 'copy-of' || c.name === 'sequence') {
        rows.push({ target: path.replace(/^\//, ''), source: c.attrs.select ?? '.', rule: ruleFor(c.attrs.select ?? '.') });
      } else if (c.name === 'attribute') {
        const v = c.children.find((x) => x.name === 'value-of');
        rows.push({ target: `${path}/@${c.attrs.name}`.replace(/^\//, ''), source: v?.attrs.select ?? c.attrs.select ?? c.text, rule: v || c.attrs.select ? ruleFor(v?.attrs.select ?? c.attrs.select ?? '') : 'constant' });
      } else if (c.name === 'if' || c.name === 'choose') {
        rows.push({ target: path.replace(/^\//, ''), source: c.attrs.test ?? '', rule: 'xpath', note: `conditional (${c.name}) — review manually` });
      } else if (!isXsl(c)) visitElement(c, `${path}/${c.name}`);
    }
  };
  const visitElement = (el: XmlNode, path: string) => {
    for (const [k, v] of Object.entries(el.attrs)) {
      const avt = /^\{(.+)\}$/.exec(v);
      rows.push({ target: `${path}/@${k}`.replace(/^\//, ''), source: avt ? avt[1] : v, rule: avt ? ruleFor(avt[1]) : 'constant' });
    }
    if (!el.children.length && el.text.trim()) rows.push({ target: path.replace(/^\//, ''), source: el.text.trim(), rule: 'constant' });
    walk(el, path);
  };
  walk(main, '');
  return rows;
}

// ---------------------------------------------------------------- CSV (Excel)

const HEADER = ['target', 'source', 'rule', 'note'];

function csvCell(v: string, sep: string): string {
  return /["\n\r]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Semicolon-separated by default (what Czech/European Excel opens directly). */
export function mappingToCsv(rows: MappingRow[], sep = ';'): string {
  return [HEADER.join(sep), ...rows.map((r) => [r.target, r.source, r.rule, r.note ?? ''].map((c) => csvCell(c, sep)).join(sep))].join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Read a mapping from CSV. Accepts our header or Czech column names (cíl, zdroj, pravidlo, poznámka). */
export function csvToMapping(text: string): MappingRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const hasHeader = idx('target', 'cíl', 'cil') >= 0;
  const ti = hasHeader ? idx('target', 'cíl', 'cil') : 0;
  const si = hasHeader ? idx('source', 'zdroj') : 1;
  const ri = hasHeader ? idx('rule', 'pravidlo', 'typ') : 2;
  const ni = hasHeader ? idx('note', 'poznámka', 'poznamka') : 3;
  return rows.slice(hasHeader ? 1 : 0).map((r) => {
    const rule = (r[ri] ?? '').trim().toLowerCase();
    const norm: Rule = rule === 'konstanta' ? 'constant' : rule === 'cyklus' || rule === 'for-each' ? 'loop' : (RULES as string[]).includes(rule) ? (rule as Rule) : 'copy';
    return { target: (r[ti] ?? '').trim(), source: (r[si] ?? '').trim(), rule: norm, ...(ni >= 0 && r[ni]?.trim() ? { note: r[ni].trim() } : {}) };
  }).filter((r) => r.target);
}
