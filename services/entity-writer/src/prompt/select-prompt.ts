/**
 * select-prompt.ts — Resolucao do prompt versionado da Fase 3A.
 *
 * Le `prompts/entity_intro_pt.md` (prompt combinado que gera `editorial_intro`
 * + `cast_intro`), extrai o `prompt_version` do frontmatter e retorna conteudo
 * + versao. O `prompt_version` e obrigatorio (invariante 13): ausencia falha
 * explicitamente.
 *
 * WORKER/SERVER-ONLY: usa `node:fs`/`node:url`. Sem Gemini, sem rede, sem
 * runtime web — e nunca importado pelo render publico (apps/web).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Caminho do prompt relativo a este modulo (services/entity-writer/src/prompt). */
const ENTITY_INTRO_PROMPT_PATH = "../../../../prompts/entity_intro_pt.md";

/** Prompt resolvido: conteudo + versao registrada no frontmatter. */
export interface SelectedPrompt {
  readonly promptVersion: string;
  readonly content: string;
}

/**
 * Extrai `prompt_version` do frontmatter YAML simples (bloco entre `---`).
 * Lanca se ausente — versionamento e obrigatorio.
 */
export function parsePromptVersion(content: string): string {
  const frontmatter = content.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/)?.[1] ?? "";
  const version = frontmatter.match(/^\s*prompt_version:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
  if (version === undefined) {
    throw new Error(
      "prompt_version ausente no frontmatter do prompt (versionamento obrigatorio — invariante 13).",
    );
  }
  return version.trim();
}

/** Resolve o prompt combinado da Fase 3A (`prompts/entity_intro_pt.md`). */
export function selectEntityIntroPrompt(): SelectedPrompt {
  const promptUrl = new URL(ENTITY_INTRO_PROMPT_PATH, import.meta.url);
  const content = readFileSync(fileURLToPath(promptUrl), "utf8");
  return { promptVersion: parsePromptVersion(content), content };
}
