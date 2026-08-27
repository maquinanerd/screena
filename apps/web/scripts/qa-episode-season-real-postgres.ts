/**
 * qa-episode-season-real-postgres.ts — Sobe a página de TEMPORADA e a de
 * EPISÓDIO com PostgreSQL 16 REAL e o Next REAL, para que possam ser ABERTAS.
 *
 * FERRAMENTA DE DESENVOLVIMENTO. Não faz parte do produto: nunca roda no
 * render, no build de app, nem em produção.
 *
 * ============================================================================
 * POR QUE ISTO EXISTE
 * ============================================================================
 * `cast_members` e `crew_members` com `entity_type='episode'` têm ZERO linha em
 * produção, e `tmdb_videos` com `entity_type='season'` também — a coleta nunca
 * aconteceu (ver `syncEpisodes` e `buildMediaTarget`). Sem este harness, os
 * blocos novos da página de episódio e o trailer da temporada só poderiam ser
 * provados por teste de unidade, e a regra da leva é "abra a página com dado
 * real".
 *
 * Ele semeia o estado que o dreno da fila vai produzir, usando a T2 de Ted
 * Lasso — a mesma que a encomenda comparou lado a lado com o TMDB. Os nomes,
 * datas e durações vêm daquela comparação, para que a conferência bloco a bloco
 * seja possível. É FIXTURE: nenhuma linha aqui foi coletada do TMDB por este
 * script, e nada disto vale como dado de catálogo.
 *
 * ============================================================================
 * SEGURANÇA
 * ============================================================================
 *  - ZERO produção: `DATABASE_URL` aponta SEMPRE para 127.0.0.1, num banco
 *    efêmero. Nenhum `.env` é lido.
 *  - ZERO rede de dados: nenhuma chamada a TMDB/RapidAPI/Gemini. As URLs de
 *    imagem que a página monta apontam para o CDN público do TMDB — offline, a
 *    grade aparece sem os bytes e a ESTRUTURA continua verificável.
 *  - Postgres derrubado e diretório removido no `finally`.
 *
 * Uso: pnpm --filter @screena/web qa:episode-season
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

/** A série. `tmdbId` é o real do TMDB — a URL da comparação usa este número. */
const SERIE = { tmdbId: 97546, slug: "ted-lasso-qa", titulo: "Ted Lasso" };
/** A temporada 2. `tmdbId` é o id PRÓPRIO dela, nunca o da série. */
const TEMPORADA = { numero: 2, tmdbId: 119051, nome: "Temporada 2" };

/**
 * Os 12 episódios da T2, como o TMDB os lista.
 *
 * `tmdbId` é o id PRÓPRIO de cada episódio: é ele que vira a chave de
 * `tmdb_images`. Usar o da série faria os 12 compartilharem a mesma galeria —
 * a colisão que manteve `sync_media` recusando episódio até 27/08/2026.
 */
