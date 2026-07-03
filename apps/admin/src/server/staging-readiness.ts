/**
 * staging-readiness.ts — Coleta de fatos de PRONTIDAO DE STAGING. SERVER-ONLY,
 * SOMENTE LEITURA.
 *
 * Junta os sinais necessarios para o checklist de staging e delega a avaliacao
 * ao lib PURO `../lib/staging-readiness`. NUNCA escreve, NUNCA publica, NUNCA
 * chama API externa.
 *
 * SEGURANCA. A leitura de env sensivel (`ADMIN_BASIC_AUTH_*`) fica encapsulada em
 * `getAdminSecurityDiagnostics()` (helper server-only da Fase 6C), que ja devolve
 * so a projecao REDIGIDA (booleans/rotulos, nunca usuario/senha). Este helper NAO
 * referencia nenhum nome de env de credencial nem `DATABASE_URL`; consome apenas
 * o diagnostico redigido. As contagens do banco vem de `getDashboardData()` (o
 * agregado read-only ja existente), embrulhado em try/catch para reportar
 * conectividade sem vazar stacktrace/erro.
 *
 * NAO usa raw SQL, NAO usa `console`, NAO usa `fetch`. A unica leitura de banco e
 * indireta, via helper agregado bounded (count/groupBy), nunca corpo/conteudo.
 */

import { cache } from "react";

import {
  buildStagingSeedPlan,
  formatSeedPlan,
  STAGING_SEED_CONFIRM_ENV,
  STAGING_SEED_CONFIRM_VALUE,
  STAGING_SEED_MARKER,
  STAGING_SEED_SLUG_PREFIX,
  type SeedRecordCount,
} from "../lib/staging-seed-plan";
import {
  evaluateStagingReadiness,
  runtimeKindLabel,
  type StagingDatabaseFacts,
  type StagingReadinessReport,
} from "../lib/staging-readiness";
import { getDashboardData } from "./dashboard";
import { getAdminSecurityDiagnostics } from "./security";

/** Projecao de seed segura para exibir (so agregados/rotulos, sem execucao). */
export interface StagingSeedView {
  readonly marker: string;
  readonly slugPrefix: string;
  readonly recordCount: SeedRecordCount;
  readonly confirmEnv: string;
  readonly confirmValue: string;
  readonly planLines: readonly string[];
}

/** Dados completos para a pagina de staging (todos seguros para exibir). */
export interface StagingReadinessView {
  readonly report: StagingReadinessReport;
  readonly environmentLabel: string;
  readonly nodeVersionMajor: number | null;
  readonly editorialActionsEnabled: boolean;
  readonly database: StagingDatabaseFacts | null;
  readonly seed: StagingSeedView;
}

/** Detecta o Node major a partir de `process.versions.node` (nao e segredo). */
function detectNodeMajor(): number | null {
  const raw = process.versions?.node;
  if (typeof raw !== "string") return null;
  const major = Number.parseInt(raw.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

/**
 * Le as contagens agregadas do banco (read-only) via `getDashboardData`.
 * Em falha de conectividade retorna `null` — sem log, sem stacktrace, sem vazar
 * o erro (o checklist reporta "banco nao respondeu").
 */
async function readDatabaseFacts(): Promise<StagingDatabaseFacts | null> {
  try {
    const data = await getDashboardData();
    return {
      articleRecords: data.articleRecords,
      translations: data.articles.total,
      contentBlocks: data.contentBlocks.total,
      pending: data.articleReview.pending + data.contentBlocks.pending,
      approved: data.articleReview.approved + data.contentBlocks.publishable,
      blocked: data.articles.blocked + data.contentBlocks.blocked,
      indexReadyCandidates: data.articles.publishable,
    };
  } catch {
    return null;
  }
}

/**
 * Monta a visao de prontidao de staging. Coleta fatos redigidos (env via
 * diagnostico seguro, banco via agregado read-only, Node major) e delega a
 * avaliacao ao lib puro. Nenhum campo do retorno carrega segredo.
 */
export const getStagingReadiness = cache(async (): Promise<StagingReadinessView> => {
  const { config, editorialActions } = getAdminSecurityDiagnostics();
  const nodeVersionMajor = detectNodeMajor();
  const database = await readDatabaseFacts();

  const report = evaluateStagingReadiness({
    runtimeKind: config.runtimeKind,
    productionLike: config.productionLike,
    protectionRequired: config.protectionRequired,
    protectionExplicitlyEnabled: config.protectionExplicitlyEnabled,
    hasCredentials: config.credentialsConfigured,
    editorialActionsEnabled: editorialActions.enabled,
    nodeMajor: nodeVersionMajor,
    database,
  });

  const plan = buildStagingSeedPlan();

  return {
    report,
    environmentLabel: runtimeKindLabel(config.runtimeKind),
    nodeVersionMajor,
    editorialActionsEnabled: editorialActions.enabled,
    database,
    seed: {
      marker: STAGING_SEED_MARKER,
      slugPrefix: STAGING_SEED_SLUG_PREFIX,
      recordCount: plan.recordCount,
      confirmEnv: STAGING_SEED_CONFIRM_ENV,
      confirmValue: STAGING_SEED_CONFIRM_VALUE,
      planLines: formatSeedPlan(plan),
    },
  };
});
