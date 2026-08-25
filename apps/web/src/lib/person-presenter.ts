/**
 * person-presenter.ts - Mapeia o registro cru de pessoa (PostgreSQL) para o
 * modelo de exibicao da pagina publica. PURO: sem rede/DB/IO.
 *
 * Regra dura: nao inventa fatos. Ausencia de dado vira `null` ou lista vazia, e
 * a pagina simplesmente omite a secao correspondente. Em especial:
 *  - nao fabrica biografia, funcao, idade, nacionalidade nem filmografia;
 *  - imagem de perfil: path LOCAL seguro (demo/committed) OU URL remota do TMDB
 *    montada do `file_path` cru (helper governado); externo/invalido -> null;
 *  - bio exibida vem de conteudo PROPRIO (content_blocks revisados +
 *    metaDescription). O `summary` da traducao NAO e usado como bio: uma bio de
 *    terceiro e governada por `biography_source_status` (invariante 6) e fica
 *    fora desta fatia.
 */

import { evaluateIndexability, type IndexabilityResult } from "@screena/seo";

import { buildTmdbImageUrl, type TmdbImageSize } from "./tmdb-image-url";

/**
 * Ordem canonica dos tipos de content_block (espelha o enum `ContentBlockType`).
 * Usada apenas para ordenar a exibicao de forma deterministica.
 */
const BLOCK_TYPE_ORDER = [
  "editorial_intro",
  "summary_without_spoilers",
  "ratings_explanation",
  "where_to_watch_text",
  "cast_intro",
  "similar_titles_intro",
  "franchise_context",
  "season_guide",
  "episode_context",
  "faq",
  "news_context",
  "review_summary",
] as const;

const LOCAL_IMAGE_PREFIXES = ["/media/", "/uploads/", "/brand/"] as const;
const LOCAL_IMAGE_EXTENSION_PATTERN = /\.(?:avif|jpg|jpeg|png|webp)$/i;

/** Perfil e retrato 2:3 (mesma proporcao de poster). */
const PROFILE_IMAGE_SPEC: LocalImageSpec = { width: 300, height: 450, tmdbSize: "original" };

/** Rotas canonicas dos alvos de credito (pt-BR; barra final como no esquema). */
const MOVIE_PATH_PREFIX = "/pt/filmes/";
const SERIES_PATH_PREFIX = "/pt/series/";

/** Estados de `review_status` que podem aparecer no render publico. */
export const PERSON_RENDERABLE_REVIEW_STATUSES = [
  "human_reviewed",
  "published",
] as const;

const PERSON_RENDERABLE_REVIEW_STATUS_SET: ReadonlySet<string> = new Set(
  PERSON_RENDERABLE_REVIEW_STATUSES,
);

/**
 * Numero de blocos renderizaveis distintos a partir do qual a pagina e "rica"
 * (sinal `hasUniqueValue`). NAO gate mais indexacao (politica 2026-07 —
 * indexacao total).
 */
export const MIN_PERSON_RENDERABLE_BLOCKS = 2;

/**
 * A traducao de `known_for_department` vive em `./known-for-department` — modulo
 * proprio, uma copia so. Reexportada aqui porque esta pagina e a maior
 * consumidora e porque `news-presenter` ja importava por este caminho; e um
 * ALIAS do simbolo unico, nunca uma segunda tabela.
 */
import { mapKnownForDepartment } from "./known-for-department";

export { mapKnownForDepartment };

interface LocalImageSpec {
  width: number;
  height: number;
  /** Tamanho TMDB (segmento da URL remota) quando a origem é `file_path` cru. */
  tmdbSize: TmdbImageSize;
}

export type PersonCreditEntityType = "movie" | "tv";

/**
 * Tipos de alvo que a filmografia sabe transformar em linha.
 *
 * Fechado de proposito. `cast_members`/`crew_members` sao polimorficos sobre o
 * enum inteiro (`movie|tv|season|episode|person`) e a ingestao de episodio
 * grava credito com `entity_type='episode'` (guest star). Esta secao lista obra,
 * nao episodio: um credito de episodio nao e um titulo "faltando", e outra
 * granularidade.
 */
const PERSON_CREDIT_ENTITY_TYPES: ReadonlySet<string> = new Set<PersonCreditEntityType>([
  "movie",
  "tv",
]);

export function isPersonCreditEntityType(
  value: string,
): value is PersonCreditEntityType {
  return PERSON_CREDIT_ENTITY_TYPES.has(value);
}

