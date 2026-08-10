/**
 * entity-resolve.ts — NUCLEO PURO do tradutor "nome -> id interno do catalogo".
 *
 * O PROBLEMA QUE ELE RESOLVE. `entityCard.entityId` e um id INTERNO do catalogo
 * (`INTERNAL_ENTITY_ID` em `apps/cms/src/publication-intake.ts`), e o catalogo
 * vive no `screen-db` — banco que o CMS nao alcanca (ADR 0015). Por isso o CMS
 * aceita qualquer numero e devolve `201`: ele nao tem como conferir. Quem confere
 * e a renderizacao, e quando nao acha, ela **descarta em silencio**.
 *
 * Dois modos de falha, e o segundo e o caro:
 *
 *   id inexistente        -> o bloco some, e ninguem e avisado
 *   id existente e ERRADO -> a pagina mostra a OBRA ERRADA com cara de certo
 *
 * O MNScr conhece NOMES. O `screen-db` conhece IDS. Este modulo e o tradutor —
 * e a regra que o organiza e a segunda linha acima: **um `null` e inofensivo; um
 * id errado e uma mentira publicada.** Nada aqui devolve palpite.
 *
 * TRES CASAMENTOS, E SO TRES:
 *
 *  1. `tmdb_id` — identificador, exato, caminho preferencial;
 *  2. `exact_title_year` — titulo dobrado + ANO + `kind`, todos batendo;
 *  3. `exact_name` — nome dobrado + `kind`, UNICO no catalogo. So para `person`.
 *
 * O terceiro e uma extensao deliberada ao contrato esbocado, e o motivo esta em
 * `MATCHED_BY`: pessoa nao tem ano. Sem ele, o tradutor so traduziria pessoa
 * quando o emissor ja tivesse o id do TMDB — que e justamente o caso em que ele
 * nao precisa de tradutor. A trava que o mantem honesto e a UNICIDADE: dois
 * homonimos derrubam o casamento para `null`, e nao para "o mais popular".
 *
 * NAO HA FUZZY, NAO HA PREFIXO, NAO HA "MELHOR APROXIMACAO". A busca do site tem
 * os tres — e esta certa, porque la existe uma pessoa lendo a lista e escolhendo.
 * Aqui nao existe ninguem: o que sair daqui vira bloco publicado.
 */

/* ------------------------------------------------------------------ */
/* Vocabulario                                                         */
/* ------------------------------------------------------------------ */

/**
 * Tipos que este tradutor resolve.
 *
 * `season` e `episode` existem no `EntityType` do banco e ficam de fora: eles nao
 * tem titulo proprio estavel (uma "Temporada 2" existe as centenas) e so se
 * identificam pela serie mais o numero — outro contrato, com outra chave. Pedir
 * um deles devolve `unsupported_kind`, e nao um palpite.
 */
export const RESOLVABLE_KINDS = ["movie", "tv", "person"] as const;
export type ResolvableKind = (typeof RESOLVABLE_KINDS)[number];

/**
 * COMO o casamento aconteceu. Sempre devolvido, junto da confianca.
 *
 * O cliente decide o que fazer com cada um — e por isso os tres sao distintos em
 * vez de um booleano "casou":
 *
 *  - `tmdb_id` (1.0) — identificador. Nao ha ambiguidade possivel;
 *  - `exact_title_year` (0.9) — titulo + ano + tipo, exatos e unicos. Nao e 1.0
 *    porque titulo nao e identificador: duas obras podem compartilhar os tres
 *    campos, e quando compartilham este modulo devolve `null` (`ambiguous_*`) —
 *    mas a existencia do caso e o que justifica o desconto;
 *  - `exact_name` (0.85) — nome exato e UNICO, so para pessoa, que nao tem ano.
 *    O sinal mais fraco dos tres, e por isso o mais barato de recusar.
 */
export const MATCHED_BY = ["tmdb_id", "exact_title_year", "exact_name"] as const;
export type MatchedBy = (typeof MATCHED_BY)[number];

export const CONFIDENCE_BY_MATCH: Readonly<Record<MatchedBy, number>> = {
  tmdb_id: 1,
  exact_title_year: 0.9,
  exact_name: 0.85,
};

/**
 * Por que NAO casou. O `reason` e obrigatorio em todo resultado sem id.
 *
 * Um `null` mudo devolveria o emissor ao ponto de partida: ele saberia que nao
 * achou e nao saberia se o problema e o dado dele, o gate de publicacao ou o
 * catalogo. Cada valor aqui aponta uma acao diferente.
 */
