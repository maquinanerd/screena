/**
 * entity-resolve.ts — LEITURA do catalogo para o tradutor "nome -> id interno".
 *
 * Server-only, somente PostgreSQL (invariantes 3 e 4). Toda a decisao vive em
 * `../lib/entity-resolve.ts`; aqui so ha as consultas que produzem candidatas.
 *
 * DUAS CONSULTAS POR LOTE, NAO DUAS POR ITEM. Um pedido com 50 titulos vira uma
 * varredura de titulos, nao 50 — a diferenca entre uma rota utilizavel e uma que
 * o operador acaba desligando. Por isso as candidatas sao buscadas para o lote
 * inteiro e o casamento acontece em memoria, item a item, no modulo puro.
 *
 * O CASAMENTO DE TITULO USA `search_documents`, e a escolha e deliberada: e a
 * projecao PUBLICA, com o texto ja dobrado pela mesma funcao
 * (`services/ingestion/src/search/fold.ts`) e com os aliases separados em
 * `normalized_aliases`. Casar contra `movies.title_original` cru significaria
 * repetir a dobra em SQL e perder os titulos alternativos — que sao justamente
 * como o MNScr costuma citar uma obra ("Homem-Aranha" vs "Spider-Man").
 *
 * O predicado de igualdade e o MESMO que `search-page.ts` usa para o `tier 0`
 * (`immutable_unaccent(lower(primary_text))` e alias exato). Nao existe um
 * segundo motor de casamento — existe um so, e este modulo usa a metade EXATA
 * dele, sem prefixo e sem similaridade.
 */

import { getPrismaClient } from "@screena/db/server";

import type { ResolvableKind, ResolveCandidate, ResolveQuery } from "../lib/entity-resolve";

const LANGUAGE_CODE = "pt-BR";

/** Linha crua de `search_documents` que interessa ao casamento por texto. */
interface SearchRow {
  entity_type: string;
  entity_id: bigint;
  primary_text: string;
  folded_primary: string;
  normalized_aliases: string;
  year: number | null;
}

/**
 * Candidatas por TEXTO, para o lote inteiro.
 *
 * `$1` = locale, `$2` = array dos textos dobrados. Nenhum literal do cliente e
 * interpolado: os dois vao como parametro.
 *
 * `doc_kind = 'entity'` e obrigatorio — a tabela tambem abriga documentos de
 * ARTIGO, com `entity_type` nulo. Sem o filtro eles entrariam no lote e sairiam
 * descartados depois, mas so depois de terem sido lidos.
 */
const CANDIDATES_BY_TEXT_SQL = `
  SELECT
    entity_type::text AS entity_type,
    entity_id,
    primary_text,
    immutable_unaccent(lower(primary_text)) AS folded_primary,
    normalized_aliases,
    year
  FROM search_documents
  WHERE doc_kind = 'entity'
    AND entity_type IS NOT NULL
    AND locale = $1
    AND (
      immutable_unaccent(lower(primary_text)) = ANY($2::text[])
      OR (normalized_aliases <> '' AND EXISTS (
        SELECT 1 FROM unnest(string_to_array(normalized_aliases, '|')) AS a(alias)
        WHERE alias = ANY($2::text[])
      ))
    )
`;

function isResolvableKind(value: string): value is ResolvableKind {
  return value === "movie" || value === "tv" || value === "person";
}

/** Ids internos por (tipo, tmdbId), para os itens que trouxeram identificador. */
async function findByTmdbIds(
  prisma: ReturnType<typeof getPrismaClient>,
  wanted: ReadonlyMap<ResolvableKind, number[]>,
): Promise<Map<string, { entityId: bigint; tmdbId: number }>> {
  const out = new Map<string, { entityId: bigint; tmdbId: number }>();

  const movieIds = wanted.get("movie") ?? [];
  const tvIds = wanted.get("tv") ?? [];
  const personIds = wanted.get("person") ?? [];

  const [movies, shows, people] = await Promise.all([
    movieIds.length > 0
      ? prisma.movie.findMany({ where: { tmdbId: { in: movieIds } }, select: { id: true, tmdbId: true } })
      : Promise.resolve([]),
    tvIds.length > 0
      ? prisma.tvShow.findMany({ where: { tmdbId: { in: tvIds } }, select: { id: true, tmdbId: true } })
      : Promise.resolve([]),
    personIds.length > 0
      ? prisma.person.findMany({ where: { tmdbId: { in: personIds } }, select: { id: true, tmdbId: true } })
      : Promise.resolve([]),
  ]);

  for (const row of movies) out.set(`movie:${String(row.tmdbId)}`, { entityId: row.id, tmdbId: row.tmdbId });
  for (const row of shows) out.set(`tv:${String(row.tmdbId)}`, { entityId: row.id, tmdbId: row.tmdbId });
  for (const row of people) out.set(`person:${String(row.tmdbId)}`, { entityId: row.id, tmdbId: row.tmdbId });

  return out;
}

