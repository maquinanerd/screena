/**
 * validate-entity-resolve-real-postgres.ts — a rota interna de resolucao de
 * entidade contra Next REAL + PostgreSQL 16 efemero.
 *
 * POR QUE HTTP REAL, E NAO SO O NUCLEO PURO. `entity-resolve.test.ts` cobre a
 * decisao e `entity-resolve-auth.test.ts` cobre credencial e teto. O que nenhum
 * dos dois alcanca e justamente onde uma rota interna costuma falhar:
 *
 *  1. o SQL de casamento por titulo. Ele usa `immutable_fold(...)` — uma funcao
 *     que so existe no banco. Um erro ali nao aparece em teste puro: aparece
 *     como `not_found` para um titulo que existe;
 *  2. a credencial e o teto ligados no handler — teste puro prova a funcao, nao
 *     o fio;
 *  3. os cabecalhos de rota interna (`X-Robots-Tag`, `no-store`, ausencia de
 *     CORS) e o `405` para metodo errado;
 *  4. O FECHO DO CIRCUITO: que o id devolvido pela rota e o MESMO id que a
 *     renderizacao da materia aceita. Esse e o defeito que a rota inteira existe
 *     para fechar, e ele so se prova rodando os dois lados contra o mesmo banco.
 *
 * O QUE MUDOU AQUI, e por que a versao anterior deste arquivo passou verde
 * enquanto a rota estava morta em producao.
 *
 * A semente gravava `search_documents` A MAO, com `prisma.searchDocument.create`.
 * Isso fabricava a unica precondicao que producao nao tinha: a projecao de busca
 * ja rodada, com o texto certo, no locale certo. O teste media o SQL e nao media
 * a DEPENDENCIA — e a dependencia era o defeito. Medido em producao: `tmdbId`
 * resolvia 3 de 3 e titulo/nome resolvia 0 de 11.
 *
 * Agora a semente grava SO O CATALOGO: a entidade, a slug, a traducao e os
 * titulos alternativos. **Nenhuma linha de `search_documents` e criada em lugar
 * nenhum deste arquivo** — se a rota voltar a depender da projecao, todo
 * casamento por texto aqui fica vermelho.
 *
 * E o casamento nao usa titulo escolhido pelo autor do teste: ele usa o
 * `canonicalTitle` que a PROPRIA ROTA devolveu. Casar por id nao provava nada —
 * foi exatamente o que mascarou o defeito.
 *
 * Nao chama rede externa, nao usa banco remoto, nao cria credencial real: a
 * chave e sorteada e morre com o processo.
 *
 * Uso: pnpm --filter @screena/web validate:entity-resolve
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webDir, "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));

const LANGUAGE = "pt-BR";
const API_KEY = `resolve-${randomUUID()}${randomUUID()}`;

/* ------------------------------------------------------------------ */
/* Relatorio                                                           */
/* ------------------------------------------------------------------ */

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
let step = 0;
function record(name: string, ok: boolean, detail: string): void {
  step += 1;
  results.push({ n: step, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${String(step)}. ${name} - ${detail}`);
}

/* ------------------------------------------------------------------ */
/* Infra                                                               */
/* ------------------------------------------------------------------ */

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function prismaBin(): string {
  const pkgPath = dbRequire.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.status > 0) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** A MESMA dobra da ingestao e da rota. Duplicada aqui so para semear. */
function fold(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Semente                                                             */
/* ------------------------------------------------------------------ */

type PrismaLike = {
  movie: { create: (args: unknown) => Promise<{ id: bigint }> };
  tvShow: { create: (args: unknown) => Promise<{ id: bigint }> };
  person: { create: (args: unknown) => Promise<{ id: bigint }> };
  slug: { create: (args: unknown) => Promise<unknown> };
  entityTranslation: { create: (args: unknown) => Promise<unknown> };
  entityAlternativeTitle: { create: (args: unknown) => Promise<unknown> };
  searchDocument: { count: (args?: unknown) => Promise<number> };
  article: { create: (args: unknown) => Promise<{ id: bigint }> };
  articleTranslation: { create: (args: unknown) => Promise<unknown> };
  $queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>;
};

interface SeedEntity {
  readonly kind: "movie" | "tv" | "person";
  readonly tmdbId: number;
  /** Titulo ORIGINAL, gravado em `movies`/`tv_shows`/`people`. */
  readonly title: string;
  readonly year: number | null;
  readonly slug: string | null;
  readonly translatedTitle?: string;
  readonly aliases?: readonly string[];
}

async function seedEntity(prisma: PrismaLike, entity: SeedEntity): Promise<bigint> {
  let id: bigint;
  if (entity.kind === "movie") {
    const row = await prisma.movie.create({
      data: {
        tmdbId: entity.tmdbId,
        titleOriginal: entity.title,
        releaseDate: entity.year === null ? null : new Date(Date.UTC(entity.year, 5, 1)),
      },
      select: { id: true },
    });
    id = row.id;
  } else if (entity.kind === "tv") {
    const row = await prisma.tvShow.create({
      data: {
        tmdbId: entity.tmdbId,
        nameOriginal: entity.title,
        firstAirDate: entity.year === null ? null : new Date(Date.UTC(entity.year, 5, 1)),
      },
      select: { id: true },
    });
    id = row.id;
  } else {
    const row = await prisma.person.create({
      data: { tmdbId: entity.tmdbId, name: entity.title },
      select: { id: true },
    });
    id = row.id;
  }

  if (entity.slug !== null) {
    await prisma.slug.create({
      data: {
        entityType: entity.kind,
        entityId: id,
        languageCode: LANGUAGE,
        slug: entity.slug,
        isCanonical: true,
      },
    });
  }

  if (entity.translatedTitle !== undefined) {
    await prisma.entityTranslation.create({
      data: {
        entityType: entity.kind,
        entityId: id,
        languageCode: LANGUAGE,
        title: entity.translatedTitle,
      },
    });
  }

  // TITULOS ALTERNATIVOS no CATALOGO, e nao em `search_documents`. Esta e a
  // fonte de verdade dos aliases; a projecao de busca so os copiava.
  for (const alias of entity.aliases ?? []) {
    await prisma.entityAlternativeTitle.create({
      // `normalized` e obrigatorio na tabela e e usado por OUTRAS superficies;
      // esta rota nao le essa coluna (ela dobra `title` no SQL). Semeamos com a
      // dobra so para a linha ficar realista.
      data: { entityType: entity.kind, entityId: id, title: alias, normalized: fold(alias) },
    });
  }

  // NENHUM `searchDocument.create` aqui, de proposito. Ver o cabecalho: era ele
  // que fabricava a precondicao que producao nao tinha.
  return id;
}

/* ------------------------------------------------------------------ */
/* Chamadas HTTP                                                       */
/* ------------------------------------------------------------------ */

interface ResolveResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

async function callResolve(
  base: string,
  items: unknown,
  key: string | null = API_KEY,
): Promise<ResolveResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${base}/api/internal/entity-resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ items }),
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = { raw: raw.slice(0, 300) };
  }
  return { status: response.status, headers: response.headers, body };
}

interface ResultRow {
  entityKind: string | null;
  entityId: string | null;
  matchedBy: string | null;
  confidence: number;
  canonicalTitle: string | null;
  path: string | null;
  reason: string | null;
}

function rows(response: ResolveResponse): ResultRow[] {
  const list = response.body.results;
  return Array.isArray(list) ? (list as ResultRow[]) : [];
}

/* ------------------------------------------------------------------ */
/* Checagens                                                           */
/* ------------------------------------------------------------------ */

interface SeededIds {
  fightClub: bigint;
  espacoDuplo: bigint;
  gemeasA: bigint;
  gemeasB: bigint;
  ruptura: bigint;
  freeman: bigint;
  evansA: bigint;
  evansB: bigint;
  semSlug: bigint;
}

async function runHttpChecks(base: string, ids: SeededIds): Promise<void> {
  /* --- credencial ------------------------------------------------- */

  const noKey = await callResolve(base, [{ kind: "movie", tmdbId: 550 }], null);
  record("sem credencial: 401", noKey.status === 401, `status=${String(noKey.status)}`);

  const wrongKey = await callResolve(
    base,
    [{ kind: "movie", tmdbId: 550 }],
    `${API_KEY.slice(0, -1)}z`,
  );
  record(
    "chave errada do MESMO tamanho: 401",
    wrongKey.status === 401,
    `status=${String(wrongKey.status)}`,
  );

  /* --- cabecalhos de rota interna --------------------------------- */

  const ok = await callResolve(base, [{ kind: "movie", tmdbId: 550 }]);
  record(
    "X-Robots-Tag noindex — Disallow impede rastrear, nao indexar",
    (ok.headers.get("x-robots-tag") ?? "").includes("noindex"),
    `x-robots-tag=${ok.headers.get("x-robots-tag") ?? "ausente"}`,
  );
  record(
    "sem CORS publico — navegador nenhum chama esta rota",
    ok.headers.get("access-control-allow-origin") === null,
    `acao=${ok.headers.get("access-control-allow-origin") ?? "ausente"}`,
  );
  record(
    "cache-control no-store — a resposta depende da credencial",
    (ok.headers.get("cache-control") ?? "").includes("no-store"),
    `cache-control=${ok.headers.get("cache-control") ?? "ausente"}`,
  );

  const get = await fetch(`${base}/api/internal/entity-resolve`, { method: "GET" });
  record("GET responde 405", get.status === 405, `status=${String(get.status)}`);

  const robots = await (await fetch(`${base}/robots.txt`)).text();
  record(
    "robots.txt continua bloqueando /api/",
    robots.includes("Disallow: /api/"),
    "Disallow: /api/ presente",
  );

  /* --- tmdb_id ---------------------------------------------------- */

  const byTmdb = rows(ok)[0];
  record(
    "tmdb_id casa e devolve o id INTERNO, nao o do TMDB",
    byTmdb?.entityId === ids.fightClub.toString() &&
      byTmdb?.matchedBy === "tmdb_id" &&
      byTmdb?.confidence === 1,
    `entityId=${byTmdb?.entityId ?? "null"} interno=${ids.fightClub.toString()} matchedBy=${byTmdb?.matchedBy ?? "null"}`,
  );
  record(
    "o caminho devolvido e a rota publica pt-BR",
    byTmdb?.path === "/pt/filmes/clube-da-luta/",
    `path=${byTmdb?.path ?? "null"}`,
  );
  record(
    "canonicalTitle vem da traducao pt-BR, nunca inventado",
    byTmdb?.canonicalTitle === "Clube da Luta",
    `canonicalTitle=${byTmdb?.canonicalTitle ?? "null"}`,
  );

  const tmdbMissing = await callResolve(base, [{ kind: "movie", tmdbId: 987654321 }]);
  record(
    "tmdb_id fora do catalogo: null NOMEADO, nunca palpite",
    rows(tmdbMissing)[0]?.entityId === null &&
      rows(tmdbMissing)[0]?.reason === "tmdb_id_not_in_catalog",
    `reason=${rows(tmdbMissing)[0]?.reason ?? "null"}`,
  );

  const tmdbWrongKind = await callResolve(base, [{ kind: "tv", tmdbId: 550 }]);
  record(
    "o MESMO tmdb_id em outro kind nao casa",
    rows(tmdbWrongKind)[0]?.entityId === null,
    `entityId=${rows(tmdbWrongKind)[0]?.entityId ?? "null"}`,
  );

  const tmdbWins = await callResolve(base, [
    { kind: "movie", tmdbId: 987654321, title: "Clube da Luta", year: 1999 },
  ]);
  record(
    "tmdb_id inexistente NAO cai para o titulo — divergencia nao vira 'tente o outro'",
    rows(tmdbWins)[0]?.entityId === null &&
      rows(tmdbWins)[0]?.reason === "tmdb_id_not_in_catalog",
    `reason=${rows(tmdbWins)[0]?.reason ?? "null"}`,
  );

  /* --- O DEFEITO MEDIDO: ida e volta pelo proprio canonicalTitle ---
   *
   * ESTE E O BLOCO CENTRAL DO ARQUIVO.
   *
   * Em producao a rota devolvia `canonicalTitle: "A Origem"` para
   * `{kind:movie, tmdbId:27205}` e devolvia `not_found` para
   * `{kind:movie, title:"A Origem", year:2010}` — o titulo que ela mesma
   * acabara de emitir. Onze titulos, onze `not_found`.
   *
   * O casamento por ID nao prova nada aqui: foi ele que mascarou o defeito. O
   * que prova e o CICLO — perguntar por id, pegar o rotulo que voltou, e
   * perguntar de novo por esse rotulo.
   */

  const label = await callResolve(base, [
    { kind: "movie", tmdbId: 550 },
    { kind: "tv", tmdbId: 12001 },
    { kind: "person", tmdbId: 192 },
  ]);
  const labelRows = rows(label);
  const movieTitle = labelRows[0]?.canonicalTitle ?? "";
  const tvTitle = labelRows[1]?.canonicalTitle ?? "";
  const personName = labelRows[2]?.canonicalTitle ?? "";

  const roundTrip = await callResolve(base, [
    { kind: "movie", title: movieTitle, year: 1999 },
    { kind: "tv", title: tvTitle, year: 2022 },
    { kind: "person", name: personName },
  ]);
  const tripRows = rows(roundTrip);
  record(
    "IDA E VOLTA: o canonicalTitle que a rota devolveu resolve para o MESMO id",
    tripRows[0]?.entityId === ids.fightClub.toString() &&
      tripRows[1]?.entityId === ids.ruptura.toString() &&
      tripRows[2]?.entityId === ids.freeman.toString(),
    `"${movieTitle}"->${tripRows[0]?.entityId ?? tripRows[0]?.reason ?? "null"} · ` +
      `"${tvTitle}"->${tripRows[1]?.entityId ?? tripRows[1]?.reason ?? "null"} · ` +
      `"${personName}"->${tripRows[2]?.entityId ?? tripRows[2]?.reason ?? "null"}`,
  );

  /* --- titulo + ano (o SQL de verdade) ---------------------------- */

  const byTitle = await callResolve(base, [{ kind: "movie", title: "Clube da Luta", year: 1999 }]);
  record(
    "TRADUCAO pt-BR casa pelo SQL real (immutable_fold nos dois lados)",
    rows(byTitle)[0]?.entityId === ids.fightClub.toString() &&
      rows(byTitle)[0]?.matchedBy === "exact_title_year",
    `entityId=${rows(byTitle)[0]?.entityId ?? "null"} matchedBy=${rows(byTitle)[0]?.matchedBy ?? "null"}`,
  );

  const byOriginal = await callResolve(base, [{ kind: "movie", title: "Fight Club", year: 1999 }]);
  record(
    "TITULO ORIGINAL casa — o emissor nem sempre usa o titulo pt-BR",
    rows(byOriginal)[0]?.entityId === ids.fightClub.toString(),
    `entityId=${rows(byOriginal)[0]?.entityId ?? "null"} reason=${rows(byOriginal)[0]?.reason ?? "null"}`,
  );

  const byAccent = await callResolve(base, [
    { kind: "movie", title: "  clube DA   luta ", year: 1999 },
  ]);
  record(
    "caixa, espaco duplo e espaco nas pontas nao atrapalham",
    rows(byAccent)[0]?.entityId === ids.fightClub.toString(),
    `entityId=${rows(byAccent)[0]?.entityId ?? "null"}`,
  );

  const byAlias = await callResolve(base, [
    { kind: "movie", title: "O Clube da Luta", year: 1999 },
  ]);
  record(
    "ALIAS casa — e como o MNScr costuma citar a obra",
    rows(byAlias)[0]?.entityId === ids.fightClub.toString(),
    `entityId=${rows(byAlias)[0]?.entityId ?? "null"} reason=${rows(byAlias)[0]?.reason ?? "null"}`,
  );

  const accented = await callResolve(base, [{ kind: "tv", title: "ruptura", year: 2022 }]);
  record(
    "titulo com acento no banco casa com o termo sem acento",
    rows(accented)[0]?.entityId === ids.ruptura.toString(),
    `entityId=${rows(accented)[0]?.entityId ?? "null"} esperado=${ids.ruptura.toString()}`,
  );

  const doubleSpacedInDb = await callResolve(base, [
    { kind: "movie", title: "Filme Com Espaco Duplo", year: 2015 },
  ]);
  record(
    // `immutable_unaccent(lower(x))` NAO colapsa espaco; a dobra do JS colapsa.
    // Este caso e o que separa as duas funcoes, e ele so falha contra banco real.
    "ESPACO DUPLO no BANCO casa com um espaco so na entrada",
    rows(doubleSpacedInDb)[0]?.entityId === ids.espacoDuplo.toString(),
    `entityId=${rows(doubleSpacedInDb)[0]?.entityId ?? "null"} reason=${rows(doubleSpacedInDb)[0]?.reason ?? "null"}`,
  );

  const noYear = await callResolve(base, [{ kind: "movie", title: "Clube da Luta" }]);
  record(
    "titulo SEM ano nao casa, mesmo com candidato unico",
    rows(noYear)[0]?.entityId === null && rows(noYear)[0]?.reason === "title_requires_year",
    `reason=${rows(noYear)[0]?.reason ?? "null"}`,
  );

  const ambiguous = await callResolve(base, [{ kind: "movie", title: "Gemeas", year: 1998 }]);
  record(
    "DUAS obras com titulo e ano iguais: null, nunca escolha",
    rows(ambiguous)[0]?.entityId === null && rows(ambiguous)[0]?.reason === "ambiguous_title",
    `reason=${rows(ambiguous)[0]?.reason ?? "null"} (ids ${ids.gemeasA.toString()}/${ids.gemeasB.toString()})`,
  );

  const fuzzy = await callResolve(base, [{ kind: "movie", title: "Clube de Luta", year: 1999 }]);
  record(
    "quase-igual NAO casa — nao ha fuzzy nesta rota",
    rows(fuzzy)[0]?.entityId === null && rows(fuzzy)[0]?.reason === "not_found",
    `reason=${rows(fuzzy)[0]?.reason ?? "null"}`,
  );

  /* --- pessoa ----------------------------------------------------- */

  const person = await callResolve(base, [{ kind: "person", name: "Morgan Freeman" }]);
  record(
    "pessoa por nome UNICO casa, com confianca menor",
    rows(person)[0]?.entityId === ids.freeman.toString() &&
      rows(person)[0]?.matchedBy === "exact_name" &&
      rows(person)[0]?.path === "/pt/pessoas/morgan-freeman/",
    `entityId=${rows(person)[0]?.entityId ?? "null"} confidence=${String(rows(person)[0]?.confidence ?? -1)}`,
  );

  const homonym = await callResolve(base, [{ kind: "person", name: "Chris Evans" }]);
  record(
    "HOMONIMOS derrubam para null, nunca para o mais popular",
    rows(homonym)[0]?.entityId === null && rows(homonym)[0]?.reason === "ambiguous_name",
    `reason=${rows(homonym)[0]?.reason ?? "null"} (ids ${ids.evansA.toString()}/${ids.evansB.toString()})`,
  );

  /* --- o portao final --------------------------------------------- */

  const noSlug = await callResolve(base, [{ kind: "movie", tmdbId: 424242 }]);
  record(
    "entidade SEM slug canonico pt-BR nao e devolvida, e diz por que",
    rows(noSlug)[0]?.entityId === null && rows(noSlug)[0]?.reason === "no_canonical_slug",
    `reason=${rows(noSlug)[0]?.reason ?? "null"} (id ${ids.semSlug.toString()} existe no catalogo)`,
  );

  /* --- lote ------------------------------------------------------- */

  const batch = await callResolve(base, [
    { kind: "movie", tmdbId: 550 },
    { kind: "planeta" },
    { kind: "person", name: "Morgan Freeman" },
    { kind: "movie", title: "Nada Disso Existe", year: 2001 },
  ]);
  const batchRows = rows(batch);
  record(
    "o lote devolve UM resultado por item, na ordem, mesmo com item invalido",
    batchRows.length === 4 &&
      batchRows[0]?.entityId === ids.fightClub.toString() &&
      batchRows[1]?.reason === "unsupported_kind" &&
      batchRows[2]?.entityId === ids.freeman.toString() &&
      batchRows[3]?.reason === "not_found",
    `n=${String(batchRows.length)} reasons=[${batchRows.map((r) => r.reason ?? "ok").join(", ")}]`,
  );
  record(
    "todo resultado sem id carrega motivo; todo resultado com id nao carrega",
    batchRows.every((row) => (row.entityId === null) === (row.reason !== null)),
    "invariante da resposta preservada",
  );

  const tooMany = await callResolve(
    base,
    Array.from({ length: 51 }, () => ({ kind: "movie", tmdbId: 550 })),
  );
  record(
    "itens demais: 422 e recusa do pedido INTEIRO, nunca truncamento",
    tooMany.status === 422 && tooMany.body.error === "too_many_items",
    `status=${String(tooMany.status)} error=${String(tooMany.body.error)}`,
  );

  /* --- teto de chamadas ------------------------------------------- */

  let limited: ResolveResponse | null = null;
  for (let i = 0; i < 40; i += 1) {
    const response = await callResolve(base, [{ kind: "movie", tmdbId: 550 }]);
    if (response.status === 429) {
      limited = response;
      break;
    }
  }
  record(
    "o teto por credencial dispara 429 com Retry-After",
    limited !== null && Number(limited.headers.get("retry-after") ?? 0) > 0,
    limited === null
      ? "nao disparou em 40 chamadas (teto do ambiente = 5?)"
      : `retry-after=${limited.headers.get("retry-after") ?? "ausente"}`,
  );
}

/* ------------------------------------------------------------------ */
/* A dobra do JS e a dobra do BANCO                                    */
/* ------------------------------------------------------------------ */

/**
 * Corpus em que uma dobra "equivalente" costuma escorregar.
 *
 * E o MESMO corpus de `tests/governance/entity-resolve-fold.test.ts`, e a
 * repeticao e o ponto: aquele teste compara JS com JS e passou verde durante
 * todo o periodo em que o casamento por titulo estava morto. O que faltava era
 * comparar o JS com o SQL — e isso nao existe fora de um banco.
 */
const FOLD_CORPUS: readonly string[] = [
  "Clube da Luta",
  "Amélie",
  "CORAÇÃO",
  "A Viagem  de   Chihiro",
  "   Cidade de Deus   ",
  "Homem-Aranha: Sem Volta Para Casa",
  "Star Wars: Episódio V — O Império Contra-Ataca",
  "Ó Irmão, Onde Estás?",
  "WALL·E",
  "¡Ay, Carmela!",
  "Spider-Man 2",
  // Os dois casos em que `unaccent` transforma ALEM do acento e o NFD do JS nao
  // transforma nada. Se a comparacao fosse "dobra do JS contra dobra do SQL",
  // estas duas linhas nunca casariam; dobrando os dois lados, casam.
  "Æon Flux",
  "Straße ohne Ende",
  "Crouching Tiger, Hidden Dragon",
  "Não",
  "ÑOÑO",
  "Café Society",
  "“Aspas” e ‘apóstrofos’",
  "Emoji 🎬 no título",
  "A Origem",
  "a origem",
  "Rúptura",
  "Morgan Freeman",
  "Christopher Nolan",
];

/**
 * A PROPRIEDADE de que o casamento por titulo depende.
 *
 * Nao e "a dobra do SQL e igual a dobra do JS" — essa promessa e fragil e nao e
 * o que o desenho pede. A consulta aplica `immutable_fold` aos DOIS lados: ao
 * valor da coluna (crua) e ao termo (que ja chegou dobrado pelo JS). O
 * casamento so acontece se:
 *
 *     immutable_fold( foldEntityText(x) )  ==  immutable_fold( x )
 *
 * ou seja: a pre-dobra do JS nao pode LEVAR a entrada para fora do espaco em que
 * a dobra do SQL poe a coluna. E isto que este passo mede — e so um banco de
 * verdade pode medir, porque `immutable_fold` mora la.
 */
async function runFoldParityCheck(): Promise<void> {
  const dbServer = (await import("@screena/db/server")) as { getPrismaClient: () => PrismaLike };
  const prisma = dbServer.getPrismaClient();

  // O CLUSTER LOCAL NEM SEMPRE E UTF8. Este harness (como os demais deste
  // repositorio) tenta `initdb --encoding=UTF8` e CAI para o encoding do SO
  // quando o caminho tem caractere nao-ASCII — no Windows, WIN1252. Mandar um
  // emoji para um cluster WIN1252 estoura com `22P05` antes de a dobra ser
  // exercida, e isso nao diz nada sobre a dobra.
  //
  // Entao o corpus e RECORTADO ao que o cluster consegue representar, e o
  // recorte aparece no relatorio. Em CI (Linux, UTF8) o corpus roda inteiro.
  const [{ server_encoding: encoding }] = await prisma.$queryRawUnsafe<
    { server_encoding: string }[]
  >("SHOW server_encoding");
  const representable =
    encoding.toUpperCase() === "UTF8"
      ? FOLD_CORPUS
      : FOLD_CORPUS.filter((value) => [...value].every((ch) => (ch.codePointAt(0) ?? 0) <= 0xff));

  const pairs = await prisma.$queryRawUnsafe<
    { input: string; direct: string; viaJs: string }[]
  >(
    `SELECT t.input,
            immutable_fold(t.input) AS "direct",
            immutable_fold(t.pre)   AS "viaJs"
       FROM unnest($1::text[], $2::text[]) AS t(input, pre)`,
    [...representable],
    representable.map((value) => fold(value)),
  );

  const divergent = pairs.filter((row) => row.direct !== row.viaJs);
  record(
    "dobrar o termo no JS ANTES nao muda o resultado da dobra do banco",
    divergent.length === 0 && pairs.length === representable.length,
    divergent.length === 0
      ? `${String(pairs.length)}/${String(FOLD_CORPUS.length)} entradas conferidas (acento, caixa, espaco duplo, ligadura, AE ligado, eszett, aspas) — cluster ${encoding}`
      : divergent
          .slice(0, 4)
          .map(
            (row) =>
              `${JSON.stringify(row.input)}: coluna=${JSON.stringify(row.direct)} termo=${JSON.stringify(row.viaJs)}`,
          )
          .join(" | "),
  );

  // CONTROLE NEGATIVO. Sem ele o caso acima passaria mesmo se `immutable_fold`
  // fosse a identidade — bastaria as duas pontas nao fazerem nada.
  // O ` ` e ESPACO INQUEBRAVEL, e ele esta aqui de proposito: ele NAO entra em
  // `[[:space:]]` sob ctype C, entao sem o `replace(..., chr(160), ' ')` da funcao
  // este caso volta com dois espacos e o titulo nunca casaria.
  const identity = await prisma.$queryRawUnsafe<{ folded: string }[]>(
    "SELECT immutable_fold($1::text) AS folded",
    "  ÁGUA   Viva   ",
  );
  record(
    "o controle NEGATIVO acusa: a dobra do banco realmente TRANSFORMA",
    identity[0]?.folded === "agua viva",
    `immutable_fold("  AGUA <nbsp> Viva   ") = ${JSON.stringify(identity[0]?.folded ?? null)}`,
  );

  // A PRECONDICAO QUE PRODUCAO NAO TINHA. Se algum passo deste arquivo voltar a
  // semear a projecao de busca, todo casamento por texto acima passa a medir a
  // projecao de novo — e o defeito volta a ser invisivel.
  const projected = await prisma.searchDocument.count();
  record(
    "NENHUM documento de busca foi semeado: o casamento por titulo leu o CATALOGO",
    projected === 0,
    `search_documents = ${String(projected)} linha(s)`,
  );
}

/**
 * O FECHO DO CIRCUITO — e o unico passo que prova o que a rota existe para
 * resolver.
 *
 * Pega o id que a ROTA devolveu, poe num bloco `entityCard` do corpo de uma
 * materia e renderiza pela MESMA funcao que a pagina publica usa. Se a ficha
 * aparecer, o id que o MNScr recebeu e o id que a renderizacao aceita. Se nao
 * aparecer, o bloco teria sumido em silencio — que e exatamente o defeito.
 */
async function runRenderCheck(resolvedEntityId: string): Promise<void> {
  const dbServer = (await import("@screena/db/server")) as { getPrismaClient: () => PrismaLike };
  const prisma = dbServer.getPrismaClient();

  const slug = `materia-do-circuito-${randomUUID().slice(0, 8)}`;
  const article = await prisma.article.create({
    data: {
      authorName: "Redacao Cinerie",
      publishedAt: new Date("2026-06-30T12:00:00.000Z"),
      aiAssisted: false,
      licenseStatus: "official",
      displayAllowed: true,
      requiresAttribution: false,
      requiresLinkback: false,
    },
    select: { id: true },
  });

  // `body_blocks` vive na TRADUCAO, nao no artigo: o corpo estruturado e por
  // idioma, como todo texto.
  await prisma.articleTranslation.create({
    data: {
      articleId: article.id,
      languageCode: LANGUAGE,
      slug,
      title: "Materia que cita o filme resolvido",
      body: "Corpo editorial proprio e substancial. ".repeat(12),
      bodyBlocks: [
        { type: "paragraph", id: "p1", text: "Texto de abertura com corpo suficiente. ".repeat(8) },
        {
          type: "entityCard",
          id: "e1",
          entityKind: "movie",
          entityId: resolvedEntityId,
          note: "Nota escrita pela redacao.",
        },
      ],
      // O CHECK `article_translations_body_blocks_version_paired` exige os dois
      // juntos: corpo estruturado sem versao nao entra no banco.
      bodyBlocksVersion: "validate-entity-resolve",
      reviewStatus: "published",
      indexStatus: "index",
      publishedAt: new Date("2026-06-30T12:00:00.000Z"),
    },
  });

  const news = (await import("../src/server/news-pages.ts")) as {
    getNewsArticleData: (slug: string) => Promise<{
      bodyBlocks: ReadonlyArray<{ kind: string; card?: { entityId: string; href: string } }>;
    } | null>;
  };
  const data = await news.getNewsArticleData(slug);
  const card = data?.bodyBlocks.find((block) => block.kind === "entityCard");

  record(
    "O CIRCUITO FECHA: o id devolvido pela rota RENDERIZA como ficha na materia",
    card !== undefined && card.card?.entityId === resolvedEntityId,
    card === undefined
      ? `bloco entityCard AUSENTE — o id ${resolvedEntityId} sumiu em silencio, que e o defeito`
      : `entityId=${card.card?.entityId ?? "null"} href=${card.card?.href ?? "null"}`,
  );
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const pgPort = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-entity-resolve-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: pgPort,
    persistent: true,
  });
  const database = "cinerie_entity_resolve_validation";
  const url = `postgresql://postgres:postgres@127.0.0.1:${String(pgPort)}/${database}?schema=public`;
  console.log(
    `\n=== Postgres efemero (embedded) :${String(pgPort)} | postgresql://postgres:****@127.0.0.1:${String(pgPort)}/${database} ===\n`,
  );

  let started = false;
  let server: ReturnType<typeof spawn> | null = null;

  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase(database);

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record("migrate deploy aplica sem erro", true, "ok");

    console.log("--- prisma db seed ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    record("db:seed roda sem erro", true, "ok");

    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    const prisma = dbServer.getPrismaClient();

    const ids: SeededIds = {
      // As TRES origens de texto numa entidade so: original em `movies`,
      // traducao pt-BR em `entity_translations` e alias em
      // `entity_alternative_titles`. A rota tem de casar pelas tres.
      fightClub: await seedEntity(prisma, {
        kind: "movie",
        tmdbId: 550,
        title: "Fight Club",
        year: 1999,
        slug: "clube-da-luta",
        translatedTitle: "Clube da Luta",
        aliases: ["O Clube da Luta"],
      }),
      // ESPACO DUPLO gravado NO BANCO. O emissor manda "Filme Com Espaco
      // Duplo" com um espaco so; `immutable_unaccent(lower(x))` nunca casaria.
      espacoDuplo: await seedEntity(prisma, {
        kind: "movie",
        tmdbId: 15001,
        title: "Filme  Com   Espaco Duplo",
        year: 2015,
        slug: "filme-com-espaco-duplo",
      }),
      // Duas obras com o MESMO titulo e o MESMO ano: a ambiguidade que a rota
      // recusa em vez de resolver por popularidade.
      gemeasA: await seedEntity(prisma, {
        kind: "movie",
        tmdbId: 11001,
        title: "Gemeas",
        year: 1998,
        slug: "gemeas-a",
      }),
      gemeasB: await seedEntity(prisma, {
        kind: "movie",
        tmdbId: 11002,
        title: "Gemeas",
        year: 1998,
        slug: "gemeas-b",
      }),
      // Titulo COM acento no banco, consultado SEM acento pelo cliente.
      ruptura: await seedEntity(prisma, {
        kind: "tv",
        tmdbId: 12001,
        title: "Rúptura",
        year: 2022,
        slug: "ruptura",
      }),
      freeman: await seedEntity(prisma, {
        kind: "person",
        tmdbId: 192,
        title: "Morgan Freeman",
        year: null,
        slug: "morgan-freeman",
      }),
      evansA: await seedEntity(prisma, {
        kind: "person",
        tmdbId: 13001,
        title: "Chris Evans",
        year: null,
        slug: "chris-evans",
      }),
      evansB: await seedEntity(prisma, {
        kind: "person",
        tmdbId: 13002,
        title: "Chris Evans",
        year: null,
        slug: "chris-evans-apresentador",
      }),
      // Existe no catalogo, e NAO tem pagina: sem slug canonico pt-BR.
      semSlug: await seedEntity(prisma, {
        kind: "movie",
        tmdbId: 424242,
        title: "Filme Sem Pagina",
        year: 2020,
        slug: null,
      }),
    };
    record(
      "catalogo semeado (9 entidades) — e NENHUM documento de busca",
      true,
      "so movies/tv_shows/people + slugs + traducoes + titulos alternativos",
    );

    /* --- Next real ------------------------------------------------ */

    const nextBin = path.join(webDir, "node_modules", "next", "dist", "bin", "next");
    const webEnv: NodeJS.ProcessEnv = {
      ...env,
      NODE_ENV: "production",
      CINERIE_PUBLIC_SITE_URL: "https://cinerie.com",
      CINERIE_PUBLIC_INDEXING_ENABLED: "true",
      CINERIE_CATALOG_RESOLVE_API_KEYS: API_KEY,
      // Teto BAIXO de proposito: o caso do 429 precisa disparar sem 60 chamadas.
      CINERIE_CATALOG_RESOLVE_RATE_LIMIT_PER_MINUTE: "20",
    };

    console.log("--- next build ---");
    const build = spawnSync("node", [nextBin, "build"], {
      cwd: webDir,
      env: webEnv,
      stdio: "pipe",
      shell: false,
    });
    if (build.status !== 0) {
      record("next build", false, (build.stdout?.toString() ?? "").slice(-1200));
      throw new Error("next build falhou");
    }
    record("next build concluido", true, "ok");

    const httpPort = await freePort();
    const base = `http://127.0.0.1:${String(httpPort)}`;
    server = spawn(
      "node",
      [nextBin, "start", "--port", String(httpPort), "--hostname", "127.0.0.1"],
      { cwd: webDir, env: webEnv, stdio: "pipe", shell: false },
    );
    let log = "";
    const capture = (chunk: unknown) => {
      log = `${log}${String(chunk)}`.slice(-4_000);
    };
    server.stdout?.on("data", capture);
    server.stderr?.on("data", capture);

    const up = await waitForHttp(`${base}/robots.txt`, 120_000);
    if (!up) {
      record("Next respondeu", false, log.slice(-600) || "sem saida");
      throw new Error("Next nao subiu");
    }
    record("Next real no ar", true, base);

    await runHttpChecks(base, ids);
    await runFoldParityCheck();
    await runRenderCheck(ids.fightClub.toString());

    await dbServer.disconnectPrisma();
  } catch (error) {
    // A mensagem do Prisma vem multilinha e o primeiro trecho costuma ser
    // vazio; sem o recorte maior, um erro de schema aparecia como `FAIL -` puro.
    const message =
      error instanceof Error ? `${error.name}: ${error.message.replace(/\s+/g, " ").slice(0, 400)}` : String(error);
    record("execucao", false, message);
  } finally {
    if (server !== null) server.kill();
    if (started) await pg.stop();
    delete process.env.DATABASE_URL;
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch (error) {
      console.warn(`Aviso: dir temporario nao removido (${(error as Error).message.split("\n")[0] ?? ""}).`);
    }
    console.log("\n=== Postgres efemero derrubado ===");
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nRESUMO: ${String(results.length - failed.length)}/${String(results.length)} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${String(f.n)}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Rota interna de resolucao validada contra Next e PostgreSQL reais.");
}

main().catch((error) => {
  console.error("Erro fatal:", error);
  process.exit(1);
});
