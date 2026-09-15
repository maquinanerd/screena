/**
 * visibility.ts — POR QUE uma nota, um trailer, uma imagem ou o Score nao
 * aparecem na pagina. PURO.
 *
 * ============================================================================
 * O PORTAO DA PAGINA DIZ "NAO", ESTE MODULO DIZ "POR QUE"
 * ============================================================================
 * Os portoes de exibicao vivem em `apps/web` (`toPublicRating`,
 * `isDisplayableTrailerRow`, `authorizeImageDisplay`, `decideCinerieScore`) e
 * devolvem so o veredito: `null`, `false`, `rendered: false`. Para o leitor isso
 * basta. Para o dono, diante de um titulo sem nota, nao: "sem nota" pode ser
 * licenca vencida, decisao de outro territorio, nota velha, credito faltando ou
 * simplesmente nenhuma consulta feita — e cada um pede uma acao diferente.
 *
 * Aqui cada condicao do portao vira um MOTIVO nomeado, e TODOS os que se aplicam
 * sao listados (nao so o primeiro). O veredito final e travado contra o portao
 * real por `tests/governance/admin-visibility-mirror.test.ts`: se a pagina e este
 * modulo discordarem sobre UMA linha, o teste reprova.
 *
 * Um painel nao importa `apps/web`, e o portao nao pode morar em dois lugares com
 * duas verdades. Por isso a copia existe, e por isso o espelho e por
 * COMPORTAMENTO (mesma entrada, mesmo veredito), nao por texto.
 */

import { RATING_SOURCES, RATING_STALE_POLICY } from "@screena/config";

/** Estados de licenca que permitem exibir. Espelha `DISPLAYABLE_LICENSE_STATUS` (apps/web). */
export const DISPLAYABLE_LICENSE_STATUSES: readonly string[] = ["official", "licensed", "third_party"];

/** Caso de uso que autoriza exibir nota de terceiro. */
export const RATING_DISPLAY_USE_CASE = "rating_display";

/** Territorio de exibicao das notas. */
export const RATING_DISPLAY_TERRITORY = "BR";

const HOUR_MS = 60 * 60 * 1000;

/** A decisao de uso ligada a nota, como o banco a guarda. */
export interface RatingDecisionFacts {
  readonly useCase: string;
  readonly isCurrent: boolean;
  readonly stage: string;
  readonly displayAllowed: boolean;
  readonly territory: string | null;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
}

/** A licenca-mae da decisao. */
export interface RatingLicenseFacts {
  readonly isCurrent: boolean;
  readonly licenseStatus: string;
  readonly displayAllowed: boolean;
  readonly scoreAllowed: boolean;
  readonly contentType: string;
  readonly ratingSourceKey: string | null;
}

/** Uma linha de `external_ratings` com a decisao e a licenca ja juntadas. */
export interface RatingRowFacts {
  readonly ratingSource: string;
  /** `external_ratings.display_allowed`: a consulta da pagina so le linha liberada. */
  readonly rowDisplayAllowed: boolean;
  readonly scoreType: string | null;
  readonly ratingValue: number | null;
  readonly fetchedAt: Date | null;
  readonly requiresAttribution: boolean;
  readonly attributionText: string | null;
  readonly requiresLinkback: boolean;
  readonly attributionUrl: string | null;
  /** `null` = a nota nao aponta para decisao nenhuma. */
  readonly decision: RatingDecisionFacts | null;
  /** `null` somente quando `decision` e `null`. */
  readonly license: RatingLicenseFacts | null;
}

/** Um motivo de a nota nao aparecer. */
export type RatingRefusal =
  | "linha_sem_exibicao"
  | "fonte_fora_da_lista"
  | "sem_decisao"
  | "decisao_de_outro_uso"
  | "decisao_nao_vigente"
  | "decisao_nao_aprovada"
  | "decisao_ainda_nao_valida"
  | "decisao_vencida"
  | "territorio"
  | "licenca_nao_vigente"
  | "licenca_status"
  | "licenca_sem_exibicao"
  | "licenca_sem_score"
  | "licenca_de_outra_fonte"
  | "frescor_sem_politica"
  | "frescor_sem_coleta"
  | "frescor_expirada"
  | "sem_score_type"
  | "valor_invalido"
  | "sem_credito"
  | "sem_link";