/**
 * Quantas linhas de credito PODERIAM virar filmografia — o denominador de
 * `hiddenCreditCount`.
 *
 * Conta na ORIGEM (a linha crua de `cast_members`/`crew_members`), nao no fim de
 * cada camada. E de proposito: o descarte acontece em modulo diferente do que
 * monta a lista, e um descarte novo no meio do caminho ja entra nesta conta sem
 * ninguem lembrar de soma-lo. Hoje quem trunca de fato e a ausencia de slug
 * canonico pt-BR (ver `buildPersonCredits`).
 *
 * Usa a MESMA porta (`isPersonCreditEntityType`) que o resolvedor de creditos:
 * contar por um criterio e descartar por outro faria o numero mentir.
 */
export function countLinkableCreditRows(
  rows: readonly { readonly entityType: string }[],
): number {
  let total = 0;
  for (const row of rows) {
    if (isPersonCreditEntityType(row.entityType)) total += 1;
  }
  return total;
}

/** Subconjunto de `people` necessario para a pagina. */
export interface PersonRecordInput {
  /** `people.name` - nome canonico (fallback do nome exibido). */
  name: string;
  /** `people.known_for_department` (rotulo TMDB em ingles) ou null. */
  knownForDepartment: string | null;
  /** Data de nascimento em ISO `YYYY-MM-DD` (derivada de `birthday`) ou null. */
  birthDateIso: string | null;
  /** Data de falecimento em ISO `YYYY-MM-DD` (derivada de `deathday`) ou null. */
  deathDateIso: string | null;
  /** `people.place_of_birth` ou null. */
  placeOfBirth: string | null;
  /** `people.profile_path` salvo offline; nunca uma URL livre do banco. */
  profilePath: string | null;
  /** `people.biography` — o texto cru do TMDB. Persistido desde 20/08/2026. */
  biography: string | null;
  /**
   * `people.biography_source_status` — quem GOVERNA a exibicao da bio.
   *
   * Vem separado do texto de proposito. Ter o paragrafo no banco nao autoriza
   * mostra-lo: `unknown`/`blocked` barram (invariante 6). Nasce `unknown`, e so
   * uma decisao humana o move — a ingestao nao toca nesta coluna.
   */
  biographySourceStatus: string | null;
}

/** Subconjunto de `entity_translations` (pt-BR) usado pela pagina. */
export interface PersonTranslationInput {
  title: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

/** content_block cru, antes da filtragem por `review_status`. */
export interface PersonContentBlockInput {
  blockType: string;
  content: string;
  reviewStatus: string;
}

/** Credito cru ja resolvido pelo server (titulo/slug do alvo movie|tv). */
export interface PersonCreditInput {
  entityType: PersonCreditEntityType;
  /** Titulo publico do alvo (traducao pt-BR ou original). */
  title: string | null;
  /** Slug canonico pt-BR do alvo; sem slug o credito nao vira link e e omitido. */
  slug: string | null;
  /** Ano do alvo (lancamento/estreia) ou null. */
  year: number | null;
  /** Papel: personagem (elenco) ou funcao/departamento (equipe) ou null. */
  roleLabel: string | null;
  /** Poster path TMDB do alvo (ou null). */
  posterPath?: string | null;
}

/** Bloco ja aprovado para render publico. */
export interface RenderablePersonBlock {
  blockType: string;
  content: string;
}

/** Imagem ja normalizada para render publico. */
export interface PersonImageAsset {
  src: string;
  width: number;
  height: number;
}

/** Credito ja pronto para render (com href montado). */
export interface PersonCredit {
  entityType: PersonCreditEntityType;
  title: string;
  href: string;
  year: number | null;
  roleLabel: string | null;
  /** Poster do alvo via helper governado (ou null — card so com dado real). */
  posterUrl: string | null;
}

/** Modelo de exibicao final da pagina de pessoa. */
export interface PersonPageView {
  name: string;
  originalName: string | null;
  roleLabel: string | null;
  birthDateIso: string | null;
  deathDateIso: string | null;
  lifeLabel: string | null;
  placeOfBirth: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  /**
   * A biografia crua do TMDB, JA passada pelo gate de licenca.
   *
   * `null` cobre tres estados que a pagina nao precisa distinguir (sem texto,
   * texto sem licenca, ou coluna nunca preenchida) — todos significam "nao
   * exibir". A distincao que importa (ha bio de alguma origem?) e feita na
   * pagina, com `SectionBoundary`.
   */
  sourceBiography: string | null;
  profile: PersonImageAsset | null;
  hasRealImage: boolean;
  blocks: RenderablePersonBlock[];
  renderableBlockCount: number;
  credits: PersonCredit[];
  /**
   * Creditos de filme/serie que existem no banco e nao entraram em `credits`.
   *
   * `0` significa filmografia COMPLETA — e por isso este campo existe: sem ele a
   * tela mostrava a lista parcial com a mesma cara da lista inteira.
   */
  hiddenCreditCount: number;
}

export interface PersonIndexabilityInput {
  renderableBlockCount: number;
}

export interface BuildPersonPageViewInput {
  record: PersonRecordInput;
  translation: PersonTranslationInput | null;
  blocks: PersonContentBlockInput[];
  credits: PersonCreditInput[];
  /**
   * Quantos creditos de filme/serie a pessoa tem no banco, ANTES de qualquer
   * descarte (`countLinkableCreditRows` sobre as linhas cruas).
   *
   * OBRIGATORIO, e nao opcional com default. Um default seria sempre "nada
   * escondido" — o proprio silencio que este campo existe para acabar. Quem
   * monta a view tem que dizer de quantos partiu.
   */
  rawCreditCount: number;
}

/** Normaliza string opcional para `null` quando vazia/ausente (apos trim). */
function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function validYearOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Normaliza caminhos de imagem LOCAIS servidos pelo proprio app (demo/committed).
 * URLs externas, protocolo-relativo, query/hash e traversal sao recusados. O
 * `file_path` cru do TMDB (`/abc.jpg`) tambem retorna `null` AQUI — a URL remota
 * e montada em `profileAsset` via `buildTmdbImageUrl` (helper governado).
 */
export function normalizePersonLocalImagePath(
  path: string | null | undefined,
): string | null {
  const value = trimToNull(path);
  if (value === null) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("//")) return null;
  if (value.includes("\\") || value.includes("?") || value.includes("#")) {
    return null;
  }
  if (value.split("/").includes("..")) return null;
  if (!LOCAL_IMAGE_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return null;
  }
  return LOCAL_IMAGE_EXTENSION_PATTERN.test(value) ? value : null;
}

