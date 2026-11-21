/** Lightweight syntax highlighting for YAML, XML and Java (returns safe HTML). */
export type CodeLang = 'yaml' | 'xml' | 'java' | 'markdown' | 'json' | 'text';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, s: string) => `<span class="${cls}">${s}</span>`;

function exprs(s: string): string {
  // ${...} and {{...}} inside already-escaped text
  return s.replace(/(\$\{[^}]*\}|\{\{[^}]*\}\})/g, (m) => span('tk-expr', m));
}

function yamlLine(line: string): string {
  const ci = line.search(/(^|\s)#/);
  let code = line;
  let comment = '';
  if (ci >= 0 && !/["']/.test(line.slice(0, ci))) {
    code = line.slice(0, ci);
    comment = line.slice(ci);
  }
  const m = /^(\s*(?:-\s+)?)([\w.$@-]+)(:)(\s|$)(.*)$/.exec(code);
  let out: string;
  if (m) {
    const value = m[5];
    out = esc(m[1]) + span('tk-key', esc(m[2])) + esc(m[3]) + esc(m[4]) + yamlValue(value);
  } else {
    const d = /^(\s*-\s*)(.*)$/.exec(code);
    out = d ? esc(d[1]) + yamlValue(d[2]) : yamlValue(code);
  }
  return out + (comment ? span('tk-com', esc(comment)) : '');
}

function yamlValue(v: string): string {
  if (!v) return '';
  if (/^\s*(true|false|null|~)\s*$/.test(v)) return span('tk-kw', esc(v));
  if (/^\s*-?\d+(\.\d+)?\s*$/.test(v)) return span('tk-num', esc(v));
  return span('tk-str', exprs(esc(v)));
}

function xmlLine(line: string): string {
  let out = '';
  const re = /(<!--.*?-->)|(<\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?>)|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1]) out += span('tk-com', esc(m[1]));
    else if (m[3]) {
      const attrs = (m[4] ?? '').replace(/([\w:.-]+)(\s*=\s*)("[^"]*")/g, (_a, n: string, eq: string, val: string) => `\u0001${n}\u0002${eq}\u0003${val}\u0004`);
      const attrHtml = esc(attrs)
        .replace(/\u0001([^\u0002]*)\u0002/g, (_x, n: string) => span('tk-attr', n))
        .replace(/\u0003([^\u0004]*)\u0004/g, (_x, v: string) => span('tk-str', exprs(v)));
      out += span('tk-tag', esc(m[2] + m[3])) + attrHtml + span('tk-tag', esc(m[5]));
    } else if (m[6]) out += exprs(esc(m[6]));
    else out += esc(m[0]);
  }
  return out;
}

const JAVA_KW = /\b(package|import|public|private|protected|class|extends|implements|void|throws|return|new|static|final|true|false|null|@Override|@Component|@SpringBootApplication)\b/g;

function javaLine(line: string): string {
  const ci = line.indexOf('//');
  const code = ci >= 0 ? line.slice(0, ci) : line;
  const comment = ci >= 0 ? line.slice(ci) : '';
  const parts = code.split(/("(?:[^"\\]|\\.)*")/g);
  const html = parts
    .map((p, i) =>
      i % 2 === 1
        ? span('tk-str', exprs(esc(p)))
        : esc(p)
            .replace(JAVA_KW, (k) => span('tk-kw', k))
            .replace(/\.(\w+)(?=\()/g, (_m, f: string) => `.${span('tk-fn', f)}`)
            .replace(/\b(\d+)\b/g, (n) => span('tk-num', n)),
    )
    .join('');
  return html + (comment ? span('tk-com', esc(comment)) : '');
}

function jsonLine(line: string): string {
  return esc(line)
    .replace(/(&quot;|")((?:[^"\\]|\\.)*)"(\s*:)/g, (_m, _q, k: string, c: string) => `${span('tk-key', `"${k}"`)}${c}`)
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, (m, v: string) => m.replace(v, span('tk-str', v)))
    .replace(/\b(true|false|null)\b/g, (k) => span('tk-kw', k));
}

export function highlight(code: string, lang: CodeLang): string {
  const fn = lang === 'yaml' ? yamlLine : lang === 'xml' ? xmlLine : lang === 'java' ? javaLine : lang === 'json' ? jsonLine : esc;
  return code.split('\n').map(fn).join('\n');
}
