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
    // PRE-CONDICAO PARA A COMPOSICAO (C7C): conflito engolido ENVENENA a
    // transacao.
    //
    // Estes dois checks nao validam uma decisao desta unidade — CARACTERIZAM um
    // comportamento do Postgres que a composicao futura precisa conhecer. Um
    // conflito convertido em valor pelo adapter nao "desfaz" o erro no banco: o
    // Prisma nao emite SAVEPOINT por statement, entao a transacao fica abortada.
    //
    // Se um dia o driver passar a isolar cada statement, ESTES CHECKS FALHAM —
    // de proposito. E o gatilho para reler a pre-condicao registrada em
    // `executor.ts` antes que alguem escreva a composicao confiando nela.
    // -----------------------------------------------------------------------
    let erroAposConflito: string | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        const txCredentials = createPrismaPasswordCredentialStore(tx);
        // Alice ja tem credencial: P2002 e capturado e vira valor de contrato.
        const conflito = await txCredentials.createInitial(SCOPE, {
          userId: aliceId,
          passwordHash: HASH_1,
          algorithm: ALG_PORT,
        });
        if (conflito.kind !== "already_exists") {
          throw new Error("setup: esperava already_exists");
        }
        // Chamada SEGUINTE no mesmo escopo — e aqui que a transacao ja morreu.
        await txCredentials.findForVerification(SCOPE, aliceId);
      });
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const primeiraLinha =
        String((e as Error).message ?? "")
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.length > 0) ?? (e as object).constructor.name;
      erroAposConflito = typeof code === "string" ? code : primeiraLinha.slice(0, 60);
    }
    record(
      42,
      "conflito engolido ABORTA a transacao: a chamada seguinte nao devolve contrato",
      erroAposConflito !== null,
      `erro observado=${erroAposConflito ?? "NENHUM (driver mudou; reler executor.ts)"}`,
    );

    // Variante mais perigosa: ninguem lanca, e o COMMIT vira ROLLBACK silencioso.
    let conflitoEngolido = false;
    try {
      await prisma.$transaction(async (tx) => {
        const txIdentities = createPrismaIdentityStore(tx);
        const ok = await txIdentities.create(SCOPE, {
          email: "tx-veneno@example.test",
          emailNormalized: "tx-veneno@example.test",
          displayName: null,
        });
        const colide = await txIdentities.create(SCOPE, {
          email: "Alice@Example.Test",
          emailNormalized: "alice@example.test",
          displayName: null,
        });
        conflitoEngolido = ok.kind === "created" && colide.kind === "conflict";
      });
    } catch {
      // Se o driver passar a rejeitar aqui, o check abaixo acusa a mudanca.
    }
    const [venenoRow] = await q<{ c: bigint }>(
      `SELECT count(*) AS c FROM "users" WHERE email_normalized = 'tx-veneno@example.test'`,
    );
    record(
      43,
      "apos conflito engolido, a escrita anterior NAO persiste (rollback silencioso)",
      conflitoEngolido && Number(venenoRow!.c) === 0,
      `conflito=${conflitoEngolido} linhas=${Number(venenoRow!.c)}`,
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
    `\n=== C7B1 — adapters Prisma de identidade e credencial | Postgres 16 efemero :${port} (postgres:****) ===\n`,
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
  console.log("Resultado: PASSOU. Adapters de identidade e credencial validados em PostgreSQL 16 real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
