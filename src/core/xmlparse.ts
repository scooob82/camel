/**
 * Minimal, dependency-free XML parser (elements, attributes, text, CDATA,
 * comments, processing instructions). Works in the browser and in Node, which
 * keeps the DSL converters testable without a DOM.
 */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
  /** Offsets into the source, used to keep unknown elements verbatim. */
  start: number;
  end: number;
}

export class XmlError extends Error {
  constructor(message: string, public line: number) {
    super(`${message} (line ${line})`);
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function escapeXml(s: string, attr = false): string {
  let out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (attr) out = out.replace(/"/g, '&quot;');
  return out;
}

const localName = (n: string) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n);

export function parseXml(src: string): XmlNode {
  let i = 0;
  const lineAt = (pos: number) => src.slice(0, pos).split('\n').length;
  const fail = (msg: string): never => {
    throw new XmlError(msg, lineAt(i));
  };

  const skipMisc = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('<?', i)) {
        const e = src.indexOf('?>', i);
        if (e < 0) fail('Unterminated processing instruction');
        i = e + 2;
      } else if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i);
        if (e < 0) fail('Unterminated comment');
        i = e + 3;
      } else if (src.startsWith('<!DOCTYPE', i)) {
        const e = src.indexOf('>', i);
        i = e + 1;
      } else return;
    }
  };

  const parseElement = (): XmlNode => {
    const start = i;
    if (src[i] !== '<') fail('Expected "<"');
    i++;
    const nameMatch = /^[A-Za-z_][\w.:-]*/.exec(src.slice(i));
    if (!nameMatch) fail('Invalid element name');
    const rawName = nameMatch![0];
    i += rawName.length;
    const node: XmlNode = { name: localName(rawName), attrs: {}, children: [], text: '', start, end: start };
    for (;;) {
      while (/\s/.test(src[i] ?? '')) i++;
      if (src.startsWith('/>', i)) {
        i += 2;
        node.end = i;
        return node;
      }
      if (src[i] === '>') {
        i++;
        break;
      }
      const am = /^([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(i));
      if (!am) fail(`Invalid attribute in <${rawName}>`);
      const an = am![1];
      if (!an.startsWith('xmlns')) node.attrs[localName(an)] = decodeEntities(am![3] ?? am![4] ?? '');
      i += am![0].length;
    }
    // content
    for (;;) {
      if (i >= src.length) fail(`Unclosed element <${rawName}>`);
      if (src.startsWith('</', i)) {
        const close = /^<\/([A-Za-z_][\w.:-]*)\s*>/.exec(src.slice(i));
        if (!close) fail('Invalid closing tag');
        if (close![1] !== rawName) fail(`Expected </${rawName}> but found </${close![1]}>`);
        i += close![0].length;
        node.end = i;
        node.text = node.text.trim();
        return node;
      }
      if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i);
        if (e < 0) fail('Unterminated comment');
        i = e + 3;
      } else if (src.startsWith('<![CDATA[', i)) {
        const e = src.indexOf(']]>', i);
        if (e < 0) fail('Unterminated CDATA');
        node.text += src.slice(i + 9, e);
        i = e + 3;
      } else if (src[i] === '<') {
        node.children.push(parseElement());
      } else {
        const e = src.indexOf('<', i);
        const chunk = src.slice(i, e < 0 ? src.length : e);
        node.text += decodeEntities(chunk);
        i = e < 0 ? src.length : e;
      }
    }
  };

  skipMisc();
  if (i >= src.length) fail('Document is empty');
  const root = parseElement();
  skipMisc();
  if (i < src.length) fail('Unexpected content after root element');
  return root;
}
