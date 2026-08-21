/**
 * qa-gallery-real-postgres.ts — Sobe as galerias com PostgreSQL 16 REAL e o
 * Next REAL, para que elas possam ser ABERTAS.
 *
 * FERRAMENTA DE DESENVOLVIMENTO. Não faz parte do produto: nunca roda no
 * render, no build de app, nem em produção.
 *
 * ============================================================================
 * POR QUE ISTO EXISTE
 * ============================================================================
 * `tmdb_images` e `tmdb_videos` têm ZERO linha em produção — a fila de
 * `catalog_jobs` nunca foi drenada. Sem este harness, as quatro páginas de
 * galeria só poderiam ser provadas por teste de unidade, e a regra da leva é
 * "abra a página com dado real".
 *
 * Ele semeia o estado que o dreno vai produzir: um título COM muitas imagens e
 * vídeos, e outro com POUCAS — porque o piso de página fina só tem prova com os
 * dois lados.
 *
 * ============================================================================
 * SEGURANÇA
 * ============================================================================
 *  - ZERO produção: `DATABASE_URL` aponta SEMPRE para 127.0.0.1, num banco
 *    efêmero. Nenhum `.env` é lido.
 *  - ZERO rede de dados: nenhuma chamada a TMDB/RapidAPI/Gemini. As URLs de
 *    imagem que a página monta apontam para o CDN público do TMDB — se a
 *    máquina estiver offline, a grade aparece sem os bytes, e a ESTRUTURA
 *    (contagem, rótulos, ordem, piso) continua verificável.
 *  - Postgres derrubado e diretório removido no `finally`.
 *
 * Uso: pnpm --filter @screena/web qa:gallery
 *      (deixa o Next servindo até Ctrl+C, para abrir no navegador)
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

/** O título RICO: muitas imagens e vídeos. Acima dos dois pisos. */
const RICO = { tmdbId: 99990101, slug: "gladiador-qa", title: "Gladiador (QA)" };
/** O título POBRE: abaixo dos dois pisos. Prova o `noindex`. */
const POBRE = { tmdbId: 99990102, slug: "curta-qa", title: "Curta (QA)" };

/**
 * Acesso ao banco pelo MESMO acessor server-only que o app usa
 * (`@screena/db/server`), e não por um `@prisma/client` importado direto: o
 * pacote não resolve a partir de `apps/web/scripts` (é dependência de
 * `packages/db`), e usar o acessor mantém UM caminho de conexão.
 */
