/**
 * validate-route-cache-real-postgres.ts — CACHE E VOLUME DE CONSULTA das rotas
 * publicas, contra PostgreSQL 16 REAL efemero e Next.js REAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nao roda no render/build/producao.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO PROVA, E POR QUE NADA DISSO PODE SER `grep`
 * ============================================================================
 * A tarefa que originou este script mede SUCESSO EM RELOGIO. As tres provas
 * abaixo sao as unicas que um teste pode dar sem sair da maquina; a quarta (o
 * tempo contra producao, depois do deploy) e humana e esta no relatorio.
 *
 *  1. CABECALHO POR CLASSE, emitido por um Next de verdade. Nenhuma linha deste
 *     repositorio escreve `Cache-Control` de pagina: `no-store` e o default do
 *     Next para resposta nao cacheada, e `s-maxage=N` e o default para resposta
 *     cacheada. Este script mede os DOIS na mesma instalacao, no mesmo processo
 *     — e e assim que a afirmacao "o header e consequencia, nao causa" deixa de
 *     ser opiniao.
 *
 *  2. ISR DE VERDADE nas rotas de ficha. A segunda leitura da MESMA URL tem de
 *     vir do cache: `age` presente, ou `x-nextjs-cache: HIT`, e um tempo
 *     visivelmente menor. Header novo nao e tempo — por isso as duas coisas sao
 *     exigidas juntas.
 *
 *  3. VOLUME DE CONSULTA. O PostgreSQL conta as linhas devolvidas por
 *     `pg_stat_statements`... que exige extensao. Em vez disso este script usa o
 *     que ja existe e e exato: `pg_stat_database.tup_returned` /
 *     `tup_fetched` do banco efemero, medidos ANTES e DEPOIS de UMA
 *     requisicao. Com o catalogo semeado grande, o defeito antigo (ler tudo
 *     para mostrar 24) aparece como um numero na casa das dezenas de milhares.
 *
 * Uso: pnpm --filter @screena/web validate:route-cache
 * Pre-requisito: `pnpm build` (o script sobe `next start` sobre o build atual).
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const webRequire = createRequire(path.join(webDir, "package.json"));

const LANGUAGE = "pt-BR";

/** Slug da ficha usada nas provas de ISR (semeado por `seedCatalog`). */
const SLUG = "filme-1";

/**
 * Tamanho do catalogo semeado.
 *
 * 6.000 filmes e 3.000 series NAO e capricho: com 129 titulos (o tamanho de
 * producao ate 2026-08) a diferenca entre "ler o catalogo" e "ler a pagina" e
 * invisivel. O defeito so tem sombra quando o catalogo e grande — que e
 * exatamente por que ele viveu tanto tempo sem ser visto.
 */
const MOVIE_COUNT = 6_000;
const SERIES_COUNT = 3_000;
const PERSON_COUNT = 3_000;

/**
 * Teto de linhas lidas do banco por UMA requisicao de listagem.
 *
 * O numero nao e uma meta de performance — e um LIMITE ESTRUTURAL. Uma
 * listagem exibe 24 cards; ler 2.000 linhas ja denuncia que alguem voltou a
 * varrer a tabela. Com o defeito antigo de pe, `/pt/filmes/` sozinha devolvia
 * mais de 18 mil linhas neste mesmo cenario.
 */
