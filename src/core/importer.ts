import { detectContract, fromContract, type ContractKind } from './contract';
import type { CamelFile } from './model';
import { fromXml } from './xml';
import { DslParseError, fromYaml } from './yaml';

export const IMPORT_ACCEPT = '.yaml,.yml,.xml,.json,.wsdl';

export interface ImportResult {
  file: CamelFile;
  /** Set when the file was an API contract and routes were scaffolded from it. */
  contract?: ContractKind;
}

/** Parse an uploaded file: Camel YAML/XML routes, or an OpenAPI / AsyncAPI / WSDL contract. */
export function importAny(name: string, text: string): ImportResult {
  if (!text.trim()) throw new DslParseError('The file is empty or too large (max 2 MB)');
  const contract = detectContract(name, text);
  if (contract) return { file: fromContract(contract, name, text), contract };
  const lower = name.toLowerCase();
  if (lower.endsWith('.xml') || (!lower.endsWith('.yaml') && !lower.endsWith('.yml') && text.trimStart().startsWith('<'))) return { file: fromXml(text) };
  return { file: fromYaml(text) };
}

/** @deprecated use importAny */
export function importText(name: string, text: string): CamelFile {
  return importAny(name, text).file;
}

export function baseName(name: string): string {
  return name.replace(/\.(camel\.)?(ya?ml|xml|json|wsdl)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Imported routes';
}

export const CONTRACT_LABEL: Record<ContractKind, string> = { openapi: 'OpenAPI', asyncapi: 'AsyncAPI', wsdl: 'WSDL' };
