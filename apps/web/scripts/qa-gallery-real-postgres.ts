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
 * PESSOA (27/08/2026): TRÊS, E NÃO DOIS
 * ============================================================================
 * A foto de pessoa tem um gate a mais que a imagem de título: ela é promovida
 * por LINHA (`display_allowed` + `license_status`), e não só governada pela
 * licença da fonte. Provar isso exige um terceiro caso — a pessoa cujas fotos
 * EXISTEM na tabela e não foram promovidas. Sem ele, "não tem foto" e "tem foto
 * e ninguém acendeu" ficariam idênticas na tela, que é exatamente o defeito que
 * a tira passou a registrar em log.
 *
 * É esse terceiro caso que também prova o motivo DERIVADO: com a primeira
 * pessoa acesa, o catálogo tem foto exibível, então a ausência da terceira sai
 * como `no_photo_for_person` (fato) e não como `no_licensed_person_photo`
 * (pendência de operação).
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

/** Pessoa com fotos PROMOVIDAS acima do piso: tira com `+N` e galeria indexavel. */
const RETRATADA = { tmdbId: 99990201, slug: "atriz-qa", name: "Atriz QA", fotos: 9, promovida: true };
/** Pessoa promovida, porem ABAIXO do piso: tira sem `+N`, galeria `noindex`. */
const POUCAS = { tmdbId: 99990202, slug: "ator-qa", name: "Ator QA", fotos: 3, promovida: true };
/** Pessoa com fotos NAO promovidas: a tira some, e o log diz o motivo. */
const NAO_PROMOVIDA = {
  tmdbId: 99990203,
  slug: "figurante-qa",
  name: "Figurante QA",
  fotos: 6,
  promovida: false,
};
const PESSOAS = [RETRATADA, POUCAS, NAO_PROMOVIDA] as const;

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
  /**
   * O campo `size` do TMDB: RESOLUÇÃO (altura), nunca duração.
   *
   * A primeira versão desta fixture semeava 134, 151, 62 — números que passam
   * por segundos e renderizavam "02:14" numa tela que parecia certa. Foi a
   * fixture que escondeu o defeito de o presenter formatar `size` como `MM:SS`.
   * Agora ela usa as alturas REAIS que o TMDB devolve.
   */
  readonly size: number;
  readonly site: string;
}

