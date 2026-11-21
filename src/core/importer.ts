import type { CamelFile } from './model';
import { fromXml } from './xml';
import { DslParseError, fromYaml } from './yaml';

/** Parse an uploaded route file, detecting YAML or XML by name and content. */
export function importText(name: string, text: string): CamelFile {
  if (!text.trim()) throw new DslParseError('The file is empty or too large (max 2 MB)');
  const lower = name.toLowerCase();
  if (lower.endsWith('.xml') || (!lower.endsWith('.yaml') && !lower.endsWith('.yml') && text.trimStart().startsWith('<'))) return fromXml(text);
  return fromYaml(text);
}

export function baseName(name: string): string {
  return name.replace(/\.(camel\.)?(ya?ml|xml)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Imported routes';
}