function profileAsset(path: string | null): PersonImageAsset | null {
  // Local (demo/committed) primeiro; senão a URL remota do TMDB do `file_path` cru.
  const src =
    normalizePersonLocalImagePath(path) ?? buildTmdbImageUrl(path, PROFILE_IMAGE_SPEC.tmdbSize);
  if (src === null) return null;
  return { src, width: PROFILE_IMAGE_SPEC.width, height: PROFILE_IMAGE_SPEC.height };
}

/** Nome exibido: traducao pt-BR, senao nome canonico. Nunca inventado. */
export function selectPersonName(
  record: PersonRecordInput,
  translation: PersonTranslationInput | null,
): string {
  return trimToNull(translation?.title) ?? record.name;
}

/**
 * Nome original: so aparece quando a traducao pt-BR difere do nome canonico
 * (`people.name`). Caso contrario retorna `null` (nao repete o mesmo nome).
 */
export function selectPersonOriginalName(
  record: PersonRecordInput,
  translation: PersonTranslationInput | null,
): string | null {
  const translated = trimToNull(translation?.title);
  if (translated === null) return null;
  const original = trimToNull(record.name);
  if (original === null || original === translated) return null;
  return original;
}


/**
 * A biografia CRUA do TMDB, quando a licenca permite exibi-la.
 *
 * DUAS condicoes, e nenhuma basta sozinha:
 *  1. o texto existe (`people.biography` — antes nem coluna havia);
 *  2. `biography_source_status` esta num estado que autoriza exibir.
 *
 * Os estados permitidos sao os mesmos de qualquer dado de terceiro
 * (invariante 6): `official`, `licensed` e `third_party`. `unknown` e `blocked`
 * barram — e `unknown` e o DEFAULT, entao hoje esta funcao devolve `null` para
 * todo mundo. Isso e o comportamento correto: o texto entra no banco por
 * ingestao, mas a exibicao continua sendo decisao humana registrada, como em
 * ratings e em streaming.
 */
export function selectSourceBiography(record: PersonRecordInput): string | null {
  const texto = trimToNull(record.biography);
  if (texto === null) return null;
  if (!BIOGRAPHY_DISPLAYABLE_STATUSES.has(record.biographySourceStatus ?? "unknown")) return null;
  return texto;
}

/**
 * Estados de licenca que autorizam EXIBIR dado de terceiro (invariante 6).
 *
 * Fechado de proposito: um estado novo no enum nao passa a exibir por omissao.
 */