interface Sql {
  q: <T>(sql: string) => Promise<T[]>;
  x: (sql: string) => Promise<number>;
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function prismaBin(): string {
  const pkgPath = dbRequire.resolve("prisma/package.json");
  const pkg = dbRequire("prisma/package.json") as { bin?: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.prisma;
  if (rel === undefined) throw new Error("binario do prisma nao encontrado");
  return path.join(path.dirname(pkgPath), rel);
}

/** Um `file_path` de arte determinístico. Não é arquivo real; é chave estável. */
function art(prefix: string, index: number): string {
  return `/qa-${prefix}-${String(index).padStart(3, "0")}.jpg`;
}

/** As imagens do título, por tipo e idioma. */
function planoDeImagens(rico: boolean): Array<{ tipo: string; idioma: string | null }> {
  if (!rico) {
    // TRÊS: um a menos que o piso de 4. É o lado que prova o `noindex`.
    return [
      { tipo: "poster", idioma: "pt" },
      { tipo: "poster", idioma: "en" },
      { tipo: "backdrop", idioma: null },
    ];
  }
  return [
    ...Array.from({ length: 14 }, (_, i) => ({
      tipo: "poster",
      idioma: i % 3 === 0 ? "pt" : i % 3 === 1 ? "en" : null,
    })),
    ...Array.from({ length: 22 }, () => ({ tipo: "backdrop", idioma: null })),
    ...Array.from({ length: 5 }, () => ({ tipo: "still", idioma: "en" })),
    ...Array.from({ length: 3 }, () => ({ tipo: "logo", idioma: "pt" })),
  ];
}

interface PlanoVideo {
  readonly tipo: string;
  readonly nome: string;
  readonly pt: boolean;
  readonly oficial: boolean;
  readonly seg: number;
  readonly site: string;
}

function planoDeVideos(rico: boolean): readonly PlanoVideo[] {
  if (!rico) {
    // UM: abaixo do piso de 2.
    return [{ tipo: "Trailer", nome: "Trailer", pt: true, oficial: true, seg: 100, site: "YouTube" }];
  }
  return [
    { tipo: "Trailer", nome: "Trailer oficial", pt: true, oficial: true, seg: 134, site: "YouTube" },
    { tipo: "Trailer", nome: "Trailer legendado", pt: false, oficial: true, seg: 151, site: "YouTube" },
    { tipo: "Teaser", nome: "Teaser", pt: false, oficial: true, seg: 62, site: "YouTube" },
    { tipo: "Behind the Scenes", nome: "Bastidores", pt: false, oficial: false, seg: 305, site: "YouTube" },
    { tipo: "Clip", nome: "Cena do duelo", pt: true, oficial: false, seg: 88, site: "YouTube" },
    { tipo: "Featurette", nome: "Featurette", pt: false, oficial: false, seg: 240, site: "YouTube" },
    { tipo: "Bloopers", nome: "Erros de gravacao", pt: false, oficial: false, seg: 120, site: "YouTube" },
    // Tipo FORA do dicionário: prova que ele aparece com o próprio nome.
    { tipo: "Interview", nome: "Entrevista com o elenco", pt: false, oficial: false, seg: 400, site: "YouTube" },
    // Vimeo de propósito: prova a linha SEM player.
    { tipo: "Trailer", nome: "Trailer (Vimeo)", pt: false, oficial: false, seg: 90, site: "Vimeo" },
  ];
}

async function seed(sql: Sql): Promise<void> {
  // A LICENÇA DE IMAGEM. Sem ela o gate nega e a galeria sai vazia — que é o
  // comportamento certo, mas não é o que este harness quer mostrar.
  await sql.x(
    `INSERT INTO source_licenses
       (source_key, content_type, provider_key, license_status, display_allowed,
        logo_allowed, score_allowed, review_quote_allowed, requires_attribution,
        requires_linkback, attribution_text, is_current, decision_origin, policy_version,
        created_at, updated_at)
     VALUES ('tmdb', 'image', 'tmdb', 'official', true,
             true, false, false, true,
             true, 'Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.',
             true, 'qa-harness', 'qa/gallery', now(), now())`,
  );

  for (const titulo of [RICO, POBRE]) {
    const rico = titulo === RICO;

    const linhas = await sql.q<{ id: string }>(
      `INSERT INTO movies (tmdb_id, title_original, original_language, release_date,
                           runtime_minutes, poster_path, backdrop_path, status,
                           created_at, updated_at)
       VALUES (${String(titulo.tmdbId)}, '${titulo.title}', 'en', '2000-05-05',
               155, '${art("poster", 1)}', '${art("backdrop", 1)}', 'Released',
               now(), now())
       RETURNING id::text AS id`,
    );
    const movieId = linhas[0]?.id ?? "0";

    await sql.x(
      `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical,
                          created_at, updated_at)
       VALUES ('movie', ${movieId}, '${LANGUAGE}', '${titulo.slug}', true, now(), now())`,
    );
    await sql.x(
      `INSERT INTO entity_translations (entity_type, entity_id, language_code, title,
                                        summary, created_at, updated_at)
       VALUES ('movie', ${movieId}, '${LANGUAGE}', '${titulo.title}',
               'Fixture local de QA. Nao e sinopse real.', now(), now())`,
    );

    const valoresImagem = planoDeImagens(rico)
      .map((item, index) => {
        const idioma = item.idioma === null ? "NULL" : `'${item.idioma}'`;
        const w = item.tipo === "poster" ? 2000 : 3840;
        const h = item.tipo === "poster" ? 3000 : 2160;
        const caminho = art(`${String(titulo.tmdbId)}-${item.tipo}`, index);
        return (
          `('tmdb', 'movie', ${String(titulo.tmdbId)}, '${item.tipo}', '${caminho}', ` +
          `${idioma}, ${String(w)}, ${String(h)}, ${String(5 + (index % 5))}, ` +
          `'qa-${String(titulo.tmdbId)}-${String(index)}', 'unknown', false, now(), now(), now())`
        );
      })
      .join(",");

    await sql.x(
      `INSERT INTO tmdb_images (provider_api, entity_type, tmdb_id, image_type, file_path,
                                language_code, width, height, vote_average, payload_hash,
                                license_status, display_allowed,
                                fetched_at, created_at, updated_at)
       VALUES ${valoresImagem}`,
    );

    // Os VÍDEOS nascem `display_allowed=false` no produto; o harness os promove
    // porque o que se quer VER é a galeria, e a promoção é operação governada
    // fora do render (o mesmo desenho de ratings).
    const valoresVideo = planoDeVideos(rico)
      .map(
        (item, index) =>
          `('tmdb', 'movie', ${String(titulo.tmdbId)}, ` +
          `'qa-${String(titulo.tmdbId)}-${String(index)}', '${item.site}', ` +
          // ONZE caracteres EXATOS: `youtube-embed.ts` exige `^[A-Za-z0-9_-]{11}$`.
          //
          // A primeira versão usava `qaVid` + 5 dígitos = DEZ, e a página abriu
          // com "Indisponível para reprodução" nos NOVE vídeos — inclusive nos
          // oito do YouTube. A página estava CERTA (id inválido não vira
          // player); o dado do harness é que estava errado. Só apareceu ao
          // ABRIR a página: nenhum teste de unidade usaria este id.
          `'qaVideo${String(index).padStart(4, "0")}', '${item.nome}', '${item.tipo}', ` +
          `${String(item.oficial)}, '${item.pt ? "pt" : "en"}', ${String(item.seg)}, ` +
          `'qa-v-${String(titulo.tmdbId)}-${String(index)}', 'official', true, now(), now(), now())`,
      )
      .join(",");

    await sql.x(
      `INSERT INTO tmdb_videos (provider_api, entity_type, tmdb_id, tmdb_video_id, site,
                                video_key, name, video_type, official, language_code, size,
                                payload_hash, license_status, display_allowed,
                                fetched_at, created_at, updated_at)
       VALUES ${valoresVideo}`,
    );
  }
}

async function main(): Promise<number> {
  const pgPort = await freePort();
  // Porta FIXA quando `CINERIE_QA_PORT` e passada: com porta sorteada, quem
  // roda o harness nao consegue abrir a pagina sem ler o log — e num pipe
  // bufferizado o log so aparece no fim.
  const webPort = process.env.CINERIE_QA_PORT
    ? Number(process.env.CINERIE_QA_PORT)
    : await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-qa-gal-"));
  const database = "cinerie_qa_gallery";
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: pgPort,
    persistent: false,
  });

