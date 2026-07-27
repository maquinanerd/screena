/**
 * matching.ts — decisao PURA de correspondencia com o catalogo (C8).
 *
 * A REGRA CENTRAL: uma linha so vira escrita quando a identificacao e
 * INEQUIVOCA. Ambiguidade nunca e resolvida escolhendo "o primeiro" — e
 * exatamente isso que transformaria um remake em original na biblioteca de
 * alguem, sem que ninguem percebesse.
 *
 * PRIORIDADE (a primeira que resolve vence):
 *   1. id externo (TMDB / IMDb) — os dois sao UNIQUE no catalogo, entao um
 *      acerto e unico por construcao  -> `exact`
 *   2. titulo normalizado + ano, com resultado UNICO                 -> `high_confidence`
 *   3. titulo normalizado + ano, com mais de um resultado            -> `ambiguous`
 *   4. titulo SEM ano, mesmo com resultado unico                     -> `ambiguous`
 *   5. nada encontrado                                              -> `not_found`
 *
 * O caso 4 e deliberado e talvez surpreenda: um unico resultado por titulo
 * parece seguro, mas o catalogo cresce. "Dune" sem ano casaria com 1984 hoje e
 * com dois filmes amanha — e o resultado da importacao mudaria conforme a data
 * em que foi executada. Exigir o ano torna o veredito estavel no tempo.
 */

import type { MatchCandidate, MatchConfidence, MatchedImportRecord, NormalizedImportRecord } from "./types.js";

/** O que o matching recebe do catalogo para UMA linha. */
export interface MatchLookup {
  /** Resultado da busca por id externo (0 ou 1 elemento, pelos uniques). */
  readonly byExternalId: readonly MatchCandidate[];
  /** Resultado da busca por titulo (+ano quando informado). */
  readonly byTitle: readonly MatchCandidate[];
}

/**
 * Confiancas que a aplicacao automatica aceita.
 *
 * SOMENTE `exact`. `high_confidence` fica de fora nesta unidade — e um sinal
 * forte, mas a regra formal que o autorizaria (desambiguacao por idioma, pais
 * ou duracao) nao existe, e aplicar sem ela e adivinhar com outro nome. O item
 * fica no relatorio para o usuario decidir, em vez de entrar em silencio.
 */
export const AUTO_APPLICABLE_CONFIDENCES: ReadonlySet<MatchConfidence> = new Set<MatchConfidence>([
  "exact",
]);

/** true quando a confianca autoriza escrever sem confirmacao humana. */
export function isAutoApplicable(confidence: MatchConfidence): boolean {
  return AUTO_APPLICABLE_CONFIDENCES.has(confidence);
}

/**
 * Classifica UMA linha contra o que o catalogo devolveu.
 *
 * Puro e deterministico: as mesmas entradas produzem sempre o mesmo veredito,
 * o que torna o preview uma promessa confiavel sobre o que o apply fara.
 */
export function classifyMatch(
  record: NormalizedImportRecord,
  lookup: MatchLookup,
): MatchedImportRecord {
  // 1. Id externo. Um acerto e unico (UNIQUE em `movies`/`tv_shows`), entao a
  //    identificacao e inequivoca — o unico caminho que gera `exact`.
  if (lookup.byExternalId.length === 1) {
    return {
      record,
      confidence: "exact",
      resolved: lookup.byExternalId[0]!,
      candidates: lookup.byExternalId,
    };
  }
  if (lookup.byExternalId.length > 1) {
    // Dois registros com o mesmo id externo violariam o unique. Se acontecer, o
    // catalogo esta inconsistente e a linha NAO e aplicada — fail-closed.
    return {
      record,
      confidence: "ambiguous",
      resolved: null,
      candidates: lookup.byExternalId,
    };
  }

  // 2..4. Titulo.
  if (lookup.byTitle.length === 0) {
    return { record, confidence: "not_found", resolved: null, candidates: [] };
  }

  if (record.year === null) {
    // Sem ano nao ha veredito estavel no tempo (ver cabecalho).
    return { record, confidence: "ambiguous", resolved: null, candidates: lookup.byTitle };
  }

  if (lookup.byTitle.length === 1) {
    // Titulo + ano com resultado unico: sinal forte, porem NAO auto-aplicavel
    // (ver AUTO_APPLICABLE_CONFIDENCES). `resolved` e preenchido para que a
    // tela possa oferecer a confirmacao com um clique.
    return {
      record,
      confidence: "high_confidence",
      resolved: lookup.byTitle[0]!,
      candidates: lookup.byTitle,
    };
  }

  return { record, confidence: "ambiguous", resolved: null, candidates: lookup.byTitle };
}

/**
 * Conta os vereditos. Usado pelo preview; separado da classificacao para que a
 * contagem nunca possa divergir da decisao (a mesma lista alimenta os dois).
 */
export function tallyConfidences(matches: readonly MatchedImportRecord[]): Readonly<
  Record<MatchConfidence, number>
> {
  const tally: Record<MatchConfidence, number> = {
    exact: 0,
    high_confidence: 0,
    ambiguous: 0,
    not_found: 0,
    unsupported: 0,
  };
  for (const match of matches) {
    tally[match.confidence] += 1;
  }
  return tally;
}