/**
 * Enriquece as candidatas com o que a RESPOSTA precisa: slug canonico pt-BR e
 * titulo pt-BR.
 *
 * O slug nao e cosmetico. Sem ele a entidade nao tem pagina, e um `entityCard`
 * apontando para ela sumiria do corpo exatamente como sumiria um id inexistente
 * — o modo de falha que esta rota existe para fechar. Por isso ele e lido aqui e
 * o modulo puro recusa a candidata sem slug.
 *
 * A mesma regra ja vale em `catalog-summary.ts` e em `loadEntityCardInput`
 * (`news-pages.ts`): entidade sem slug canonico pt-BR e OMITIDA. Ter tres
 * lugares concordando nao e redundancia — e a definicao de "renderavel" sendo
 * aplicada em toda superficie que a usa.
 */
async function loadPublicFacts(
  prisma: ReturnType<typeof getPrismaClient>,
  keys: readonly { kind: ResolvableKind; entityId: bigint }[],
): Promise<Map<string, { slug: string | null; translatedTitle: string | null }>> {
  const out = new Map<string, { slug: string | null; translatedTitle: string | null }>();
  if (keys.length === 0) return out;

  const byKind = (kind: ResolvableKind): bigint[] =>
    keys.filter((key) => key.kind === kind).map((key) => key.entityId);

  const [slugs, translations] = await Promise.all([
    prisma.slug.findMany({
      where: {
        languageCode: LANGUAGE_CODE,
        isCanonical: true,
        OR: (["movie", "tv", "person"] as const)
          .filter((kind) => byKind(kind).length > 0)
          .map((kind) => ({ entityType: kind, entityId: { in: byKind(kind) } })),
      },
      select: { entityType: true, entityId: true, slug: true },
    }),
    prisma.entityTranslation.findMany({
      where: {
        languageCode: LANGUAGE_CODE,
        OR: (["movie", "tv", "person"] as const)
          .filter((kind) => byKind(kind).length > 0)
          .map((kind) => ({ entityType: kind, entityId: { in: byKind(kind) } })),
      },
      select: { entityType: true, entityId: true, title: true },
    }),
  ]);

  const ensure = (key: string) => {
    const existing = out.get(key);
    if (existing !== undefined) return existing;
    const created = { slug: null as string | null, translatedTitle: null as string | null };
    out.set(key, created);
    return created;
  };

  for (const row of slugs) {
    ensure(`${String(row.entityType)}:${row.entityId.toString()}`).slug = row.slug;
  }
  for (const row of translations) {
    const entry = ensure(`${String(row.entityType)}:${row.entityId.toString()}`);
    if (entry.translatedTitle === null) entry.translatedTitle = row.title;
  }

  return out;
}

/**
 * Todas as candidatas de que o lote precisa.
 *
 * Devolve uma lista achatada; o casamento (qual candidata serve a qual item, e
 * se serve) e do modulo puro. Esta funcao nao decide nada — nem sequer descarta
 * a candidata sem slug, porque o motivo `no_canonical_slug` precisa chegar ao
 * cliente e um filtro aqui o transformaria num `not_found` enganoso.
 */
