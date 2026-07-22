/**
 * Validador dos ADAPTERS Prisma de identidade e credencial (Backend C, C7B1)
 * contra PostgreSQL 16 REAL, efemero e descartavel.
 *
 * Por que um banco de verdade: os pontos que decidem a corretude desta unidade
 * nao existem fora dele — qual unique o driver reporta e em que FORMA
 * (`meta.target` muda entre versoes), se `updateMany` realmente aplica o
 * `@updatedAt` numa coluna NOT NULL sem default, se o compare-and-swap sob
 * concorrencia real produz exatamente um vencedor, e se o rollback desfaz as
 * DUAS escritas do cadastro. Um mock responde o que o autor imaginou; o banco
 * responde o que acontece.
 *
 * Nada aqui toca banco de producao: sobe um PostgreSQL proprio numa porta livre,
 * aplica TODAS as migrations num database vazio e derruba tudo no fim.
 *
 * Uso: pnpm --filter @screena/user-platform validate:user-product
 *
 * Todos os e-mails e hashes deste arquivo sao FICTICIOS. Nenhuma senha em texto
 * claro existe neste fluxo: o adapter so conhece hash opaco.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";
import { createPrismaIdentityStore } from "../src/persistence/prisma/identity-store.js";
import { createPrismaPasswordCredentialStore } from "../src/persistence/prisma/password-credential-store.js";
import { createPrismaSessionStore } from "../src/persistence/prisma/session-store.js";
import { createPrismaAuthTokenStore } from "../src/persistence/prisma/auth-token-store.js";
import { evaluateSessionAccess } from "../src/auth/sessions.js";
import type { TransactionScope } from "../src/persistence/types.js";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");

/**
 * Escopo transacional. E um MARCADOR de compilacao: quem o passa declara estar
 * numa transacao. O client concreto chega pelo executor, nao por aqui.
 */
const SCOPE: TransactionScope = { transactional: true };

/** Hashes FICTICIOS em formato PHC-like (satisfazem o CHECK de versionamento). */
const HASH_1 = "scrypt$N=32768,r=8,p=1$00112233$hash-ficticio-um";
const HASH_2 = "scrypt$N=32768,r=8,p=1$44556677$hash-ficticio-dois";
const HASH_3 = "scrypt$N=32768,r=8,p=1$8899aabb$hash-ficticio-tres";

/**
 * Rotulo de algoritmo FICTICIO, escolhido para diferir do default da coluna
 * ("scrypt") E do prefixo do PHC ("scrypt"). Assim, ver este valor no banco so e
 * possivel se o adapter tiver gravado exatamente o que o port entregou.
 */
const ALG_PORT = "rotulo-do-port-c7b1";
const ALG_PORT_NOVO = "rotulo-do-port-c7b1-trocado";

/**
 * Hashes FICTICIOS de sessao/CSRF/token. Precisam ter a forma sha256 hex
 * (`^[0-9a-f]{64}$`) porque o schema a exige por CHECK — usar um valor
 * arbitrario reprovaria no banco antes de chegar ao comportamento sob teste.
 */