export type ResolveFailureReason =
  /** Nem `tmdbId` nem titulo/nome utilizavel foram enviados. */
  | "no_input"
  /** `kind` fora de `RESOLVABLE_KINDS`. */
  | "unsupported_kind"
  /** O `tmdbId` nao existe no catalogo — o item ainda nao foi ingerido. */
  | "tmdb_id_not_in_catalog"
  /** Titulo sem ano, para `movie`/`tv`. O ano nao e opcional no casamento. */
  | "title_requires_year"
  /** Pessoa sem `tmdbId`: o nome bateu, mas em mais de uma pessoa. */
  | "ambiguous_name"
  /** Titulo + ano + tipo bateram em mais de uma obra. */
  | "ambiguous_title"
  /** Nada bateu. */
  | "not_found"
  /**
   * A entidade EXISTE, e ainda assim nao serve.
   *
   * Sem slug canonico pt-BR ela nao tem pagina — e um `entityCard` apontando
   * para ela sumiria exatamente como um id inexistente. Devolver o id aqui
   * seria trocar um modo de falha silenciosa por outro.
   */
  | "no_canonical_slug";

/* ------------------------------------------------------------------ */
/* Limites                                                             */
/* ------------------------------------------------------------------ */

/** Itens por chamada. Alem disso o pedido inteiro e recusado, nunca truncado. */
export const MAX_RESOLVE_ITEMS = 50;

/** Teto do corpo. Cada item sao poucos campos curtos. */
export const MAX_RESOLVE_REQUEST_BYTES = 64 * 1024;

/** Teto de texto por campo. Titulo de obra nao passa disso. */
const MAX_TEXT_LENGTH = 300;

/** Faixa de ano aceita. Fora dela e digitacao errada, nao obra. */
const MIN_YEAR = 1870;
const MAX_YEAR = 2200;

/* ------------------------------------------------------------------ */
/* Dobra de texto                                                      */
/* ------------------------------------------------------------------ */

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Decompoe (NFD), remove acentos, minusculo, colapsa espacos.
 *
 * **Tem de ser bit a bit igual** a DUAS outras dobras, e as duas igualdades sao
 * travadas por teste — nao por comentario:
 *
 *  1. `foldText` de `services/ingestion/src/search/fold.ts` (a dobra da
 *     ingestao). Travada por `tests/governance/entity-resolve-fold.test.ts`,
 *     que compara as duas funcoes sobre um corpus. E um teste JS contra JS;
 *  2. **`immutable_fold(text)` no PostgreSQL** (migration
 *     `20260808120000_entity_resolve_folded_title_indexes`), que e quem dobra o
 *     LADO DO BANCO no casamento por titulo. Travada pelo passo de corpus de
 *     `pnpm --filter @screena/web validate:entity-resolve`, que so roda contra
 *     banco real — uma funcao SQL nao existe em teste puro.
 *
 * A distincao entre (1) e (2) e a licao do defeito de producao: o teste de (1)
 * passava, e o casamento por titulo estava morto assim mesmo, porque a
 * divergencia que importava era com o BANCO. Divergir nao quebra nada
 * ruidosamente — nao ha erro, nao ha log, so `not_found` para titulos que
 * existem.
 */