const EPISODIOS: ReadonlyArray<{
  numero: number;
  tmdbId: number;
  titulo: string;
  data: string;
  duracao: number;
  sinopse: string;
}> = [
  { numero: 1, tmdbId: 2960053, titulo: "Adeus, Earl", data: "2021-07-23", duracao: 39, sinopse: "AFC Richmond contrata uma psicóloga esportiva para ajudar o time a se recuperar de sua inédita sequência de empates em sete jogos consecutivos." },
  { numero: 2, tmdbId: 2960054, titulo: "Lavanda", data: "2021-07-30", duracao: 37, sinopse: "Ted se surpreende com o ressurgimento de um rosto familiar. Roy experimenta um novo trabalho." },
  { numero: 3, tmdbId: 2960055, titulo: "Faça a coisa mais certa", data: "2021-08-06", duracao: 40, sinopse: "Rebecca recebe o acompanhamento de uma visita muito especial no trabalho. O retorno de um jogador é mal recebido pelo time." },
  { numero: 4, tmdbId: 2960056, titulo: "Canto dos sinos", data: "2021-08-13", duracao: 33, sinopse: "É Natal em Richmond. Rebecca convoca Ted para uma missão secreta, Roy e Keeley vão atrás de um milagre, e os Higgins abrem sua casa." },
  { numero: 5, tmdbId: 2960057, titulo: "Arco-íris", data: "2021-08-20", duracao: 41, sinopse: "Nate aprende a ser assertivo com a Keeley e a Rebecca. Ted pede um favor ao Roy." },
  { numero: 6, tmdbId: 2960058, titulo: "O sinal", data: "2021-08-27", duracao: 38, sinopse: "Ted fica animado ao ver que a nova dinâmica do time parece estar funcionando. Mas será que eles terão uma chance nas quartas de final?" },
  { numero: 7, tmdbId: 2960059, titulo: "Espaço mental", data: "2021-09-03", duracao: 38, sinopse: "Agora que Richmond está dando a volta por cima, está na hora de todos cuidarem de seus próprios problemas — como o desconforto do Ted, a confiança do Nate, e a atenção do Roy." },
  { numero: 8, tmdbId: 2960060, titulo: "Man City", data: "2021-09-10", duracao: 48, sinopse: "Ted e Dra. Sharon percebem que terão que encontrar um meio termo. Tensões aumentam enquanto o time se prepara para a semifinal." },
  { numero: 9, tmdbId: 2960061, titulo: "Beard depois de horas", data: "2021-09-17", duracao: 46, sinopse: "Depois da semifinal, Beard sai para uma odisseia noturna em Londres na tentativa de organizar seus pensamentos." },
  { numero: 10, tmdbId: 2960062, titulo: "Nenhum casamento e um funeral", data: "2021-09-24", duracao: 49, sinopse: "Rebecca sofre uma perda repentina. O time se junta para mostrar apoio, mas Ted precisa confrontar uma parte de seu passado." },
  { numero: 11, tmdbId: 2960063, titulo: "Trem de meia noite para Royston", data: "2021-10-01", duracao: 45, sinopse: "Enquanto o bilionário entusiasta de futebol ganês faz uma oferta incrível para Sam, Ted planeja algo especial para o último dia da Dra. Sharon com o time." },
  { numero: 12, tmdbId: 2960064, titulo: "Invertendo a pirâmide do sucesso", data: "2021-10-08", duracao: 53, sinopse: "No último episódio da temporada, Richmond tem a chance de ganhar de volta sua promoção, enquanto Ted enfrenta as reações ao artigo dolorosamente honesto de Trent Crimm." },
];

/** A EQUIPE do E1 — a que o TMDB nomeia como Direção e Roteiro. */
const EQUIPE_E1: ReadonlyArray<{ tmdbId: number; nome: string; departamento: string; funcao: string }> = [
  { tmdbId: 1213786, nome: "Declan Lowney", departamento: "Directing", funcao: "Director" },
  { tmdbId: 1245004, nome: "Brendan Hunt", departamento: "Writing", funcao: "Writer" },
];

/**
 * Os 31 artistas convidados do E1, na ordem do TMDB.
 *
 * Os `tmdbId` de PESSOA aqui são sintéticos e apenas DISTINTOS entre si — a
 * primeira versão desta fixture deu o mesmo id a Brendan Hunt e a Jason
 * Sudeikis, e o `ON CONFLICT DO UPDATE` colapsou os dois: a tela mostrou
 * "Roteiro: Jason Sudeikis". Um defeito da fixture, não da página, e que só
 * apareceu ao ABRIR.
 *
 * TRINTA E UM de propósito: é acima do teto de exibição (18), e é o caso que
 * prova a contagem honesta na tela ("18 de 31") em vez de mostrar 18 e dizer 18.
 */