const HASH_SESSAO_1 = "a".repeat(64);
const HASH_SESSAO_2 = "b".repeat(64);
const HASH_CSRF_1 = "c".repeat(64);
const HASH_CSRF_2 = "d".repeat(64);
const HASH_TOKEN_1 = "1".repeat(64);
const HASH_TOKEN_2 = "2".repeat(64);
const HASH_TOKEN_3 = "3".repeat(64);
const HASH_TOKEN_4 = "4".repeat(64);
const HASH_TOKEN_5 = "5".repeat(64);
const HASH_RESET_1 = "e".repeat(64);
const HASH_RESET_2 = "f".repeat(64);
const HASH_INEXISTENTE = "0".repeat(64);
const HASH_ROT_BASE = "6".repeat(64);
const HASH_ROT_1 = "7".repeat(64);
const HASH_ROT_2 = "8".repeat(64);
const HASH_IP_CRU = "9".repeat(64);
const HASH_SESSAO_ALVO = "ab".repeat(32);
const HASH_VERIF_TX = "cd".repeat(32);
const HASH_RESET_VERIF = "ef".repeat(32);
const HASH_VERIF_EXPIRADO = "ba".repeat(32);

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
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
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

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const identities = createPrismaIdentityStore(prisma);
  const credentials = createPrismaPasswordCredentialStore(prisma);
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);

  try {
    // -----------------------------------------------------------------------
    // IDENTIDADE
    // -----------------------------------------------------------------------
    const criado = await identities.create(SCOPE, {
      email: "Alice@Example.Test",
      emailNormalized: "alice@example.test",
      displayName: "Alice",
    });
    record(1, "cria identidade valida", criado.kind === "created", `kind=${criado.kind}`);
    if (criado.kind !== "created") {
      throw new Error("cadastro base falhou; demais checks dependem dele");
    }
    const aliceId = criado.identity.id;

    const [aliceRow] = await q<{
      email: string;
      email_normalized: string;
      display_name: string | null;
      role: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(`SELECT * FROM "users" WHERE id = ${aliceId}`);

    record(
      2,
      "e-mail BRUTO persistido byte a byte (sem normalizar)",
      aliceRow!.email === "Alice@Example.Test",
      `email=${aliceRow!.email}`,
    );
    record(
      3,
      "e-mail NORMALIZADO persistido na coluna propria",
      aliceRow!.email_normalized === "alice@example.test",
      `email_normalized=${aliceRow!.email_normalized}`,
    );
    record(
      4,
      "displayName persistido",
      aliceRow!.display_name === "Alice",
      `display_name=${aliceRow!.display_name}`,
    );
    record(
      5,
      "defaults do BANCO aplicados (role/status/timestamps)",
      aliceRow!.role === "user" &&
        aliceRow!.status === "active" &&
        aliceRow!.created_at instanceof Date &&
        aliceRow!.updated_at instanceof Date,
      `role=${aliceRow!.role} status=${aliceRow!.status}`,
    );
    record(
      6,
      "o registro devolvido tem EXATAMENTE id e status",
      JSON.stringify(Object.keys(criado.identity).sort()) === JSON.stringify(["id", "status"]),
      `keys=${Object.keys(criado.identity).sort().join(",")}`,
    );

    const achado = await identities.findByNormalizedEmail(SCOPE, "alice@example.test");
    record(
      7,
      "busca por e-mail NORMALIZADO encontra",
      achado.kind === "found" && achado.identity.id === aliceId,
      `kind=${achado.kind}`,
    );

    const porBruto = await identities.findByNormalizedEmail(SCOPE, "Alice@Example.Test");
    record(
      8,
      "e-mail BRUTO nao serve de fallback na busca",
      porBruto.kind === "not_found",
      `kind=${porBruto.kind}`,
    );

    const ausente = await identities.findByNormalizedEmail(SCOPE, "ninguem@example.test");
    record(9, "identidade ausente e not_found", ausente.kind === "not_found", `kind=${ausente.kind}`);

    // Conflito isolado por e-mail BRUTO: mesmo `email`, normalizados diferentes.
    await identities.create(SCOPE, {
      email: "Dup@Example.Test",
      emailNormalized: "dup-um@example.test",
      displayName: null,
    });
    const conflitoBruto = await identities.create(SCOPE, {
      email: "Dup@Example.Test",
      emailNormalized: "dup-dois@example.test",
      displayName: null,
    });
    record(
      10,
      "conflito por e-mail BRUTO classifica identity.email",
      conflitoBruto.kind === "conflict" &&
        conflitoBruto.conflict.reason === "unique_violation" &&
        conflitoBruto.conflict.target === "identity.email",
      `alvo=${conflitoBruto.kind === "conflict" ? String(conflitoBruto.conflict.target) : "-"}`,
    );

    // Conflito isolado por NORMALIZADO: `email` diferente, normalizado igual.
    const conflitoNorm = await identities.create(SCOPE, {
      email: "Outro@Example.Test",
      emailNormalized: "alice@example.test",
      displayName: null,
    });
    record(
      11,
      "conflito por e-mail NORMALIZADO classifica identity.emailNormalized",
      conflitoNorm.kind === "conflict" &&
        conflitoNorm.conflict.reason === "unique_violation" &&
        conflitoNorm.conflict.target === "identity.emailNormalized",
      `alvo=${conflitoNorm.kind === "conflict" ? String(conflitoNorm.conflict.target) : "-"}`,
    );

    record(
      12,
      "nenhum nome de constraint/SQL vaza no conflito",
      !/users_|_key|constraint|pg_|SELECT|INSERT/i.test(JSON.stringify(conflitoNorm)),
      JSON.stringify(conflitoNorm),
    );

    // Forma REAL de `meta.target` nesta versao do driver — diagnostico, nao
    // assercao: a classificacao acima ja provou o comportamento observavel.
    try {
      await prisma.user.create({
        data: { email: "Alice@Example.Test", emailNormalized: "forma-do-target@example.test" },
        select: { id: true },
      });
    } catch (e) {
      const meta = (e as { meta?: { target?: unknown } }).meta;
      console.log(`      [diagnostico] meta.target observado = ${JSON.stringify(meta?.target)}`);
    }

    const independentes = await Promise.all([
      identities.create(SCOPE, {
        email: "ind1@example.test",
        emailNormalized: "ind1@example.test",
        displayName: null,
      }),
      identities.create(SCOPE, {
        email: "ind2@example.test",
        emailNormalized: "ind2@example.test",
        displayName: null,
      }),
    ]);
    record(
      13,
      "duas identidades independentes vencem as duas",
      independentes.every((r) => r.kind === "created"),
      `kinds=${independentes.map((r) => r.kind).join(",")}`,
    );

    // DISPUTA: duas criacoes simultaneas do MESMO normalizado. Nao se afirma
    // sobreposicao temporal (o pool pode serializar); o que se prova e que a
    // trava do BANCO deixa exatamente uma vencer, sobrepondo-se ou nao.
    const corrida = await Promise.all([
      identities.create(SCOPE, {
        email: "Corrida-A@Example.Test",
        emailNormalized: "corrida@example.test",
        displayName: null,
      }),
      identities.create(SCOPE, {
        email: "Corrida-B@Example.Test",
        emailNormalized: "corrida@example.test",
        displayName: null,
      }),
    ]);
    const venceram = corrida.filter((r) => r.kind === "created").length;
    const conflitaram = corrida.filter((r) => r.kind === "conflict").length;
    const [linhasCorrida] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "users" WHERE email_normalized = 'corrida@example.test'`,
    );
    record(
      14,
      "disputa: exatamente 1 identidade sobrevive, a outra e conflito",
      venceram === 1 && conflitaram === 1 && Number(linhasCorrida!.c) === 1,
      `criadas=${venceram} conflitos=${conflitaram} linhas=${Number(linhasCorrida!.c)}`,
    );

    // -----------------------------------------------------------------------
    // CREDENCIAL
    // -----------------------------------------------------------------------
    // O rotulo e DELIBERADAMENTE diferente do default da coluna ("scrypt"):
    // usar "scrypt" aqui tornaria o check 17 nao-falsificavel — ele ficaria
    // verde mesmo se o adapter DESCARTASSE o valor do port e deixasse o banco
    // preencher.
    const credCriada = await credentials.createInitial(SCOPE, {
      userId: aliceId,
      passwordHash: HASH_1,
      algorithm: ALG_PORT,
    });
    record(15, "cria credencial inicial", credCriada.kind === "created", `kind=${credCriada.kind}`);

    const [credRow] = await q<{ password_hash: string; algorithm: string }>(
      `SELECT password_hash, algorithm FROM "user_password_credentials" WHERE user_id = ${aliceId}`,
    );
    record(
      16,
      "hash persistido EXATAMENTE como recebido (string opaca)",
      credRow!.password_hash === HASH_1,
      `igual=${credRow!.password_hash === HASH_1}`,
    );
    record(
      17,
      "algoritmo persistido e o VINDO DO PORT (nao o default, nao o prefixo do PHC)",
      credRow!.algorithm === ALG_PORT,
      `algorithm=${credRow!.algorithm} (default da coluna seria "scrypt"; prefixo do PHC tambem)`,
    );

    // O gate do C7B1: a coluna e NOT NULL, mas TEM default no banco — por isso
    // um port que nao carregasse `algorithm` ainda assim seria satisfativel.
    await exec(
      `INSERT INTO "users" (email, email_normalized, status, updated_at) VALUES ('default-alg@example.test','default-alg@example.test','active', now())`,
    );
    const [usuarioDefault] = await q<{ id: bigint }>(
      `SELECT id FROM "users" WHERE email_normalized = 'default-alg@example.test'`,
    );
    await exec(
      `INSERT INTO "user_password_credentials" (user_id, password_hash, updated_at) VALUES (${usuarioDefault!.id}, '${HASH_1}', now())`,
    );
    const [semAlg] = await q<{ algorithm: string }>(
      `SELECT algorithm FROM "user_password_credentials" WHERE user_id = ${usuarioDefault!.id}`,
    );
    record(
      18,
      "coluna algorithm tem DEFAULT no banco (nao ha PORT_GAP)",
      semAlg!.algorithm === "scrypt",
      `default aplicado=${semAlg!.algorithm}`,
    );

    const lida = await credentials.findForVerification(SCOPE, aliceId);
    record(
      19,
      "findForVerification devolve o hash",
      lida.kind === "found" && lida.material.passwordHash === HASH_1,
      `kind=${lida.kind}`,
    );
    record(
      20,
      "o material tem EXATAMENTE passwordHash (sem algorithm)",
      lida.kind === "found" &&
        JSON.stringify(Object.keys(lida.material)) === JSON.stringify(["passwordHash"]),
      `keys=${lida.kind === "found" ? Object.keys(lida.material).join(",") : "-"}`,
    );

    const identidadeDepois = await identities.findByNormalizedEmail(SCOPE, "alice@example.test");
    record(
      21,
      "a IDENTIDADE nunca devolve hash, mesmo com credencial existente",
      !/hash|scrypt/i.test(JSON.stringify(identidadeDepois, (_k, v) => (typeof v === "bigint" ? "0" : v))),
      "sem segredo no registro de identidade",
    );

    const segunda = await credentials.createInitial(SCOPE, {
      userId: aliceId,
      passwordHash: HASH_2,
      algorithm: "scrypt",
    });
    record(
      22,
      "segunda credencial do mesmo usuario e already_exists (1:1)",
      segunda.kind === "already_exists" && segunda.conflict.target === "credential.user",
      `kind=${segunda.kind}`,
    );
    const [aposSegunda] = await q<{ password_hash: string }>(
      `SELECT password_hash FROM "user_password_credentials" WHERE user_id = ${aliceId}`,
    );
    record(
      23,
      "a credencial existente NAO foi sobrescrita pela tentativa",
      aposSegunda!.password_hash === HASH_1,
      "hash preservado",
    );

    const semUsuario = await credentials.createInitial(SCOPE, {
      userId: 999999n,
      passwordHash: HASH_1,
      algorithm: "scrypt",
    });
    record(
      24,
      "usuario inexistente respeita a FK e vira user_not_found",
      semUsuario.kind === "user_not_found",
      `kind=${semUsuario.kind}`,
    );

    // -----------------------------------------------------------------------
    // COMPARE-AND-SWAP
    // -----------------------------------------------------------------------
    // Envelhece `updated_at` para provar que o swap o atualiza. A coluna e NOT
    // NULL e NAO tem default: SQL cru teria de preenche-la a mao — `updateMany`
    // honra o `@updatedAt` do modelo, e e por isso que ele foi escolhido.
    await exec(
      `UPDATE "user_password_credentials" SET updated_at = TIMESTAMP '2000-01-01 00:00:00' WHERE user_id = ${aliceId}`,
    );

    const trocaOk = await credentials.replaceByPreimage(SCOPE, {
      userId: aliceId,
      expectedPasswordHash: HASH_1,
      nextPasswordHash: HASH_2,
      nextAlgorithm: ALG_PORT_NOVO,
    });
    record(25, "CAS com pre-imagem CORRETA atualiza", trocaOk.kind === "updated", `kind=${trocaOk.kind}`);

    const [aposTroca] = await q<{ password_hash: string; algorithm: string; updated_at: Date }>(
      `SELECT password_hash, algorithm, updated_at FROM "user_password_credentials" WHERE user_id = ${aliceId}`,
    );
    record(
      26,
      "a leitura seguinte devolve SO o hash novo",
      aposTroca!.password_hash === HASH_2,
      "hash trocado",
    );
    record(
      // Os numeros sao IDs ESTAVEIS por check, nao a ordem de execucao (mesmo
      // criterio do validador de C7A): renumerar tudo a cada insercao tornaria
      // ilegivel qualquer historico de falha.
      40,
      "o CAS grava tambem o nextAlgorithm vindo do port",
      aposTroca!.algorithm === ALG_PORT_NOVO,
      `algorithm=${aposTroca!.algorithm}`,
    );
    record(
      27,
      "updateMany aplicou @updatedAt (coluna NOT NULL sem default)",
      aposTroca!.updated_at.getFullYear() > 2000,
      `updated_at=${aposTroca!.updated_at.toISOString()}`,
    );

    const trocaVelha = await credentials.replaceByPreimage(SCOPE, {
      userId: aliceId,
      expectedPasswordHash: HASH_1,
      nextPasswordHash: HASH_3,
      nextAlgorithm: "scrypt",
    });
    record(
      28,
      "o hash ANTIGO deixa de valer como pre-imagem (stale_preimage)",
      trocaVelha.kind === "conflict" &&
        trocaVelha.conflict.reason === "stale_preimage" &&
        trocaVelha.conflict.target === "credential.passwordHash",
      `kind=${trocaVelha.kind}`,
    );
    const [aposStale] = await q<{ password_hash: string }>(
      `SELECT password_hash FROM "user_password_credentials" WHERE user_id = ${aliceId}`,
    );
    record(
      29,
      "pre-imagem divergente NAO escreve (sem last-write-wins)",
      aposStale!.password_hash === HASH_2,
      "hash intacto",
    );

    // O caso que importa e "usuario EXISTE, credencial NAO existe" — usar um
    // usuario inexistente testaria outra coisa (e passaria pelo mesmo caminho
    // por acidente). Um usuario recem-criado, ainda sem credencial, e o cenario
    // real de um cadastro interrompido no meio.
    const semCredencial = await identities.create(SCOPE, {
      email: "sem-credencial@example.test",
      emailNormalized: "sem-credencial@example.test",
      displayName: null,
    });
    if (semCredencial.kind !== "created") throw new Error("setup de sem-credencial falhou");
    const trocaSemCredencial = await credentials.replaceByPreimage(SCOPE, {
      userId: semCredencial.identity.id,
      expectedPasswordHash: HASH_1,
      nextPasswordHash: HASH_2,
      nextAlgorithm: ALG_PORT,
    });
    record(
      30,
      "CAS em usuario EXISTENTE sem credencial e not_found (distinto de conflito)",
      trocaSemCredencial.kind === "not_found",
      `kind=${trocaSemCredencial.kind}`,
    );

    // Usuario inexistente cai no MESMO resultado: o contrato de replace nao
    // separa "sem usuario" de "sem credencial" (ao contrario de createInitial,
    // que tem user_not_found). Registrado para que a ausencia da distincao seja
    // uma escolha visivel, nao uma descoberta futura.
    const trocaSemUsuario = await credentials.replaceByPreimage(SCOPE, {
      userId: 999999n,
      expectedPasswordHash: HASH_1,
      nextPasswordHash: HASH_2,
      nextAlgorithm: ALG_PORT,
    });
    record(
      41,
      "CAS em usuario INEXISTENTE colapsa no mesmo not_found (contrato nao separa)",
      trocaSemUsuario.kind === "not_found",
      `kind=${trocaSemUsuario.kind}`,
    );

    // DISPUTA no CAS: duas trocas com a MESMA pre-imagem. O vencedor unico vem
    // do WHERE da pre-imagem, nao do entrelacamento.
    const corridaCas = await Promise.all([
      credentials.replaceByPreimage(SCOPE, {
        userId: aliceId,
        expectedPasswordHash: HASH_2,
        nextPasswordHash: HASH_1,
        nextAlgorithm: "scrypt",
      }),
      credentials.replaceByPreimage(SCOPE, {
        userId: aliceId,
        expectedPasswordHash: HASH_2,
        nextPasswordHash: HASH_3,
        nextAlgorithm: "scrypt",
      }),
    ]);
    const atualizadas = corridaCas.filter((r) => r.kind === "updated").length;
    const stale = corridaCas.filter(
      (r) => r.kind === "conflict" && r.conflict.reason === "stale_preimage",
    ).length;
    record(
      31,
      "disputa no CAS: 1 vence, 1 recebe stale_preimage",
      atualizadas === 1 && stale === 1,
      `updated=${atualizadas} stale=${stale}`,
    );

    const [final] = await q<{ password_hash: string }>(
      `SELECT password_hash FROM "user_password_credentials" WHERE user_id = ${aliceId}`,
    );
    record(
      32,
      "o valor final e UM dos dois novos hashes (nunca mistura)",
      final!.password_hash === HASH_1 || final!.password_hash === HASH_3,
      "estado coerente",
    );

    const [contagem] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "user_password_credentials" WHERE user_id = ${aliceId}`,
    );
    record(
      33,
      "nenhuma linha duplicada de credencial",
      Number(contagem!.c) === 1,
      `linhas=${Number(contagem!.c)}`,
    );

    // DISPUTA na criacao inicial: duas simultaneas para o mesmo usuario.
    const criadoBob = await identities.create(SCOPE, {
      email: "bob@example.test",
      emailNormalized: "bob@example.test",
      displayName: null,
    });
    if (criadoBob.kind !== "created") throw new Error("setup de bob falhou");
    const corridaCred = await Promise.all([
      credentials.createInitial(SCOPE, {
        userId: criadoBob.identity.id,
        passwordHash: HASH_1,
        algorithm: "scrypt",
      }),
      credentials.createInitial(SCOPE, {
        userId: criadoBob.identity.id,
        passwordHash: HASH_2,
        algorithm: "scrypt",
      }),
    ]);
    const [linhasBob] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "user_password_credentials" WHERE user_id = ${criadoBob.identity.id}`,
    );
    record(
      34,
      "disputa: so 1 credencial inicial sobrevive",
      corridaCred.filter((r) => r.kind === "created").length === 1 &&
        corridaCred.filter((r) => r.kind === "already_exists").length === 1 &&
        Number(linhasBob!.c) === 1,
      `linhas=${Number(linhasBob!.c)}`,
    );

    // -----------------------------------------------------------------------
    // TRANSACAO: os DOIS adapters no mesmo escopo, e rollback conjunto
    // -----------------------------------------------------------------------
    let commitOk = false;
    await prisma.$transaction(async (tx) => {
      const txIdentities = createPrismaIdentityStore(tx);
      const txCredentials = createPrismaPasswordCredentialStore(tx);
      const r = await txIdentities.create(SCOPE, {
        email: "tx-ok@example.test",
        emailNormalized: "tx-ok@example.test",
        displayName: null,
      });
      if (r.kind !== "created") return;
      const c = await txCredentials.createInitial(SCOPE, {
        userId: r.identity.id,
        passwordHash: HASH_1,
        algorithm: "scrypt",
      });
      commitOk = c.kind === "created";
    });
    const [txOkRow] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "users" WHERE email_normalized = 'tx-ok@example.test'`,
    );
    record(
      35,
      "os DOIS adapters aceitam o client de TRANSACAO e comitam juntos",
      commitOk && Number(txOkRow!.c) === 1,
      `linhas=${Number(txOkRow!.c)}`,
    );

    let rollbackDisparou = false;
    try {
      await prisma.$transaction(async (tx) => {
        const txIdentities = createPrismaIdentityStore(tx);
        const txCredentials = createPrismaPasswordCredentialStore(tx);
        const r = await txIdentities.create(SCOPE, {
          email: "tx-rollback@example.test",
          emailNormalized: "tx-rollback@example.test",
          displayName: null,
        });
        if (r.kind !== "created") throw new Error("setup do rollback falhou");
        await txCredentials.createInitial(SCOPE, {
          userId: r.identity.id,
          passwordHash: HASH_1,
          algorithm: "scrypt",
        });
        // Falha DEPOIS da credencial: as duas escritas devem sumir.
        throw new Error("falha proposital apos a credencial");
      });
    } catch {
      rollbackDisparou = true;
    }
    const [txRollbackRow] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "users" WHERE email_normalized = 'tx-rollback@example.test'`,
    );
    record(
      36,
      "erro apos a credencial desfaz identidade E credencial",
      rollbackDisparou && Number(txRollbackRow!.c) === 0,
      `linhas remanescentes=${Number(txRollbackRow!.c)}`,
    );

    // -----------------------------------------------------------------------
    // SEGREDO
    // -----------------------------------------------------------------------
    const [colunas] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'user_password_credentials' AND column_name IN ('password','plain_password','raw_password')`,
    );
    record(
      37,
      "a tabela de credencial nao tem coluna de senha em claro",
      Number(colunas!.c) === 0,
      `colunas suspeitas=${Number(colunas!.c)}`,
    );

    const [hashEmUsuarios] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'users' AND column_name LIKE '%password%'`,
    );
    record(
      38,
      "a tabela de identidade nao guarda hash (separacao de tabelas)",
      Number(hashEmUsuarios!.c) === 0,
      `colunas=${Number(hashEmUsuarios!.c)}`,
    );

    // -----------------------------------------------------------------------
    // CONFLITO ESPERADO NAO ENVENENA A TRANSACAO (C7B1.1)
    //
    // Ate C7B1 estes checks CARACTERIZAVAM o defeito: um conflito capturado
    // deixava a transacao abortada. Agora eles verificam o oposto — que a
    // transacao continua utilizavel e comita de verdade. A fixture negativa no
    // fim prova que o padrao antigo AINDA seria punido pelo banco, para que
    // estes checks nao possam ficar verdes por acidente.
    // -----------------------------------------------------------------------
    let identidadeTx: {
      conflito: string;
      alvo: string | undefined;
      leuDepois: boolean;
      criouDepois: string;
    } | null = null;
    let erroIdentidadeTx: string | null = null;
    try {
      identidadeTx = await prisma.$transaction(async (tx) => {
        const txIdentities = createPrismaIdentityStore(tx);
        // 1. escrita valida ANTES do conflito
        const antes = await txIdentities.create(SCOPE, {
          email: "tx-antes@example.test",
          emailNormalized: "tx-antes@example.test",
          displayName: null,
        });
        if (antes.kind !== "created") throw new Error("setup: escrita anterior falhou");
        // 2. conflito esperado
        const colide = await txIdentities.create(SCOPE, {
          email: "Alice@Example.Test",
          emailNormalized: "alice@example.test",
          displayName: null,
        });
        // 3. query valida DEPOIS do conflito — aqui morria com 25P02
        const leitura = await txIdentities.findByNormalizedEmail(SCOPE, "tx-antes@example.test");
        // 4. outra escrita valida depois do conflito
        const depois = await txIdentities.create(SCOPE, {
          email: "tx-depois@example.test",
          emailNormalized: "tx-depois@example.test",
          displayName: null,
        });
        return {
          conflito: colide.kind,
          alvo: colide.kind === "conflict" ? colide.conflict.target : undefined,
          leuDepois: leitura.kind === "found",
          criouDepois: depois.kind,
        };
      });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      erroIdentidadeTx = typeof code === "string" ? code : (e as Error).message.slice(0, 60);
    }

    record(
      42,
      "identidade: conflito dentro de transacao devolve resultado tipado (sem 25P02)",
      erroIdentidadeTx === null && identidadeTx?.conflito === "conflict",
      `erro=${erroIdentidadeTx ?? "nenhum"} kind=${identidadeTx?.conflito ?? "-"}`,
    );
    record(
      43,
      "identidade: alvo semantico continua correto apos a mudanca de estrategia",
      identidadeTx?.alvo === "identity.emailNormalized",
      `alvo=${String(identidadeTx?.alvo)}`,
    );
    record(
      44,
      "identidade: a transacao segue USAVEL depois do conflito (leitura e escrita)",
      identidadeTx?.leuDepois === true && identidadeTx?.criouDepois === "created",
      `leu=${identidadeTx?.leuDepois} criou=${identidadeTx?.criouDepois}`,
    );

    const [antesRow] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "users" WHERE email_normalized = 'tx-antes@example.test'`,
    );
    const [depoisRow] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "users" WHERE email_normalized = 'tx-depois@example.test'`,
    );
    record(
      45,
      "identidade: COMMIT REAL — escritas ANTES e DEPOIS do conflito persistem",
      Number(antesRow!.c) === 1 && Number(depoisRow!.c) === 1,
      `antes=${Number(antesRow!.c)} depois=${Number(depoisRow!.c)}`,
    );

    // Credencial: mesmo roteiro.
    let credencialTx: { conflito: string; alvo: string | undefined; leuDepois: boolean } | null =
      null;
    let erroCredencialTx: string | null = null;
    const donoCred = await identities.create(SCOPE, {
      email: "tx-cred@example.test",
      emailNormalized: "tx-cred@example.test",
      displayName: null,
    });
    if (donoCred.kind !== "created") throw new Error("setup de tx-cred falhou");
    await credentials.createInitial(SCOPE, {
      userId: donoCred.identity.id,
      passwordHash: HASH_1,
      algorithm: ALG_PORT,
    });
    try {
      credencialTx = await prisma.$transaction(async (tx) => {
        const txCredentials = createPrismaPasswordCredentialStore(tx);
        const colide = await txCredentials.createInitial(SCOPE, {
          userId: donoCred.identity.id,
          passwordHash: HASH_2,
          algorithm: ALG_PORT,
        });
        // Query valida DEPOIS do conflito.
        const leitura = await txCredentials.findForVerification(SCOPE, donoCred.identity.id);
        return {
          conflito: colide.kind,
          alvo: colide.kind === "already_exists" ? colide.conflict.target : undefined,
          leuDepois: leitura.kind === "found" && leitura.material.passwordHash === HASH_1,
        };
      });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      erroCredencialTx = typeof code === "string" ? code : (e as Error).message.slice(0, 60);
    }
    record(
      46,
      "credencial: conflito 1:1 dentro de transacao nao aborta e mantem o alvo",
      erroCredencialTx === null &&
        credencialTx?.conflito === "already_exists" &&
        credencialTx?.alvo === "credential.user",
      `erro=${erroCredencialTx ?? "nenhum"} alvo=${String(credencialTx?.alvo)}`,
    );
    record(
      47,
      "credencial: leitura posterior ao conflito funciona e o hash NAO foi trocado",
      credencialTx?.leuDepois === true,
      `leu hash original=${credencialTx?.leuDepois}`,
    );

    // Usuario inexistente dentro de transacao: `user_not_found` sem violar FK.
    let fkTx: { kind: string; leuDepois: boolean } | null = null;
    let erroFkTx: string | null = null;
    try {
      fkTx = await prisma.$transaction(async (tx) => {
        const txCredentials = createPrismaPasswordCredentialStore(tx);
        const txIdentities = createPrismaIdentityStore(tx);
        const semDono = await txCredentials.createInitial(SCOPE, {
          userId: 999999n,
          passwordHash: HASH_1,
          algorithm: ALG_PORT,
        });
        const leitura = await txIdentities.findByNormalizedEmail(SCOPE, "alice@example.test");
        return { kind: semDono.kind, leuDepois: leitura.kind === "found" };
      });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      erroFkTx = typeof code === "string" ? code : (e as Error).message.slice(0, 60);
    }
    record(
      48,
      "credencial: user_not_found dentro de transacao nao dispara FK nem aborta",
      erroFkTx === null && fkTx?.kind === "user_not_found" && fkTx?.leuDepois === true,
      `erro=${erroFkTx ?? "nenhum"} kind=${fkTx?.kind ?? "-"}`,
    );

    // Erro INESPERADO continua escapando e desfazendo tudo.
    let erroInesperadoEscapou = false;
    try {
      await prisma.$transaction(async (tx) => {
        const txIdentities = createPrismaIdentityStore(tx);
        const ok = await txIdentities.create(SCOPE, {
          email: "tx-inesperado@example.test",
          emailNormalized: "tx-inesperado@example.test",
          displayName: null,
        });
        if (ok.kind !== "created") throw new Error("setup falhou");
        throw new Error("falha inesperada de dominio");
      });
    } catch {
      erroInesperadoEscapou = true;
    }
    const [inesperadoRow] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "users" WHERE email_normalized = 'tx-inesperado@example.test'`,
    );
    record(
      49,
      "erro inesperado continua escapando e faz ROLLBACK (nada de continuacao enganosa)",
      erroInesperadoEscapou && Number(inesperadoRow!.c) === 0,
      `escapou=${erroInesperadoEscapou} linhas=${Number(inesperadoRow!.c)}`,
    );

    // FIXTURE NEGATIVA: o padrao ABORTIVO antigo, executado de proposito.
    // Sem isto, os checks 42-48 poderiam estar verdes por qualquer motivo — este
    // prova que o banco AINDA pune create/catch dentro de transacao, e que a
    // diferenca observada vem da ESTRATEGIA, nao de o Postgres ter mudado.
    let padraoAntigoEnvenenou = false;
    try {
      await prisma.$transaction(async (tx) => {
        try {
          // `create` cru (nao `createManyAndReturn` + skipDuplicates): levanta
          // P2002 e aborta a transacao.
          await tx.user.create({
            data: { email: "Alice@Example.Test", emailNormalized: "alice@example.test" },
            select: { id: true },
          });
        } catch {
          // Exatamente o que o C7B1.1 proibiu: engolir e seguir.
        }
        await tx.user.findUnique({
          where: { emailNormalized: "alice@example.test" },
          select: { id: true },
        });
      });
    } catch {
      padraoAntigoEnvenenou = true;
    }
    record(
      50,
      "fixture negativa: o padrao create/catch AINDA envenena (a prova nao e vacua)",
      padraoAntigoEnvenenou,
      `envenenou=${padraoAntigoEnvenenou}`,
    );

    // -----------------------------------------------------------------------
    // UNIQUE NAO PREVISTA PELO CONTRATO => FALHA FECHADO
    //
    // `ON CONFLICT DO NOTHING` sem alvo absorve TODA unique da tabela, nao so a
    // que o contrato representa. Uma sequence dessincronizada (restore mal
    // feito) faz a PK colidir e devolver zero linhas — e "zero linhas" NAO pode
    // ser lido como "o e-mail ja existe" nem "o usuario ja tem credencial".
    //
    // Estes dois checks ficam por ULTIMO porque mexem nas sequences.
    // -----------------------------------------------------------------------
    // Criado ANTES de mexer em qualquer sequence: o check 52 precisa de um
    // usuario sem credencial, e monta-lo depois o tornaria refem da restauracao
    // da sequence de `users`.
    const semCred = await identities.create(SCOPE, {
      email: "pk-colisao-credencial@example.test",
      emailNormalized: "pk-colisao-credencial@example.test",
      displayName: null,
    });
    if (semCred.kind !== "created") {
      throw new Error(`setup de sem-credencial falhou: ${JSON.stringify(semCred)}`);
    }

    await exec(`SELECT setval('users_id_seq', 1, false)`);
    let identidadeFechou: string | null = null;
    try {
      const r = await identities.create(SCOPE, {
        email: "e-mail-totalmente-livre@example.test",
        emailNormalized: "e-mail-totalmente-livre@example.test",
        displayName: null,
      });
      identidadeFechou = `NAO LANCOU: ${JSON.stringify(r)}`;
    } catch (e) {
      identidadeFechou = null;
      console.log(`      [esperado] ${(e as Error).message.split("\n")[0]}`);
    }
    const [livreRow] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "users" WHERE email_normalized = 'e-mail-totalmente-livre@example.test'`,
    );
    record(
      51,
      "identidade: unique nao-e-mail falha fechado (nunca 'e-mail ja registrado' falso)",
      identidadeFechou === null && Number(livreRow!.c) === 0,
      identidadeFechou ?? "lancou como esperado",
    );
    await exec(`SELECT setval('users_id_seq', (SELECT max(id) FROM "users"))`);

    // Credencial: usuario SEM credencial + PK colidindo.
    await exec(`SELECT setval('user_password_credentials_id_seq', 1, false)`);
    let credencialFechou: string | null = null;
    try {
      const r = await credentials.createInitial(SCOPE, {
        userId: semCred.identity.id,
        passwordHash: HASH_1,
        algorithm: ALG_PORT,
      });
      credencialFechou = `NAO LANCOU: ${JSON.stringify(r)}`;
    } catch (e) {
      credencialFechou = null;
      console.log(`      [esperado] ${(e as Error).message.split("\n")[0]}`);
    }
    record(
      52,
      "credencial: unique nao-user_id falha fechado (nunca 'ja tem credencial' falso)",
      credencialFechou === null,
      credencialFechou ?? "lancou como esperado",
    );
    await exec(
      `SELECT setval('user_password_credentials_id_seq', (SELECT max(id) FROM "user_password_credentials"))`,
    );

    // -----------------------------------------------------------------------
    // LIMITE DE ISOLAMENTO: a garantia desta camada vale sob READ COMMITTED.
    //
    // Sob REPEATABLE READ o proprio `INSERT ... ON CONFLICT DO NOTHING` levanta
    // 40001 (Prisma P2034) quando a linha conflitante foi comitada depois do
    // snapshot — ou seja, o conflito volta a ser abortivo. Nao e defeito destes
    // adapters: e uma propriedade do isolamento. Fica CARACTERIZADO aqui para
    // que ninguem endureca o isolamento do cadastro sem reler a documentacao.
    // -----------------------------------------------------------------------
    let isolamentoCodigo: string | null = null;
    try {
      await prisma.$transaction(
        async (tx) => {
          const txIdentities = createPrismaIdentityStore(tx);
          // Fixa o snapshot da transacao.
          await txIdentities.findByNormalizedEmail(SCOPE, "alice@example.test");
          // Outro escopo comita a linha conflitante DEPOIS do snapshot.
          await prisma.user.create({
            data: { email: "RR@example.test", emailNormalized: "rr@example.test" },
            select: { id: true },
          });
          await txIdentities.create(SCOPE, {
            email: "RR@example.test",
            emailNormalized: "rr@example.test",
            displayName: null,
          });
        },
        { isolationLevel: "RepeatableRead" },
      );
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      isolamentoCodigo = typeof code === "string" ? code : "erro sem codigo";
    }
    record(
      53,
      "REPEATABLE READ: conflito volta a ser abortivo (garantia e de READ COMMITTED)",
      isolamentoCodigo !== null,
      `codigo=${isolamentoCodigo ?? "NENHUM (isolamento mudou; reler a doc)"}`,
    );

    // =======================================================================
    // C7B2 — SESSOES, VERIFICACAO DE E-MAIL E RECUPERACAO DE SENHA
    //
    // Nota sobre TEMPO: o schema exige `expires_at > created_at`, entao nao ha
    // como inserir algo ja expirado. A expiracao e provada avancando o `now`
    // INJETADO — que e exatamente como o dominio a avalia. Nenhum teste depende
    // do relogio real.
    // =======================================================================
    const sessions = createPrismaSessionStore(prisma);
    const authTokens = createPrismaAuthTokenStore(prisma);

    const T0 = new Date();
    const daquiA = (ms: number): Date => new Date(T0.getTime() + ms);
    const HORA = 3_600_000;

    const dono = await identities.create(SCOPE, {
      email: "c7b2@example.test",
      emailNormalized: "c7b2@example.test",
      displayName: null,
    });
    if (dono.kind !== "created") throw new Error("setup de dono do C7B2 falhou");
    const donoId = dono.identity.id;

    // ----------------------------- SESSOES ---------------------------------
    const s1 = await sessions.create(SCOPE, {
      userId: donoId,
      tokenHash: HASH_SESSAO_1,
      csrfTokenHash: HASH_CSRF_1,
      expiresAt: daquiA(HORA),
      rotatedFromSessionId: null,
      ipHash: null,
      userAgent: "agente-de-teste",
    });
    record(54, "cria sessao", s1.kind === "created", `kind=${s1.kind}`);
    if (s1.kind !== "created") throw new Error("sessao base falhou");

    const [linhaSessao] = await q<{
      token_hash: string;
      csrf_token_hash: string;
      ip_hash: string | null;
      revoked_at: Date | null;
    }>(`SELECT * FROM "user_sessions" WHERE id = ${s1.sessionId}`);
    record(
      55,
      "hashes de sessao e CSRF persistidos exatamente como recebidos",
      linhaSessao!.token_hash === HASH_SESSAO_1 && linhaSessao!.csrf_token_hash === HASH_CSRF_1,
      "hash-only",
    );
    record(
      56,
      "nenhum IP em texto claro (coluna nula quando o dominio nao envia hash)",
      linhaSessao!.ip_hash === null,
      `ip_hash=${String(linhaSessao!.ip_hash)}`,
    );

    const achadaSessao = await sessions.findByTokenHash(SCOPE, HASH_SESSAO_1);
    record(
      57,
      "lookup por hash devolve o material de decisao",
      achadaSessao.kind === "found" && achadaSessao.session.userId === donoId,
      `kind=${achadaSessao.kind}`,
    );
    record(
      58,
      "o registro de sessao NAO carrega hash algum",
      !JSON.stringify(achadaSessao, (_k, v) => (typeof v === "bigint" ? "0" : v)).includes(
        HASH_SESSAO_1,
      ),
      "sem segredo no retorno",
    );

    const sessaoAusente = await sessions.findByTokenHash(SCOPE, HASH_INEXISTENTE);
    record(
      59,
      "sessao inexistente e not_found",
      sessaoAusente.kind === "not_found",
      `kind=${sessaoAusente.kind}`,
    );

    // Expirada: o adapter NAO filtra; o dominio decide com `now`.
    const expirouPeloDominio =
      achadaSessao.kind === "found" &&
      evaluateSessionAccess({
        now: daquiA(2 * HORA),
        session: achadaSessao.session,
        userStatus: "active",
      }).publicResult.ok === false;
    record(
      60,
      "sessao vencida nao autentica (decidido pelo DOMINIO, com now avancado)",
      expirouPeloDominio,
      "evaluateSessionAccess recusou",
    );

    const ativaAgora =
      achadaSessao.kind === "found" &&
      evaluateSessionAccess({
        now: daquiA(60_000),
        session: achadaSessao.session,
        userStatus: "active",
      }).publicResult.ok === true;
    record(61, "sessao vigente autentica (controle positivo)", ativaAgora, "acesso concedido");

    const naoElegivel =
      achadaSessao.kind === "found" &&
      evaluateSessionAccess({
        now: daquiA(60_000),
        session: achadaSessao.session,
        userStatus: "disabled",
      }).publicResult.ok === false;
    record(
      62,
      "conta desativada nao autentica mesmo com sessao vigente",
      naoElegivel,
      "fail-closed por status",
    );

    const ativas1 = await sessions.listActiveIds(SCOPE, { userId: donoId, now: daquiA(60_000) });
    record(
      63,
      "listActiveIds devolve a sessao vigente",
      ativas1.length === 1 && ativas1[0] === s1.sessionId,
      `ids=${ativas1.length}`,
    );
    const ativasDepois = await sessions.listActiveIds(SCOPE, {
      userId: donoId,
      now: daquiA(2 * HORA),
    });
    record(
      64,
      "listActiveIds respeita `now`: apos o vencimento, nenhuma ativa",
      ativasDepois.length === 0,
      `ids=${ativasDepois.length}`,
    );

    const revoga1 = await sessions.revoke(SCOPE, {
      sessionIds: [s1.sessionId],
      now: daquiA(60_000),
    });
    record(65, "revoga sessao ativa", revoga1.revokedCount === 1, `count=${revoga1.revokedCount}`);

    const revoga2 = await sessions.revoke(SCOPE, {
      sessionIds: [s1.sessionId],
      now: daquiA(120_000),
    });
    record(
      66,
      "revogar de novo e idempotente (nao conta, nao reescreve carimbo)",
      revoga2.revokedCount === 0,
      `count=${revoga2.revokedCount}`,
    );

    const revogadaLida = await sessions.findByTokenHash(SCOPE, HASH_SESSAO_1);
    const revogadaRecusa =
      revogadaLida.kind === "found" &&
      revogadaLida.session.revokedAt !== null &&
      evaluateSessionAccess({
        now: daquiA(180_000),
        session: revogadaLida.session,
        userStatus: "active",
      }).publicResult.ok === false;
    record(67, "sessao revogada nao autentica", revogadaRecusa, "recusada com carimbo");

    // Colisao de tokenHash.
    const colisao = await sessions.create(SCOPE, {
      userId: donoId,
      tokenHash: HASH_SESSAO_1,
      csrfTokenHash: HASH_CSRF_2,
      expiresAt: daquiA(HORA),
      rotatedFromSessionId: null,
      ipHash: null,
      userAgent: null,
    });
    record(
      68,
      "colisao de tokenHash e conflito tipado (alvo confirmado por leitura)",
      colisao.kind === "conflict" && colisao.conflict.target === "session.tokenHash",
      `kind=${colisao.kind}`,
    );

    // Disputa: duas criacoes com o MESMO hash.
    const disputaSessao = await Promise.all([
      sessions.create(SCOPE, {
        userId: donoId,
        tokenHash: HASH_SESSAO_2,
        csrfTokenHash: HASH_CSRF_1,
        expiresAt: daquiA(HORA),
        rotatedFromSessionId: null,
        ipHash: null,
        userAgent: null,
      }),
      sessions.create(SCOPE, {
        userId: donoId,
        tokenHash: HASH_SESSAO_2,
        csrfTokenHash: HASH_CSRF_2,
        expiresAt: daquiA(HORA),
        rotatedFromSessionId: null,
        ipHash: null,
        userAgent: null,
      }),
    ]);
    const [linhasSessao2] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "user_sessions" WHERE token_hash = '${HASH_SESSAO_2}'`,
    );
    record(
      69,
      "disputa de sessao: 1 vence, 1 conflita, 1 linha no banco",
      disputaSessao.filter((r) => r.kind === "created").length === 1 &&
        disputaSessao.filter((r) => r.kind === "conflict").length === 1 &&
        Number(linhasSessao2!.c) === 1,
      `linhas=${Number(linhasSessao2!.c)}`,
    );

    // --------------------- VERIFICACAO DE E-MAIL ---------------------------
    const emitido = await authTokens.issue(SCOPE, {
      userId: donoId,
      purpose: "email_verification",
      tokenHash: HASH_TOKEN_1,
      expiresAt: daquiA(24 * HORA),
    });
    record(70, "emite token de verificacao", emitido.kind === "issued", `kind=${emitido.kind}`);

    const [linhaToken] = await q<{ token_hash: string; consumed_at: Date | null }>(
      `SELECT token_hash, consumed_at FROM "user_verification_tokens" WHERE token_hash = '${HASH_TOKEN_1}'`,
    );
    record(
      71,
      "hash do token persistido; nada em texto claro",
      linhaToken!.token_hash === HASH_TOKEN_1 && linhaToken!.consumed_at === null,
      "hash-only, pendente",
    );

    const consumoErrado = await authTokens.consume(SCOPE, {
      tokenHash: HASH_TOKEN_1,
      purpose: "password_reset",
      now: daquiA(60_000),
    });
    record(
      72,
      "PROPOSITO ERRADO nao consome (token de verificacao nao reseta senha)",
      consumoErrado.kind === "wrong_purpose",
      `kind=${consumoErrado.kind}`,
    );

    const consumoOk = await authTokens.consume(SCOPE, {
      tokenHash: HASH_TOKEN_1,
      purpose: "email_verification",
      now: daquiA(60_000),
    });
    record(
      73,
      "consome token valido e devolve o dono",
      consumoOk.kind === "consumed" && consumoOk.userId === donoId,
      `kind=${consumoOk.kind}`,
    );

    const [aposConsumo] = await q<{ consumed_at: Date | null }>(
      `SELECT consumed_at FROM "user_verification_tokens" WHERE token_hash = '${HASH_TOKEN_1}'`,
    );
    record(
      74,
      "consumedAt gravado",
      aposConsumo!.consumed_at !== null,
      `consumed_at=${String(aposConsumo!.consumed_at)}`,
    );

    const replay = await authTokens.consume(SCOPE, {
      tokenHash: HASH_TOKEN_1,
      purpose: "email_verification",
      now: daquiA(120_000),
    });
    record(
      75,
      "USO UNICO: segunda tentativa e already_consumed",
      replay.kind === "already_consumed",
      `kind=${replay.kind}`,
    );

    const inexistente = await authTokens.consume(SCOPE, {
      tokenHash: HASH_INEXISTENTE,
      purpose: "email_verification",
      now: daquiA(60_000),
    });
    record(76, "token inexistente e not_found", inexistente.kind === "not_found", `kind=${inexistente.kind}`);

    // Expirado: `now` avancado alem do TTL.
    await authTokens.issue(SCOPE, {
      userId: donoId,
      purpose: "email_verification",
      tokenHash: HASH_TOKEN_2,
      expiresAt: daquiA(HORA),
    });
    const expirado = await authTokens.consume(SCOPE, {
      tokenHash: HASH_TOKEN_2,
      purpose: "email_verification",
      now: daquiA(2 * HORA),
    });
    record(77, "token vencido nao consome", expirado.kind === "expired", `kind=${expirado.kind}`);

    // Disputa: duas consumptions do MESMO token.
    await authTokens.issue(SCOPE, {
      userId: donoId,
      purpose: "email_verification",
      tokenHash: HASH_TOKEN_3,
      expiresAt: daquiA(24 * HORA),
    });
    const disputaToken = await Promise.all([
      authTokens.consume(SCOPE, {
        tokenHash: HASH_TOKEN_3,
        purpose: "email_verification",
        now: daquiA(60_000),
      }),
      authTokens.consume(SCOPE, {
        tokenHash: HASH_TOKEN_3,
        purpose: "email_verification",
        now: daquiA(60_000),
      }),
    ]);
    record(
      78,
      "disputa de consumo: exatamente 1 vence (uso unico sob concorrencia)",
      disputaToken.filter((r) => r.kind === "consumed").length === 1 &&
        disputaToken.filter((r) => r.kind === "already_consumed").length === 1,
      disputaToken.map((r) => r.kind).join(","),
    );

    // --------------------- RECUPERACAO DE SENHA ----------------------------
    await credentials.createInitial(SCOPE, {
      userId: donoId,
      passwordHash: HASH_1,
      algorithm: ALG_PORT,
    });
    await authTokens.issue(SCOPE, {
      userId: donoId,
      purpose: "password_reset",
      tokenHash: HASH_RESET_1,
      expiresAt: daquiA(2 * HORA),
    });

    // ROLLBACK: consumo + troca falham juntos.
    let resetRollbackDisparou = false;
    try {
      await prisma.$transaction(async (tx) => {
        const txTokens = createPrismaAuthTokenStore(tx);
        const txCred = createPrismaPasswordCredentialStore(tx);
        const c = await txTokens.consume(SCOPE, {
          tokenHash: HASH_RESET_1,
          purpose: "password_reset",
          now: daquiA(60_000),
        });
        if (c.kind !== "consumed") throw new Error("setup do rollback falhou");
        // A pre-imagem vem de `findForVerification` NO MESMO escopo — e assim
        // que o reset alimenta o CAS sem receber a senha atual do usuario.
        const atual = await txCred.findForVerification(SCOPE, c.userId);
        if (atual.kind !== "found") throw new Error("credencial ausente");
        throw new Error("falha proposital apos consumir o token");
      });
    } catch {
      resetRollbackDisparou = true;
    }
    const [aposRollback] = await q<{ consumed_at: Date | null }>(
      `SELECT consumed_at FROM "user_verification_tokens" WHERE token_hash = '${HASH_RESET_1}'`,
    );
    record(
      79,
      "falha apos o consumo desfaz o consumo (token volta a valer)",
      resetRollbackDisparou && aposRollback!.consumed_at === null,
      `consumed_at=${String(aposRollback!.consumed_at)}`,
    );

    // SUCESSO: consumo + troca comitam juntos.
    const reset = await prisma.$transaction(async (tx) => {
      const txTokens = createPrismaAuthTokenStore(tx);
      const txCred = createPrismaPasswordCredentialStore(tx);
      const txSessions = createPrismaSessionStore(tx);
      const c = await txTokens.consume(SCOPE, {
        tokenHash: HASH_RESET_1,
        purpose: "password_reset",
        now: daquiA(60_000),
      });
      if (c.kind !== "consumed") return { ok: false as const };
      const atual = await txCred.findForVerification(SCOPE, c.userId);
      if (atual.kind !== "found") return { ok: false as const };
      const trocou = await txCred.replaceByPreimage(SCOPE, {
        userId: c.userId,
        expectedPasswordHash: atual.material.passwordHash,
        nextPasswordHash: HASH_2,
        nextAlgorithm: ALG_PORT_NOVO,
      });
      // Reset SEMPRE derruba as sessoes e queima os demais links pendentes.
      const ativas = await txSessions.listActiveIds(SCOPE, {
        userId: c.userId,
        now: daquiA(60_000),
      });
      await txSessions.revoke(SCOPE, { sessionIds: ativas, now: daquiA(60_000) });
      const queimados = await txTokens.invalidatePending(SCOPE, {
        userId: c.userId,
        purpose: "password_reset",
        now: daquiA(60_000),
      });
      return { ok: trocou.kind === "updated", queimados: queimados.invalidatedCount };
    });
    record(
      80,
      "consumo + troca de senha comitam JUNTOS na mesma transacao",
      reset.ok === true,
      `ok=${reset.ok}`,
    );

    const [senhaFinal] = await q<{ password_hash: string }>(
      `SELECT password_hash FROM "user_password_credentials" WHERE user_id = ${donoId}`,
    );
    record(
      81,
      "hash antigo deixa de ser o atual; o novo esta persistido",
      senhaFinal!.password_hash === HASH_2,
      "credencial trocada",
    );

    const resetReplay = await authTokens.consume(SCOPE, {
      tokenHash: HASH_RESET_1,
      purpose: "password_reset",
      now: daquiA(120_000),
    });
    record(
      82,
      "token de reset e uso unico apos o commit",
      resetReplay.kind === "already_consumed",
      `kind=${resetReplay.kind}`,
    );

    const ativasPosReset = await sessions.listActiveIds(SCOPE, {
      userId: donoId,
      now: daquiA(60_000),
    });
    record(
      83,
      "reset derruba todas as sessoes vigentes",
      ativasPosReset.length === 0,
      `ativas=${ativasPosReset.length}`,
    );

    // Queima de pendentes: emite dois e invalida.
    await authTokens.issue(SCOPE, {
      userId: donoId,
      purpose: "password_reset",
      tokenHash: HASH_RESET_2,
      expiresAt: daquiA(2 * HORA),
    });
    const queima = await authTokens.invalidatePending(SCOPE, {
      userId: donoId,
      purpose: "password_reset",
      now: daquiA(60_000),
    });
    const aindaVale = await authTokens.consume(SCOPE, {
      tokenHash: HASH_RESET_2,
      purpose: "password_reset",
      now: daquiA(90_000),
    });
    record(
      84,
      "invalidatePending queima os pendentes (link antigo nao vale mais)",
      queima.invalidatedCount === 1 && aindaVale.kind === "already_consumed",
      `queimados=${queima.invalidatedCount}`,
    );

    // Verificacao de e-mail NAO e queimada pela invalidacao de reset.
    await authTokens.issue(SCOPE, {
      userId: donoId,
      purpose: "email_verification",
      tokenHash: HASH_TOKEN_4,
      expiresAt: daquiA(24 * HORA),
    });
    await authTokens.invalidatePending(SCOPE, {
      userId: donoId,
      purpose: "password_reset",
      now: daquiA(60_000),
    });
    const verificacaoIntacta = await authTokens.consume(SCOPE, {
      tokenHash: HASH_TOKEN_4,
      purpose: "email_verification",
      now: daquiA(90_000),
    });
    record(
      85,
      "queimar reset NAO afeta tokens de verificacao (purpose isola)",
      verificacaoIntacta.kind === "consumed",
      `kind=${verificacaoIntacta.kind}`,
    );

    // --------------------- TRANSACAO NAO ENVENENADA ------------------------
    let tokenTx: { conflito: string; leuDepois: boolean; criouDepois: string } | null = null;
    let erroTokenTx: string | null = null;
    try {
      tokenTx = await prisma.$transaction(async (tx) => {
        const txTokens = createPrismaAuthTokenStore(tx);
        const txSessions = createPrismaSessionStore(tx);
        // Conflito ESPERADO: hash ja emitido.
        const conflito = await txTokens.issue(SCOPE, {
          userId: donoId,
          purpose: "email_verification",
          tokenHash: HASH_TOKEN_1,
          expiresAt: daquiA(24 * HORA),
        });
        // Query valida DEPOIS do conflito — aqui morreria com 25P02.
        const leitura = await txSessions.listActiveIds(SCOPE, {
          userId: donoId,
          now: daquiA(60_000),
        });
        const depois = await txTokens.issue(SCOPE, {
          userId: donoId,
          purpose: "email_verification",
          tokenHash: HASH_TOKEN_5,
          expiresAt: daquiA(24 * HORA),
        });
        return {
          conflito: conflito.kind,
          leuDepois: Array.isArray(leitura),
          criouDepois: depois.kind,
        };
      });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      erroTokenTx = typeof code === "string" ? code : (e as Error).message.slice(0, 60);
    }
    record(
      86,
      "conflito esperado de token nao envenena a transacao",
      erroTokenTx === null && tokenTx?.conflito === "conflict" && tokenTx?.leuDepois === true,
      `erro=${erroTokenTx ?? "nenhum"} kind=${tokenTx?.conflito ?? "-"}`,
    );
    const [tokenDepoisRow] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "user_verification_tokens" WHERE token_hash = '${HASH_TOKEN_5}'`,
    );
    record(
      87,
      "COMMIT REAL apos conflito esperado (escrita posterior persiste)",
      tokenTx?.criouDepois === "issued" && Number(tokenDepoisRow!.c) === 1,
      `linhas=${Number(tokenDepoisRow!.c)}`,
    );

    const [semPlaintext] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "user_verification_tokens" WHERE token_hash !~ '^[0-9a-f]{64}$'`,
    );
    record(
      88,
      "nenhum token fora da forma sha256 hex (nada em claro no banco)",
      Number(semPlaintext!.c) === 0,
      `fora de forma=${Number(semPlaintext!.c)}`,
    );

    // Achados da revisao adversarial do C7B2, agora travados em banco real.
    const rotBase = await sessions.create(SCOPE, {
      userId: donoId,
      tokenHash: HASH_ROT_BASE,
      csrfTokenHash: HASH_CSRF_1,
      expiresAt: daquiA(HORA),
      rotatedFromSessionId: null,
      ipHash: null,
      userAgent: null,
    });
    if (rotBase.kind !== "created") throw new Error("setup de rotacao falhou");
    const rot1 = await sessions.create(SCOPE, {
      userId: donoId,
      tokenHash: HASH_ROT_1,
      csrfTokenHash: HASH_CSRF_1,
      expiresAt: daquiA(HORA),
      rotatedFromSessionId: rotBase.sessionId,
      ipHash: null,
      userAgent: null,
    });
    // Segunda rotacao da MESMA origem: duplo clique, aba paralela, retry.
    const rot2 = await sessions.create(SCOPE, {
      userId: donoId,
      tokenHash: HASH_ROT_2,
      csrfTokenHash: HASH_CSRF_1,
      expiresAt: daquiA(HORA),
      rotatedFromSessionId: rotBase.sessionId,
      ipHash: null,
      userAgent: null,
    });
    record(
      89,
      "rotacao concorrente da mesma origem e CONFLITO tipado, nao excecao",
      rot1.kind === "created" &&
        rot2.kind === "conflict" &&
        rot2.conflict.target === "session.rotatedFrom",
      `1a=${rot1.kind} 2a=${rot2.kind}`,
    );

    // IP CRU: o banco nao tem CHECK em `ip_hash`; o adapter e a ultima linha.
    let ipCruBarrado = false;
    try {
      await sessions.create(SCOPE, {
        userId: donoId,
        tokenHash: HASH_IP_CRU,
        csrfTokenHash: HASH_CSRF_1,
        expiresAt: daquiA(HORA),
        rotatedFromSessionId: null,
        ipHash: "192.168.0.1",
        userAgent: null,
      });
    } catch {
      ipCruBarrado = true;
    }
    const [linhasIpCru] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "user_sessions" WHERE ip_hash = '192.168.0.1'`,
    );
    record(
      90,
      "IP em texto claro e barrado ANTES do disco (fail-closed no adapter)",
      ipCruBarrado && Number(linhasIpCru!.c) === 0,
      `barrado=${ipCruBarrado} linhas=${Number(linhasIpCru!.c)}`,
    );

    // =======================================================================
    // C7B2.1 — IDENTIDADE FECHADA PARA AUTENTICACAO
    // =======================================================================
    const naoVerificado = await identities.create(SCOPE, {
      email: "c7b21@example.test",
      emailNormalized: "c7b21@example.test",
      displayName: null,
    });
    if (naoVerificado.kind !== "created") throw new Error("setup do C7B2.1 falhou");
    const alvoId = naoVerificado.identity.id;

    const porId = await identities.findById(SCOPE, alvoId);
    record(
      91,
      "findById devolve a identidade com o status",
      porId.kind === "found" && porId.identity.id === alvoId && porId.identity.status === "active",
      `kind=${porId.kind}`,
    );
    record(
      92,
      "findById devolve EXATAMENTE id e status (sem PII, sem segredo)",
      porId.kind === "found" &&
        JSON.stringify(Object.keys(porId.identity).sort()) === JSON.stringify(["id", "status"]),
      porId.kind === "found" ? Object.keys(porId.identity).sort().join(",") : "-",
    );

    const idAusente = await identities.findById(SCOPE, 999999n);
    record(93, "findById ausente e not_found", idAusente.kind === "not_found", `kind=${idAusente.kind}`);

    // Conta desativada continua sendo ENCONTRADA: quem decide e o dominio.
    await exec(`UPDATE "users" SET status = 'disabled' WHERE id = ${alvoId}`);
    const desativado = await identities.findById(SCOPE, alvoId);
    record(
      94,
      "findById NAO filtra conta desativada (elegibilidade e do dominio)",
      desativado.kind === "found" && desativado.identity.status === "disabled",
      `status=${desativado.kind === "found" ? desativado.identity.status : "-"}`,
    );
    await exec(`UPDATE "users" SET status = 'active' WHERE id = ${alvoId}`);

    // --------------------- SESSAO + IDENTIDADE -----------------------------
    const sessaoAlvo = await sessions.create(SCOPE, {
      userId: alvoId,
      tokenHash: HASH_SESSAO_ALVO,
      csrfTokenHash: HASH_CSRF_1,
      expiresAt: daquiA(HORA),
      rotatedFromSessionId: null,
      ipHash: null,
      userAgent: null,
    });
    if (sessaoAlvo.kind !== "created") throw new Error("setup de sessao do C7B2.1 falhou");

    /** Composicao real: lookup de sessao + lookup de identidade + decisao pura. */
    async function autentica(now: Date): Promise<boolean> {
      const s = await sessions.findByTokenHash(SCOPE, HASH_SESSAO_ALVO);
      if (s.kind !== "found") return false;
      const u = await identities.findById(SCOPE, s.session.userId);
      const status = u.kind === "found" ? u.identity.status : null;
      return evaluateSessionAccess({ now, session: s.session, userStatus: status }).publicResult.ok;
    }

    record(
      95,
      "sessao ativa + usuario ativo AUTENTICA (composicao fecha)",
      await autentica(daquiA(60_000)),
      "acesso concedido",
    );

    // E-mail NAO verificado nao pode bloquear login.
    const [aindaNaoVerificado] = await q<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM "users" WHERE id = ${alvoId}`,
    );
    record(
      96,
      "e-mail NAO verificado nao bloqueia autenticacao por sessao",
      aindaNaoVerificado!.email_verified_at === null && (await autentica(daquiA(60_000))),
      "login permitido sem verificacao",
    );

    await exec(`UPDATE "users" SET status = 'disabled' WHERE id = ${alvoId}`);
    record(
      97,
      "sessao ativa + usuario DESATIVADO nao autentica (fail-closed)",
      !(await autentica(daquiA(60_000))),
      "acesso negado por status",
    );
    await exec(`UPDATE "users" SET status = 'active' WHERE id = ${alvoId}`);

    record(
      98,
      "sessao VENCIDA nao autentica mesmo com usuario ativo",
      !(await autentica(daquiA(2 * HORA))),
      "acesso negado por expiracao",
    );

    // ------------------- VERIFICACAO DE E-MAIL -----------------------------
    const marcou = await identities.markEmailVerified(SCOPE, {
      userId: alvoId,
      now: daquiA(60_000),
    });
    record(99, "marca e-mail como verificado", marcou.kind === "verified", `kind=${marcou.kind}`);

    const [carimbo1] = await q<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM "users" WHERE id = ${alvoId}`,
    );
    record(
      100,
      "carimbo persistido exatamente como recebido",
      carimbo1!.email_verified_at?.getTime() === daquiA(60_000).getTime(),
      `carimbo=${String(carimbo1!.email_verified_at?.toISOString())}`,
    );

    const remarcou = await identities.markEmailVerified(SCOPE, {
      userId: alvoId,
      now: daquiA(120_000),
    });
    const [carimbo2] = await q<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM "users" WHERE id = ${alvoId}`,
    );
    record(
      101,
      "remarcar e IDEMPOTENTE e PRESERVA o primeiro carimbo",
      remarcou.kind === "already_verified" &&
        carimbo2!.email_verified_at?.getTime() === carimbo1!.email_verified_at?.getTime(),
      `kind=${remarcou.kind} carimbo intacto=${carimbo2!.email_verified_at?.getTime() === carimbo1!.email_verified_at?.getTime()}`,
    );

    const marcaAusente = await identities.markEmailVerified(SCOPE, {
      userId: 999999n,
      now: daquiA(60_000),
    });
    record(
      102,
      "marcar conta inexistente e not_found (distinto de already_verified)",
      marcaAusente.kind === "not_found",
      `kind=${marcaAusente.kind}`,
    );

    // Disputa: duas marcacoes simultaneas do MESMO usuario nao verificado.
    const disputaAlvo = await identities.create(SCOPE, {
      email: "disputa-verif@example.test",
      emailNormalized: "disputa-verif@example.test",
      displayName: null,
    });
    if (disputaAlvo.kind !== "created") throw new Error("setup da disputa falhou");
    const disputaMarcacao = await Promise.all([
      identities.markEmailVerified(SCOPE, { userId: disputaAlvo.identity.id, now: daquiA(60_000) }),
      identities.markEmailVerified(SCOPE, { userId: disputaAlvo.identity.id, now: daquiA(90_000) }),
    ]);
    const [carimboDisputa] = await q<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM "users" WHERE id = ${disputaAlvo.identity.id}`,
    );
    record(
      103,
      "disputa de marcacao: exatamente 1 grava, e o carimbo e o da vencedora",
      disputaMarcacao.filter((r) => r.kind === "verified").length === 1 &&
        disputaMarcacao.filter((r) => r.kind === "already_verified").length === 1 &&
        carimboDisputa!.email_verified_at !== null,
      disputaMarcacao.map((r) => r.kind).join(","),
    );

    // ---------- CONSUMO DO TOKEN + MARCACAO NA MESMA TRANSACAO -------------
    const verifAlvo = await identities.create(SCOPE, {
      email: "verif-tx@example.test",
      emailNormalized: "verif-tx@example.test",
      displayName: null,
    });
    if (verifAlvo.kind !== "created") throw new Error("setup de verif-tx falhou");
    const verifId = verifAlvo.identity.id;

    await authTokens.issue(SCOPE, {
      userId: verifId,
      purpose: "email_verification",
      tokenHash: HASH_VERIF_TX,
      expiresAt: daquiA(24 * HORA),
    });

    // ROLLBACK: falha depois do consumo desfaz consumo E marcacao.
    let verifRollback = false;
    try {
      await prisma.$transaction(async (tx) => {
        const txTokens = createPrismaAuthTokenStore(tx);
        const txIdentities = createPrismaIdentityStore(tx);
        const c = await txTokens.consume(SCOPE, {
          tokenHash: HASH_VERIF_TX,
          purpose: "email_verification",
          now: daquiA(60_000),
        });
        if (c.kind !== "consumed") throw new Error("setup do rollback de verificacao falhou");
        const m = await txIdentities.markEmailVerified(SCOPE, {
          userId: c.userId,
          now: daquiA(60_000),
        });
        if (m.kind !== "verified") throw new Error("marcacao inesperada");
        throw new Error("falha proposital apos consumir e marcar");
      });
    } catch {
      verifRollback = true;
    }
    const [tokenAposRollback] = await q<{ consumed_at: Date | null }>(
      `SELECT consumed_at FROM "user_verification_tokens" WHERE token_hash = '${HASH_VERIF_TX}'`,
    );
    const [userAposRollback] = await q<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM "users" WHERE id = ${verifId}`,
    );
    record(
      104,
      "falha apos consumir+marcar desfaz OS DOIS efeitos",
      verifRollback &&
        tokenAposRollback!.consumed_at === null &&
        userAposRollback!.email_verified_at === null,
      `token pendente=${tokenAposRollback!.consumed_at === null} usuario nao verificado=${userAposRollback!.email_verified_at === null}`,
    );

    // SUCESSO: os dois efeitos comitam juntos.
    const verifOk = await prisma.$transaction(async (tx) => {
      const txTokens = createPrismaAuthTokenStore(tx);
      const txIdentities = createPrismaIdentityStore(tx);
      const c = await txTokens.consume(SCOPE, {
        tokenHash: HASH_VERIF_TX,
        purpose: "email_verification",
        now: daquiA(60_000),
      });
      if (c.kind !== "consumed") return { ok: false as const };
      const m = await txIdentities.markEmailVerified(SCOPE, {
        userId: c.userId,
        now: daquiA(60_000),
      });
      return { ok: m.kind === "verified" };
    });
    const [tokenFinal] = await q<{ consumed_at: Date | null }>(
      `SELECT consumed_at FROM "user_verification_tokens" WHERE token_hash = '${HASH_VERIF_TX}'`,
    );
    const [userFinal] = await q<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM "users" WHERE id = ${verifId}`,
    );
    record(
      105,
      "consumo do token + marcacao comitam JUNTOS",
      verifOk.ok &&
        tokenFinal!.consumed_at !== null &&
        userFinal!.email_verified_at !== null,
      `ok=${verifOk.ok}`,
    );

    const verifReplay = await authTokens.consume(SCOPE, {
      tokenHash: HASH_VERIF_TX,
      purpose: "email_verification",
      now: daquiA(120_000),
    });
    record(
      106,
      "token de verificacao e uso unico apos o commit",
      verifReplay.kind === "already_consumed",
      `kind=${verifReplay.kind}`,
    );

    // Token de RESET nao verifica e-mail; e a transacao segue utilizavel.
    const naoVerif = await identities.create(SCOPE, {
      email: "nao-verif@example.test",
      emailNormalized: "nao-verif@example.test",
      displayName: null,
    });
    if (naoVerif.kind !== "created") throw new Error("setup de nao-verif falhou");
    await authTokens.issue(SCOPE, {
      userId: naoVerif.identity.id,
      purpose: "password_reset",
      tokenHash: HASH_RESET_VERIF,
      expiresAt: daquiA(2 * HORA),
    });
    let purposeErradoNaoVerificou = false;
    let erroPurposeTx: string | null = null;
    try {
      purposeErradoNaoVerificou = await prisma.$transaction(async (tx) => {
        const txTokens = createPrismaAuthTokenStore(tx);
        const txIdentities = createPrismaIdentityStore(tx);
        const c = await txTokens.consume(SCOPE, {
          tokenHash: HASH_RESET_VERIF,
          purpose: "email_verification",
          now: daquiA(60_000),
        });
        if (c.kind === "consumed") return false;
        // A transacao continua utilizavel depois do outcome esperado.
        const u = await txIdentities.findById(SCOPE, naoVerif.identity.id);
        return c.kind === "wrong_purpose" && u.kind === "found";
      });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      erroPurposeTx = typeof code === "string" ? code : (e as Error).message.slice(0, 60);
    }
    const [naoVerifRow] = await q<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM "users" WHERE id = ${naoVerif.identity.id}`,
    );
    record(
      107,
      "token de password_reset NAO verifica e-mail, e a transacao segue usavel",
      erroPurposeTx === null &&
        purposeErradoNaoVerificou &&
        naoVerifRow!.email_verified_at === null,
      `erro=${erroPurposeTx ?? "nenhum"} usuario nao verificado=${naoVerifRow!.email_verified_at === null}`,
    );

    // Token inexistente e token expirado tambem nao verificam.
    const tokenInexistente = await authTokens.consume(SCOPE, {
      tokenHash: HASH_INEXISTENTE,
      purpose: "email_verification",
      now: daquiA(60_000),
    });
    await authTokens.issue(SCOPE, {
      userId: naoVerif.identity.id,
      purpose: "email_verification",
      tokenHash: HASH_VERIF_EXPIRADO,
      expiresAt: daquiA(HORA),
    });
    const tokenVencido = await authTokens.consume(SCOPE, {
      tokenHash: HASH_VERIF_EXPIRADO,
      purpose: "email_verification",
      now: daquiA(2 * HORA),
    });
    const [aindaNaoVerif] = await q<{ email_verified_at: Date | null }>(
      `SELECT email_verified_at FROM "users" WHERE id = ${naoVerif.identity.id}`,
    );
    record(
      108,
      "token inexistente e token vencido nao verificam ninguem",
      tokenInexistente.kind === "not_found" &&
        tokenVencido.kind === "expired" &&
        aindaNaoVerif!.email_verified_at === null,
      `inexistente=${tokenInexistente.kind} vencido=${tokenVencido.kind}`,
    );

    // `already_verified` e outcome ESPERADO: nao envenena a transacao.
    let jaVerificadoTx: { kind: string; leuDepois: boolean } | null = null;
    let erroJaVerificado: string | null = null;
    try {
      jaVerificadoTx = await prisma.$transaction(async (tx) => {
        const txIdentities = createPrismaIdentityStore(tx);
        const m = await txIdentities.markEmailVerified(SCOPE, {
          userId: verifId,
          now: daquiA(180_000),
        });
        const u = await txIdentities.findById(SCOPE, verifId);
        return { kind: m.kind, leuDepois: u.kind === "found" };
      });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      erroJaVerificado = typeof code === "string" ? code : (e as Error).message.slice(0, 60);
    }
    record(
      109,
      "already_verified nao envenena a transacao (query posterior funciona)",
      erroJaVerificado === null &&
        jaVerificadoTx?.kind === "already_verified" &&
        jaVerificadoTx?.leuDepois === true,
      `erro=${erroJaVerificado ?? "nenhum"} kind=${jaVerificadoTx?.kind ?? "-"}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-c7b1-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  console.log(
    `\n=== C7B1+C7B2 — adapters Prisma de identidade, credencial, sessao e tokens | Postgres 16 efemero :${port} (postgres:****) ===\n`,
  );

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("c7b1");
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/c7b1?schema=public`;

    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
      cwd: dbDir,
    });
    record(0, "todas as migrations aplicam em banco vazio", true, "migrate deploy ok");

    await runChecks(url);
  } catch (e) {
    record(99, "execucao", false, (e as Error).message.split("\n")[0] ?? "erro");
  } finally {
    if (started) {
      try {
        await pg.stop();
      } catch (e) {
        console.warn(`[cleanup] pg.stop: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    await safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado e dir temporario removido ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Adapters de identidade, credencial, sessao e tokens validados em PostgreSQL 16 real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
