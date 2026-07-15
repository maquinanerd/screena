/**
 * indexability-decision.ts — Leitura SERVER-ONLY da decisao VIGENTE de
 * indexabilidade persistida em `page_indexability_decisions`.
 *
 * Fonte unica de verdade da Fase 3: metadata (`<meta robots>`), HTML, canonical
 * e sitemap consomem a MESMA resolucao — `resolvePageSeo` (fatos vivos do banco)
 * fundido com a decisao vigente persistida via `mergePersistedDecision`.
 *
 * Invariantes 3/4: le SO PostgreSQL local via `@screena/db/server`; nunca chama
 * API externa nem Gemini. Read-only: nao escreve no banco.
 *
 * FAIL-CLOSED: qualquer erro ao ler a decisao vigente resolve para
 * `noindex`/fora do sitemap (nao indexa por duvida). SO consulta linhas
 * `is_current = true`; o historico (via `supersedes_id`) e ignorado.
 */

import { getPrismaClient } from "@screena/db/server";
import {
  mergePersistedDecision,
  resolvePageSeo,
  type PageSeoFacts,
  type PageSeoResolution,
  type PersistedDecisionFacts,
} from "@screena/seo";

/** Tipos de entidade cobertos por `page_indexability_decisions` (tabela `entities`). */
export type DecisionEntityType =
  | "movie"
  | "tv"
  | "season"
  | "episode"
  | "person";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Chave da decisao vigente (entidade + idioma). */
export interface CurrentDecisionKey {
  entityType: DecisionEntityType;
  entityId: bigint;
  languageCode: string;
}

/** Decisao vigente + metadados de auditoria (ou null quando nao persistida). */
export interface CurrentPageIndexabilityDecision extends PersistedDecisionFacts {
  /** URL registrada na decisao (auditoria). */
  url: string | null;
  /** ISO-8601 de `decided_at`, ou null. */
  decidedAt: string | null;
  /** ISO-8601 de `created_at`. */
  createdAt: string;
}

/**
 * Le a decisao VIGENTE (`is_current = true`) para (entityType, entityId,
 * idioma). Retorna `null` quando nao ha linha persistida — nesse caso a politica
 * de indexacao total (`resolvePageSeo`) governa. LANCA em falha de banco; o
 * chamador (`resolveEntityPageSeo`) trata como fail-closed.
 */
export async function getCurrentPageIndexabilityDecision(
  key: CurrentDecisionKey,
  client?: PrismaClient,
): Promise<CurrentPageIndexabilityDecision | null> {
  const prisma = client ?? getPrismaClient();
  const row = await prisma.pageIndexabilityDecision.findFirst({
    where: {
      entityType: key.entityType,
      entityId: key.entityId,
      languageCode: key.languageCode,
      isCurrent: true,
    },
    // Defesa em profundidade: se por bug houver >1 vigente, a mais recente vence.
    orderBy: { createdAt: "desc" },
    select: {
      decision: true,
      reason: true,
      decisionOrigin: true,
      policyVersion: true,
      url: true,
      decidedAt: true,
      createdAt: true,
    },
  });
  if (row === null) return null;
  return {
    decision: row.decision as PersistedDecisionFacts["decision"],
    decisionOrigin: row.decisionOrigin,
    policyVersion: row.policyVersion,
    reason: row.reason,
    url: row.url,
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Resolucao fail-closed para quando a leitura da decisao vigente falha. */
function failClosed(live: PageSeoResolution): PageSeoResolution {
  return {
    ...live,
    decision: "noindex",
    robots: { index: false, follow: false },
    includeInSitemap: false,
    decisionSource: "persisted-decision",
    reason:
      "Falha ao ler a decisao vigente de indexabilidade (page_indexability_decisions); fail-closed para noindex ate a leitura ser confiavel.",
  };
}

/**
 * Resolucao FINAL de SEO de uma entidade: funde os fatos vivos (via
 * `resolvePageSeo`) com a decisao vigente persistida (`mergePersistedDecision`).
 * FAIL-CLOSED: erro ao ler a decisao vigente -> `noindex`/fora do sitemap.
 *
 * Esta e a funcao que metadata, HTML, canonical e sitemap devem consumir para a
 * pagina de detalhe de uma entidade.
 */
export async function resolveEntityPageSeo(
  key: CurrentDecisionKey,
  liveFacts: PageSeoFacts,
  client?: PrismaClient,
): Promise<PageSeoResolution> {
  const live = resolvePageSeo(liveFacts);
  let persisted: PersistedDecisionFacts | null;
  try {
    persisted = await getCurrentPageIndexabilityDecision(key, client);
  } catch (error) {
    console.error(
      `[seo] page_indexability_decisions indisponivel para ${key.entityType}:${key.entityId.toString()} (${key.languageCode}); fail-closed noindex:`,
      error,
    );
    return failClosed(live);
  }
  return mergePersistedDecision(live, persisted);
}
