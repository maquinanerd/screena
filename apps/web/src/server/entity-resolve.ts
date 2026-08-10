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
 * O CASAMENTO DE TITULO LE O CATALOGO. Isto MUDOU, e a mudanca e a correcao de
 * um defeito medido em producao.
 *
 * A primeira versao (PR #140) casava titulo contra `search_documents` — a
 * projecao PUBLICA de busca. A escolha parecia boa (texto ja dobrado, aliases
 * separados) e tinha um custo que so aparece em producao: `search_documents` e
 * escrita por um WORKER OFFLINE (`catalog search-reindex`). Uma entidade existe
 * no catalogo muito antes de existir na projecao — e enquanto nao existe la, o
 * casamento por titulo devolve `not_found` sem log, sem erro e sem teste
 * vermelho.
 *
 * Foi exatamente o que se mediu: `tmdbId` resolvia 3 de 3 (ele le o catalogo
 * direto) e titulo/nome resolvia 0 de 11 — com titulos que a PROPRIA rota tinha
 * acabado de devolver em `canonicalTitle`. Duas metades da mesma rota lendo
 * fontes diferentes, uma delas dependente de um job que ninguem foi mandado
 * rodar.
 *
 * O codigo abaixo le a MESMA fonte nos dois caminhos: o catalogo. Cinco origens
 * de texto, todas do banco autoritativo:
 *
 *   entity_translations (pt-BR)  titulo traduzido — o rotulo que a rota devolve
 *   movies.title_original        titulo original de filme
 *   tv_shows.name_original       nome original de serie
 *   people.name                  nome de pessoa
 *   entity_alternative_titles    titulos alternativos (o alias)
 *
 * OS DOIS LADOS SAO DOBRADOS PELA MESMA FUNCAO, e essa e a peca de desenho que
 * fecha o outro modo de falha. `immutable_fold` (migration
 * `20260808120000_entity_resolve_folded_title_indexes`) e aplicada ao valor da
 * COLUNA **e** ao TERMO procurado, dentro da mesma consulta. Cada uma das cinco
 * origens tem indice funcional sobre ela.
 *
 * Por que nao "uma dobra em JS igualzinha a uma dobra em SQL": duas funcoes
 * equivalentes divergem no primeiro caractere exotico, e a divergencia e muda —
 * o casamento exato deixa de casar, sem erro e sem log. Uma funcao so nao tem
 * como divergir de si mesma. O termo chega pre-dobrado pelo modulo puro (para
 * deduplicar o lote) e e REDOBRADO no SQL; e a redobra que poe os dois lados no
 * mesmo espaco.
 *
 * Comparar termo dobrado com valor CRU do banco — que e a outra forma de matar
 * este casamento — nao e possivel aqui: nao existe comparacao contra coluna crua
 * neste arquivo.
 */

import { getPrismaClient } from "@screena/db/server";

import type { ResolvableKind, ResolveCandidate, ResolveQuery } from "../lib/entity-resolve";

const LANGUAGE_CODE = "pt-BR";

/** Linha do casamento por texto: uma entidade e as dobras dela que bateram. */
interface FoldedMatchRow {
  entity_type: string;
  entity_id: bigint;
  folded_matches: string[];
}

/**
 * Candidatas por TEXTO, para o lote inteiro.
 *
 * `$1` = locale, `$2` = array dos textos dobrados. Nenhum literal do cliente e
 * interpolado: os dois vao como parametro.
 *
 * `wanted` guarda DOIS valores por termo: `term`, o texto dobrado pelo modulo
 * puro (a chave que volta ao chamador), e `folded`, o MESMO texto passado por
 * `immutable_fold` (a chave de comparacao). Os cinco ramos se juntam por
 * igualdade sobre `immutable_fold(coluna)` — a expressao indexada. E por isso
 * que um lote de 50 titulos custa 50 buscas em indice, e nao cinco varreduras.
 *
 * O `array_agg` devolve `w.term`, e nao `w.folded`: quem compara de novo em
 * memoria e o modulo puro, que so conhece a dobra dele. Devolver a dobra do SQL
 * faria o filtro em memoria recusar exatamente o que o SQL acabou de casar.
 *
 * O filtro `entity_type IN (...)` nos ramos de traducao e de titulo alternativo
 * nao e cosmetico: `EntityType` tambem tem `season` e `episode`, que esta rota
 * nao resolve (uma "Temporada 2" existe as centenas). Sem o filtro elas entrariam
 * no lote e virariam ambiguidade.
 *
 * O agrupamento no fim entrega UMA linha por entidade com TODAS as dobras que
 * bateram. O modulo puro so precisa saber que bateu; guardar quais bateram
 * mantem a candidata autoexplicativa em log e em teste.
 */
const CANDIDATES_BY_TEXT_SQL = `
  WITH wanted AS (
    SELECT DISTINCT term, immutable_fold(term) AS folded
    FROM unnest($2::text[]) AS t(term)
  ),
  matches AS (
    SELECT t.entity_type::text AS entity_type, t.entity_id, w.term
    FROM entity_translations t
    JOIN wanted w ON w.folded = immutable_fold(t.title)
    WHERE t.language_code = $1
      AND t.title IS NOT NULL
      AND t.entity_type IN ('movie', 'tv', 'person')

    UNION ALL
    SELECT 'movie', m.id, w.term
    FROM movies m
    JOIN wanted w ON w.folded = immutable_fold(m.title_original)

    UNION ALL
    SELECT 'tv', s.id, w.term
    FROM tv_shows s
    JOIN wanted w ON w.folded = immutable_fold(s.name_original)

    UNION ALL
    SELECT 'person', p.id, w.term
    FROM people p
    JOIN wanted w ON w.folded = immutable_fold(p.name)

    UNION ALL
    SELECT a.entity_type::text, a.entity_id, w.term
    FROM entity_alternative_titles a
    JOIN wanted w ON w.folded = immutable_fold(a.title)
    WHERE a.entity_type IN ('movie', 'tv')
  )
  SELECT entity_type, entity_id, array_agg(DISTINCT term) AS folded_matches
  FROM matches
  GROUP BY entity_type, entity_id
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
 *
 * Consequencia de ler o catalogo em vez da projecao: entidade SEM slug canonico
 * agora tambem vira candidata por texto (a projecao so indexava quem tinha
 * slug). Se duas obras dividem titulo e ano e uma delas nao tem pagina, o
 * resultado e `ambiguous_title` — e nao a escolha silenciosa da que tem pagina.
 * E o desfecho certo pela regra da rota: um `null` e inofensivo, um id errado e
 * uma mentira publicada.
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
      ? prisma.$queryRawUnsafe<FoldedMatchRow[]>(CANDIDATES_BY_TEXT_SQL, LANGUAGE_CODE, foldedList)
      : Promise.resolve([] as FoldedMatchRow[]),
  ]);

  // Candidatas de TEXTO. O `GROUP BY` do SQL ja entrega uma linha por entidade;
  // a deduplicacao por chave fica porque o casamento por id pode trazer a MESMA
  // entidade de novo.
  const collected = new Map<
    string,
    {
      kind: ResolvableKind;
      entityId: bigint;
      tmdbId: number | null;
      foldedMatches: string[];
    }
  >();

  for (const row of textRows) {
    if (!isResolvableKind(row.entity_type)) continue;
    const key = `${row.entity_type}:${row.entity_id.toString()}`;
    collected.set(key, {
      kind: row.entity_type,
      entityId: row.entity_id,
      tmdbId: null,
      foldedMatches: [...row.folded_matches],
    });
  }

  // Candidatas por TMDB ID. Elas nao trazem dobra nenhuma: o identificador ja
  // resolveu a entidade, e o casamento por texto nem chega a olhar para elas.
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
      foldedMatches: [],
    });
  }

  const keys = [...collected.values()].map((row) => ({ kind: row.kind, entityId: row.entityId }));
  const [facts, catalog] = await Promise.all([
    loadPublicFacts(prisma, keys),
    loadCatalogFacts(prisma, keys),
  ]);

  const candidates: ResolveCandidate[] = [];
  for (const row of collected.values()) {
    const key = `${row.kind}:${row.entityId.toString()}`;
    const fact = facts.get(key);
    const base = catalog.get(key);
    // O rotulo: traducao pt-BR quando existe, senao o titulo/nome original.
    // Nunca inventado, e nunca uma dobra — a dobra e chave de casamento, nao
    // texto para humano ler.
    const canonicalTitle = fact?.translatedTitle ?? base?.originalTitle ?? "";
    const [first, ...rest] = row.foldedMatches;
    candidates.push({
      kind: row.kind,
      entityId: row.entityId.toString(),
      tmdbId: row.tmdbId,
      folded: first ?? "",
      foldedAliases: rest,
      year: base?.year ?? null,
      canonicalTitle,
      canonicalSlug: fact?.slug ?? null,
    });
  }

  return candidates;
}

/**
 * Titulo/nome ORIGINAL e ANO, direto das tabelas do catalogo.
 *
 * O ano vinha de `search_documents.year`; agora vem de `release_date` /
 * `first_air_date`, que e de onde a projecao o tirava. Ler a fonte remove um
 * modo de falha inteiro: uma entidade projetada ANTES de a data ser preenchida
 * ficava com `year` nulo na projecao, e `exact_title_year` nunca casava — sem
 * nenhum sinal de que o problema era o frescor da projecao.
 *
 * `getUTCFullYear` no lado do JS e `@db.Date` no banco: a coluna nao tem fuso,
 * entao o ano lido aqui e o mesmo ano que a ingestao gravou.
 */
async function loadCatalogFacts(
  prisma: ReturnType<typeof getPrismaClient>,
  rows: readonly { kind: ResolvableKind; entityId: bigint }[],
): Promise<Map<string, { originalTitle: string; year: number | null }>> {
  const out = new Map<string, { originalTitle: string; year: number | null }>();
  if (rows.length === 0) return out;

  const ids = (kind: ResolvableKind): bigint[] =>
    rows.filter((row) => row.kind === kind).map((row) => row.entityId);

  const yearOf = (date: Date | null): number | null =>
    date === null ? null : date.getUTCFullYear();

  const [movies, shows, people] = await Promise.all([
    ids("movie").length > 0
      ? prisma.movie.findMany({
          where: { id: { in: ids("movie") } },
          select: { id: true, titleOriginal: true, releaseDate: true },
        })
      : Promise.resolve([]),
    ids("tv").length > 0
      ? prisma.tvShow.findMany({
          where: { id: { in: ids("tv") } },
          select: { id: true, nameOriginal: true, firstAirDate: true },
        })
      : Promise.resolve([]),
    ids("person").length > 0
      ? prisma.person.findMany({ where: { id: { in: ids("person") } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  for (const row of movies) {
    out.set(`movie:${row.id.toString()}`, {
      originalTitle: row.titleOriginal,
      year: yearOf(row.releaseDate),
    });
  }
  for (const row of shows) {
    out.set(`tv:${row.id.toString()}`, {
      originalTitle: row.nameOriginal,
      year: yearOf(row.firstAirDate),
    });
  }
  // Pessoa nao tem ano: `exact_name` e o unico casamento por texto dela, e ele
  // se sustenta na UNICIDADE do nome, nunca num ano de nascimento.
  for (const row of people) {
    out.set(`person:${row.id.toString()}`, { originalTitle: row.name, year: null });
  }
  return out;
}
