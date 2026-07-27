/**
 * plan.ts — CONFLITOS e PLANO de aplicacao (C8). Puro.
 *
 * POLITICA DE CONFLITO, declarada uma vez:
 *
 *  - NUNCA regredir carimbo. Se a Cinerie ja tem `watchedAt` e o arquivo traz
 *    uma data DIFERENTE, a data local vence e o caso vira CONFLITO relatado. O
 *    contrario (arquivo sobrescrevendo silenciosamente) apagaria historico que
 *    o usuario registrou aqui.
 *  - NUNCA rebaixar estado. Arquivo pedindo `watchlist` para algo ja `watched`
 *    nao volta o titulo para "quero assistir": e conflito informado, nao
 *    escrita.
 *  - Nota divergente e conflito, nao sobrescrita.
 *  - Uniao, nunca substituicao: importar acrescenta a biblioteca; nada e
 *    removido por importacao.
 *
 * O plano resultante e DETERMINISTICO e ORDENADO por `rawRowNumber`. E o que
 * torna a retomada possivel por indice: reprocessar a partir de `appliedCount`
 * visita exatamente as mesmas acoes na mesma ordem.
 */

import type {
  ImportAction,
  ImportConflict,
  ImportPlan,
  ImportPreviewSummary,
  MatchedImportRecord,
  RejectedImportRow,
  SupportedImportSource,
} from "./types.js";
import { CINERIE_IMPORT_FORMAT_VERSION } from "./types.js";
import { isAutoApplicable, tallyConfidences } from "./matching.js";

/** Estado que a Cinerie ja tem para uma entidade — insumo dos conflitos. */
export interface ExistingEntityState {
  readonly entityId: bigint;
  readonly status: "planned" | "watching" | "watched" | "paused" | "dropped" | "rewatching" | "not_interested" | null;
  readonly watchedAt: Date | null;
  readonly rating: number | null;
}

/** Chave de consulta do estado atual, por entidade. */
export function existingStateKey(entityType: string, entityId: bigint): string {
  return `${entityType}:${entityId.toString(10)}`;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.getTime() === b.getTime();
}

/**
 * Monta o plano completo a partir dos matches e do estado atual do usuario.
 *
 * NENHUMA ESCRITA acontece aqui — este modulo e puro. O servico de aplicacao
 * consome `actions` e nada mais; tudo que ficou de fora esta em `conflicts`,
 * `rejected` ou `unmatched`, com o numero da linha original.
 */
export function buildImportPlan(input: {
  readonly source: SupportedImportSource;
  readonly matches: readonly MatchedImportRecord[];
  readonly rejected: readonly RejectedImportRow[];
  readonly duplicateRows: number;
  readonly totalRows: number;
  /** Estado atual do usuario, indexado por `existingStateKey`. */
  readonly existing: ReadonlyMap<string, ExistingEntityState>;
}): ImportPlan {
  const actions: ImportAction[] = [];
  const conflicts: ImportConflict[] = [];
  const unmatched: {
    rawRowNumber: number;
    title: string;
    year: number | null;
    confidence: MatchedImportRecord["confidence"];
  }[] = [];

  let watchlist = 0;
  let watched = 0;
  let listItems = 0;
  let ratingsIgnored = 0;

  for (const match of input.matches) {
    const { record, resolved, confidence } = match;

    if (!isAutoApplicable(confidence) || resolved === null) {
      // Preservado com o numero da linha para que o usuario possa resolver
      // depois — e para que o catalogo, ao crescer, permita reprocessar.
      unmatched.push({
        rawRowNumber: record.rawRowNumber,
        title: record.title,
        year: record.year,
        confidence,
      });
      continue;
    }

    const atual = input.existing.get(existingStateKey(resolved.entityType, resolved.entityId));

    // --- Conflitos (relatados; NUNCA sobrescrevem) -------------------------
    if (
      record.targetState === "watched" &&
      atual?.watchedAt != null &&
      record.watchedAt !== null &&
      !sameInstant(atual.watchedAt, record.watchedAt)
    ) {
      conflicts.push({
        rawRowNumber: record.rawRowNumber,
        kind: "watched_at_divergent",
        entityType: resolved.entityType,
        entityId: resolved.entityId,
        detail: "ja existe uma data de conclusao diferente na Cinerie; a local foi mantida.",
      });
      // Segue aplicavel: o estado `watched` e o mesmo, so o carimbo diverge —
      // e o carimbo local vence (ver politica no cabecalho).
    }

    if (record.targetState === "watchlist" && atual?.status === "watched") {
      conflicts.push({
        rawRowNumber: record.rawRowNumber,
        kind: "already_watched",
        entityType: resolved.entityType,
        entityId: resolved.entityId,
        detail: "o arquivo pede 'quero assistir' para um titulo ja assistido; estado mantido.",
      });
      // NAO vira acao: rebaixar `watched` para `planned` perderia informacao.
      continue;
    }

    if (
      record.rating !== null &&
      atual?.rating != null &&
      atual.rating !== record.rating
    ) {
      conflicts.push({
        rawRowNumber: record.rawRowNumber,
        kind: "rating_divergent",
        entityType: resolved.entityType,
        entityId: resolved.entityId,
        detail: "ja existe nota diferente na Cinerie; a local foi mantida.",
      });
      ratingsIgnored += 1;
    }

    // --- Acao aplicavel ----------------------------------------------------
    const notaAplicavel = atual?.rating == null ? record.rating : null;
    if (record.rating !== null && notaAplicavel === null && atual?.rating == null) {
      ratingsIgnored += 1;
    }

    actions.push({
      rawRowNumber: record.rawRowNumber,
      entityType: resolved.entityType,
      entityId: resolved.entityId,
      targetState: record.targetState,
      // Carimbo do ARQUIVO, nunca `now()`: importar historico e declarar
      // quando algo foi assistido, e substituir isso por "agora" inventaria
      // um fato que o usuario nao informou.
      watchedAt: record.watchedAt,
      listName: record.listName,
      rating: notaAplicavel,
    });

    if (record.targetState === "watchlist") watchlist += 1;
    else if (record.targetState === "watched") watched += 1;
    else listItems += 1;
  }

  // Ordem deterministica pela linha do arquivo — base da retomada por indice.
  actions.sort((a, b) => a.rawRowNumber - b.rawRowNumber);

  const tally = tallyConfidences(input.matches);
  const summary: ImportPreviewSummary = {
    formatVersion: CINERIE_IMPORT_FORMAT_VERSION,
    source: input.source,
    totalRows: input.totalRows,
    validRows: input.matches.length,
    rejectedRows: input.rejected.length,
    duplicateRows: input.duplicateRows,
    exact: tally.exact,
    highConfidence: tally.high_confidence,
    ambiguous: tally.ambiguous,
    notFound: tally.not_found,
    unsupported: tally.unsupported,
    watchlist,
    watched,
    listItems,
    ratingsIgnored,
    conflicts: conflicts.length,
    applicable: actions.length,
  };

  return { summary, actions, conflicts, rejected: input.rejected, unmatched };
}