const BIOGRAPHY_DISPLAYABLE_STATUSES: ReadonlySet<string> = new Set([
  "official",
  "licensed",
  "third_party",
]);

function yearFromIso(iso: string | null): number | null {
  if (iso === null) return null;
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(iso.trim());
  if (match === null) return null;
  return validYearOrNull(Number.parseInt(match[1] as string, 10));
}

/**
 * Rotulo de vida a partir dos anos de nascimento/falecimento. Nunca calcula
 * idade (mutavel, nao armazenada): so mostra os anos que existem no payload.
 */
export function formatLifeLabel(
  birthDateIso: string | null,
  deathDateIso: string | null,
): string | null {
  const birthYear = yearFromIso(birthDateIso);
  const deathYear = yearFromIso(deathDateIso);
  if (birthYear !== null && deathYear !== null) return `${birthYear}–${deathYear}`;
  if (birthYear !== null) return `Nascimento: ${birthYear}`;
  if (deathYear !== null) return `Falecimento: ${deathYear}`;
  return null;
}

function blockTypeRank(blockType: string): number {
  const index = (BLOCK_TYPE_ORDER as readonly string[]).indexOf(blockType);
  return index === -1 ? BLOCK_TYPE_ORDER.length : index;
}

export function isPubliclyRenderablePersonBlock(reviewStatus: string): boolean {
  return PERSON_RENDERABLE_REVIEW_STATUS_SET.has(reviewStatus);
}

/**
 * Seleciona os blocos renderizaveis: apenas `review_status` publicavel, conteudo
 * nao vazio, no maximo um por `block_type`, em ordem canonica. Duplicatas do
 * mesmo tipo nao inflam a contagem do gate anti-thin.
 */
export function selectRenderablePersonBlocks(
  blocks: PersonContentBlockInput[],
): RenderablePersonBlock[] {
  const seenTypes = new Set<string>();
  const renderable: RenderablePersonBlock[] = [];
  for (const block of blocks) {
    const content = trimToNull(block.content);
    if (content === null) continue;
    if (!isPubliclyRenderablePersonBlock(block.reviewStatus)) continue;
    if (seenTypes.has(block.blockType)) continue;
    seenTypes.add(block.blockType);
    renderable.push({ blockType: block.blockType, content });
  }
  renderable.sort((a, b) => blockTypeRank(a.blockType) - blockTypeRank(b.blockType));
  return renderable;
}

function creditHref(entityType: PersonCreditEntityType, slug: string): string {
  const prefix = entityType === "movie" ? MOVIE_PATH_PREFIX : SERIES_PATH_PREFIX;
  return `${prefix}${slug}/`;
}

/**
 * Monta a filmografia renderizavel a partir de creditos ja resolvidos pelo
 * server. Descarta creditos sem titulo ou sem slug (nao vira link -> nao aparece)
 * e ordena por ano decrescente (nulos ao fim), depois titulo. Nunca inventa
 * creditos: o que entra e exatamente o que o payload trouxe.
 *
 * O descarte por slug e o unico que hoje trunca a filmografia de verdade: o
 * titulo ESTA no catalogo e mesmo assim nao vira linha, porque nao existe pagina
 * pt-BR para onde linkar. (O outro candidato — alvo ausente de
 * `movies`/`tv_shows` — o banco nao deixa acontecer: ha FK para `entities`. Ver
 * o cabecalho de `server/person-page.ts`.) E temporario: nasce e morre com a
 * geracao de slug. Enquanto durar, quantos sairam vira `hiddenCreditCount` e a
 * secao FILMOGRAFIA exibe o numero em vez de calar.
 */
export function buildPersonCredits(
  credits: PersonCreditInput[],
): PersonCredit[] {
  const resolved: PersonCredit[] = [];
  for (const credit of credits) {
    const title = trimToNull(credit.title);
    const slug = trimToNull(credit.slug);
    if (title === null || slug === null) continue;
    resolved.push({
      entityType: credit.entityType,
      title,
      href: creditHref(credit.entityType, slug),
      year: validYearOrNull(credit.year),
      roleLabel: trimToNull(credit.roleLabel),
      posterUrl: buildTmdbImageUrl(credit.posterPath ?? null, "w300"),
    });
  }
  resolved.sort((a, b) => {
    const ay = a.year ?? -Infinity;
    const by = b.year ?? -Infinity;
    if (ay !== by) return by - ay;
    return a.title.localeCompare(b.title);
  });
  return resolved;
}

