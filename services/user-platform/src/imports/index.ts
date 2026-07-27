/**
 * Barrel do dominio de IMPORTACAO (C8).
 *
 * Tudo aqui e PURO: sem rede, sem DB, sem fs, sem relogio. O fluxo completo
 * (upload -> parse -> normalize -> match -> conflitos -> plano) e decidido sem
 * tocar em nada, e so o PLANO resultante e aplicado pelo servico de runtime.
 */

export {
  CSV_MAX_COLUMNS,
  CSV_MAX_ROWS,
  indexHeader,
  parseCsv,
  readColumn,
  stripBom,
  type CsvTable,
} from "./csv.js";

export {
  IMPORT_MAX_YEAR,
  IMPORT_MIN_YEAR,
  IMPORT_TITLE_MAX_LENGTH,
  neutralizeSpreadsheetFormula,
  normalizeTitleForMatch,
  parseEntityType,
  parseImdbId,
  parseImportDate,
  parseRating,
  parseTmdbId,
  parseYear,
  sanitizeTitle,
} from "./normalize.js";

export {
  dedupeRecords,
  parseSourceRows,
  validateSourceHeader,
  type ParsedSourceRows,
} from "./sources.js";

export {
  AUTO_APPLICABLE_CONFIDENCES,
  classifyMatch,
  isAutoApplicable,
  tallyConfidences,
  type MatchLookup,
} from "./matching.js";

export {
  buildImportPlan,
  existingStateKey,
  type ExistingEntityState,
} from "./plan.js";

export {
  IMPORT_FILENAME_MAX_LENGTH,
  IMPORT_MAX_FILE_BYTES,
  sanitizeFileName,
  validateAndDecodeUpload,
} from "./upload.js";

export {
  CINERIE_IMPORT_FORMAT_VERSION,
  IMPORT_CONFLICT_KINDS,
  IMPORT_TARGET_STATES,
  MATCH_CONFIDENCES,
  SUPPORTED_IMPORT_SOURCES,
  type ImportAction,
  type ImportConflict,
  type ImportConflictKind,
  type ImportPlan,
  type ImportPreviewSummary,
  type ImportTargetState,
  type MatchCandidate,
  type MatchConfidence,
  type MatchedImportRecord,
  type NormalizedImportRecord,
  type RejectedImportRow,
  type SupportedImportSource,
} from "./types.js";
