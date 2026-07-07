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

/** Minimo de blocos renderizaveis distintos para indexar a pagina. */
export const MIN_PERSON_RENDERABLE_BLOCKS = 2;

/**
 * Traducao pt-BR dos departamentos conhecidos do TMDB (`known_for_department`).
 * Valor desconhecido -> `null` (nunca vaza rotulo em ingles nem inventa funcao).
 */
const KNOWN_FOR_DEPARTMENT_LABELS: Readonly<Record<string, string>> = {
  Acting: "Atuacao",
  Directing: "Direcao",
  Writing: "Roteiro",
  Production: "Producao",
  Editing: "Edicao",
  Camera: "Fotografia",
  Sound: "Som",
  Art: "Arte",
  "Costume & Make-Up": "Figurino e Maquiagem",
  "Visual Effects": "Efeitos Visuais",
  Lighting: "Iluminacao",
  Crew: "Equipe",
};

interface LocalImageSpec {
  width: number;
  height: number;
  /** Tamanho TMDB (segmento da URL remota) quando a origem é `file_path` cru. */
  tmdbSize: TmdbImageSize;
}

export type PersonCreditEntityType = "movie" | "tv";

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
  profile: PersonImageAsset | null;
  hasRealImage: boolean;
  blocks: RenderablePersonBlock[];
  renderableBlockCount: number;
  credits: PersonCredit[];
}

export interface PersonIndexabilityInput {
  renderableBlockCount: number;
}

export interface BuildPersonPageViewInput {
  record: PersonRecordInput;
  translation: PersonTranslationInput | null;
  blocks: PersonContentBlockInput[];
  credits: PersonCreditInput[];
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
 * Traduz `known_for_department` para pt-BR usando um mapa de valores conhecidos
 * do TMDB. Valor ausente ou desconhecido -> `null` (nao vaza ingles cru nem
 * inventa funcao).
 */
export function mapKnownForDepartment(
  department: string | null | undefined,
): string | null {
  const value = trimToNull(department);
  if (value === null) return null;
  return KNOWN_FOR_DEPARTMENT_LABELS[value] ?? null;
}

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

export function evaluatePersonIndexability(
  input: PersonIndexabilityInput,
): IndexabilityResult {
  const count = input.renderableBlockCount < 0 ? 0 : input.renderableBlockCount;
  return evaluateIndexability({
    language: "pt-BR",
    hasReliableStructuredData: true,
    valueBlocksCount: count,
    displayedRatings: [],
    thinContentScore: count >= MIN_PERSON_RENDERABLE_BLOCKS ? 0 : 1,
    reviewStatusOk: true,
  });
}

export function buildPersonPageView(
  input: BuildPersonPageViewInput,
): PersonPageView {
  const blocks = selectRenderablePersonBlocks(input.blocks);
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
    profile,
    hasRealImage: profile !== null,
    blocks,
    renderableBlockCount: blocks.length,
    credits: buildPersonCredits(input.credits),
  };
}
