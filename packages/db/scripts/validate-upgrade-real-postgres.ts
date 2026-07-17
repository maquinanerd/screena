/**
 * validate-upgrade-real-postgres.ts — Cenario B da Fase 2 (Prompt 2, §17):
 * aplicar a migration de data-governance-hardening SOBRE UM ESTADO ANTERIOR
 * sintetico e provar que os BACKFILLS funcionam sem perda de dado.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL (nao roda em produto/render/prod).
 * Motor: `embedded-postgres@16` (PostgreSQL 16 real, efemero). Nenhum segredo,
 * nenhum DATABASE_URL persistido, instancia derrubada no `finally`.
 *
 * Fluxo:
 *  1. sobe PG16 efemero;
 *  2. `migrate deploy` das migrations ANTERIORES a Fase 2 (estado pre-hardening),
 *     via um diretorio prisma temporario SEM a pasta da Fase 2;
 *  3. insere dados legados sinteticos "sujos": ref polimorfica orfa, ofertas de
 *     streaming DUPLICADAS, provider_key nulo, varias decisoes historicas de
 *     indexabilidade para a mesma entidade/idioma, licenca de rating sem
 *     rating_source_key ainda, e artigo com category/author '' (string vazia);
 *  4. copia a pasta da Fase 2 e faz `migrate deploy` de novo (aplica o hardening
 *     SOBRE o estado anterior + dados sinteticos);
 *  5. valida cada backfill (registro de entidades, quarentena de orfaos, dedup
 *     de ofertas, derivacao de provider_key, decisao vigente unica + historico,
 *     content_type/rating_source_key de licenca, normalizacao de '' -> NULL);
 *  6. derruba tudo.
 *
 * Uso: pnpm --filter @screena/db db:validate:upgrade
 */

import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(scriptDir, "..");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");
const migrationsDir = path.join(dbDir, "prisma", "migrations");
const PHASE2_DIR = "20260715120000_data_governance_hardening";

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${n}. ${name} — ${detail}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
      srv.close();
    });
  });
}

