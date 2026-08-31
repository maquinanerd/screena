/**
 * trailer-presenter.ts — Escolhe o trailer de uma entidade a partir das linhas
 * de `tmdb_videos`, e aplica o gate de licença. PURO: sem rede, sem Prisma.
 *
 * O GATE VEM PRIMEIRO, E É FAIL-CLOSED (invariante 6). Uma linha só é
 * candidata quando TODAS as condições valem:
 *
 *   displayAllowed === true            — a coluna-mestra
 *   licenseStatus ∉ {unknown, blocked} — a invariante 6 literal
 *   site === "YouTube"                 — é o único player que o site carrega
 *   videoType ∈ {Trailer, Teaser}      — clipe/bastidor/entrevista não é trailer
 *   videoKey passa em YOUTUBE_VIDEO_ID_PATTERN
 *
 * A LICENÇA DE VÍDEO JÁ EXISTE — ESTE PARÁGRAFO ESTAVA DESATUALIZADO.
 *
 * Até 20/08/2026 aqui se lia que `authorization-spec.ts` "não tem entrada de
 * licença para VÍDEO do TMDB, só para metadados e imagens". Deixou de ser
 * verdade em 13/08/2026: existe a entrada "TMDB (trailers)", `official`,
 * `displayAllowed: true`, policy `cinerie-source-auth/tmdb-video/2026-08-v1`.
 *
 * SÃO DOIS PASSOS, e a distinção é o assunto: `source_licenses` diz o que a
 * FONTE permite; quem decide se uma LINHA de `tmdb_videos` é exibível é a
 * coluna `display_allowed` daquela linha.
 *
 * O SEGUNDO PASSO DEIXOU DE SER MANUAL em 28/08/2026: a linha nova nasce no
 * estado que a licença autoriza
 * (`services/ingestion/src/media-promotion/birth.ts`), e o acervo anterior é
 * aceso de uma vez por `promote:media --target=all`.
 *
 * A FRASE QUE ESTAVA AQUI — "hoje isto ainda devolve `null` para todo mundo" —
 * ERA FALSA quando foi lida em 28/08: `promote:media` existia desde 25/08 e
 * já havia 2.395 linhas acesas. Comentário mentiroso encerra a investigação na
 * porta errada; ficou corrigido em vez de apagado, para que a próxima leitura
 * saiba que a afirmação existiu.
 *
 * Nada aqui monta URL à mão: a política do embed (domínio, ausência de query,
 * formato do id) vive em `youtube-embed.ts`.
 */

import { buildYouTubeEmbedUrl, buildYouTubeWatchUrl } from "./youtube-embed";

/** Linha de `tmdb_videos` já lida do banco e convertida. */
export interface TrailerRow {
  readonly site: string;
  readonly videoKey: string;
  readonly name: string | null;
  /** `Trailer` | `Teaser` | `Clip` | `Featurette` | ... (vocabulário do TMDB). */
  readonly videoType: string | null;
  readonly official: boolean | null;
  readonly languageCode: string | null;
  readonly publishedAt: Date | null;
  readonly displayAllowed: boolean;
  /** `official` | `licensed` | `third_party` | `unknown` | `blocked`. */
  readonly licenseStatus: string;
}

/** Trailer pronto para a superfície — objeto PLANO e serializável. */
export interface TrailerView {
  /** URL do player incorporável (`youtube-nocookie`, sem query). */
  readonly embedUrl: string;
  /** URL pública, para o link de escape quando o player não carrega. */
  readonly watchUrl: string;
  /** Nome do vídeo no TMDB, quando existe (ex.: "Trailer oficial dublado"). */
  readonly name: string | null;
}

/** Licenças que a invariante 6 barra, sem exceção. */
const BLOCKED_LICENSE_STATUSES: ReadonlySet<string> = new Set(["unknown", "blocked"]);

/** O único site cujo player o Cinerie carrega. Comparação exata, não `includes`. */
const ALLOWED_SITE = "YouTube";

/**
 * Tipos de vídeo que contam como "trailer".
 *
 * `Clip`, `Featurette`, `Behind the Scenes` e `Bloopers` NÃO entram: um botão
 * que promete trailer e abre bastidor de três minutos mente para o leitor.
 * `Teaser` entra como segunda opção — é trailer, só que curto.
 */
const TRAILER_TYPE_RANK: ReadonlyMap<string, number> = new Map([
  ["Trailer", 0],
  ["Teaser", 1],
]);

/** pt-BR primeiro (invariante 7), depois inglês, depois o resto. */
function languageRank(languageCode: string | null): number {
  if (languageCode === null) return 3;
  const normalized = languageCode.toLowerCase();
  if (normalized === "pt-br" || normalized === "pt") return 0;
  if (normalized === "en" || normalized.startsWith("en-")) return 1;
  return 2;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A linha passa no gate de exibição?
 *
 * Exportada porque o teste do gate afirma cada condição SOZINHA — um gate com
 * cinco checagens que só é testado pelo resultado final passa verde mesmo com
 * quatro delas apagadas.
 */
export function isDisplayableTrailerRow(row: TrailerRow): boolean {
  if (row.displayAllowed !== true) return false;
  if (BLOCKED_LICENSE_STATUSES.has(row.licenseStatus)) return false;
  if (row.site !== ALLOWED_SITE) return false;
  if (row.videoType === null || !TRAILER_TYPE_RANK.has(row.videoType)) return false;
  return buildYouTubeEmbedUrl(row.videoKey) !== null;
}

/**
 * Escolhe UM trailer entre as linhas, ou `null` quando nenhuma passa no gate.
 *
 * A ordem é determinística de ponta a ponta — duas execuções com o mesmo dado
 * escolhem o mesmo vídeo, e o desempate final é a chave do vídeo justamente
 * para nunca depender da ordem em que o banco devolveu:
 *
 *   1. `Trailer` antes de `Teaser`
 *   2. oficial antes de não-oficial (`official` nulo conta como não-oficial)
 *   3. pt-BR, depois inglês, depois o resto (invariante 7)
 *   4. publicado mais recentemente primeiro (trailer novo supera o antigo)
 *   5. `videoKey` em ordem, só para não sobrar empate
 */
export function pickTrailer(rows: readonly TrailerRow[]): TrailerView | null {
  const candidates = rows.filter(isDisplayableTrailerRow);
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const typeA = TRAILER_TYPE_RANK.get(a.videoType as string) ?? Number.MAX_SAFE_INTEGER;
    const typeB = TRAILER_TYPE_RANK.get(b.videoType as string) ?? Number.MAX_SAFE_INTEGER;
    if (typeA !== typeB) return typeA - typeB;

    const officialA = a.official === true ? 0 : 1;
    const officialB = b.official === true ? 0 : 1;
    if (officialA !== officialB) return officialA - officialB;

    const langA = languageRank(a.languageCode);
    const langB = languageRank(b.languageCode);
    if (langA !== langB) return langA - langB;

    const publishedA = a.publishedAt?.getTime() ?? 0;
    const publishedB = b.publishedAt?.getTime() ?? 0;
    if (publishedA !== publishedB) return publishedB - publishedA;

    return a.videoKey.localeCompare(b.videoKey);
  });

  const chosen = sorted[0];
  if (chosen === undefined) return null;

  const embedUrl = buildYouTubeEmbedUrl(chosen.videoKey);
  const watchUrl = buildYouTubeWatchUrl(chosen.videoKey);
  // Os dois vêm do MESMO id já validado; a checagem é para o tipo, não por dúvida.
  if (embedUrl === null || watchUrl === null) return null;

  return { embedUrl, watchUrl, name: trimToNull(chosen.name) };
}
