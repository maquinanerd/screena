/**
 * entity-awards.ts — Helper SERVER-ONLY: dado um titulo (filme|serie), traz o
 * FATO DE PREMIACAO exibivel, ja composto em pt-BR.
 *
 * Invariantes 3 e 6:
 *  - le somente PostgreSQL local via @screena/db (Prisma). Read-only. NUNCA
 *    consulta a OMDb — este e o caminho de LEITURA; a promocao roda offline;
 *  - LICENCA antes de exibir: a query filtra `display_allowed`, e ainda assim
 *    REVALIDA a decisao de uso e a licenca-mae em memoria.
 *
 * POR QUE REVALIDAR, se ha trigger fail-closed no banco: o trigger dispara em
 * ESCRITA. Uma faixa aprovada em agosto continua `display_allowed = true` para
 * sempre, porque o tempo passar nao e um UPDATE. Duas coisas so o tempo quebra,
 * e so a leitura enxerga: a decisao EXPIRA (`valid_until` passa) e a licenca-mae
 * pode ter sido supersedida sem nenhum write nesta linha.
 *
 * NAO ha gate de frescor aqui, e a ausencia e deliberada: "ganhou 4 Oscars" nao
 * envelhece como uma nota envelhece. Um premio ja concedido continua concedido.
 * O que pode mudar e a CONTAGEM agregada, e a mudanca vem pelo proximo ciclo do
 * worker (que revoga a aprovacao e reaprova a frase nova).
 */

import { cache } from "react";

import type { AwardsHighlight } from "@screena/schemas";

import { getPrismaClient } from "@screena/db/server";

import {
  buildAwardsView,
  type AwardsCredit,
  type AwardsView,
} from "../lib/awards-presenter";
import type { SectionAbsenceReason } from "../lib/section-absence";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Titulos que tem premiacao nesta fase (subset de EntityType). */
export type AwardsEntityType = "movie" | "tv";

/** Caso de uso que autoriza exibir o fato de premiacao. */
const AWARDS_DISPLAY_USE_CASE = "awards_display";

/** Territorio de exibicao (pt-BR/Brasil), como no painel de notas. */
const AWARDS_DISPLAY_TERRITORY = "BR";

/** `license_status` que permitem exibicao (espelha o trigger). */
const DISPLAYABLE_LICENSE_STATUS: readonly string[] = ["official", "licensed", "third_party"];

/** A faixa pronta para a tela: o fato + o credito que anda colado nele. */
export interface AwardsPanelView {
  readonly view: AwardsView;
  readonly credit: AwardsCredit;
}

/** Linha crua projetada pela query (exportada para o teste puro do projetor). */
export interface AwardsRow {
  readonly outcome: string | null;
  readonly highlightCount: number | null;
  readonly awardName: string | null;
  readonly wins: number | null;
  readonly nominations: number | null;
  readonly sourceKey: string | null;
  readonly attributionText: string | null;
  readonly attributionUrl: string | null;
  readonly requiresAttribution: boolean;
  readonly requiresLinkback: boolean;
  readonly dataUsageDecision: {
    readonly useCase: string;
    readonly isCurrent: boolean;
    readonly stage: string;
    readonly displayAllowed: boolean;
    readonly territory: string | null;
    readonly validFrom: Date;
    readonly validUntil: Date | null;
    readonly sourceLicense: {
      readonly isCurrent: boolean;
      readonly licenseStatus: string;
      readonly displayAllowed: boolean;
      readonly sourceKey: string;
    };
  } | null;
}

/** A decisao de uso ainda autoriza exibir, AGORA? */
function decisionAuthorizesNow(row: AwardsRow, now: Date): boolean {
  const decision = row.dataUsageDecision;
  if (decision === null) return false;
  // Uma decisao de `rating_display` NAO autoriza a faixa de premios. O eixo
  // use_case existe exatamente para impedir essa carona.
  if (decision.useCase !== AWARDS_DISPLAY_USE_CASE) return false;
  if (!decision.isCurrent) return false;
  if (decision.stage !== "approved_for_display" || !decision.displayAllowed) return false;
  if (decision.validFrom.getTime() > now.getTime()) return false;
  // O caso que SO a leitura pega: a decisao venceu sozinha.
  if (decision.validUntil !== null && decision.validUntil.getTime() <= now.getTime()) return false;
  if (decision.territory !== null && decision.territory !== AWARDS_DISPLAY_TERRITORY) return false;

  const license = decision.sourceLicense;
  if (!license.isCurrent) return false;
  if (!DISPLAYABLE_LICENSE_STATUS.includes(license.licenseStatus)) return false;
  if (!license.displayAllowed) return false;
  // A decisao tem de pertencer a licenca DESTA fonte, senao o credito exibido
  // seria de uma fonte e a autorizacao de outra.
  if (row.sourceKey === null || license.sourceKey !== row.sourceKey) return false;
  return true;
}