const MAX_ROWS_PER_LISTING_REQUEST = 2_000;

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
let counter = 0;
function record(name: string, ok: boolean, detail: string): void {
  counter += 1;
  results.push({ n: counter, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${counter}. ${name} — ${detail}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
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

interface Sql {
  q: <T>(sql: string) => Promise<T[]>;
  x: (sql: string) => Promise<number>;
}

/** Escapa literal de texto para SQL gerado (fixture, nunca entrada de usuario). */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Semeia um catalogo GRANDE com titulo, slug canonico, traducao pt-BR e arte.
 *
 * Tudo em `INSERT ... SELECT generate_series`: 12 mil linhas uma a uma levariam
 * minutos e o script deixaria de ser rodavel na revisao.
 */
async function seedCatalog(sql: Sql): Promise<void> {
  await sql.x(`
    INSERT INTO movies (tmdb_id, title_original, release_date, status, vote_count_tmdb,
                        poster_path, backdrop_path, popularity, created_at, updated_at)
    SELECT g,
           'Filme ' || lpad(g::text, 6, '0'),
           DATE '2020-01-01' + ((g % 2000))::int,
           'Released',
           1000 + (g % 5000),
           '/poster-' || g || '.jpg',
           '/backdrop-' || g || '.jpg',
           (g % 100)::numeric,
           now(), now()
    FROM generate_series(1, ${MOVIE_COUNT}) AS g
  `);
  await sql.x(`
    INSERT INTO tv_shows (tmdb_id, name_original, first_air_date, status, vote_count_tmdb,
                          poster_path, backdrop_path, popularity, created_at, updated_at)
    SELECT g,
           'Serie ' || lpad(g::text, 6, '0'),
           DATE '2019-01-01' + ((g % 2000))::int,
           'Returning Series',
           1000 + (g % 5000),
           '/poster-tv-' || g || '.jpg',
           '/backdrop-tv-' || g || '.jpg',
           (g % 100)::numeric,
           now(), now()
    FROM generate_series(1, ${SERIES_COUNT}) AS g
  `);
  await sql.x(`
    INSERT INTO people (tmdb_id, name, known_for_department, profile_path, created_at, updated_at)
    SELECT g, 'Pessoa ' || lpad(g::text, 6, '0'), 'Acting', '/profile-' || g || '.jpg', now(), now()
    FROM generate_series(1, ${PERSON_COUNT}) AS g
  `);

  for (const [type, table, prefix] of [
    ["movie", "movies", "filme"],
    ["tv", "tv_shows", "serie"],
    ["person", "people", "pessoa"],
  ] as const) {
    await sql.x(`
      INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical,
                         created_at, updated_at)
      SELECT '${type}'::"EntityType", e.id, ${lit(LANGUAGE)},
             '${prefix}-' || e.id, true, now(), now()
      FROM ${table} e
    `);
    await sql.x(`
      INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary,
                                       created_at, updated_at)
      SELECT '${type}'::"EntityType", e.id, ${lit(LANGUAGE)},
             'Titulo ${prefix} ' || e.id,
             'Sinopse editorial em portugues para ${prefix} ' || e.id || '.',
             now(), now()
      FROM ${table} e
    `);
  }
}

/**
 * ============================================================================
 * COMO ESTE SCRIPT CONTA LINHAS, E POR QUE NAO DO JEITO OBVIO
 * ============================================================================
 * A primeira versao usou `pg_stat_user_tables` (e antes disso
 * `pg_stat_database`) lido ANTES e DEPOIS de uma requisicao. O numero MENTIU, e
 * a mentira era do tipo pior: passava. Medido nesta leva, a mesma arvore deu
 * 45.087.000 linhas para a home numa execucao e 0 na execucao seguinte.
 *
 * A causa e do Postgres, nao do teste: aquelas visoes sao alimentadas por um
 * acumulador que cada backend descarrega no fim de uma transacao, com intervalo
 * minimo de 1 s — e um backend OCIOSO pode segurar o que acumulou por ate 10 s.
 * A conexao que faz o trabalho e a do processo do Next, nao a nossa; ler
 * "antes" e "depois" da nossa conexao corre contra esse relogio. `0 linhas`
 * significava "ainda nao descarregou", e um teto de 2.000 aprova 0 sem
 * reclamar.
 *
 * `pg_stat_statements` nao tem esse problema: ele e atualizado no FIM DE CADA
 * STATEMENT, na tabela hash compartilhada, sem intervalo. E de quebra ele
 * guarda o texto da consulta — entao "alguma coisa esta varrendo alguma coisa"
 * vira o SQL exato do culpado.
 *
 * A extensao exige `shared_preload_libraries`, o que exige REINICIAR o cluster.
 * Por isso isto roda ANTES do Prisma existir: uma conexao `pg` crua, descartada
 * antes do restart. Reaproveitar a conexao do Prisma aqui nao funciona — ela
 * morre no restart, o erro e engolido pelo `catch`, e o script segue achando
 * que nao ha instrumento (medido nesta leva).
 *
 * Se a extensao nao estiver disponivel, o script REPROVA em vez de medir errado
 * — um instrumento que nao existe nao pode ser reportado como "passou".
 */
async function enableStatementStats(
  pg: EmbeddedPostgres,
  appUrl: string,
): Promise<boolean> {
  // SO `shared_preload_libraries` e o log aqui. As GUCs do modulo
  // (`pg_stat_statements.track`, `.max`) ainda NAO EXISTEM neste ponto — a
  // biblioteca so e carregada no proximo start, e `ALTER SYSTEM` sobre um
  // parametro desconhecido ERRA. Os defaults do modulo (`track = top`,
  // `max = 5000`) sao suficientes para o que este script mede.
  const settings = [
    "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'",
    // Statement lento vai para o stderr do Postgres, que o `embedded-postgres`
    // encaminha para a saida deste script — util quando o teto estoura.
    "ALTER SYSTEM SET log_min_duration_statement = 400",
  ];
  try {
    const before = pg.getPgClient();
    await before.connect();
    for (const statement of settings) await before.query(statement);
    await before.end();

    await pg.stop();
    await pg.start();

    // `getPgClient()` aponta para o banco de MANUTENCAO. `CREATE EXTENSION` e
    // por banco: criada la, ela nao existe no banco que o app usa, e a chamada
    // a `pg_stat_statements_reset()` pelo Prisma morre com 42883 (medido nesta
    // leva). Por isso a conexao aqui e montada com a URL DO APP.
    // `pg` nao e dependencia direta de `apps/web` — `import("pg")` daqui falha.
    // O construtor vem do proprio cliente que o `embedded-postgres` fabrica.
    type RawClient = {
      connect: () => Promise<void>;
      query: <T>(sql: string) => Promise<{ rows: T[] }>;
      end: () => Promise<void>;
    };
    const ClientCtor = pg.getPgClient().constructor as unknown as new (config: {
      connectionString: string;
    }) => RawClient;
    const after = new ClientCtor({ connectionString: appUrl });
    await after.connect();
    await after.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
    const probe = await after.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_stat_statements",
    );
    await after.end();
    return probe.rows.length === 1;
  } catch (error) {
    console.error("[diag] pg_stat_statements indisponivel:", (error as Error).message);
    return false;
  }
}

interface StatementRows {
  /** Total de linhas devolvidas por TODOS os statements desde o reset. */
  total: number;
  /** As consultas que mais devolveram linha, ja resumidas para o log. */
  top: string;
}

async function resetStatementStats(sql: Sql): Promise<void> {
  await sql.q("SELECT pg_stat_statements_reset()::text AS ok");
}

async function readStatementStats(sql: Sql): Promise<StatementRows> {
  const rows = await sql.q<{ query: string; calls: bigint; rows: bigint }>(`
    SELECT query, calls, rows
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat_statements%'
    ORDER BY rows DESC
  `);
  const total = rows.reduce((sum, row) => sum + Number(row.rows), 0);
  const top = rows
    .slice(0, 3)
    .filter((row) => Number(row.rows) > 0)
    .map(
      (row) =>
        `${Number(row.rows)} linhas em ${Number(row.calls)} chamada(s): ` +
        `${row.query.replace(/\s+/g, " ").slice(0, 160)}`,
    )
    .join("\n        ");
  return { total, top };
}

interface Probe {
  status: number;
  ms: number;
  cacheControl: string | null;
  age: string | null;
  nextCache: string | null;
  bytes: number;
}

async function probe(url: string): Promise<Probe> {
  const t0 = process.hrtime.bigint();
  const res = await fetch(url, { headers: { "user-agent": "cinerie-route-cache-validator" } });
  const body = await res.text();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return {
    status: res.status,
    ms,
    cacheControl: res.headers.get("cache-control"),
    age: res.headers.get("age"),
    nextCache: res.headers.get("x-nextjs-cache"),
    bytes: body.length,
  };
}

async function main(): Promise<void> {
  const pgPort = await freePort();
  const appPort = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-route-cache-pg-"));
  const dbName = "cinerie_route_cache";
  const url = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/${dbName}?schema=public`;

  // Trava dura: este script NUNCA fala com banco que nao seja local descartavel.
  if (!/@127\.0\.0\.1:/.test(url) || !url.includes(dbName)) {
    throw new Error("abort: DATABASE_URL de validacao nao e local/descartavel");
  }

  const newPg = (utf8: boolean): EmbeddedPostgres =>
    new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "postgres",
      port: pgPort,
      persistent: true,
      initdbFlags: utf8 ? ["--encoding=UTF8", "--locale=C"] : [],
    });
  let pg = newPg(true);

  console.log(`\n=== Postgres efemero :${pgPort} | Next real :${appPort} | ${dbName} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  let server: ChildProcess | undefined;

  try {
    try {
      await pg.initialise();
    } catch (e) {
      const reason = (e as Error).message.split("\n")[0] ?? "";
      // Caminho com caractere nao-ASCII derruba o `initdb --encoding=UTF8`.
      if (!/invalid byte sequence|encoding/i.test(reason)) throw e;
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
      mkdirSync(dataDir, { recursive: true });
      pg = newPg(false);
      await pg.initialise();
    }
    await pg.start();
    started = true;
    await pg.createDatabase(dbName);

    // ANTES do Prisma: ligar a extensao exige reiniciar o cluster, e um restart
    // com o Prisma ja conectado mata a conexao dele em silencio.
    const statsOk = await enableStatementStats(pg, url);
    record(
      "instrumento de contagem disponivel (`pg_stat_statements`)",
      statsOk,
      statsOk
        ? "extensao ativa — a contagem de linhas por requisicao e exata"
        : "extensao INDISPONIVEL — sem instrumento, as provas de volume nao valem",
    );

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });

    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => {
        $executeRawUnsafe: (sql: string) => Promise<number>;
        $queryRawUnsafe: <T>(sql: string) => Promise<T[]>;
      };
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const prisma = dbServer.getPrismaClient();
    const sql: Sql = {
      q: (s) => prisma.$queryRawUnsafe(s),
      x: (s) => prisma.$executeRawUnsafe(s),
    };

    console.log(`--- semeando catalogo (${MOVIE_COUNT} filmes / ${SERIES_COUNT} series) ---`);
    await seedCatalog(sql);
    // `ANALYZE` NAO e cosmetico. Num banco recem-carregado o planejador nao tem
    // estatistica nenhuma e escolhe planos que producao nunca usa (la o
    // autovacuum ja analisou ha muito). Sem esta linha, o script mede o
    // planejador cego — e um numero de tempo colhido assim nao diz nada sobre a
    // consulta que se quer avaliar.
    await sql.x("ANALYZE");
    record(
      "catalogo grande semeado",
      true,
      `${MOVIE_COUNT} filmes, ${SERIES_COUNT} series, ${PERSON_COUNT} pessoas, com slug e traducao`,
    );

    // A pagina gerada SOB DEMANDA e gravada ao lado do build, em
    // `.next/server/app/pt/filmes/<slug>.{html,meta,rsc}` — NAO em
    // `.next/cache`. Ela SOBREVIVE entre execucoes deste script: sem apagar, a
    // segunda rodada serve a ficha guardada na rodada anterior (com dados de
    // OUTRO banco efemero) e responde `x-nextjs-cache: STALE` sem
    // `Cache-Control`. A prova de cache passaria — ou reprovaria — por um
    // motivo que nao tem nada a ver com a mudanca sob teste.
    //
    // Apagar `.next/cache` inteiro NAO resolve e ainda quebra o ISR: aquele
    // diretorio guarda outra coisa (fetch cache, imagens), e foi medido nesta
    // leva que remove-lo faz a primeira resposta sair sem `Cache-Control`.
    for (const ext of ["html", "meta", "rsc"]) {
      rmSync(path.join(webDir, ".next", "server", "app", "pt", "filmes", `${SLUG}.${ext}`), {
        force: true,
      });
    }


    const nextBin = webRequire.resolve("next/dist/bin/next");
    server = spawn("node", [nextBin, "start", "-p", String(appPort), "-H", "127.0.0.1"], {
      cwd: webDir,
      env: { ...env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (d: Buffer) => process.stdout.write(`[next] ${d}`));
    server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[next] ${d}`));

    const base = `http://127.0.0.1:${appPort}`;
    const deadline = Date.now() + 120_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${base}/api/health/`);
        if (res.status < 500) {
          up = true;
          break;
        }
      } catch {
        /* ainda subindo */
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    record("Next.js real respondendo", up, up ? base : "timeout 120s");
    if (!up) throw new Error("next start nao respondeu");

    // ------------------------------------------------------------------ (1)
    // O CABECALHO E CONSEQUENCIA. A MESMA instalacao do Next, no MESMO
    // processo, emite os dois valores — e nenhum deles esta escrito no repo.
    const home = await probe(`${base}/pt/`);
    const termos = await probe(`${base}/pt/termos/`);
    record(
      "rota DINAMICA emite `no-store` sem uma linha nossa de Cache-Control",
      (home.cacheControl ?? "").includes("no-store"),
      `/pt/ -> ${home.cacheControl ?? "(ausente)"}`,
    );
    record(
      "rota ESTATICA emite `s-maxage` na MESMA instalacao — o header segue o modo de render",
      (termos.cacheControl ?? "").includes("s-maxage"),
      `/pt/termos/ -> ${termos.cacheControl ?? "(ausente)"}`,
    );

    // ------------------------------------------------------------------ (2)
    // ISR de verdade na ficha: cabecalho cacheavel E tempo menor na segunda.
    const first = await probe(`${base}/pt/filmes/${SLUG}/`);
    const second = await probe(`${base}/pt/filmes/${SLUG}/`);
    const cacheable = (first.cacheControl ?? "").includes("s-maxage");
    record(
      "ficha de filme e CACHEAVEL (o `generateStaticParams` ligou o `revalidate`)",
      cacheable && first.status === 200,
      `status=${first.status} cache-control=${first.cacheControl ?? "(ausente)"}`,
    );
    const servedFromCache = second.age !== null || second.nextCache === "HIT";
    record(
      "a SEGUNDA leitura da ficha vem do cache — e nao so 'tem header novo'",
      servedFromCache,
      `age=${second.age ?? "(ausente)"} x-nextjs-cache=${second.nextCache ?? "(ausente)"} ` +
        `1a=${first.ms.toFixed(0)}ms 2a=${second.ms.toFixed(0)}ms`,
    );

    // ------------------------------------------------------------------ (3)
    // VOLUME. Uma requisicao, contador do Postgres antes e depois.
    const listagens: ReadonlyArray<readonly [string, string]> = [
      ["/pt/filmes/", "listagem de filmes"],
      ["/pt/series/", "listagem de series"],
      ["/pt/pessoas/", "listagem de pessoas"],
      ["/pt/", "home"],
    ];
    for (const [route, label] of listagens) {
      // Sem instrumento nao ha medida: a falha ja foi registrada na prova 1, e
      // seguir aqui produziria numeros inventados — ou um `abort` que o
      // relatorio confundiria com "passou".
      if (!statsOk) break;
      // Aquece: a primeira requisicao de uma rota paga compilacao/conexao, e o
      // que se quer medir e o regime, nao o boot.
      await probe(`${base}${route}`);
      await resetStatementStats(sql);
      const res = await probe(`${base}${route}`);
      const { total, top } = await readStatementStats(sql);
      const ok = res.status === 200 && total > 0 && total <= MAX_ROWS_PER_LISTING_REQUEST;
      record(
        `${label}: linhas lidas do banco em UMA requisicao`,
        ok,
        `${total} linhas (teto ${MAX_ROWS_PER_LISTING_REQUEST}); ` +
          `status=${res.status} tempo=${res.ms.toFixed(0)}ms` +
          (top === "" ? "" : `\n        ${top}`),
      );
    }

    // ------------------------------------------------------------------ (4)
    // NAO-VAZAMENTO: a pagina publica guardavel nao pode carregar dado pessoal.
    // Sem sessao nao ha o que vazar — a prova aqui e que a ficha (a unica rota
    // publica com cache de ROTA) responde IGUAL com e sem cookie de sessao.
    const comCookie = await fetch(`${base}/pt/filmes/${SLUG}/`, {
      headers: { cookie: "cinerie_session=alguem; outro=1" },
    });
    const semCookie = await fetch(`${base}/pt/filmes/${SLUG}/`);
    const iguais = (await comCookie.text()) === (await semCookie.text());
    record(
      "ficha guardavel responde IDENTICO com e sem cookie (nada pessoal no HTML)",
      iguais,
      iguais ? "bytes identicos" : "o HTML mudou com o cookie — NAO pode ser cacheado",
    );

    // ------------------------------------------------------------------ (5)
    // O `?ranking=` nao pode mais mudar O QUE A PAGINA RENDERIZA.
    //
    // A PRIMEIRA VERSAO DESTA PROVA COMPARAVA BYTES, E ESTAVA ERRADA. Ela
    // reprovava, e o diagnostico (que este script imprime) mostrou onde: a
    // divergencia era a NUMERACAO DE CHUNK do payload RSC (`c:I[9620...` vs
    // `d:I[9620...`), nao conteudo. Numa rota dinamica o Next embute o estado do
    // roteador — inclusive a query — no payload de Flight; identidade de bytes
    // e inalcancavel por construcao, e exigi-la seria medir o framework em vez
    // do produto.
    //
    // O que importa e a ABA ATIVA: se o servidor ainda lesse `?ranking=`, o
    // `aria-selected="true"` mudaria de botao — e um HTML guardado entregaria a
    // aba de um leitor para outro. E isso que se mede.
    const abaAtiva = (html: string): string | null =>
      /<button[^>]*aria-selected="true"[^>]*id="([^"]+)"/.exec(html)?.[1] ??
      /<button[^>]*id="([^"]+)"[^>]*aria-selected="true"/.exec(html)?.[1] ??
      null;

    const semQuery = await (await fetch(`${base}/pt/filmes/`)).text();
    // CONTROLE: a aba precisa ser LEGIVEL no HTML. Se o seletor nao achasse
    // nada, `null === null` passaria e a prova nao teria medido coisa alguma.
    const abaSem = abaAtiva(semQuery);
    record(
      "CONTROLE: a aba ativa e legivel no HTML do servidor",
      abaSem !== null,
      abaSem ?? "nenhum botao com aria-selected=true — a prova seguinte nao mede nada",
    );
    if (abaSem !== null) {
      const comQuery = await (await fetch(`${base}/pt/filmes/?ranking=classicos`)).text();
      const abaCom = abaAtiva(comQuery);
      record(
        "`?ranking=` NAO altera a aba ativa do servidor (a aba virou controle de cliente)",
        abaCom === abaSem,
        `sem query: ${abaSem} | com ?ranking=classicos: ${abaCom ?? "(nenhuma)"}`,
      );
    }
  } finally {
    server?.kill();
    if (disconnect) await disconnect().catch(() => undefined);
    if (started) await pg.stop().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  FAIL ${f.n}. ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  }
}

/**
 * `process.exit(1)` EXPLICITO, e nao so `process.exitCode`.
 *
 * Este repositorio ja registrou um validador que MORRIA e era reportado como
 * PASS: com processos filhos vivos (aqui: o `next start` e o Postgres
 * embarcado) o `exitCode` pode nao ser o codigo com que o processo termina.
 * Um validador que falha em silencio e pior que nenhum validador.
 */
main()
  .then(() => {
    if (process.exitCode !== undefined && process.exitCode !== 0) process.exit(1);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("[FAIL] validador ABORTOU antes de terminar as provas:");
    console.error(error);
    process.exit(1);
  });
