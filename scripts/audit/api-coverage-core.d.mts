/**
 * Declaracoes de tipo para api-coverage-core.mjs (nucleo puro do validador de
 * cobertura de API — Fase 5). O runtime e ESM `.mjs` (rodado por Node no CLI e
 * importado pelo Vitest); este `.d.mts` da os tipos ao `tsc`.
 */

export const COVERAGE_STATES: readonly string[];
export const RATING_SOURCES: readonly string[];
export const ROLES: readonly string[];
export const PROVIDER_KINDS: readonly string[];
export const ENUMERATION_SOURCES: readonly { readonly file: string; readonly label: string }[];

export function parseProvidersYaml(text: string): {
  providers: Record<string, string | boolean>[];
  errors: string[];
};

export function evaluateApiCoverage(input: {
  providersText: string;
  endpoints: unknown;
  fields: unknown;
  readText: (relPath: string) => Promise<string | null>;
  enumerationSources?: { file: string; label: string }[];
}): Promise<{ violations: string[]; warnings: string[]; passes: string[] }>;