const CONVIDADOS_E1: ReadonlyArray<{ tmdbId: number; nome: string; personagem: string }> = [
  { tmdbId: 1657018, nome: "Toheeb Jimoh", personagem: "Sam Obisanya" },
  { tmdbId: 1215166, nome: "Cristo Fernández", personagem: "Dani Rojas" },
  { tmdbId: 1802353, nome: "Kola Bokinni", personagem: "Isaac McAdoo" },
  { tmdbId: 2385271, nome: "Billy Harris", personagem: "Colin Hughes" },
  { tmdbId: 84495, nome: "James Lance", personagem: "Trent Crimm" },
  { tmdbId: 1214258, nome: "Patrick Baladi", personagem: "John Wingsnight" },
  { tmdbId: 1301780, nome: "Hugh Futcher", personagem: "Nigel" },
  { tmdbId: 2385272, nome: "Sarah Ford", personagem: "Nicole" },
  { tmdbId: 2385273, nome: "Juliet Prew", personagem: "Lauren" },
  { tmdbId: 2385274, nome: "Kaye Brown", personagem: "Rachel" },
  { tmdbId: 1195322, nome: "Rosalind Adler", personagem: "Deri" },
  { tmdbId: 2385275, nome: "Kate Perry", personagem: "Janice" },
  { tmdbId: 2385276, nome: "Ellie Jaday", personagem: "Amelia" },
  { tmdbId: 2385277, nome: "Aroop Shergill", personagem: "Addison" },
  { tmdbId: 1370450, nome: "Anna Martine Freeman", personagem: "Sarah" },
  { tmdbId: 2385278, nome: "Marcus Onilude", personagem: "Marcus Adebayo" },
  { tmdbId: 1252989, nome: "Guy Porritt", personagem: "Gary" },
  { tmdbId: 2036356, nome: "Elodie Blomfield", personagem: "Phoebe" },
  { tmdbId: 2385279, nome: "Georgia Gagen", personagem: "Ellie" },
  { tmdbId: 2385280, nome: "Miguel Harichi", personagem: "Danthony" },
  { tmdbId: 1608587, nome: "Fleur East", personagem: "Jayliah Vivienne" },
  { tmdbId: 2385281, nome: "Chris Powell", personagem: "Chris Powell" },
  { tmdbId: 2205148, nome: "Arlo White", personagem: "Arlo White" },
  { tmdbId: 1802354, nome: "Charlie Hiscock", personagem: "Will Kitman" },
  { tmdbId: 1245878, nome: "Ruth Bradley", personagem: "Ms. Bowen" },
  { tmdbId: 84496, nome: "Annette Badland", personagem: "Mae Green" },
  { tmdbId: 1802355, nome: "Stephen Manas", personagem: "Richard Montlaur" },
  { tmdbId: 1802356, nome: "Moe Jeudy-Lamour", personagem: "Thierry Zoreaux" },
  { tmdbId: 1802357, nome: "Moe Hashim", personagem: "Moe Bumbercatch" },
  { tmdbId: 1802358, nome: "David Elsendoorn", personagem: "Jan Maas" },
  { tmdbId: 2385282, nome: "Tom Hendryk", personagem: "Tom O'Brien" },
];

/** Elenco REGULAR creditado no E1 (o que a ficha da série já mostra por inteiro). */
const REGULARES_E1: ReadonlyArray<{ tmdbId: number; nome: string; personagem: string }> = [
  { tmdbId: 1245003, nome: "Jason Sudeikis", personagem: "Ted Lasso" },
  { tmdbId: 1213787, nome: "Hannah Waddingham", personagem: "Rebecca Welton" },
  { tmdbId: 1213788, nome: "Jeremy Swift", personagem: "Leslie Higgins" },
  { tmdbId: 1213789, nome: "Juno Temple", personagem: "Keeley Jones" },
  { tmdbId: 1213790, nome: "Brett Goldstein", personagem: "Roy Kent" },
  { tmdbId: 1213791, nome: "Nick Mohammed", personagem: "Nathan Shelley" },
];

/**
 * Os DOIS trailers da T2, como o TMDB os lista.
 *
 * `videoKey` tem ONZE caracteres exatos: `youtube-embed.ts` exige
 * `^[A-Za-z0-9_-]{11}$`. A primeira versão do harness de galeria usou dez e a
 * página abriu com "Indisponível para reprodução" nos nove vídeos — a página
 * estava certa, a fixture é que estava errada, e só apareceu ao ABRIR.
 */
const VIDEOS_T2: ReadonlyArray<{ id: string; key: string; nome: string; tipo: string; data: string }> = [
  { id: "qa-t2-teaser", key: "qaTedLasso1", nome: "Teaser oficial da 2.ª temporada", tipo: "Teaser", data: "2021-04-30" },
  { id: "qa-t2-trailer", key: "qaTedLasso2", nome: "Trailer oficial da 2.ª temporada [Legendado]", tipo: "Trailer", data: "2021-06-21" },
];