function prismaBin(): string {
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

/**
 * Remove um diretorio temporario com BEST-EFFORT. No Windows, o
 * embedded-postgres pode manter o diretorio de dados travado por alguns
 * milissegundos apos `stop()`; algumas tentativas resolvem. Uma limpeza que
 * falha NUNCA deve derrubar a suite (o diretorio fica no %TEMP% e o SO limpa).
 */
async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  console.warn(`[cleanup] nao foi possivel remover ${dir} (deixado para o SO limpar).`);
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-upg-pg-"));
  const tempPrisma = mkdtempSync(path.join(tmpdir(), "screena-upg-prisma-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_upgrade?schema=public`;
  console.log(
    `\n=== Cenario B (upgrade) — Postgres efemero :${port} | postgresql://postgres:****@127.0.0.1:${port} ===\n`,
  );

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("screena_upgrade");
    const env = { ...process.env, DATABASE_URL: url };

    // --- diretorio prisma temporario com SO as migrations ANTERIORES a Fase 2 ---
    //
    // Remover apenas a pasta da Fase 2 (comportamento antigo) deixava as
    // migrations POSTERIORES (catalogo 20260716*, Backend B 20260717*) no
    // PRIMEIRO deploy — aplicadas FORA DE ORDEM, antes da Fase 2 de que
    // dependem. Nenhum banco real teria a 20260717 sem a 20260715; o cenario
    // so passava porque, por acaso, nada posterior referenciava objetos da
    // Fase 2 em DDL imediato. A FK de `cinerie_score_calculations` ->
    // `entities` (revisao adversarial da PR #74, achado A8) expos o furo:
    // `entities` nasce na Fase 2. Estado anterior = TUDO antes da Fase 2;
    // upgrade = Fase 2 + posteriores, EM ORDEM (achado A10).
    const tempSchema = path.join(tempPrisma, "schema.prisma");
    const tempMig = path.join(tempPrisma, "migrations");
    copyFileSync(schemaPath, tempSchema);
    cpSync(migrationsDir, tempMig, { recursive: true });
    const phase2AndLater = readdirSync(migrationsDir)
      .filter((dir) => /^\d{14}_/.test(dir) && dir >= PHASE2_DIR)
      .sort();
    for (const dir of phase2AndLater) {
      rmSync(path.join(tempMig, dir), { recursive: true, force: true });
    }

    console.log("--- migrate deploy (estado ANTERIOR a Fase 2) ---");
    execFileSync(
      "node",
      [prismaBin(), "migrate", "deploy", "--schema", tempSchema],
      { env, stdio: "inherit", cwd: dbDir },
    );
    record(1, "migrations anteriores aplicam (estado pre-hardening)", true, "ok");

    // --- dados legados sinteticos "sujos" (raw SQL: colunas PRE-hardening) ---
    const seedPrisma = new PrismaClient({ datasources: { db: { url } } });
    const ORPHAN_ID = 987654321;
    try {
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO languages (code, name_pt, name_en, is_published, index_default) VALUES ('pt-BR','Portugues','Portuguese',true,true)`,
      );
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO countries (code, name_pt, name_en) VALUES ('BR','Brasil','Brazil')`,
      );
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO rating_sources (key, label, scale) VALUES ('imdb','IMDb',10)`,
      );
      const movie = await seedPrisma.$queryRawUnsafe<Array<{ id: bigint }>>(
        `INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (700001,'Legacy Movie',now()) RETURNING id`,
      );
      const movieId = Number(movie[0]!.id);
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO people (tmdb_id, name, updated_at) VALUES (700001,'Legacy Person',now())`,
      );

      // ref polimorfica ORFA (entity_id inexistente) + slug valido do filme real
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie',${ORPHAN_ID},'pt-BR','orphan-slug',true,now())`,
      );
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES ('movie',${movieId},'pt-BR','legacy-movie',true,now())`,
      );

      // ofertas DUPLICADAS (mesma chave natural, provider_key NULL) + plataforma distinta
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES ('movie',${movieId},'BR','Max','subscription',now())`,
      );
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES ('movie',${movieId},'BR','Max','subscription',now())`,
      );
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, updated_at) VALUES ('movie',${movieId},'BR','Prime Video','subscription',now())`,
      );

      // 3 decisoes historicas para (movie, pt-BR): so a mais recente deve ficar vigente
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, decided_at, created_at) VALUES ('movie',${movieId},'pt-BR','/pt/filmes/legacy-movie/','noindex', now() - interval '2 days', now() - interval '2 days')`,
      );
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, decided_at, created_at) VALUES ('movie',${movieId},'pt-BR','/pt/filmes/legacy-movie/','draft', now() - interval '1 day', now() - interval '1 day')`,
      );
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, decided_at, created_at) VALUES ('movie',${movieId},'pt-BR','/pt/filmes/legacy-movie/','index', now(), now())`,
      );

      // licenca de rating legada (sem content_type/rating_source_key ainda)
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO source_licenses (source_key, updated_at) VALUES ('imdb', now())`,
      );

      // referencias extras para os cenarios de licenca
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO rating_sources (key, label, scale) VALUES ('metacritic','Metacritic',100)`,
      );
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO api_providers (key, name, kind) VALUES ('tmdb','TMDB','data')`,
      );

      // licenca com provider_key INVALIDO (nao existe em api_providers) + aprovada:
      // deve ser QUARENTENADA, provider_key anulado e forcada FAIL-CLOSED.
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO source_licenses (source_key, provider_key, display_allowed, updated_at) VALUES ('metacritic','ghost_provider', true, now())`,
      );

      // DUAS licencas que colidem na NOVA chave (mesma fonte/tipo/provider/territorio,
      // provider valido 'tmdb'): uma vira vigente, a outra HISTORICO (nenhuma sobrescrita).
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO source_licenses (source_key, provider_key, updated_at) VALUES ('imdb','tmdb', now() - interval '2 days')`,
      );
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO source_licenses (source_key, provider_key, updated_at) VALUES ('imdb','tmdb', now())`,
      );

      // oferta legada APROVADA (display_allowed=true) mas SEM approved_payload_hash
      // (coluna so existe na Fase 2): a reconciliacao deve forca-la FAIL-CLOSED.
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, display_allowed, updated_at) VALUES ('movie',${movieId},'BR','Star','subscription', true, now())`,
      );

      // artigo com category/author '' (string vazia) — violaria o CHECK sem backfill
      await seedPrisma.$executeRawUnsafe(
        `INSERT INTO articles (category, author_name, updated_at) VALUES ('', '', now())`,
      );
      record(2, "dados legados sinteticos inseridos (estado anterior)", true, `movieId=${movieId}`);

      // --- aplica Fase 2 + POSTERIORES, em ordem, SOBRE o estado anterior ---
      for (const dir of phase2AndLater) {
        cpSync(path.join(migrationsDir, dir), path.join(tempMig, dir), { recursive: true });
      }
      console.log("\n--- migrate deploy (Fase 2 + posteriores SOBRE estado anterior) ---");
      execFileSync(
        "node",
        [prismaBin(), "migrate", "deploy", "--schema", tempSchema],
        { env, stdio: "inherit", cwd: dbDir },
      );
      record(3, "migration da Fase 2 aplica sobre estado anterior sem erro", true, "ok");

      // --- validacao dos backfills ---
      const q = <T>(sql: string) => seedPrisma.$queryRawUnsafe<T[]>(sql);

      const entMovie = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM entities WHERE entity_type='movie' AND entity_id=${movieId}`,
      ))[0]!.c;
      record(4, "backfill entities: filme real registrado", entMovie === 1, `linhas=${entMovie}`);

      const orphanQuar = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM entity_reference_orphans WHERE source_table='slugs' AND entity_id=${ORPHAN_ID}`,
      ))[0]!.c;
      record(5, "orfao slug quarentenado em entity_reference_orphans", orphanQuar === 1, `linhas=${orphanQuar}`);

      const orphanGone = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM slugs WHERE entity_id=${ORPHAN_ID}`,
      ))[0]!.c;
      record(6, "orfao removido da tabela de origem (slugs)", orphanGone === 0, `linhas=${orphanGone}`);

      const validSlug = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM slugs WHERE entity_id=${movieId}`,
      ))[0]!.c;
      record(7, "slug valido do filme real preservado (nao apagado)", validSlug === 1, `linhas=${validSlug}`);

      const maxCount = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM watch_availability WHERE entity_id=${movieId} AND provider_name='Max'`,
      ))[0]!.c;
      record(8, "dedup watch_availability: 'Max' duplicado colapsa para 1", maxCount === 1, `linhas=${maxCount}`);

      const allOffers = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM watch_availability WHERE entity_id=${movieId}`,
      ))[0]!.c;
      record(9, "plataformas distintas preservadas (Max + Prime + Star = 3)", allOffers === 3, `linhas=${allOffers}`);

      const maxKey = (await q<{ provider_key: string | null }>(
        `SELECT provider_key FROM watch_availability WHERE entity_id=${movieId} AND provider_name='Max'`,
      ))[0]!.provider_key;
      record(10, "provider_key NAO derivado de provider_name (permanece NULL)", maxKey === null, `provider_key=${maxKey}`);

      const currentCount = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM page_indexability_decisions WHERE entity_id=${movieId} AND language_code='pt-BR' AND is_current=true`,
      ))[0]!.c;
      record(11, "exatamente 1 decisao vigente por (entidade, idioma)", currentCount === 1, `vigentes=${currentCount}`);

      const totalDecisions = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM page_indexability_decisions WHERE entity_id=${movieId} AND language_code='pt-BR'`,
      ))[0]!.c;
      record(12, "historico preservado (3 decisoes, nenhuma apagada)", totalDecisions === 3, `linhas=${totalDecisions}`);

      const currentDecision = (await q<{ decision: string }>(
        `SELECT decision FROM page_indexability_decisions WHERE entity_id=${movieId} AND language_code='pt-BR' AND is_current=true`,
      ))[0]!.decision;
      record(13, "vigente = a mais recente (decision='index')", currentDecision === "index", `decision=${currentDecision}`);

      const lic = (await q<{ content_type: string; rating_source_key: string | null }>(
        `SELECT content_type, rating_source_key FROM source_licenses WHERE source_key='imdb' AND provider_key IS NULL`,
      ))[0]!;
      record(14, "source_licenses: content_type='rating' + rating_source_key backfill",
        lic.content_type === "rating" && lic.rating_source_key === "imdb",
        `content_type=${lic.content_type}, rating_source_key=${lic.rating_source_key}`);

      const emptyStrings = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM articles WHERE category='' OR author_name=''`,
      ))[0]!.c;
      record(15, "articles: '' normalizado para NULL antes do CHECK", emptyStrings === 0, `linhas com ''=${emptyStrings}`);

      const articleKept = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM articles`,
      ))[0]!.c;
      record(16, "artigo legado preservado (backfill nao apaga a linha)", articleKept === 1, `linhas=${articleKept}`);

      // 17. provider_key INVALIDO: quarentenado ANTES de anular (perda-zero).
      const invalidProviderQuar = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM data_migration_quarantine WHERE issue='source_license_invalid_provider' AND detail->>'old_provider_key'='ghost_provider'`,
      ))[0]!.c;
      record(17, "provider_key invalido quarentenado (snapshot + valor antigo)", invalidProviderQuar === 1, `linhas=${invalidProviderQuar}`);

      // 18. e a linha fica FAIL-CLOSED (provider_key anulado + display_allowed=false).
      const metaLic = (await q<{ provider_key: string | null; display_allowed: boolean }>(
        `SELECT provider_key, display_allowed FROM source_licenses WHERE source_key='metacritic'`,
      ))[0]!;
      record(18, "licenca com provider invalido: anulada e fail-closed", metaLic.provider_key === null && metaLic.display_allowed === false,
        `provider_key=${metaLic.provider_key}, display_allowed=${metaLic.display_allowed}`);

      // 19. duas licencas colidindo na nova chave -> 1 vigente + historico (nao sobrescreve).
      const imdbTmdbCurrent = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM source_licenses WHERE source_key='imdb' AND provider_key='tmdb' AND is_current=true`,
      ))[0]!.c;
      const imdbTmdbTotal = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM source_licenses WHERE source_key='imdb' AND provider_key='tmdb'`,
      ))[0]!.c;
      record(19, "licencas historicas: 1 vigente por grupo + nenhuma sobrescrita", imdbTmdbCurrent === 1 && imdbTmdbTotal === 2,
        `vigentes=${imdbTmdbCurrent}, total=${imdbTmdbTotal}`);

      // 20. dedup de streaming ARQUIVA a linha removida (nao apaga sem preservacao).
      const dedupArchived = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM data_migration_quarantine WHERE issue='watch_dedup_removed' AND detail ? 'surviving_id' AND detail ? 'dedupe_fingerprint'`,
      ))[0]!.c;
      record(20, "dedup de streaming arquiva a removida (snapshot + surviving_id + fingerprint)", dedupArchived === 1, `arquivadas=${dedupArchived}`);

      // 21. oferta legada APROVADA sem hash correspondente -> fail-closed apos migration.
      const starDisplay = (await q<{ display_allowed: boolean }>(
        `SELECT display_allowed FROM watch_availability WHERE entity_id=${movieId} AND provider_name='Star'`,
      ))[0]!.display_allowed;
      record(21, "aprovacao legada sem hash correspondente vira fail-closed", starDisplay === false, `display_allowed=${starDisplay}`);

      // 22. CADEIA de supersedes construida (nao apenas is_current): a vigente
      //     aponta para a anterior ('draft'); 2 das 3 decisoes tem supersedes_id.
      const linked = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM page_indexability_decisions WHERE entity_id=${movieId} AND language_code='pt-BR' AND supersedes_id IS NOT NULL`,
      ))[0]!.c;
      const currentPrev = (await q<{ decision: string | null }>(
        `SELECT s.decision FROM page_indexability_decisions c JOIN page_indexability_decisions s ON s.id = c.supersedes_id WHERE c.entity_id=${movieId} AND c.language_code='pt-BR' AND c.is_current=true`,
      ))[0]?.decision ?? null;
      record(22, "cadeia supersedes_id construida (vigente 'index' -> anterior 'draft')", linked === 2 && currentPrev === "draft",
        `linkadas=${linked}, anterior_da_vigente=${currentPrev}`);

      // 23. determinismo/perda-zero: toda linha de streaming removida foi arquivada.
      const survivingMax = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM watch_availability WHERE entity_id=${movieId} AND provider_name='Max'`,
      ))[0]!.c;
      const archivedMax = (await q<{ c: number }>(
        `SELECT count(*)::int AS c FROM data_migration_quarantine WHERE issue='watch_dedup_removed' AND source_row_id IS NOT NULL`,
      ))[0]!.c;
      record(23, "perda-zero: removidas de streaming = arquivadas (1 removida, 1 arquivada)", survivingMax === 1 && archivedMax === 1,
        `sobrevivente_max=${survivingMax}, arquivadas=${archivedMax}`);
    } finally {
      await seedPrisma.$disconnect();
    }
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.split("\n")[0]);
  } finally {
    if (started) {
      // pg.stop() pode lancar EBUSY no Windows ao limpar o dataDir; best-effort.
      try {
        await pg.stop();
      } catch (e) {
        console.warn(`[cleanup] pg.stop: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    await safeRm(dataDir);
    await safeRm(tempPrisma);
    console.log("\n=== Cenario B: Postgres efemero derrubado e temporarios removidos ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO (Cenario B / upgrade): ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Migration da Fase 2 valida SOBRE estado anterior (backfills corretos).");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
