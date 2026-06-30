#!/usr/bin/env node
/**
 * bin/smoke-gemini.ts — Smoke MANUAL do Gemini REAL para o Entity Writer. EXCLUIDO do typecheck.
 *
 * Worker-only/offline — NUNCA no render. Responde: "com uma entidade real do
 * banco, o Gemini real devolve JSON valido e passa pela validacao?". Monta o
 * payload controlado (PayloadSource real), chama o Gemini REAL e roda
 * `runGeneration`. NAO persiste nada por padrao: NAO salva content_block, NAO
 * grava log, NAO finaliza/cria job, NAO publica e NAO altera o banco.
 *
 * SEGURANCA: exige `--confirm-live` para chamar a API externa; sem ela, aborta
 * ANTES de qualquer chamada (e antes de abrir conexao com o banco). O resumo
 * nunca imprime a `GEMINI_API_KEY`, o payload completo, nem a resposta crua.
 *
 * Uso:
 *   tsx services/entity-writer/bin/smoke-gemini.ts --entity-type movie --entity-id 123 --language pt-BR --confirm-live
 *   tsx services/entity-writer/bin/smoke-gemini.ts --entity-type tv --entity-id 456 --language pt-BR --confirm-live
 *
 * Env (worker-only; nunca no front): DATABASE_URL, GEMINI_API_KEY, GEMINI_MODEL.
 */

import { disconnectPrisma } from "@screena/db/server";
import { createGeminiAdapterFromEnv } from "../src/gemini/adapter.js";
import { createEntityWriterPersistence } from "../src/persistence/index.js";
import {
  formatSmokeError,
  parseSmokeGeminiArgs,
  resolveSmokeGeminiOptions,
  runSmokeGemini,
} from "../src/smoke/smoke-gemini.js";

/** Env obrigatorias (presenca; valores NUNCA sao impressos). */
const REQUIRED_ENV = ["DATABASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL"] as const;

async function main(): Promise<void> {
  const args = parseSmokeGeminiArgs(process.argv.slice(2));
  const resolution = resolveSmokeGeminiOptions(args);

  // Guarda de uso (inclui --confirm-live): aborta ANTES de abrir banco/chamar Gemini.
  if (resolution.kind === "error") {
    console.error(`Erro: ${resolution.message}`);
    process.exitCode = 1;
    return;
  }

  // Presenca de env (so nomes; nunca valores). Sem env, nada externo e tocado.
  const missing = REQUIRED_ENV.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === "";
  });
  if (missing.length > 0) {
    console.error(`Erro: variavel(is) de ambiente ausente(s): ${missing.join(", ")} (worker-only; defina em env var).`);
    process.exitCode = 1;
    return;
  }

  console.warn("[smoke-gemini] AVISO: chama a API REAL do Gemini. Nada e persistido (sem content_block/log/job).");

  // payloadSource real (Prisma); as demais portas NAO sao passadas ao smoke.
  const persistence = createEntityWriterPersistence();
  try {
    const report = await runSmokeGemini(
      { payloadSource: persistence.payloadSource, gemini: createGeminiAdapterFromEnv() },
      resolution.options,
    );
    console.log(JSON.stringify(report, null, 2));
    // Exit code reflete o smoke: 1 se a validacao falhou ou o JSON foi invalido.
    process.exitCode = report.validationFailed || !report.jsonValid ? 1 : 0;
  } catch (error) {
    console.error(formatSmokeError(error));
    process.exitCode = 1;
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  // Rede de seguranca final: formata sem vazar chave/segredo.
  console.error(formatSmokeError(error));
  process.exitCode = 1;
});