function planoDeVideos(rico: boolean): readonly PlanoVideo[] {
  if (!rico) {
    // UM: abaixo do piso de 2.
    return [{ tipo: "Trailer", nome: "Trailer", pt: true, oficial: true, size: 1080, site: "YouTube" }];
  }
  return [
    { tipo: "Trailer", nome: "Trailer oficial", pt: true, oficial: true, size: 1080, site: "YouTube" },
    { tipo: "Trailer", nome: "Trailer legendado", pt: false, oficial: true, size: 1080, site: "YouTube" },
    { tipo: "Teaser", nome: "Teaser", pt: false, oficial: true, size: 720, site: "YouTube" },
    { tipo: "Behind the Scenes", nome: "Bastidores", pt: false, oficial: false, size: 480, site: "YouTube" },
    { tipo: "Clip", nome: "Cena do duelo", pt: true, oficial: false, size: 1080, site: "YouTube" },
    { tipo: "Featurette", nome: "Featurette", pt: false, oficial: false, size: 720, site: "YouTube" },
    { tipo: "Bloopers", nome: "Erros de gravacao", pt: false, oficial: false, size: 360, site: "YouTube" },
    // Tipo FORA do dicionário: prova que ele aparece com o próprio nome.
    { tipo: "Interview", nome: "Entrevista com o elenco", pt: false, oficial: false, size: 480, site: "YouTube" },
    // Vimeo de propósito: prova a linha SEM player.
    { tipo: "Trailer", nome: "Trailer (Vimeo)", pt: false, oficial: false, size: 720, site: "Vimeo" },
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
          `${String(item.oficial)}, '${item.pt ? "pt" : "en"}', ${String(item.size)}, ` +
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

  await seedPessoas(sql);
}

/**
 * As TRES pessoas. Ver o cabecalho para por que sao tres e nao duas.
 *
 * O `profile_path` da coluna de `people` (o retrato do cabecalho) e semeado em
 * TODAS, inclusive na nao promovida: ele NAO passa pelo gate por linha — vem da
 * coluna da entidade, como o poster do filme. A distincao e o ponto: numa
 * pessoa sem promocao a pagina mostra o retrato do cabecalho e NAO mostra a
 * tira, e e assim que tem de ser.
 */
async function seedPessoas(sql: Sql): Promise<void> {
  for (const pessoa of PESSOAS) {
    const linhas = await sql.q<{ id: string }>(
      `INSERT INTO people (tmdb_id, name, known_for_department, gender, birthday,
                           place_of_birth, profile_path, created_at, updated_at)
       VALUES (${String(pessoa.tmdbId)}, '${pessoa.name}', 'Acting', 1, '1980-03-14',
               'Sao Paulo, Brasil', '${art("profile", 1)}', now(), now())
       RETURNING id::text AS id`,
    );
    const personId = linhas[0]?.id ?? "0";

    await sql.x(
      `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical,
                          created_at, updated_at)
       VALUES ('person', ${personId}, '${LANGUAGE}', '${pessoa.slug}', true, now(), now())`,
    );
    await sql.x(
      `INSERT INTO entity_translations (entity_type, entity_id, language_code, title,
                                        summary, created_at, updated_at)
       VALUES ('person', ${personId}, '${LANGUAGE}', '${pessoa.name}',
               'Fixture local de QA. Nao e biografia real.', now(), now())`,
    );

    // As colunas de licenca sao o ASSUNTO desta fixture, nao detalhe: quem esta
    // promovida nasce como a CLI de promocao a deixaria (`official` + `true`);
    // quem nao esta, como o sync a escreve (`unknown` + `false`).
    const status = pessoa.promovida ? "official" : "unknown";
    const exibivel = pessoa.promovida ? "true" : "false";
    const valores = Array.from({ length: pessoa.fotos }, (_, index) => {
      // Idiomas variados so na pessoa rica: e o que faz a faixa de facetas ter
      // mais de uma opcao (com uma so, o presenter a omite de proposito).
      const idioma = index % 3 === 0 ? "'pt'" : index % 3 === 1 ? "NULL" : "'en'";
      const caminho = art(`${String(pessoa.tmdbId)}-profile`, index);
      return (
        `('tmdb', 'person', ${String(pessoa.tmdbId)}, 'profile', '${caminho}', ` +
        `${idioma}, 1000, 1500, ${String(5 + (index % 5))}, ` +
        `'qa-p-${String(pessoa.tmdbId)}-${String(index)}', '${status}', ${exibivel}, ` +
        `now(), now(), now())`
      );
    }).join(",");

    await sql.x(
      `INSERT INTO tmdb_images (provider_api, entity_type, tmdb_id, image_type, file_path,
                                language_code, width, height, vote_average, payload_hash,
                                license_status, display_allowed,
                                fetched_at, created_at, updated_at)
       VALUES ${valores}`,
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

    log("== semeando os dois titulos e as tres pessoas ==");
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

    const contagem = await sql.q<{ imagens: number; videos: number; fotos: number; acesas: number }>(
      `SELECT (SELECT COUNT(*)::int FROM tmdb_images WHERE entity_type <> 'person') AS imagens,
              (SELECT COUNT(*)::int FROM tmdb_videos) AS videos,
              (SELECT COUNT(*)::int FROM tmdb_images WHERE entity_type = 'person') AS fotos,
              (SELECT COUNT(*)::int FROM tmdb_images
                WHERE entity_type = 'person' AND display_allowed
                  AND license_status IN ('official','licensed')) AS acesas`,
    );
    log(
      `   ${String(contagem[0]?.imagens)} imagens de titulo e ${String(contagem[0]?.videos)} videos semeados`,
    );
    log(
      `   ${String(contagem[0]?.fotos)} fotos de pessoa, das quais ${String(contagem[0]?.acesas)} promovidas`,
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
    const base = `http://127.0.0.1:${String(webPort)}`;
    log("TITULO — as quatro paginas de galeria:");
    log(`  RICO  imagens: ${base}/pt/filmes/${RICO.slug}/imagens/`);
    log(`  RICO  videos : ${base}/pt/filmes/${RICO.slug}/videos/`);
    log(`  POBRE imagens: ${base}/pt/filmes/${POBRE.slug}/imagens/`);
    log(`  POBRE videos : ${base}/pt/filmes/${POBRE.slug}/videos/`);
    log(`  A ficha      : ${base}/pt/filmes/${RICO.slug}/`);
    log("");
    log("PESSOA — a tira (na ficha) e a galeria de fotos:");
    log(`  ${String(RETRATADA.fotos)} fotos, PROMOVIDAS  ficha : ${base}/pt/pessoas/${RETRATADA.slug}/`);
    log(`                              galeria: ${base}/pt/pessoas/${RETRATADA.slug}/fotos/`);
    log(`  ${String(POUCAS.fotos)} fotos, abaixo do piso ficha : ${base}/pt/pessoas/${POUCAS.slug}/`);
    log(`                              galeria: ${base}/pt/pessoas/${POUCAS.slug}/fotos/  (noindex)`);
    log(`  ${String(NAO_PROMOVIDA.fotos)} fotos, NAO promovidas ficha : ${base}/pt/pessoas/${NAO_PROMOVIDA.slug}/`);
    log("                              (a tira NAO renderiza; o motivo sai no log do Next)");
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
