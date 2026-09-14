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
 * FALHA DE BANCO NAO E DECISAO DE SEO (mudou em 2026-09-11): erro ao ler a
 * decisao vigente LANCA `IndexabilityDecisionUnavailableError`, e a rota
 * responde 5xx. Ate essa data virava `noindex` — ver o motivo na classe. SO
 * consulta linhas `is_current = true`; o historico (via `supersedes_id`) e
 * ignorado.
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
 * de indexacao total (`resolvePageSeo`) governa. LANCA em falha de banco, e o
 * chamador (`resolveEntityPageSeo`) propaga como
 * `IndexabilityDecisionUnavailableError`.
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

/**
 * A leitura da decisao vigente FALHOU — e isso nao e uma decisao de SEO.
 *
 * ATE 2026-09-11 este caso virava `noindex, nofollow`. Tinha nome de fail-closed
 * e efeito oposto: a pagina respondia **200** com `noindex`, e as fichas de filme
 * e de pessoa sao ISR — a resposta ficava GUARDADA pela janela do `revalidate`.
 * Um soluco de segundos no PostgreSQL publicava, por minutos, a instrucao "tire
 * esta pagina do indice" em paginas que deveriam indexar. O buscador obedece a
 * `noindex`; ele nao tem como saber que foi um soluco.
 *
 * O correto e 5xx, por dois motivos independentes:
 *  - o buscador trata 5xx como indisponibilidade TEMPORARIA: tenta de novo e nao
 *    desindexa na primeira ocorrencia;
 *  - o Next NAO guarda erro no cache de rota — numa revalidacao que falha, ele
 *    continua servindo a ultima versao boa.
 *
 * Por isso isto LANCA. Quem chama nao deve capturar para "degradar": nao existe
 * degradacao correta aqui, so a verdade — o dado nao pode ser lido agora.
 * Distinguir os tres casos e o ponto: nao existe -> 404; existe e a politica diz
 * noindex -> 200 + noindex; a infraestrutura falhou -> 5xx.
 */
export class IndexabilityDecisionUnavailableError extends Error {
  readonly key: CurrentDecisionKey;

  constructor(key: CurrentDecisionKey, cause: unknown) {
    super(
      `page_indexability_decisions indisponivel para ${key.entityType}:${key.entityId.toString()} (${key.languageCode})`,
      { cause },
    );
    this.name = "IndexabilityDecisionUnavailableError";
    this.key = key;
  }
}

/**
 * Resolucao FINAL de SEO de uma entidade: funde os fatos vivos (via
 * `resolvePageSeo`) com a decisao vigente persistida (`mergePersistedDecision`).
 *
 * Falha ao ler a decisao vigente LANCA `IndexabilityDecisionUnavailableError`
 * (a rota responde 5xx) — nunca devolve uma resolucao `noindex` inventada.
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
    // O log continua de proposito: e ele que separa "banco caiu" de qualquer
    // outra causa de 500 no painel. O throw e o que impede o noindex de ir para
    // o cache.
    console.error(
      `[seo] page_indexability_decisions indisponivel para ${key.entityType}:${key.entityId.toString()} (${key.languageCode}); respondendo 5xx, NAO noindex:`,
      error,
    );
    throw new IndexabilityDecisionUnavailableError(key, error);
  }
  return mergePersistedDecision(live, persisted);
}
