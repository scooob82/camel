/**
 * Small JSONPath evaluator for the expression tester.
 * Supports: $, .name, ['name'], [n], [-n], [*], .*, ..name, [a,b], [start:end],
 * and filters [?(@.field op value)] with ==, !=, <, <=, >, >= and existence [?(@.field)].
 */
type J = unknown;

export class JsonPathError extends Error {}

type Seg =
  | { t: 'child'; names: (string | number)[] }
  | { t: 'wild' }
  | { t: 'deep'; name: string | '*' }
  | { t: 'slice'; start?: number; end?: number }
  | { t: 'filter'; path: string[]; op?: string; value?: J };

function parseLiteral(s: string): J {
  const v = s.trim();
  if (/^'.*'$/.test(v) || /^".*"$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (!Number.isNaN(Number(v))) return Number(v);
  throw new JsonPathError(`Invalid literal: ${v}`);
}

function tokenize(path: string): Seg[] {
  const p = path.trim();
  if (!p.startsWith('$')) throw new JsonPathError('JSONPath must start with $');
  const segs: Seg[] = [];
  let i = 1;
  while (i < p.length) {
    if (p.startsWith('..', i)) {
      i += 2;
      const m = /^(\*|[A-Za-z_$][\w$-]*)/.exec(p.slice(i));
      if (!m) throw new JsonPathError(`Expected name after ".." at ${i}`);
      segs.push({ t: 'deep', name: m[1] });
      i += m[1].length;
    } else if (p[i] === '.') {
      i++;
      if (p[i] === '*') {
        segs.push({ t: 'wild' });
        i++;
        continue;
      }
      const m = /^[A-Za-z_$][\w$-]*/.exec(p.slice(i));
      if (!m) throw new JsonPathError(`Expected name at ${i}`);
      segs.push({ t: 'child', names: [m[0]] });
      i += m[0].length;
    } else if (p[i] === '[') {
      const end = p.indexOf(']', i);
      if (end < 0) throw new JsonPathError('Missing "]"');
      const inner = p.slice(i + 1, end).trim();
      i = end + 1;
      if (inner === '*') segs.push({ t: 'wild' });
      else if (inner.startsWith('?(') && inner.endsWith(')')) {
        const body = inner.slice(2, -1).trim();
        const m = /^@((?:\.[A-Za-z_$][\w$-]*)+)\s*(?:(==|!=|<=|>=|<|>)\s*(.+))?$/.exec(body);
        if (!m) throw new JsonPathError(`Unsupported filter: ${body}`);
        segs.push({ t: 'filter', path: m[1].split('.').filter(Boolean), op: m[2], value: m[3] !== undefined ? parseLiteral(m[3]) : undefined });
      } else if (/^-?\d*:-?\d*$/.test(inner)) {
        const [a, b] = inner.split(':');
        segs.push({ t: 'slice', start: a ? Number(a) : undefined, end: b ? Number(b) : undefined });
      } else {
        const names = inner.split(',').map((x) => {
          const v = x.trim();
          if (/^-?\d+$/.test(v)) return Number(v);
          if (/^'.*'$/.test(v) || /^".*"$/.test(v)) return v.slice(1, -1);
          throw new JsonPathError(`Invalid selector: [${inner}]`);
        });
        segs.push({ t: 'child', names });
      }
    } else throw new JsonPathError(`Unexpected "${p[i]}" at ${i}`);
  }
  return segs;
}

const isObj = (v: J): v is Record<string, J> => typeof v === 'object' && v !== null;

function children(v: J): J[] {
  if (Array.isArray(v)) return v;
  if (isObj(v)) return Object.values(v);
  return [];
}

function deep(v: J, name: string, out: J[]): void {
  if (isObj(v) && !Array.isArray(v) && name !== '*' && name in v) out.push(v[name]);
  if (name === '*') out.push(...children(v));
  for (const c of children(v)) deep(c, name, out);
}

function compare(a: J, op: string, b: J): boolean {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return (a as number) < (b as number);
    case '<=': return (a as number) <= (b as number);
    case '>': return (a as number) > (b as number);
    case '>=': return (a as number) >= (b as number);
  }
  return false;
}

export function jsonPath(data: J, path: string): J[] {
  let cur: J[] = [data];
  for (const seg of tokenize(path)) {
    const next: J[] = [];
    for (const v of cur) {
      switch (seg.t) {
        case 'child':
          for (const n of seg.names) {
            if (typeof n === 'number' && Array.isArray(v)) {
              const idx = n < 0 ? v.length + n : n;
              if (idx >= 0 && idx < v.length) next.push(v[idx]);
            } else if (typeof n === 'string' && isObj(v) && !Array.isArray(v) && n in v) next.push(v[n]);
          }
          break;
        case 'wild':
          next.push(...children(v));
          break;
        case 'deep':
          deep(v, seg.name, next);
          break;
        case 'slice':
          if (Array.isArray(v)) next.push(...v.slice(seg.start, seg.end));
          break;
        case 'filter':
          for (const c of children(v)) {
            let x: J = c;
            for (const k of seg.path) x = isObj(x) ? (x as Record<string, J>)[k] : undefined;
            if (seg.op ? compare(x, seg.op, seg.value) : x !== undefined) next.push(c);
          }
          break;
      }
    }
    cur = next;
  }
  return cur;
}