  let disconnect: (() => Promise<void>) | null = null;
  let next: ChildProcess | null = null;

  try {
    log("== subindo PostgreSQL 16 efemero ==");
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(database);
    const url = `postgresql://postgres:postgres@127.0.0.1:${String(pgPort)}/${database}`;

    log("== aplicando as migrations REAIS ==");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
      cwd: dbDir,
    });

    // O SEED DE DICIONARIOS vem antes: `source_licenses.provider_key` tem FK
    // para `api_providers.key`, e sem a linha `tmdb` o primeiro INSERT morre em
    // violacao de chave estrangeira. Mesma pre-condicao do bootstrap de catalogo.
    log("== semeando os dicionarios (api_providers, countries, ...) ==");
    execFileSync(
      process.execPath,
      [path.join(webDir, "node_modules", "tsx", "dist", "cli.mjs"), path.join(dbDir, "prisma", "seed.ts")],
      { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", cwd: dbDir },
    );

    log("== semeando os dois titulos (rico e pobre) ==");
    // `DATABASE_URL` entra no processo ANTES do import: o acessor server-only
    // le a variavel na primeira chamada.
    process.env.DATABASE_URL = url;
    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => {
        $executeRawUnsafe: (sql: string) => Promise<number>;
        $queryRawUnsafe: <T>(sql: string) => Promise<T[]>;
      };
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const cliente = dbServer.getPrismaClient();
    const sql: Sql = {
      q: (texto) => cliente.$queryRawUnsafe(texto),
      x: (texto) => cliente.$executeRawUnsafe(texto),
    };
    await seed(sql);

    const contagem = await sql.q<{ imagens: number; videos: number }>(
      `SELECT (SELECT COUNT(*)::int FROM tmdb_images) AS imagens,
              (SELECT COUNT(*)::int FROM tmdb_videos) AS videos`,
    );
    log(
      `   ${String(contagem[0]?.imagens)} imagens e ${String(contagem[0]?.videos)} videos semeados`,
    );

    log("== subindo o Next (dev) ==");
    next = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--filter", "@screena/web", "dev", "--port", String(webPort)],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: url,
          NODE_ENV: "development",
          CINERIE_SITE_URL: `http://127.0.0.1:${String(webPort)}`,
        },
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );

    log("");
    log("=".repeat(72));
    log("AS QUATRO PAGINAS (abra no navegador):");
    log(`  RICO  imagens: http://127.0.0.1:${String(webPort)}/pt/filmes/${RICO.slug}/imagens/`);
    log(`  RICO  videos : http://127.0.0.1:${String(webPort)}/pt/filmes/${RICO.slug}/videos/`);
    log(`  POBRE imagens: http://127.0.0.1:${String(webPort)}/pt/filmes/${POBRE.slug}/imagens/`);
    log(`  POBRE videos : http://127.0.0.1:${String(webPort)}/pt/filmes/${POBRE.slug}/videos/`);
    log(`  A ficha      : http://127.0.0.1:${String(webPort)}/pt/filmes/${RICO.slug}/`);
    log("=".repeat(72));
    log("Ctrl+C para derrubar tudo.");

    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => resolve());
      process.on("SIGTERM", () => resolve());
    });
    return 0;
  } finally {
    next?.kill();
    await disconnect?.().catch(() => undefined);
    await pg.stop().catch(() => undefined);
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      log(`   (aviso) diretorio temporario nao removido: ${dataDir}`);
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`qa:gallery falhou: ${String(error)}\n`);
    process.exit(1);
  });
