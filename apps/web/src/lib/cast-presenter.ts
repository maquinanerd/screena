/**
 * cast-presenter.ts — Monta a faixa de ELENCO PRINCIPAL das paginas de detalhe
 * (filme e serie) a partir do payload controlado do PostgreSQL. PURO: sem
 * rede/DB/IO.
 *
 * Regras duras (espelham os demais presenters):
 *  - NAO inventa fatos: so cita elenco que veio de `cast_members`/`people`. Sem
 *    nome valido, a entrada e descartada; sem elenco, a secao e omitida.
 *  - Elenco = dado factual de catalogo (nome + personagem), nunca nota, licenca
 *    de rating ou disponibilidade — nada disso passa por aqui.
 *  - Imagem de perfil: path LOCAL seguro (demo/committed) OU URL remota do TMDB
 *    montada do `file_path` cru (helper governado); externo/invalido -> fallback.
 *    O link para a pessoa so existe quando ha slug canonico pt-BR valido; caso
 *    contrario, o nome aparece como texto (nunca link quebrado).
 */

import { detailPath, PEOPLE_INDEX_PATH } from "./site";
import { buildTmdbImageUrl, type TmdbImageSize } from "./tmdb-image-url";

const LOCAL_IMAGE_PREFIXES = ["/media/", "/uploads/", "/brand/"] as const;
const LOCAL_IMAGE_EXTENSION_PATTERN = /\.(?:avif|jpg|jpeg|png|webp)$/i;

interface LocalImageSpec {
  width: number;
  height: number;
  /** Tamanho TMDB (segmento da URL remota) quando a origem é `file_path` cru. */
  tmdbSize: TmdbImageSize;
}

/** Retrato 2:3 do elenco (mesma proporcao dos cards de pessoa). */
const PROFILE_IMAGE_SPEC: LocalImageSpec = { width: 200, height: 300, tmdbSize: "original" };

/** Teto padrao de membros de elenco exibidos na faixa (elenco principal). */
export const DEFAULT_CAST_LIMIT = 12;

/** Subconjunto de `cast_members` (+ `people`) necessario para a faixa. */
export interface CastMemberInput {
  /** `people.name` — unico nome permitido; sem nome valido a entrada cai fora. */
  name: string;
  /** `cast_members.character` (personagem) ou null. */
  character: string | null;
  /** `cast_members.billing_order` (ordem de credito) ou null. */
  billingOrder: number | null;
  /** `people.profile_path` salvo offline; nunca uma URL livre do banco. */
  profilePath: string | null;
  /** Slug canonico pt-BR da pessoa (quando ela tem pagina publica) ou null. */
  slug: string | null;
}

/** Imagem ja normalizada para render publico. */
export interface CastImageAsset {
  src: string;
  width: number;
  height: number;
}

/** Membro do elenco ja pronto para render. */
export interface CastMemberView {
  name: string;
  character: string | null;
  /** `/pt/pessoas/{slug}/` quando ha slug valido; null vira texto sem link. */
  href: string | null;
  profile: CastImageAsset | null;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Normaliza caminhos de imagem LOCAIS servidos pelo proprio app (demo/committed).
 * URLs externas, protocolo-relativo, query/hash e traversal sao recusados. O
 * `file_path` cru do TMDB (`/abc.jpg`) tambem retorna `null` AQUI — a URL remota
 * e montada em `profileAsset` via `buildTmdbImageUrl` (helper governado).
 */
export function normalizeCastLocalImagePath(
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

function profileAsset(path: string | null): CastImageAsset | null {
  // Local (demo/committed) primeiro; senão a URL remota do TMDB do `file_path` cru.
  const src =
    normalizeCastLocalImagePath(path) ?? buildTmdbImageUrl(path, PROFILE_IMAGE_SPEC.tmdbSize);
  if (src === null) return null;
  return { src, width: PROFILE_IMAGE_SPEC.width, height: PROFILE_IMAGE_SPEC.height };
}

/** `billing_order` numerico valido (>= 0) ou null (vai ao fim da ordenacao). */
function billingRank(value: number | null): number {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return value;
}

/**
 * Monta o `CastMemberView` de uma entrada, ou null quando nao ha nome valido.
 */
export function buildCastMemberView(
  input: CastMemberInput,
): CastMemberView | null {
  const name = trimToNull(input.name);
  if (name === null) return null;
  const slug = trimToNull(input.slug);
  return {
    name,
    character: trimToNull(input.character),
    href: slug === null ? null : detailPath(PEOPLE_INDEX_PATH, slug),
    profile: profileAsset(input.profilePath),
  };
}

/**
 * Monta a faixa de elenco principal: descarta entradas sem nome, ordena por
 * `billing_order` (asc; sem ordem vai ao fim) com desempate estavel por nome, e
 * aplica o teto de exibicao. Nunca inventa elenco; lista vazia -> secao omitida.
 */
export function buildCastStrip(
  inputs: CastMemberInput[],
  limit: number = DEFAULT_CAST_LIMIT,
): CastMemberView[] {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CAST_LIMIT;
  const decorated = inputs
    .map((input, index) => ({
      view: buildCastMemberView(input),
      rank: billingRank(input.billingOrder),
      index,
    }))
    .filter(
      (entry): entry is { view: CastMemberView; rank: number; index: number } =>
        entry.view !== null,
    );
  decorated.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const byName = a.view.name.localeCompare(b.view.name);
    return byName !== 0 ? byName : a.index - b.index;
  });
  return decorated.slice(0, cap).map((entry) => entry.view);
}