/** Projeta uma linha exibivel para a tela, ou `null` se nao passa. */
export function toAwardsPanelView(row: AwardsRow, now: Date): AwardsPanelView | null {
  if (!decisionAuthorizesNow(row, now)) return null;

  // Atribuicao exigida e ausente = nao exibe. Nunca "exibe sem credito".
  const text = (row.attributionText ?? "").trim();
  const url = (row.attributionUrl ?? "").trim();
  if (row.requiresAttribution && text === "") return null;
  if (row.requiresLinkback && url === "") return null;
  // Sem credito textual nao ha faixa, mesmo que a licenca nao o exigisse: a
  // faixa nomeia quem afirmou o fato, ou nao existe.
  if (text === "") return null;
  // Link de credito nao-HTTPS numa pagina HTTPS nao abre.
  if (url !== "" && !url.startsWith("https://")) return null;

  // Destaque e tudo-ou-nada: meia frase viraria texto quebrado na tela. (O
  // CHECK do banco ja garante isso; aqui e a rede de seguranca da leitura.)
  let highlight: AwardsHighlight | null = null;
  if (row.outcome !== null) {
    if (row.outcome !== "won" && row.outcome !== "nominated") return null;
    if (row.highlightCount === null || row.awardName === null) return null;
    highlight = {
      outcome: row.outcome,
      count: row.highlightCount,
      awardName: row.awardName,
    };
  }

  const view = buildAwardsView({
    highlight,
    tally: { wins: row.wins, nominations: row.nominations },
  });
  if (view.headline === null && view.tally.label === null) return null;

  return { view, credit: { text, url: url === "" ? null : url } };
}

/**
 * Retorna a faixa de premios exibivel de um titulo, ou `null`.
 *
 * `null` e um estado LEGITIMO e frequente (titulo sem premio, ou licenca de
 * premiacao ainda nao decidida). Quem transforma esse `null` em ausencia
 * REGISTRADA e o `<SectionBoundary>` da pagina — a faixa nunca some calada.
 */
export async function getAwardsForEntity(
  prisma: PrismaClient,
  entityType: AwardsEntityType,
  entityId: bigint,
): Promise<AwardsPanelView | null> {
  const now = new Date();

  const rows = (await prisma.entityAward.findMany({
    where: {
      entityType,
      entityId,
      // Gate de origem (invariante 6). O resto e revalidacao de tempo.
      displayAllowed: true,
    },
    // Ordem TOTAL e estavel: se um dia houver mais de um fornecedor tecnico
    // para o mesmo titulo, a escolha nao pode flutuar entre renders/replicas.
    orderBy: [{ providerApi: "asc" }],
    take: 1,
    select: {
      outcome: true,
      highlightCount: true,
      awardName: true,
      wins: true,
      nominations: true,
      sourceKey: true,
      attributionText: true,
      attributionUrl: true,
      requiresAttribution: true,
      requiresLinkback: true,
      dataUsageDecision: {
        select: {
          useCase: true,
          isCurrent: true,
          stage: true,
          displayAllowed: true,
          territory: true,
          validFrom: true,
          validUntil: true,
          sourceLicense: {
            select: {
              isCurrent: true,
              licenseStatus: true,
              displayAllowed: true,
              sourceKey: true,
            },
          },
        },
      },
    },
  })) as unknown as AwardsRow[];

  const row = rows[0];
  if (row === undefined) return null;
  return toAwardsPanelView(row, now);
}

/**
 * Por que a faixa nao renderizou NESTE titulo.
 *
 * Mesma disciplina do painel de streaming: "ninguem esta autorizado ainda" e
 * "este titulo nao ganhou nada" sao IDENTICOS na tela e completamente
 * diferentes na acao. So o log separa os dois — e hoje a resposta e sempre a
 * primeira, porque nao ha licenca de premiacao.
 *
 * Memoizado por request e consultado SO quando nao ha faixa: quem tem premio
 * nao paga a sonda.
 */
export const awardsAbsenceReason = cache(
  async (prisma: PrismaClient): Promise<SectionAbsenceReason> => {
    const anyDisplayable = await prisma.entityAward.findFirst({
      where: { displayAllowed: true },
      select: { id: true },
    });
    return awardsAbsenceReasonFor(anyDisplayable !== null);
  },
);

/**
 * A DECISAO, separada da consulta, para ser testada nos dois estados sem banco
 * e sem contexto de renderizacao do React.
 */
export function awardsAbsenceReasonFor(hasAnyDisplayableAward: boolean): SectionAbsenceReason {
  return hasAnyDisplayableAward ? "no_awards_for_entity" : "no_awards_source";
}