/** O motivo, em uma frase, para a tela. */
export const RATING_REFUSAL_TEXT: Readonly<Record<RatingRefusal, string>> = {
  linha_sem_exibicao: "a linha está com display_allowed = false",
  fonte_fora_da_lista: "a fonte não está entre as fontes de nota decididas",
  sem_decisao: "a nota não aponta para nenhuma decisão de uso",
  decisao_de_outro_uso: "a decisão ligada é de outro uso (não rating_display)",
  decisao_nao_vigente: "a decisão ligada não é mais a vigente (foi substituída)",
  decisao_nao_aprovada: "a decisão não está aprovada para exibição",
  decisao_ainda_nao_valida: "a decisão ainda não começou a valer",
  decisao_vencida: "a decisão venceu",
  territorio: "a decisão é de outro território (não BR)",
  licenca_nao_vigente: "a licença-mãe não é mais a vigente",
  licenca_status: "o license_status da licença-mãe não permite exibir",
  licenca_sem_exibicao: "a licença-mãe está com display_allowed = false",
  licenca_sem_score: "a licença-mãe não permite exibir o número (score_allowed = false)",
  licenca_de_outra_fonte: "a licença-mãe é de outra fonte ou de outro tipo de conteúdo",
  frescor_sem_politica: "a fonte não tem janela de frescor declarada",
  frescor_sem_coleta: "sem data de coleta confiável (ausente ou no futuro)",
  frescor_expirada: "a nota passou da validade da fonte (RATING_STALE_POLICY)",
  sem_score_type: "a nota não está classificada (score_type vazio)",
  valor_invalido: "o valor da nota não é um número",
  sem_credito: "a licença exige crédito e o texto de atribuição está vazio",
  sem_link: "a licença exige link e a URL de atribuição está vazia",
};

function blank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

function stalePolicy(source: string): { readonly expireAfterHours: number } | null {
  if (!Object.prototype.hasOwnProperty.call(RATING_STALE_POLICY, source)) return null;
  return (RATING_STALE_POLICY as Readonly<Record<string, { readonly expireAfterHours: number }>>)[source] ?? null;
}

/** Todos os motivos que tiram UMA nota da pagina. Lista vazia = aparece. */
export function explainRatingRow(
  row: RatingRowFacts,
  now: Date,
): { readonly visible: boolean; readonly refusals: readonly RatingRefusal[] } {
  const refusals: RatingRefusal[] = [];
  if (!row.rowDisplayAllowed) refusals.push("linha_sem_exibicao");
  if (!(RATING_SOURCES as readonly string[]).includes(row.ratingSource)) refusals.push("fonte_fora_da_lista");

  const decision = row.decision;
  if (decision === null) {
    refusals.push("sem_decisao");
  } else {
    if (decision.useCase !== RATING_DISPLAY_USE_CASE) refusals.push("decisao_de_outro_uso");
    if (!decision.isCurrent) refusals.push("decisao_nao_vigente");
    if (decision.stage !== "approved_for_display" || !decision.displayAllowed) refusals.push("decisao_nao_aprovada");
    if (decision.validFrom.getTime() > now.getTime()) refusals.push("decisao_ainda_nao_valida");
    if (decision.validUntil !== null && decision.validUntil.getTime() <= now.getTime()) refusals.push("decisao_vencida");
    if (decision.territory !== null && decision.territory !== RATING_DISPLAY_TERRITORY) refusals.push("territorio");

    const license = row.license;
    if (license === null) {
      refusals.push("licenca_nao_vigente");
    } else {
      if (!license.isCurrent) refusals.push("licenca_nao_vigente");
      if (!DISPLAYABLE_LICENSE_STATUSES.includes(license.licenseStatus)) refusals.push("licenca_status");
      if (!license.displayAllowed) refusals.push("licenca_sem_exibicao");
      if (!license.scoreAllowed) refusals.push("licenca_sem_score");
      if (license.contentType !== "rating" || license.ratingSourceKey !== row.ratingSource) {
        refusals.push("licenca_de_outra_fonte");
      }
    }
  }

  const policy = stalePolicy(row.ratingSource);
  if (policy === null) {
    refusals.push("frescor_sem_politica");
  } else if (row.fetchedAt === null || !Number.isFinite(row.fetchedAt.getTime()) || row.fetchedAt.getTime() > now.getTime()) {
    refusals.push("frescor_sem_coleta");
  } else if (now.getTime() >= row.fetchedAt.getTime() + policy.expireAfterHours * HOUR_MS) {
    refusals.push("frescor_expirada");
  }

  if (row.scoreType === null) refusals.push("sem_score_type");
  if (row.ratingValue === null || !Number.isFinite(row.ratingValue)) refusals.push("valor_invalido");
  if (row.requiresAttribution && blank(row.attributionText)) refusals.push("sem_credito");
  if (row.requiresLinkback && blank(row.attributionUrl)) refusals.push("sem_link");

  return { visible: refusals.length === 0, refusals };
}

/** Uma linha de `tmdb_videos`. */
export interface TrailerRowFacts {
  readonly displayAllowed: boolean;
  readonly licenseStatus: string;
  readonly site: string;
  readonly videoType: string | null;
  readonly videoKey: string;
}

/** Um motivo de o video nao virar trailer na pagina. */
export type TrailerRefusal = "linha_sem_exibicao" | "licenca_bloqueada" | "site_nao_youtube" | "tipo_nao_trailer" | "chave_invalida";

