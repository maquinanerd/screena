/**
 * sources.ts — mapeamento COLUNA -> registro normalizado, por fonte (C8).
 *
 * PURO. Cada fonte declara quais colunas reconhece e como as traduz. Nenhum
 * mapeamento adivinha: coluna ausente vira `null`, e uma linha sem o minimo
 * necessario (titulo, ou um id externo) e REJEITADA com motivo — nunca
 * importada "pela metade".
 *
 * FONTES E LIMITES, declarados de proposito:
 *
 *  - `cinerie_csv`: formato canonico e versionado da Cinerie. Carrega
 *    `tmdb_id`/`imdb_id`, entao permite match EXATO. E o formato de
 *    portabilidade (o que a exportacao produz e a importacao consome).
 *
 *  - `letterboxd_csv`: o export oficial que o proprio usuario baixa. As colunas
 *    (`Date`, `Name`, `Year`, `Letterboxd URI`, `Rating`) sao as do arquivo
 *    real. IMPORTANTE: o export do Letterboxd NAO traz id do TMDB nem do IMDb —
 *    so a URI do proprio Letterboxd, que nao e chave do nosso catalogo. Por
 *    isso essas linhas so podem casar por titulo+ano, e o resultado tende a
 *    `high_confidence`/`ambiguous`, nunca `exact`. Essa limitacao e do FORMATO,
 *    nao da implementacao, e esta registrada na documentacao.
 *
 * O que NAO e suportado, e por que: `trakt_export` e `cinerie_json` existem no
 * enum do banco mas nao tem formato verificavel implementado aqui — sao
 * recusados com mensagem clara em vez de aceitos e silenciosamente ignorados.
 * Scraping autenticado, senha de plataforma e API privada estao fora de
 * cogitacao (a missao os proibe e nenhum deles e necessario).
 */

import { type DomainResult, err, ok } from "../core/result.js";
import { indexHeader, readColumn, type CsvTable } from "./csv.js";
import {
  parseEntityType,
  parseImdbId,
  parseImportDate,
  parseRating,
  parseTmdbId,
  parseYear,
  normalizeTitleForMatch,
  sanitizeTitle,
} from "./normalize.js";
import {
  type ImportTargetState,
  type NormalizedImportRecord,
  type RejectedImportRow,
  type SupportedImportSource,
} from "./types.js";

export interface ParsedSourceRows {
  readonly records: readonly NormalizedImportRecord[];
  readonly rejected: readonly RejectedImportRow[];
}

/** Colunas obrigatorias por fonte — a ausencia reprova o arquivo inteiro. */
const REQUIRED_COLUMNS: Readonly<Record<SupportedImportSource, readonly string[]>> = {
  cinerie_csv: ["title"],
  letterboxd_csv: ["name"],
};

/**
 * Confere se o cabecalho pertence a fonte declarada.
 *
 * Reprovar o ARQUIVO (e nao linha a linha) quando a coluna obrigatoria falta e
 * deliberado: um usuario que enviou o arquivo errado precisa saber disso de
 * imediato, nao receber "3000 linhas invalidas".
 */
export function validateSourceHeader(
  source: SupportedImportSource,
  table: CsvTable,
): DomainResult<true> {
  const header = indexHeader(table.header);
  const faltando = REQUIRED_COLUMNS[source].filter((c) => !header.has(c));
  if (faltando.length > 0) {
    return err("validation_failed", "cabecalho do arquivo nao corresponde a fonte escolhida.", [
      `colunas obrigatorias ausentes: ${faltando.join(", ")}`,
    ]);
  }
  return ok(true);
}

/** Le o estado alvo declarado no CSV canonico. */
function parseTargetState(raw: string | null): ImportTargetState | null {
  if (raw === null) {
    return null;
  }
  const valor = raw.trim().toLowerCase();
  if (valor === "watchlist" || valor === "watched" || valor === "list_item") {
    return valor;
  }
  return null;
}

/**
 * Le as linhas ja validadas do CSV canonico da Cinerie.
 *
 * Colunas: `entity_type`, `tmdb_id`, `imdb_id`, `title`, `year`, `state`,
 * `watched_at`, `list`, `rating`.
 */