/**
 * Quantos creditos existem no banco e NAO chegaram a lista.
 *
 * Uma subtracao, e nao um contador por camada, porque o defeito que ela fecha e
 * justamente o descarte que ninguem lembrou de contar: qualquer filtro entre a
 * linha crua e a view aparece aqui sem precisar se declarar.
 *
 * Clampa em zero — negativo aqui so pode ser bug de chamador (denominador menor
 * que a lista), e uma tela nunca deve anunciar "-3 creditos".
 */
export function countHiddenCredits(
  rawCreditCount: number,
  listedCount: number,
): number {
  if (!Number.isFinite(rawCreditCount) || !Number.isFinite(listedCount)) return 0;
  const hidden = Math.trunc(rawCreditCount) - Math.trunc(listedCount);
  return hidden > 0 ? hidden : 0;
}

/**
 * A linha que a secao FILMOGRAFIA exibe quando a lista esta incompleta.
 * `null` quando esta completa — e o unico ponto que decide se a linha existe.
 *
 * COPY (decisao de 25/08/2026, sujeita a revisao do dono). Um numero so, e um
 * motivo que continua verdadeiro se a causa mudar.
 *
 * "Fora do catalogo" seria FALSO para a causa real de hoje: o titulo esta no
 * catalogo, so nao tem slug canonico pt-BR. O que vale para ela — e valeria
 * tambem para um alvo que faltasse na tabela base — e que nao ha pagina para
 * onde mandar o leitor. Por isso "sem pagina no catalogo", e nao "fora dele".
 *
 * A distincao entre causas e operacional, nao editorial: quem le a pagina nao
 * sabe o que e um slug. Ela pertence ao diagnostico, nao a tela.
 */
export function formatHiddenCreditsNotice(
  hiddenCreditCount: number,
): string | null {
  const hidden = countHiddenCredits(hiddenCreditCount, 0);
  if (hidden === 0) return null;
  const noun = hidden === 1 ? "crédito não listado" : "créditos não listados";
  return `${hidden} ${noun} — ainda sem página no catálogo.`;
}

/**
 * Indexabilidade da pagina de pessoa (politica 2026-07 — indexacao total). Uma
 * pessoa sincronizada tem sua ficha canonica (schema.org Person) e indexa
 * sempre; a contagem de blocos so alimenta `hasUniqueValue`. O caso "sem
 * dados/slug" (noindex tecnico) e tratado na rota, antes deste avaliador.
 */
export function evaluatePersonIndexability(
  input: PersonIndexabilityInput,
): IndexabilityResult {
  const count = input.renderableBlockCount < 0 ? 0 : input.renderableBlockCount;
  return evaluateIndexability({
    language: "pt-BR",
    hasReliableStructuredData: true,
    valueBlocksCount: count,
    displayedRatings: [],
    thinContentScore: 0,
    reviewStatusOk: true,
  });
}

export function buildPersonPageView(
  input: BuildPersonPageViewInput,
): PersonPageView {
  const blocks = selectRenderablePersonBlocks(input.blocks);
  const credits = buildPersonCredits(input.credits);
  const profile = profileAsset(input.record.profilePath);
  const birthDateIso = trimToNull(input.record.birthDateIso);
  const deathDateIso = trimToNull(input.record.deathDateIso);

  return {
    name: selectPersonName(input.record, input.translation),
    originalName: selectPersonOriginalName(input.record, input.translation),
    roleLabel: mapKnownForDepartment(input.record.knownForDepartment),
    birthDateIso,
    deathDateIso,
    lifeLabel: formatLifeLabel(birthDateIso, deathDateIso),
    placeOfBirth: trimToNull(input.record.placeOfBirth),
    metaTitle: trimToNull(input.translation?.metaTitle),
    // Bio para meta: SO `metaDescription` (SEO proprio). Sem fallback em
    // `summary`, que poderia ser bio de terceiro governada por
    // `biography_source_status` (invariante 6). Ausencia -> null.
    metaDescription: trimToNull(input.translation?.metaDescription),
    sourceBiography: selectSourceBiography(input.record),
    profile,
    hasRealImage: profile !== null,
    blocks,
    renderableBlockCount: blocks.length,
    credits,
    // A conta e feita AQUI, no unico ponto que ve os dois lados: quantos
    // creditos existiam (`rawCreditCount`, vindo da origem) e quantos
    // sobreviveram a todos os descartes (`credits.length`).
    hiddenCreditCount: countHiddenCredits(input.rawCreditCount, credits.length),
  };
}