export const TRAILER_REFUSAL_TEXT: Readonly<Record<TrailerRefusal, string>> = {
  linha_sem_exibicao: "a linha está com display_allowed = false",
  licenca_bloqueada: "license_status unknown ou blocked",
  site_nao_youtube: "o vídeo não é do YouTube",
  tipo_nao_trailer: "o tipo não é Trailer nem Teaser",
  chave_invalida: "a chave do vídeo não é um id válido do YouTube",
};

/** Tipos que viram trailer. Espelha `TRAILER_TYPE_RANK` (apps/web). */
export const TRAILER_TYPES: readonly string[] = ["Trailer", "Teaser"];

const YOUTUBE_KEY = /^[A-Za-z0-9_-]{11}$/;

/** Todos os motivos que impedem UM video de virar trailer. */
export function explainTrailerRow(row: TrailerRowFacts): { readonly visible: boolean; readonly refusals: readonly TrailerRefusal[] } {
  const refusals: TrailerRefusal[] = [];
  if (row.displayAllowed !== true) refusals.push("linha_sem_exibicao");
  if (row.licenseStatus === "unknown" || row.licenseStatus === "blocked") refusals.push("licenca_bloqueada");
  if (row.site !== "YouTube") refusals.push("site_nao_youtube");
  if (row.videoType === null || !TRAILER_TYPES.includes(row.videoType)) refusals.push("tipo_nao_trailer");
  if (!YOUTUBE_KEY.test(row.videoKey)) refusals.push("chave_invalida");
  return { visible: refusals.length === 0, refusals };
}

/** A licenca VIGENTE de `tmdb/image`, ou `null` quando nao ha. */
export interface ImageSourceFacts {
  readonly licenseStatus: string;
  readonly displayAllowed: boolean;
}

/** O portao de imagem e da FONTE: uma licenca vale para todas as imagens do TMDB. */
export function explainImageSource(current: ImageSourceFacts | null): { readonly authorized: boolean; readonly reason: string } {
  if (current === null) return { authorized: false, reason: "sem licença vigente de tmdb/image em source_licenses" };
  if (current.licenseStatus === "unknown" || current.licenseStatus === "blocked") {
    return { authorized: false, reason: `license_status = "${current.licenseStatus}" na licença vigente de tmdb/image` };
  }
  if (!current.displayAllowed) return { authorized: false, reason: "display_allowed = false na licença vigente de tmdb/image" };
  return { authorized: true, reason: `licença vigente de tmdb/image, license_status "${current.licenseStatus}"` };
}

/** As fontes que compoem o Score e seus nomes. Espelha o presenter e o mapa de grupos. */
export const SCORE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  imdb: "IMDb",
  tmdb: "TMDB",
  rotten_tomatoes: "Rotten Tomatoes",
  metacritic: "Metacritic",
};

/** Minimo de fontes contadas. Espelha `MINIMUM_COUNTED_SOURCES` (@screena/cinerie-score). */
export const MINIMUM_SCORE_SOURCES = 2;

/** Por que o Score nao aparece. Espelha `CinerieScoreAbsence`. */
export type ScoreAbsence = "no_approved_formula" | "single_source_insufficient" | "no_rating_at_all";

export const SCORE_ABSENCE_TEXT: Readonly<Record<ScoreAbsence, string>> = {
  no_approved_formula: "não há decisão vigente de cinerie_score_display autorizando derivar",
  single_source_insufficient: "há nota de uma fonte só: não compõe",
  no_rating_at_all: "não há cálculo com fontes contadas",
};

/** As fontes de um `explanation` persistido, com a mesma leitura fail-closed da pagina. */
export function parseExplanationSources(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.source !== "string") continue;
    if (typeof record.normalized !== "number" || !Number.isFinite(record.normalized)) continue;
    if (typeof record.weight !== "number" || !Number.isFinite(record.weight)) continue;
    out.push(record.source);
  }
  return out;
}

/**
 * O Score aparece? Mesma ordem do presenter: autorizacao, zero fontes, uma fonte.
 * Sem valor calculado, as fontes nao contam (a pagina nem as le).
 */
export function explainCinerieScore(input: {
  readonly authorized: boolean;
  readonly value: number | null;
  readonly explanationSources: readonly string[];
}):
  | { readonly rendered: true; readonly sources: readonly string[] }
  | { readonly rendered: false; readonly reason: ScoreAbsence } {
  if (!input.authorized) return { rendered: false, reason: "no_approved_formula" };
  const named =
    input.value === null ? [] : input.explanationSources.filter((source) => SCORE_SOURCE_LABELS[source] !== undefined);
  if (named.length === 0) return { rendered: false, reason: "no_rating_at_all" };
  if (named.length < MINIMUM_SCORE_SOURCES) return { rendered: false, reason: "single_source_insufficient" };
  if (input.value === null || !Number.isFinite(input.value)) return { rendered: false, reason: "no_rating_at_all" };
  return { rendered: true, sources: named };
}