export async function loadResolveCandidates(
  queries: readonly ResolveQuery[],
): Promise<ResolveCandidate[]> {
  const prisma = getPrismaClient();

  const tmdbWanted = new Map<ResolvableKind, number[]>();
  const foldedWanted = new Set<string>();
  for (const query of queries) {
    if (query.kind === null) continue;
    if (query.tmdbId !== null) {
      const list = tmdbWanted.get(query.kind) ?? [];
      if (!list.includes(query.tmdbId)) list.push(query.tmdbId);
      tmdbWanted.set(query.kind, list);
      continue;
    }
    if (query.folded !== null) foldedWanted.add(query.folded);
  }

  const foldedList = [...foldedWanted];

  const [byTmdb, textRows] = await Promise.all([
    findByTmdbIds(prisma, tmdbWanted),
    foldedList.length > 0
      ? prisma.$queryRawUnsafe<SearchRow[]>(CANDIDATES_BY_TEXT_SQL, LANGUAGE_CODE, foldedList)
      : Promise.resolve([] as SearchRow[]),
  ]);

  // Candidatas de TEXTO. Uma entidade pode aparecer uma vez so (o unique de
  // search_documents e por entidade+locale), mas a deduplicacao por chave fica
  // porque o casamento por id pode trazer a MESMA entidade de novo.
  const collected = new Map<
    string,
    {
      kind: ResolvableKind;
      entityId: bigint;
      tmdbId: number | null;
      folded: string;
      foldedAliases: string[];
      year: number | null;
      primaryText: string;
    }
  >();

  for (const row of textRows) {
    if (!isResolvableKind(row.entity_type)) continue;
    const key = `${row.entity_type}:${row.entity_id.toString()}`;
    collected.set(key, {
      kind: row.entity_type,
      entityId: row.entity_id,
      tmdbId: null,
      folded: row.folded_primary,
      foldedAliases: row.normalized_aliases === "" ? [] : row.normalized_aliases.split("|"),
      year: row.year,
      primaryText: row.primary_text,
    });
  }

  // Candidatas por TMDB ID. Elas nao precisam de `search_documents`: o
  // identificador ja resolveu a entidade, e obrigar um documento de busca faria
  // um id perfeitamente valido virar `not_found` so porque a projecao de busca
  // ainda nao rodou.
  const tmdbKeys: { kind: ResolvableKind; entityId: bigint; tmdbId: number }[] = [];
  for (const [key, row] of byTmdb) {
    const kind = key.split(":")[0] ?? "";
    if (!isResolvableKind(kind)) continue;
    tmdbKeys.push({ kind, entityId: row.entityId, tmdbId: row.tmdbId });
  }
  for (const entry of tmdbKeys) {
    const key = `${entry.kind}:${entry.entityId.toString()}`;
    const existing = collected.get(key);
    if (existing !== undefined) {
      existing.tmdbId = entry.tmdbId;
      continue;
    }
    collected.set(key, {
      kind: entry.kind,
      entityId: entry.entityId,
      tmdbId: entry.tmdbId,
      folded: "",
      foldedAliases: [],
      year: null,
      primaryText: "",
    });
  }

  const keys = [...collected.values()].map((row) => ({ kind: row.kind, entityId: row.entityId }));
  const facts = await loadPublicFacts(prisma, keys);

  // TITULO ORIGINAL como ultimo recurso do rotulo. So e lido para as candidatas
  // que nao tem nem traducao pt-BR nem `primary_text` — o caso de uma entidade
  // achada por `tmdbId` e ainda sem documento de busca.
  const needsOriginal = [...collected.values()].filter((row) => {
    const fact = facts.get(`${row.kind}:${row.entityId.toString()}`);
    return row.primaryText === "" && (fact?.translatedTitle ?? null) === null;
  });
  const originals = await loadOriginalTitles(prisma, needsOriginal);

  const candidates: ResolveCandidate[] = [];
  for (const row of collected.values()) {
    const key = `${row.kind}:${row.entityId.toString()}`;
    const fact = facts.get(key);
    const canonicalTitle =
      fact?.translatedTitle ?? (row.primaryText === "" ? (originals.get(key) ?? "") : row.primaryText);
    candidates.push({
      kind: row.kind,
      entityId: row.entityId.toString(),
      tmdbId: row.tmdbId,
      folded: row.folded,
      foldedAliases: row.foldedAliases,
      year: row.year,
      canonicalTitle,
      canonicalSlug: fact?.slug ?? null,
    });
  }

  return candidates;
}

/** Titulo original das candidatas sem `primary_text` nem traducao pt-BR. */
async function loadOriginalTitles(
  prisma: ReturnType<typeof getPrismaClient>,
  rows: readonly { kind: ResolvableKind; entityId: bigint }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rows.length === 0) return out;

  const ids = (kind: ResolvableKind): bigint[] =>
    rows.filter((row) => row.kind === kind).map((row) => row.entityId);

  const [movies, shows, people] = await Promise.all([
    ids("movie").length > 0
      ? prisma.movie.findMany({ where: { id: { in: ids("movie") } }, select: { id: true, titleOriginal: true } })
      : Promise.resolve([]),
    ids("tv").length > 0
      ? prisma.tvShow.findMany({ where: { id: { in: ids("tv") } }, select: { id: true, nameOriginal: true } })
      : Promise.resolve([]),
    ids("person").length > 0
      ? prisma.person.findMany({ where: { id: { in: ids("person") } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  for (const row of movies) out.set(`movie:${row.id.toString()}`, row.titleOriginal);
  for (const row of shows) out.set(`tv:${row.id.toString()}`, row.nameOriginal);
  for (const row of people) out.set(`person:${row.id.toString()}`, row.name);
  return out;
}
