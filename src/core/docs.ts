import { EIP_BY_TYPE } from './eip';
import { allOnExceptions, endpoints, isKnown, type CamelFile, type Expression, type Step } from './model';

const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/[<>]/g, (c) => (c === '<' ? '#lt;' : '#gt;'));
const short = (s: string, n = 42) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ex = (e?: Expression) => (e ? `${e.language}: ${short(e.expression, 30)}` : '');

interface Exit {
  id: string;
  label?: string;
}

/** Mermaid flowchart of every route in the file. */
export function toMermaid(file: CamelFile): string {
  const lines = ['flowchart LR'];
  let n = 0;
  const node = (label: string, shape: 'box' | 'diamond' | 'round' = 'box') => {
    const id = `n${++n}`;
    const l = esc(label);
    lines.push(shape === 'diamond' ? `    ${id}{"${l}"}` : shape === 'round' ? `    ${id}(["${l}"])` : `    ${id}["${l}"]`);
    return id;
  };
  const link = (from: Exit[], to: string, dashed = false) => {
    for (const f of from) lines.push(`    ${f.id} ${dashed ? '-.->' : '-->'}${f.label ? `|${esc(f.label)}|` : ''} ${to}`);
  };

  const chain = (steps: Step[], prev: Exit[]): Exit[] => {
    let exits = prev;
    for (const s of steps) exits = emit(s, exits);
    return exits;
  };

  const emit = (s: Step, prev: Exit[]): Exit[] => {
    if (!isKnown(s)) {
      const id = node(`${s.name} (unsupported)`);
      link(prev, id);
      return [{ id }];
    }
    const def = EIP_BY_TYPE[s.type];
    switch (s.type) {
      case 'choice': {
        const d = node('choice', 'diamond');
        link(prev, d);
        const exits: Exit[] = [];
        let hasOtherwise = false;
        for (const b of s.branches ?? []) {
          const label = b.kind === 'when' ? short(b.expression?.expression ?? '', 28) : 'otherwise';
          if (b.kind === 'otherwise') hasOtherwise = true;
          if (!b.steps.length) exits.push({ id: d, label });
          else exits.push(...chain(b.steps, [{ id: d, label }]));
        }
        if (!hasOtherwise) exits.push({ id: d, label: 'otherwise' });
        return exits;
      }
      case 'doTry': {
        const t = node('doTry');
        link(prev, t);
        const exits = chain(s.steps ?? [], [{ id: t }]);
        let fin: Step[] = [];
        for (const b of s.branches ?? []) {
          if (b.kind === 'doCatch') {
            const c = node(`doCatch ${short((b.exceptions ?? []).map((e) => e.split('.').pop()).join(', '), 30)}`, 'round');
            link([{ id: t }], c, true);
            exits.push(...chain(b.steps, [{ id: c }]));
          }
          if (b.kind === 'doFinally') fin = b.steps;
        }
        return fin.length ? chain(fin, exits) : exits;
      }
      default: {
        const label =
          def.uri ? `${s.type}: ${short(s.props.uri ?? '')}` :
          s.type === 'log' ? `log: ${short(s.props.message ?? '', 30)}` :
          s.type === 'setHeader' || s.type === 'setProperty' ? `${s.type} ${s.props.name}` :
          s.type === 'marshal' || s.type === 'unmarshal' ? `${s.type} ${s.props.format}` :
          s.type === 'bean' || s.type === 'process' ? `${s.type} ${s.props.ref ?? ''}` :
          s.expression ? `${s.type} (${ex(s.expression)})` : s.type;
        const id = node(label);
        link(prev, id);
        if (s.steps) {
          const inner = chain(s.steps, [{ id, label: s.type === 'filter' ? 'match' : 'each' }]);
          void inner;
          return [{ id, label: s.type === 'filter' ? 'continue' : 'done' }];
        }
        return [{ id }];
      }
    }
  };

  for (const r of file.routes) {
    lines.push(`    subgraph ${r.id.replace(/\W/g, '_')}["route: ${esc(r.routeId)}"]`);
    const f = node(`from: ${short(r.from.uri)}`, 'round');
    chain(r.steps, [{ id: f }]);
    lines.push('    end');
  }
  for (const e of allOnExceptions(file)) {
    lines.push(`    subgraph ${e.id.replace(/\W/g, '_')}["onException"]`);
    const h = node(`onException ${short(e.exceptions.map((x) => x.split('.').pop()).join(', '))}`, 'round');
    chain(e.steps, [{ id: h }]);
    lines.push('    end');
  }
  return lines.join('\n') + '\n';
}

export function endpointTableMarkdown(file: CamelFile): string {
  const rows = endpoints(file);
  const head = '| Route | Direction | EIP | Endpoint |\n|---|---|---|---|';
  const body = rows.map((r) => `| ${r.routeId} | ${r.direction} | ${r.type} | \`${r.uri.replace(/\|/g, '\\|')}\` |`).join('\n');
  return `${head}\n${body}\n`;
}

export function docsMarkdown(file: CamelFile, projectName: string): string {
  return [
    `# ${projectName} — integration documentation`,
    '',
    `Routes: ${file.routes.length} · Error handlers: ${file.onExceptions.length}`,
    '',
    '## Routes',
    '',
    ...file.routes.map((r) => `- **${r.routeId}** — from \`${r.from.uri}\`${r.description ? ` — ${r.description}` : ''}`),
    '',
    '## Flow',
    '',
    '```mermaid',
    toMermaid(file).trimEnd(),
    '```',
    '',
    '## Endpoints',
    '',
    endpointTableMarkdown(file),
  ].join('\n');
}
