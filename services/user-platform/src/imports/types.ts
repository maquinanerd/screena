/**
 * types.ts — vocabulario da IMPORTACAO (C8).
 *
 * A importacao tem UM fluxo, e os tipos aqui o descrevem em ordem:
 *
 *   upload -> parse -> normalize -> match -> conflitos -> preview -> apply
 *
 * A linha BRUTA do arquivo nunca chega a persistencia: ela vira
 * `NormalizedImportRecord` (este modulo), depois `MatchedImportRecord`, e so o
 * PLANO derivado disso e aplicado. E o que impede um CSV de terceiro de
 * escrever direto na biblioteca do usuario.
 */

import type { RatableEntityType, WatchableEntityType } from "../core/types.js";

/** Formato canonico da Cinerie; versionado para sobreviver a mudancas. */
export const CINERIE_IMPORT_FORMAT_VERSION = "cinerie.import.v1";

/**
 * Fontes que esta unidade REALMENTE le.
 *
 * O enum `ImportSource` do banco tem quatro valores (`letterboxd_csv`,
 * `trakt_export`, `cinerie_json`, `cinerie_csv`); implementar dois e uma
 * escolha explicita, nao um esquecimento:
 *  - `cinerie_csv` e o formato canonico, com id externo, e permite match exato;
 *  - `letterboxd_csv` e o export oficial que o proprio usuario baixa, com
 *    colunas publicamente documentadas.
 * `trakt_export` e `cinerie_json` sao recusados com mensagem clara ate haver
 * formato verificavel — prometer suporte que nao existe seria pior do que a
 * ausencia. Ver docs/product/user-product-library.md.
 */
export const SUPPORTED_IMPORT_SOURCES = ["cinerie_csv", "letterboxd_csv"] as const;
export type SupportedImportSource = (typeof SUPPORTED_IMPORT_SOURCES)[number];

/** Estado que uma linha importada pede para a biblioteca. */
export const IMPORT_TARGET_STATES = ["watchlist", "watched", "list_item"] as const;
export type ImportTargetState = (typeof IMPORT_TARGET_STATES)[number];

/**
 * Linha ja NORMALIZADA: o unico formato que o matching enxerga.
 *
 * `rawRowNumber` (1-based, contando o cabecalho) existe para que todo relatorio
 * consiga apontar a linha do arquivo original — sem isso, "12 itens ambiguos"
 * seria uma informacao que o usuario nao consegue acionar.
 */
export interface NormalizedImportRecord {
  readonly rawRowNumber: number;
  readonly entityType: WatchableEntityType;
  readonly title: string;
  /** Titulo normalizado para comparacao (minusculo, sem acento/pontuacao). */
  readonly titleNormalized: string;
  readonly year: number | null;
  readonly tmdbId: number | null;
  readonly imdbId: string | null;
  readonly targetState: ImportTargetState;
  /** Quando o usuario assistiu. NUNCA e substituido por `now()` na aplicacao. */
  readonly watchedAt: Date | null;
  /** Nome da lista de destino, quando `targetState = "list_item"`. */
  readonly listName: string | null;
  /** Nota pessoal 0.5..5.0, ja convertida para a escala da Cinerie. */
  readonly rating: number | null;
}

/** Linha recusada no parse/normalizacao, com o motivo acionavel. */
export interface RejectedImportRow {
  readonly rawRowNumber: number;
  readonly reason: string;
}

/**
 * Confianca do match. So `exact` e aplicado automaticamente.
 *
 * `high_confidence` existe como categoria porque titulo+ano com resultado UNICO
 * e um sinal forte — mas ele NAO e aplicado sozinho nesta unidade: a regra
 * formal que autorizaria isso (desambiguacao por idioma/pais/duracao) nao
 * existe, e aplicar sem ela seria adivinhar. Ver `matching.ts`.
 */
export const MATCH_CONFIDENCES = [
  "exact",
  "high_confidence",
  "ambiguous",
  "not_found",
  "unsupported",
] as const;
export type MatchConfidence = (typeof MATCH_CONFIDENCES)[number];

/** Candidato do catalogo considerado para uma linha. */
export interface MatchCandidate {
  readonly entityType: WatchableEntityType;
  readonly entityId: bigint;
  readonly title: string;
  readonly year: number | null;
}

/** Linha + veredito do matching. */
export interface MatchedImportRecord {
  readonly record: NormalizedImportRecord;
  readonly confidence: MatchConfidence;
  /** Entidade escolhida — SO preenchida quando a confianca autoriza aplicar. */
  readonly resolved: MatchCandidate | null;
  /** Candidatos considerados (para o relatorio de ambiguidade). */
  readonly candidates: readonly MatchCandidate[];
}

/** Tipos de conflito entre o arquivo e o que o usuario ja tem. */
export const IMPORT_CONFLICT_KINDS = [
  /** O arquivo diz "assistido" e a Cinerie ja tem uma data DIFERENTE. */
  "watched_at_divergent",
  /** O arquivo pede watchlist e a Cinerie ja marcou como assistido. */
  "already_watched",
  /** O arquivo traz nota e a Cinerie ja tem outra nota para a mesma obra. */
  "rating_divergent",
] as const;
export type ImportConflictKind = (typeof IMPORT_CONFLICT_KINDS)[number];

export interface ImportConflict {
  readonly rawRowNumber: number;
  readonly kind: ImportConflictKind;
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  /** Descricao curta e segura; nunca ecoa a linha bruta inteira. */
  readonly detail: string;
}

/** Contagens que a tela de pre-visualizacao mostra ANTES de qualquer escrita. */
export interface ImportPreviewSummary {
  readonly formatVersion: string;
  readonly source: SupportedImportSource;
  readonly totalRows: number;
  readonly validRows: number;
  readonly rejectedRows: number;
  readonly duplicateRows: number;
  readonly exact: number;
  readonly highConfidence: number;
  readonly ambiguous: number;
  readonly notFound: number;
  readonly unsupported: number;
  readonly watchlist: number;
  readonly watched: number;
  readonly listItems: number;
  readonly ratingsIgnored: number;
  readonly conflicts: number;
  /** Quantas linhas seriam efetivamente aplicadas se o usuario confirmar. */
  readonly applicable: number;
}

/**
 * UMA acao aplicavel, ja resolvida. E o unico formato que o servico de
 * aplicacao consome — o plano e deterministico e ordenado, o que torna a
 * retomada (`resume`) possivel por indice.
 */
export interface ImportAction {
  readonly rawRowNumber: number;
  readonly entityType: WatchableEntityType;
  readonly entityId: bigint;
  readonly targetState: ImportTargetState;
  readonly watchedAt: Date | null;
  readonly listName: string | null;
  readonly rating: number | null;
}

/** Plano completo: o que aplicar, o que ficou de fora e por que. */
export interface ImportPlan {
  readonly summary: ImportPreviewSummary;
  readonly actions: readonly ImportAction[];
  readonly conflicts: readonly ImportConflict[];
  readonly rejected: readonly RejectedImportRow[];
  /** Linhas nao resolvidas, preservadas para reprocessar quando o catalogo crescer. */
  readonly unmatched: readonly {
    readonly rawRowNumber: number;
    readonly title: string;
    readonly year: number | null;
    readonly confidence: MatchConfidence;
  }[];
}