function parseCinerieRows(table: CsvTable): ParsedSourceRows {
  const header = indexHeader(table.header);
  const records: NormalizedImportRecord[] = [];
  const rejected: RejectedImportRow[] = [];

  table.rows.forEach((row, indice) => {
    // +2: 1 pelo cabecalho, 1 porque a numeracao do usuario e 1-based.
    const rawRowNumber = indice + 2;

    const title = sanitizeTitle(readColumn(row, header, "title"));
    const tmdbId = parseTmdbId(readColumn(row, header, "tmdb_id"));
    const imdbId = parseImdbId(readColumn(row, header, "imdb_id"));

    if (title === null && tmdbId === null && imdbId === null) {
      rejected.push({ rawRowNumber, reason: "linha sem titulo e sem id externo" });
      return;
    }

    const state = parseTargetState(readColumn(row, header, "state")) ?? "watched";
    const listName = readColumn(row, header, "list");
    if (state === "list_item" && listName === null) {
      rejected.push({ rawRowNumber, reason: "item de lista sem nome de lista" });
      return;
    }

    records.push({
      rawRowNumber,
      entityType: parseEntityType(readColumn(row, header, "entity_type")),
      title: title ?? "",
      titleNormalized: title === null ? "" : normalizeTitleForMatch(title),
      year: parseYear(readColumn(row, header, "year")),
      tmdbId,
      imdbId,
      targetState: state,
      watchedAt: parseImportDate(readColumn(row, header, "watched_at")),
      listName,
      // O CSV canonico ja usa a escala da Cinerie (0.5..5).
      rating: parseRating(readColumn(row, header, "rating"), 5),
    });
  });

  return { records, rejected };
}

/**
 * Le as linhas de um export do Letterboxd.
 *
 * `targetState` vem do ARQUIVO escolhido pelo usuario, nao de uma coluna: o
 * export separa `watched.csv`, `watchlist.csv`, `diary.csv` e `ratings.csv`, e
 * todos compartilham o mesmo cabecalho basico. Por isso o chamador informa o
 * estado alvo — deduzi-lo do conteudo seria adivinhacao.
 */
function parseLetterboxdRows(table: CsvTable, targetState: ImportTargetState): ParsedSourceRows {
  const header = indexHeader(table.header);
  const records: NormalizedImportRecord[] = [];
  const rejected: RejectedImportRow[] = [];

  table.rows.forEach((row, indice) => {
    const rawRowNumber = indice + 2;
    const title = sanitizeTitle(readColumn(row, header, "name"));
    if (title === null) {
      rejected.push({ rawRowNumber, reason: "linha sem titulo" });
      return;
    }

    records.push({
      rawRowNumber,
      // O export do Letterboxd e de FILMES. Assumir `movie` aqui e o fato do
      // formato, nao um default preguicoso.
      entityType: "movie",
      title,
      titleNormalized: normalizeTitleForMatch(title),
      year: parseYear(readColumn(row, header, "year")),
      // O export NAO traz id do TMDB/IMDb — so a URI do Letterboxd, que nao e
      // chave do nosso catalogo. Por isso estas linhas nunca casam `exact`.
      tmdbId: null,
      imdbId: null,
      targetState,
      // `Watched Date` existe no diary; `Date` (data do registro) e o fallback.
      watchedAt:
        targetState === "watched"
          ? parseImportDate(
              readColumn(row, header, "watched date") ?? readColumn(row, header, "date"),
            )
          : null,
      listName: null,
      // Letterboxd exporta nota em 0.5..5 — mesma escala da Cinerie.
      rating: parseRating(readColumn(row, header, "rating"), 5),
    });
  });

  return { records, rejected };
}

/** Despacha para o leitor da fonte. */
export function parseSourceRows(
  source: SupportedImportSource,
  table: CsvTable,
  targetState: ImportTargetState,
): ParsedSourceRows {
  return source === "cinerie_csv"
    ? parseCinerieRows(table)
    : parseLetterboxdRows(table, targetState);
}

/**
 * Deduplica linhas equivalentes DENTRO do mesmo arquivo.
 *
 * Identidade: id externo quando existe; senao titulo normalizado + ano + estado
 * alvo. Um export com a mesma obra repetida (comum em `diary.csv`, que tem uma
 * linha por sessao) nao deve virar duas escritas — e o dedup aqui e o que
 * mantem a contagem do preview honesta.
 *
 * Mantem a PRIMEIRA ocorrencia: e a que o usuario ve primeiro no arquivo.
 */
export function dedupeRecords(records: readonly NormalizedImportRecord[]): {
  readonly unique: readonly NormalizedImportRecord[];
  readonly duplicates: number;
} {
  const vistos = new Set<string>();
  const unique: NormalizedImportRecord[] = [];
  let duplicates = 0;

  for (const record of records) {
    const identidade =
      record.tmdbId !== null
        ? `tmdb:${record.entityType}:${record.tmdbId}:${record.targetState}`
        : record.imdbId !== null
          ? `imdb:${record.entityType}:${record.imdbId}:${record.targetState}`
          : `title:${record.entityType}:${record.titleNormalized}:${record.year ?? ""}:${record.targetState}:${record.listName ?? ""}`;

    if (vistos.has(identidade)) {
      duplicates += 1;
      continue;
    }
    vistos.add(identidade);
    unique.push(record);
  }

  return { unique, duplicates };
}
