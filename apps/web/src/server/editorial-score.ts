/**
 * editorial-score.ts — O CINERIE SCORE das superficies de LISTAGEM (cards, hero,
 * trilhos da home), lido de onde a nota de fato vive.
 *
 * ============================================================================
 * O QUE MUDOU EM 2026-08-28, E POR QUE
 * ============================================================================
 * Ate aqui este modulo devolvia so a PROCEDENCIA (`'editorial'` ou ausencia), e
 * o NUMERO vinha das colunas `movies.screen_score` / `screen_score_scale` /
 * `screen_score_display`. Esse caminho estava morto em tres pontos, cada um
 * fatal sozinho:
 *
 *   1. NADA no repositorio escreve `movies.screen_score`. Varredura em
 *      `services/`, `apps/`, `packages/`, `scripts/`: zero escritas. Os proprios
 *      workers de rating dizem em voz alta no relatorio que nao a tocam. Sem a
 *      coluna, o filtro da primeira linha descartava a entidade.
 *   2. `screen_score_display` foi zerado por migration
 *      (`20260717120000_external_intelligence_product`) e nunca religado.
 *   3. As ESCALAS eram incompativeis: o gate exigia `scale === 5` e o worker
 *      grava em `scale = 100`. Um calculo em 100 nunca passa num gate que pede 5
 *      — nao e arredondamento, e uma nota lida errada por um fator de 20.
 *
 * A escolha foi a segunda das duas que existiam ("ou passa a escrever a coluna,
 * ou a listagem passa a ler de onde a nota vive"): a listagem passa a ler
 * `cinerie_score_calculations` — a MESMA fonte da ficha.
 *
 * POR QUE ESTA, E NAO A OUTRA. Escrever `movies.screen_score` significaria
 * denormalizar o numero em duas tabelas que podem divergir (era justamente para
 * detectar essa divergencia que a checagem de procedencia existia), fazer o
 * worker de nota escrever na tabela que a ingestao escreve, e depender de um
 * trigger que recusa a escrita quando a decisao de licenca nao esta vigente. Ler
 * da fonte remove os tres problemas de uma vez, e derruba os tres pontos mortos
 * acima com uma consulta que este modulo JA FAZIA.
 *
 * ============================================================================
 * UM GATE, UM PISO, UMA ESCALA — OS MESMOS DA FICHA
 * ============================================================================
 * A decisao de exibir e de `decideCinerieScore` (o presenter PURO que a ficha ja
 * usa): licenca vigente, depois piso de `MINIMUM_COUNTED_SOURCES` fontes
 * NOMEADAS. A escala e `CINERIE_SCORE_DISPLAY_SCALE` (100) nos dois lugares.
 * Ficha e listagem deixaram de ter fonte, portao e escala diferentes.
 *
 * Invariantes 3/4: le somente PostgreSQL local, em LOTE (sem N+1), read-only.
 * Invariantes 1/2: a nota NUNCA e de terceiro — e a composicao propria, e o
 * painel de notas externas continua ao lado, cada fonte na sua escala.
 */

import { getPrismaClient } from "@screena/db/server";
import { rebuildCountedSources } from "@screena/cinerie-score";

import {
  decideCinerieScore,
  type CinerieScoreView,
} from "../lib/cinerie-score-presenter";
import {
  SCREEN_SCORE_EDITORIAL_SOURCE,
  type ScreenScoreSource,
} from "../lib/home-hero-presenter";
import { findManyInChunks } from "../lib/prisma-in-chunks";
import { parseScoreExplanation } from "../lib/score-explanation";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Entidades que carregam Cinerie Score (subset de EntityType). */
export type ScoredEntityType = "movie" | "tv";

/**
 * A decisao de licenca que autoriza DERIVAR o Score.
 *
 * A consulta e a MESMA de `entity-hero.ts::getCinerieScoreForEntity`, campo a
 * campo — `use_case`, `is_current` nos DOIS lados, `stage`, `display_allowed`,
 * `derivative_allowed` e a vigencia cobrindo agora. Duas leituras que
 * divergissem em um campo fariam a ficha e a listagem discordarem sobre a mesma
 * nota, e o proximo a investigar comecaria pela pergunta errada.
 */