export function foldEntityText(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Pedido                                                              */
/* ------------------------------------------------------------------ */

/** Um item do pedido, ja normalizado. Nunca carrega o valor cru do cliente. */
export interface ResolveQuery {
  readonly index: number;
  readonly kind: ResolvableKind | null;
  readonly tmdbId: number | null;
  /** Titulo/nome DOBRADO. `null` quando ausente ou vazio. */
  readonly folded: string | null;
  readonly year: number | null;
}

export interface ResolveRequestRejection {
  readonly code: "invalid_json" | "validation_failed" | "too_many_items" | "payload_too_large";
  readonly status: number;
  readonly issues: readonly string[];
}

export type ResolveRequestParse =
  | { readonly ok: true; readonly queries: readonly ResolveQuery[] }
  | { readonly ok: false; readonly rejection: ResolveRequestRejection };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function integer(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

/**
 * Le o corpo do pedido.
 *
 * ITEM INVALIDO NAO E DESCARTADO. Ele entra na lista com `kind: null` ou sem
 * entrada utilizavel, e sai do outro lado como resultado `null` com motivo. A
 * alternativa — pular — mudaria o tamanho do array de resposta e desalinharia
 * silenciosamente a correspondencia posicional que o cliente usa.
 *
 * O pedido INTEIRO so e recusado quando a forma do envelope esta errada (nao e
 * objeto, `items` nao e lista, itens demais). Ai nao ha o que alinhar.
 */
export function parseEntityResolveRequest(
  body: unknown,
  rawBodyBytes: number,
): ResolveRequestParse {
  if (rawBodyBytes > MAX_RESOLVE_REQUEST_BYTES) {
    return {
      ok: false,
      rejection: {
        code: "payload_too_large",
        status: 413,
        issues: [
          `corpo com ${String(rawBodyBytes)} bytes; teto ${String(MAX_RESOLVE_REQUEST_BYTES)}`,
        ],
      },
    };
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      rejection: {
        code: "invalid_json",
        status: 400,
        issues: ["corpo precisa ser um objeto JSON"],
      },
    };
  }

  const items = (body as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    return {
      ok: false,
      rejection: { code: "validation_failed", status: 422, issues: ["items precisa ser uma lista"] },
    };
  }
  if (items.length === 0) {
    return {
      ok: false,
      rejection: { code: "validation_failed", status: 422, issues: ["items esta vazio"] },
    };
  }
  if (items.length > MAX_RESOLVE_ITEMS) {
    return {
      ok: false,
      rejection: {
        code: "too_many_items",
        status: 422,
        issues: [`${String(items.length)} itens; teto ${String(MAX_RESOLVE_ITEMS)} por chamada`],
      },
    };
  }

  const queries: ResolveQuery[] = items.map((raw, index) => {
    const item = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const kindText = text(item.kind);
    const kind = (RESOLVABLE_KINDS as readonly string[]).includes(kindText ?? "")
      ? (kindText as ResolvableKind)
      : null;

    const tmdbId = integer(item.tmdbId);
    // `title` e `name` sao o MESMO campo com dois nomes, e os dois sao aceitos:
    // obra tem titulo, pessoa tem nome, e obrigar o emissor a saber qual usar
    // produziria `no_input` por vocabulario, nao por falta de dado.
    const rawText = text(item.title) ?? text(item.name);
    const usable = rawText !== null && rawText.length <= MAX_TEXT_LENGTH ? rawText : null;
    const folded = usable === null ? null : foldEntityText(usable);

    const year = integer(item.year);
    const usableYear = year !== null && year >= MIN_YEAR && year <= MAX_YEAR ? year : null;

    return {
      index,
      kind,
      tmdbId: tmdbId !== null && tmdbId > 0 ? tmdbId : null,
      folded: folded === "" ? null : folded,
      year: usableYear,
    };
  });

  return { ok: true, queries };
}

/* ------------------------------------------------------------------ */
/* Casamento                                                           */
/* ------------------------------------------------------------------ */

/**
 * Uma entidade candidata, com o que basta para decidir e para responder.
 *
 * `canonicalSlug` e `null` quando a entidade nao tem slug canonico pt-BR — e e
 * isso que a torna inutil para o cliente, por mais certo que o casamento esteja.
 */
export interface ResolveCandidate {
  readonly kind: ResolvableKind;
  readonly entityId: string;
  readonly tmdbId: number | null;
  /**
   * Uma das dobras da entidade que BATERAM com o lote.
   *
   * Vazia quando a candidata veio por `tmdbId` — nesse caminho nao ha texto a
   * casar. O casamento por texto ja aconteceu no SQL; `folded` e
   * `foldedAliases` existem para que a candidata continue autoexplicativa (em
   * log e em teste) e para que a decisao siga sendo verificavel aqui.
   */
  readonly folded: string;
  /** As demais dobras que bateram (traducao, original, titulo alternativo). */
  readonly foldedAliases: readonly string[];
  readonly year: number | null;
  /** Titulo pt-BR quando existe; senao o original. Nunca inventado. */
  readonly canonicalTitle: string;
  readonly canonicalSlug: string | null;
}

export interface ResolveResult {
  readonly index: number;
  readonly entityKind: ResolvableKind | null;
  readonly entityId: string | null;
  readonly matchedBy: MatchedBy | null;
  readonly confidence: number;
  readonly canonicalTitle: string | null;
  readonly path: string | null;
  readonly reason: ResolveFailureReason | null;
}

/** Caminho publico pt-BR por tipo. */
const PATH_SEGMENT: Readonly<Record<ResolvableKind, string>> = {
  movie: "filmes",
  tv: "series",
  person: "pessoas",
};

/** Slug que quebraria a URL nunca vira caminho — nem com o casamento certo. */
function pathFor(kind: ResolvableKind, slug: string): string | null {
  const value = slug.trim();
  if (value === "") return null;
  if (/[/\\:?#\s]/.test(value) || value.includes("..")) return null;
  return `/pt/${PATH_SEGMENT[kind]}/${value}/`;
}

function fail(
  index: number,
  kind: ResolvableKind | null,
  reason: ResolveFailureReason,
): ResolveResult {
  return {
    index,
    entityKind: kind,
    entityId: null,
    matchedBy: null,
    confidence: 0,
    canonicalTitle: null,
    path: null,
    reason,
  };
}

function succeed(
  index: number,
  candidate: ResolveCandidate,
  matchedBy: MatchedBy,
): ResolveResult {
  // ULTIMO PORTAO, e ele derruba casamentos CERTOS. Uma entidade sem slug
  // canonico pt-BR nao tem pagina: o `entityCard` que apontasse para ela sumiria
  // do corpo exatamente como sumiria um id inexistente. Devolver o id aqui seria
  // trocar um modo de falha silenciosa por outro.
  const path = candidate.canonicalSlug === null ? null : pathFor(candidate.kind, candidate.canonicalSlug);
  if (path === null) return fail(index, candidate.kind, "no_canonical_slug");

  return {
    index,
    entityKind: candidate.kind,
    entityId: candidate.entityId,
    matchedBy,
    confidence: CONFIDENCE_BY_MATCH[matchedBy],
    canonicalTitle: candidate.canonicalTitle,
    path,
    reason: null,
  };
}

/**
 * Decide UM item contra as candidatas que o banco devolveu.
 *
 * A ORDEM importa e nao e negociavel: `tmdbId` primeiro. Quando o emissor manda
 * identificador E titulo, o identificador vence — e uma divergencia entre os
 * dois nao vira "tente o outro", porque tentar o outro e exatamente como se
 * publica a obra errada. Se o `tmdbId` nao esta no catalogo, o resultado e
 * `tmdb_id_not_in_catalog`, e nao uma busca por titulo pelas costas.
 */
export function resolveOne(
  query: ResolveQuery,
  candidates: readonly ResolveCandidate[],
): ResolveResult {
  if (query.kind === null) return fail(query.index, null, "unsupported_kind");
  const kind = query.kind;

  if (query.tmdbId !== null) {
    const byId = candidates.filter((c) => c.kind === kind && c.tmdbId === query.tmdbId);
    // `tmdb_id` e UNIQUE nas tres tabelas do catalogo, entao "mais de um" e
    // impossivel por schema. Continuar exigindo exatamente um custa nada e
    // recusa em vez de escolher, caso o schema mude.
    if (byId.length !== 1) return fail(query.index, kind, "tmdb_id_not_in_catalog");
    return succeed(query.index, byId[0] as ResolveCandidate, "tmdb_id");
  }

  if (query.folded === null) return fail(query.index, kind, "no_input");

  const byText = candidates.filter(
    (c) =>
      c.kind === kind && (c.folded === query.folded || c.foldedAliases.includes(query.folded ?? "")),
  );

  if (kind === "person") {
    // PESSOA NAO TEM ANO. O que sustenta este casamento e a UNICIDADE: dois
    // homonimos derrubam para `null`, nunca para "o mais popular".
    if (byText.length === 0) return fail(query.index, kind, "not_found");
    if (byText.length > 1) return fail(query.index, kind, "ambiguous_name");
    return succeed(query.index, byText[0] as ResolveCandidate, "exact_name");
  }

  // O ANO E OBRIGATORIO para obra, e a recusa e antes da consulta valer de algo:
  // "Superman" sem ano casa com meia duzia de filmes, e escolher entre eles e
  // precisamente o palpite que este modulo existe para nao dar.
  if (query.year === null) return fail(query.index, kind, "title_requires_year");

  const byYear = byText.filter((c) => c.year === query.year);
  if (byYear.length === 0) return fail(query.index, kind, "not_found");
  if (byYear.length > 1) return fail(query.index, kind, "ambiguous_title");
  return succeed(query.index, byYear[0] as ResolveCandidate, "exact_title_year");
}

/** Resolve o lote inteiro, preservando a ORDEM e o tamanho do pedido. */
export function resolveAll(
  queries: readonly ResolveQuery[],
  candidates: readonly ResolveCandidate[],
): ResolveResult[] {
  return queries.map((query) => resolveOne(query, candidates));
}
