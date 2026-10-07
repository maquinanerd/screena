/**
 * content-block-warnings.ts — Leitura DEFENSIVA de `content_blocks.warnings_json`
 * para o admin editorial. PURO (sem rede/DB/IO, SEM imports).
 *
 * O Entity Writer grava nessa coluna um array de strings: os avisos que o proprio
 * modelo reportou (`EntityWriterOutput.warnings`) somados aos da validacao
 * anti-alucinacao (`validateAgainstPayload`, ex.: "fato fora do payload: <nome>").
 * Bloco com aviso nasce `needs_review`
 * (`services/entity-writer/src/pipeline/decide-status.ts`) — e, sem esta leitura,
 * o revisor via o status sem ver o PORQUE.
 *
 * A coluna e `Json?`: nada no banco obriga a forma. Por isso a leitura NUNCA
 * lanca: o que nao for array vira lista vazia, e dentro do array so string com
 * texto sobrevive (o resto e descartado item a item). So DESCREVE — nao muda
 * `review_status`, nao publica, nao decide indexacao.
 *
 * O contrato com o escritor (array de strings, ida e volta por JSON) e travado por
 * `tests/admin/content-block-warnings.test.ts` contra o `validateAgainstPayload`
 * real.
 */

/** Avisos visiveis por bloco na fila de revisao (o detalhe mostra todos). */
export const QUEUE_WARNINGS_SHOWN = 3;

/** Teto de caracteres por aviso na fila (o texto do modelo nao tem limite). */
export const QUEUE_WARNING_MAX_CHARS = 160;

/**
 * Le `warnings_json` cru (como o Prisma devolve um `Json?`) e devolve os avisos
 * exibiveis, na ordem gravada. Espacos sao colapsados; entrada vazia, nao-string
 * ou forma inesperada some. Nunca lanca.
 */
export function parseContentBlockWarnings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const warnings: string[] = [];
  for (const entry of raw as readonly unknown[]) {
    if (typeof entry !== "string") continue;
    const text = entry.replace(/\s+/g, " ").trim();
    if (text !== "") warnings.push(text);
  }
  return warnings;
}

/** Recorte de avisos para uma linha compacta (fila de revisao). */
export interface WarningsPreview {
  readonly shown: readonly string[];
  /** Avisos validos que ficaram de fora do recorte. */
  readonly hiddenCount: number;
}

/** Corta em `maxChars` pontos de codigo (sem partir emoji/acento composto ao meio). */
function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, maxChars).join("").trimEnd()}…`;
}

/**
 * Recorta a lista para a fila: os `maxItems` primeiros, cada um com no maximo
 * `maxChars` caracteres. Limites invalidos (negativo, fracionario, NaN) contam
 * como zero — mostra nada e conta tudo como oculto.
 */
export function previewWarnings(
  warnings: readonly string[],
  maxItems: number = QUEUE_WARNINGS_SHOWN,
  maxChars: number = QUEUE_WARNING_MAX_CHARS,
): WarningsPreview {
  const itemLimit = Number.isInteger(maxItems) && maxItems > 0 ? maxItems : 0;
  const charLimit = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 0;
  const shown =
    charLimit === 0
      ? []
      : warnings.slice(0, itemLimit).map((warning) => truncate(warning, charLimit));
  return { shown, hiddenCount: warnings.length - shown.length };
}

/** Rotulo de contagem em pt-BR ("1 aviso", "3 avisos"). */
export function warningsCountLabel(count: number): string {
  return count === 1 ? "1 aviso" : `${count} avisos`;
}