/** Quantos stills o E1 tem no TMDB. É o número que a ficha e a galeria mostram. */
const STILLS_E1 = 15;

interface Sql {
  q: <T>(sql: string) => Promise<T[]>;
  x: (sql: string) => Promise<number>;
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Escapa aspas simples para SQL literal. Fixture local, nunca entrada de usuário. */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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

async function seed(sql: Sql): Promise<void> {
  // A LICENÇA DE IMAGEM (gate da galeria) e a de VÍDEO (gate do trailer). Sem
  // as duas o comportamento CERTO é a página não mostrar nada — mas não é o que
  // este harness quer mostrar.
  for (const tipo of ["image", "video"]) {
    await sql.x(
      `INSERT INTO source_licenses
         (source_key, content_type, provider_key, license_status, display_allowed,
          logo_allowed, score_allowed, review_quote_allowed, requires_attribution,
          requires_linkback, attribution_text, is_current, decision_origin, policy_version,
          created_at, updated_at)
       VALUES ('tmdb', ${lit(tipo)}, 'tmdb', 'official', true,
               true, false, false, true,
               true, 'Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.',
               true, 'qa-harness', 'qa/episode-season', now(), now())`,
    );
  }

  // --- A série ---
  const serieRows = await sql.q<{ id: string }>(
    `INSERT INTO tv_shows (tmdb_id, name_original, original_language, first_air_date,
                           poster_path, backdrop_path, status, created_at, updated_at)
     VALUES (${String(SERIE.tmdbId)}, ${lit(SERIE.titulo)}, 'en', '2020-08-14',
             '/qa-ted-poster.jpg', '/qa-ted-backdrop.jpg', 'Ended', now(), now())
     RETURNING id::text AS id`,
  );
  const serieId = serieRows[0]?.id ?? "0";

  await sql.x(
    `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, created_at, updated_at)
     VALUES ('tv', ${serieId}, ${lit(LANGUAGE)}, ${lit(SERIE.slug)}, true, now(), now())`,
  );
  await sql.x(
    `INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, created_at, updated_at)
     VALUES ('tv', ${serieId}, ${lit(LANGUAGE)}, ${lit(SERIE.titulo)},
             'Fixture local de QA. Nao e sinopse real.', now(), now())`,
  );

  // --- As temporadas 1, 2 e 3 (a navegação anterior/próxima precisa das três) ---
  let temporada2Id = "0";
  for (const numero of [1, 2, 3]) {
    const tmdbId = numero === TEMPORADA.numero ? TEMPORADA.tmdbId : 119050 + numero;
    const rows = await sql.q<{ id: string }>(
      `INSERT INTO seasons (tv_show_id, tmdb_id, season_number, name, overview, air_date,
                            episode_count, poster_path, created_at, updated_at)
       VALUES (${serieId}, ${String(tmdbId)}, ${String(numero)},
               ${lit(`Temporada ${String(numero)}`)},
               ${numero === TEMPORADA.numero ? lit("A segunda temporada do AFC Richmond.") : "NULL"},
               ${numero === TEMPORADA.numero ? "'2021-07-23'" : "NULL"},
               ${numero === TEMPORADA.numero ? String(EPISODIOS.length) : "10"},
               '/qa-t${String(numero)}-poster.jpg', now(), now())
       RETURNING id::text AS id`,
    );
    if (numero === TEMPORADA.numero) temporada2Id = rows[0]?.id ?? "0";
  }

  // --- Os 12 episódios da T2 ---
  const episodioIdPorNumero = new Map<number, string>();
  for (const ep of EPISODIOS) {
    const rows = await sql.q<{ id: string }>(
      `INSERT INTO episodes (season_id, tv_show_id, tmdb_id, episode_number, name, overview,
                             air_date, runtime_minutes, still_path, created_at, updated_at)
       VALUES (${temporada2Id}, ${serieId}, ${String(ep.tmdbId)}, ${String(ep.numero)},
               ${lit(ep.titulo)}, ${lit(ep.sinopse)}, ${lit(ep.data)},
               ${String(ep.duracao)}, ${lit(`/qa-t2e${String(ep.numero)}-still.jpg`)}, now(), now())
       RETURNING id::text AS id`,
    );
    episodioIdPorNumero.set(ep.numero, rows[0]?.id ?? "0");
  }
  const e1Id = episodioIdPorNumero.get(1) ?? "0";

  // --- As pessoas (convidados + regulares + equipe), deduplicadas por tmdb_id ---
  const pessoas = new Map<number, string>();
  const todas = [
    ...CONVIDADOS_E1.map((p) => ({ tmdbId: p.tmdbId, nome: p.nome })),
    ...REGULARES_E1.map((p) => ({ tmdbId: p.tmdbId, nome: p.nome })),
    ...EQUIPE_E1.map((p) => ({ tmdbId: p.tmdbId, nome: p.nome })),
  ];
  for (const pessoa of todas) {
    if (pessoas.has(pessoa.tmdbId)) continue;
    const rows = await sql.q<{ id: string }>(
      `INSERT INTO people (tmdb_id, name, profile_path, created_at, updated_at)
       VALUES (${String(pessoa.tmdbId)}, ${lit(pessoa.nome)},
               ${lit(`/qa-p${String(pessoa.tmdbId)}.jpg`)}, now(), now())
       ON CONFLICT (tmdb_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text AS id`,
    );
    pessoas.set(pessoa.tmdbId, rows[0]?.id ?? "0");
  }

  // Slug para ALGUMAS pessoas apenas: a página tem de aguentar os dois casos
  // (com página => link; sem página => texto, nunca link quebrado).
  for (const pessoa of [...CONVIDADOS_E1.slice(0, 6), ...EQUIPE_E1]) {
    const slug = pessoa.nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    await sql.x(
      `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, created_at, updated_at)
       VALUES ('person', ${pessoas.get(pessoa.tmdbId) ?? "0"}, ${lit(LANGUAGE)}, ${lit(slug)}, true, now(), now())
       ON CONFLICT DO NOTHING`,
    );
  }

  // --- Elenco do E1: guest stars (is_guest=true) e regulares (false) ---
  const valoresElenco = [
    ...CONVIDADOS_E1.map(
      (p, i) =>
        `(${pessoas.get(p.tmdbId) ?? "0"}, 'episode', ${e1Id}, ${lit(p.personagem)}, ${String(i)}, ` +
        `${lit(`qa-gs-${String(p.tmdbId)}`)}, true, now(), now())`,
    ),
    ...REGULARES_E1.map(
      (p, i) =>
        `(${pessoas.get(p.tmdbId) ?? "0"}, 'episode', ${e1Id}, ${lit(p.personagem)}, ${String(i)}, ` +
        `${lit(`qa-cast-${String(p.tmdbId)}`)}, false, now(), now())`,
    ),
  ].join(",");
  await sql.x(
    `INSERT INTO cast_members (person_id, entity_type, entity_id, character, billing_order,
                               credit_id, is_guest, created_at, updated_at)
     VALUES ${valoresElenco}`,
  );

  // --- Equipe do E1: direção e roteiro ---
  const valoresEquipe = EQUIPE_E1.map(
    (p) =>
      `(${pessoas.get(p.tmdbId) ?? "0"}, 'episode', ${e1Id}, ${lit(p.departamento)}, ` +
      `${lit(p.funcao)}, ${lit(`qa-crew-${String(p.tmdbId)}-${p.funcao}`)}, now(), now())`,
  ).join(",");
  await sql.x(
    `INSERT INTO crew_members (person_id, entity_type, entity_id, department, job,
                               credit_id, created_at, updated_at)
     VALUES ${valoresEquipe}`,
  );

  // --- Os 15 stills do E1, chaveados pelo tmdb_id PRÓPRIO do episódio ---
  const e1TmdbId = EPISODIOS[0]?.tmdbId ?? 0;
  const valoresStill = Array.from({ length: STILLS_E1 }, (_, i) =>
    `('tmdb', 'episode', ${String(e1TmdbId)}, 'still', ${lit(`/qa-e1-still-${String(i).padStart(2, "0")}.jpg`)}, ` +
    `NULL, 1920, 1080, ${String(5 + (i % 5))}, ${lit(`qa-still-${String(i)}`)}, 'unknown', false, now(), now(), now())`,
  ).join(",");
  await sql.x(
    `INSERT INTO tmdb_images (provider_api, entity_type, tmdb_id, image_type, file_path,
                              language_code, width, height, vote_average, payload_hash,
                              license_status, display_allowed, fetched_at, created_at, updated_at)
     VALUES ${valoresStill}`,
  );

  // --- Os 2 trailers da T2, chaveados pelo tmdb_id PRÓPRIO da temporada ---
  //
  // Nascem `display_allowed=false` no produto; o harness os promove porque o
  // que se quer VER é o trailer na tela, e a promoção é operação governada fora
  // do render (mesmo desenho de ratings e de streaming).
  const valoresVideo = VIDEOS_T2.map(
    (v) =>
      `('tmdb', 'season', ${String(TEMPORADA.tmdbId)}, ${lit(v.id)}, 'YouTube', ${lit(v.key)}, ` +
      `${lit(v.nome)}, ${lit(v.tipo)}, true, 'pt', 1080, ${lit(`qa-v-${v.id}`)}, ` +
      `'official', true, ${lit(v.data)}, now(), now(), now())`,
  ).join(",");
  await sql.x(
    `INSERT INTO tmdb_videos (provider_api, entity_type, tmdb_id, tmdb_video_id, site, video_key,
                              name, video_type, official, language_code, size, payload_hash,
                              license_status, display_allowed, published_at,
                              fetched_at, created_at, updated_at)
     VALUES ${valoresVideo}`,
  );
}

async function main(): Promise<number> {
  const pgPort = await freePort();
  const webPort = process.env.CINERIE_QA_PORT
    ? Number(process.env.CINERIE_QA_PORT)
    : await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-qa-ep-"));
  const database = "cinerie_qa_episode";
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

    // `source_licenses.provider_key` tem FK para `api_providers.key`: sem a
    // linha `tmdb` o primeiro INSERT morre em violacao de chave estrangeira.
    log("== semeando os dicionarios (api_providers, countries, ...) ==");
    execFileSync(
      process.execPath,
      [path.join(webDir, "node_modules", "tsx", "dist", "cli.mjs"), path.join(dbDir, "prisma", "seed.ts")],
      { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", cwd: dbDir },
    );

    log("== semeando Ted Lasso T2 (12 episodios, 31 convidados, 2 trailers) ==");
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

    const contagem = await sql.q<{
      episodios: number;
      convidados: number;
      regulares: number;
      equipe: number;
      stills: number;
      videos: number;
    }>(
      `SELECT (SELECT COUNT(*)::int FROM episodes) AS episodios,
              (SELECT COUNT(*)::int FROM cast_members WHERE entity_type = 'episode' AND is_guest) AS convidados,
              (SELECT COUNT(*)::int FROM cast_members WHERE entity_type = 'episode' AND NOT is_guest) AS regulares,
              (SELECT COUNT(*)::int FROM crew_members WHERE entity_type = 'episode') AS equipe,
              (SELECT COUNT(*)::int FROM tmdb_images WHERE entity_type = 'episode') AS stills,
              (SELECT COUNT(*)::int FROM tmdb_videos WHERE entity_type = 'season') AS videos`,
    );
    const c = contagem[0];
    log(
      `   ${String(c?.episodios)} episodios · ${String(c?.convidados)} convidados · ` +
        `${String(c?.regulares)} regulares · ${String(c?.equipe)} na equipe · ` +
        `${String(c?.stills)} stills · ${String(c?.videos)} videos de temporada`,
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

    const base = `http://127.0.0.1:${String(webPort)}`;
    const temporadaUrl = `${base}/pt/series/${SERIE.slug}/temporadas/2/`;
    log("");
    log("=".repeat(72));
    log("AS TRES PAGINAS (abra e compare com o TMDB, bloco a bloco):");
    log(`  TEMPORADA (trailer): ${temporadaUrl}`);
    log(`  EPISODIO 1         : ${temporadaUrl}episodios/1/`);
    log(`  GALERIA DO EP 1    : ${temporadaUrl}episodios/1/imagens/`);
    log("");
    log("  TMDB, para comparar:");
    log("    https://www.themoviedb.org/tv/97546-ted-lasso/season/2");
    log("    https://www.themoviedb.org/tv/97546-ted-lasso/season/2/episode/1");
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
    process.stderr.write(`qa:episode-season falhou: ${String(error)}\n`);
    process.exit(1);
  });