async function isDerivationAuthorized(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT d.id
      FROM data_usage_decisions d
      JOIN source_licenses l ON l.id = d.source_license_id
     WHERE d.use_case = 'cinerie_score_display'
       AND d.is_current = true
       AND l.is_current = true
       AND d.stage = 'approved_for_display'
       AND d.display_allowed = true
       AND d.derivative_allowed = true
       AND d.valid_from <= now()
       AND (d.valid_until IS NULL OR d.valid_until > now())
     LIMIT 1`;
  return rows.length > 0;
}

function toNumber(value: { toString(): string } | number | null): number | null {
  if (value == null) return null;
  const num = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(num) ? num : null;
}

/**
 * O Cinerie Score EXIBIVEL de cada entidade, por `entityId` (string).
 *
 * Entidade ausente do mapa = sem nota a exibir, e as tres causas (sem
 * autorizacao, sem calculo, menos de duas fontes) sao deliberadamente
 * indistinguiveis AQUI: o card nao tem onde contar a diferenca. Quem precisa
 * distinguir e a ficha, que usa `decideCinerieScore` diretamente e recebe o
 * motivo (`SectionAbsenceReason`).
 *
 * Duas consultas no total, independentemente de quantas entidades: a decisao e
 * uma, e os calculos vem em lotes de ids.
 */
export async function resolveEditorialScores(
  prisma: PrismaClient,
  entityType: ScoredEntityType,
  entityIds: readonly bigint[],
): Promise<Map<string, CinerieScoreView>> {
  const out = new Map<string, CinerieScoreView>();
  if (entityIds.length === 0) return out;

  const authorized = await isDerivationAuthorized(prisma);
  // Sem autorizacao nem vale ler os calculos: `decideCinerieScore` recusaria
  // todos, e a leitura seria trabalho jogado fora sobre a tabela maior.
  if (!authorized) return out;

  // Em LOTES de ids: acima de ~32,7 mil ids a consulta nao cabe no protocolo do
  // PostgreSQL (ver `../lib/prisma-in-chunks`). O `orderBy` sobrevive ao
  // fatiamento porque cada entidade cai em UM unico lote.
  const rows = await findManyInChunks([...entityIds], (chunk) =>
    prisma.cinerieScoreCalculation.findMany({
      where: { entityType, entityId: { in: chunk }, status: "calculated" },
      orderBy: { calculatedAt: "desc" },
      select: { entityId: true, value: true, explanation: true },
    }),
  );

  // O ULTIMO calculo por entidade (a lista ja vem em ordem decrescente).
  const vistos = new Set<string>();
  for (const row of rows) {
    const key = row.entityId.toString();
    if (vistos.has(key)) continue;
    vistos.add(key);

    // O GRUPO da fonte e DERIVADO pelo pacote dono do mapa, nunca inventado
    // aqui: `CinerieScoreExplanationEntry` nao persiste `group`, e um chute
    // faria o Rotten Tomatoes aparecer como publico numa comparacao
    // criticos x audiencia.
    const counted = rebuildCountedSources(parseScoreExplanation(row.explanation));
    const decision = decideCinerieScore({
      authorized: true,
      value: toNumber(row.value),
      counted,
    });
    if (decision.rendered) out.set(key, decision.view);
  }

  return out;
}

/**
 * Os quatro campos de nota que os presenters de card/hero leem.
 *
 * Existem juntos, e num helper so, porque eles TEM de andar juntos: uma nota
 * com origem editorial e sem valor, ou com valor e sem display, e um estado que
 * so pode existir por engano. Antes eles vinham de tres colunas de `movies`
 * preenchidas por ninguem e de um quarto campo resolvido a parte — e a
 * combinacao "display ligado, valor nulo" era exatamente o que a tela recebia.
 */
export interface ResolvedScoreFields {
  readonly screenScore: number | null;
  readonly screenScoreScale: number | null;
  readonly screenScoreDisplay: boolean;
  readonly screenScoreSource: ScreenScoreSource | null;
}

/** Sem nota exibivel, os quatro campos saem coerentemente vazios. */
const SEM_NOTA: ResolvedScoreFields = {
  screenScore: null,
  screenScoreScale: null,
  screenScoreDisplay: false,
  screenScoreSource: null,
};

/** Converte a decisao de exibicao nos campos que o presenter consome. */
export function scoreFields(view: CinerieScoreView | undefined): ResolvedScoreFields {
  if (view === undefined) return SEM_NOTA;
  return {
    screenScore: view.value,
    screenScoreScale: view.scale,
    screenScoreDisplay: true,
    screenScoreSource: SCREEN_SCORE_EDITORIAL_SOURCE,
  };
}
