/**
 * decision-coverage.ts — quanto do catalogo a politica ja decidiu, por tipo, e o
 * que a AUSENCIA de decisao significa por causa disso.
 *
 * POR QUE MORA AQUI (2026-09-11). Esta regra nasceu dentro do sitemap (PR #241,
 * 2026-08-27) e ficou la sozinha. Com isso, a entidade SEM decisao vigente saia
 * do sitemap assim que o gate do tipo armava — e a pagina dela continuava
 * dizendo `index`. E a divergencia (d) da auditoria de SEO. Agora a mesma regra
 * serve os DOIS consumidores: o SQL do sitemap (como parametro do COALESCE) e o
 * `<meta robots>` da pagina (via `resolveEntityPageSeo`). Um lugar so para decidir.
 *
 * ============================================================================
 * PISO QUE ARMA O GATE, POR TIPO DE ENTIDADE
 * ============================================================================
 * A regra do sitemap e "entra quem TEM decisao vigente `index`". Ela nao pode ser
 * incondicional: quem escreve as decisoes e `catalog index-decisions --apply`,
 * contra o banco de PRODUCAO. Se o codigo chegar ao ar antes de o produtor rodar,
 * a tabela esta vazia, toda ausencia vira `noindex` e a descoberta do dominio
 * inteiro para de um deploy para o outro.
 *
 * Entao o codigo detecta a precondicao SOZINHO: um tipo com pelo menos
 * `SITEMAP_DECISION_GATE_MIN_ROWS` decisoes vigentes tem o gate ARMADO (ausencia
 * vale `noindex`); abaixo disso fica DESARMADO (ausencia vale `index`, o
 * comportamento antigo). Nao ha flag, env nem segundo deploy.
 *
 * POR TIPO, e nao global: a CLI aceita `--entity person`, e um numero global
 * armaria filme e serie a partir de uma execucao que so decidiu pessoas.
 *
 * POR QUE 1.000: e a linha de sanidade que o dono declarou para a mudanca. Bem
 * acima de uma execucao parcial acidental, muito abaixo de uma completa (34.799
 * filmes e 32.392 series publicados em 2026-08-27).
 */

import { getPrismaClient } from "@screena/db/server";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Os tipos de `page_indexability_decisions` (nomes SINGULARES do enum `EntityType`). */
export type DecisionEntity = "movie" | "tv" | "person" | "season" | "episode";

const DECISION_ENTITIES: readonly DecisionEntity[] = ["movie", "tv", "person", "season", "episode"];

/** Quantas decisoes VIGENTES existem por tipo, naquele idioma (saturado no piso). */
export type DecisionCoverage = Readonly<Record<DecisionEntity, number>>;

export const EMPTY_DECISION_COVERAGE: DecisionCoverage = Object.freeze({
  movie: 0,
  tv: 0,
  person: 0,
  season: 0,
  episode: 0,
});

/** Linhas vigentes por tipo a partir das quais a ausencia de decisao vale `noindex`. */
export const SITEMAP_DECISION_GATE_MIN_ROWS = 1_000;

/** `true` quando aquele tipo ja tem decisoes suficientes para o gate valer. */
export function isDecisionGateArmed(coverage: DecisionCoverage, entity: DecisionEntity): boolean {
  return coverage[entity] >= SITEMAP_DECISION_GATE_MIN_ROWS;
}

/**
 * O que uma decisao AUSENTE vale para aquele tipo. Armado -> `noindex`;
 * desarmado -> `index`. E este par que atravessa como PARAMETRO para o COALESCE
 * do sitemap e como `absentDecision` para o resolver da pagina.
 */
export function absentDecisionFor(
  coverage: DecisionCoverage,
  entity: DecisionEntity,
): "index" | "noindex" {
  return isDecisionGateArmed(coverage, entity) ? "noindex" : "index";
}

/** Os tipos cujo gate ainda esta desarmado (para o log de transicao). */
export function unarmedDecisionEntities(coverage: DecisionCoverage): DecisionEntity[] {
  return DECISION_ENTITIES.filter((entity) => !isDecisionGateArmed(coverage, entity));
}

/**
 * Conta as decisoes vigentes por tipo — UMA consulta para os cinco.
 *
 * A CONTAGEM E LIMITADA AO PISO, de proposito: a unica coisa que a decisao
 * precisa e o booleano "passou de 1.000?". Um `GROUP BY` sobre a tabela inteira
 * leria milhoes de tuplas (ha uma decisao por episodio) por requisicao. O `LIMIT`
 * no subselect le no maximo ~5.000, sempre, pelo indice unico parcial de
 * decisoes vigentes.
 *
 * Falha de banco NAO e tratada aqui: ela sobe. Devolver "cobertura zero" em cima
 * de um erro desarmaria o gate por causa de um timeout — o pior dos mundos.
 *
 * O texto da consulta e o mesmo desde que ela nasceu no sitemap: o banco falso
 * da suite de governanca reconhece a consulta de cobertura por ele.
 */
export async function readDecisionCoverage(
  prisma: PrismaClient,
  language: string,
): Promise<DecisionCoverage> {
  const teto = SITEMAP_DECISION_GATE_MIN_ROWS;
  const rows = await prisma.$queryRaw<{ entity_type: string; n: number }[]>`
    SELECT t.entity_type AS entity_type,
           (SELECT COUNT(*)::int FROM (
              SELECT 1 FROM page_indexability_decisions d
               WHERE d.entity_type = t.entity_type::"EntityType"
                 AND d.language_code = ${language}
                 AND d.is_current = true
               LIMIT ${teto}
            ) AS amostra) AS n
    FROM (VALUES ('movie'),('tv'),('person'),('season'),('episode')) AS t(entity_type)`;
  const coverage: Record<DecisionEntity, number> = { ...EMPTY_DECISION_COVERAGE };
  for (const row of rows) {
    const key = row.entity_type as DecisionEntity;
    if (DECISION_ENTITIES.includes(key)) coverage[key] = Number(row.n) || 0;
  }
  return coverage;
}

/**
 * Quanto a cobertura pode envelhecer na PAGINA. Ela muda uma vez por produtor
 * rodado (o gate arma e fica armado); um minuto de atraso nao muda veredito de
 * ninguem e poupa uma consulta por ficha.
 */
export const PAGE_COVERAGE_TTL_MS = 60_000;

/** Memoria curta de cobertura, por idioma. */
export interface CoverageMemo {
  /** Dentro da janela, devolve o que guardou; fora dela, carrega e guarda. */
  read(
    language: string,
    load: () => Promise<DecisionCoverage>,
    now: number,
  ): Promise<DecisionCoverage>;
  /** Esquece tudo — para quem acabou de mudar a tabela e precisa do estado novo. */
  reset(): void;
}

/**
 * Memoria curta de cobertura, por idioma. Separada da leitura para ser testada
 * sem banco: o que se prova aqui e a JANELA, nao o SQL.
 *
 * Uma falha de leitura NAO e memorizada — ela sobe, e a requisicao seguinte tenta
 * de novo. Memorizar um erro transformaria um soluco do banco em um minuto
 * inteiro de 5xx.
 */
export function createCoverageMemo(ttlMs: number): CoverageMemo {
  const memo = new Map<string, { readonly at: number; readonly coverage: DecisionCoverage }>();
  return {
    async read(language, load, now) {
      const hit = memo.get(language);
      if (hit !== undefined && now - hit.at < ttlMs) return hit.coverage;
      const coverage = await load();
      memo.set(language, { at: now, coverage });
      return coverage;
    },
    reset() {
      memo.clear();
    },
  };
}

const pageCoverageMemo = createCoverageMemo(PAGE_COVERAGE_TTL_MS);

/**
 * A cobertura para uma PAGINA: a mesma leitura, contra o cliente de producao,
 * com memoria curta por idioma.
 *
 * NAO aceita cliente injetado, de proposito. Os loaders sempre repassam o proprio
 * cliente de producao adiante; se um parametro de cliente pulasse a memoria, TODA
 * pagina pularia — e a memoria existiria so no papel. Quem precisa de estado
 * fresco no meio de uma execucao (o validador real) chama
 * `resetDecisionCoverageMemo`, explicitamente.
 */
export async function readDecisionCoverageForPage(
  language: string,
  now: number = Date.now(),
): Promise<DecisionCoverage> {
  return pageCoverageMemo.read(
    language,
    () => readDecisionCoverage(getPrismaClient(), language),
    now,
  );
}

/**
 * Esquece a cobertura memorizada. Existe para o VALIDADOR real: ele semeia o
 * catalogo ate armar o gate no meio da execucao e precisa ler o estado novo na
 * mesma rodada, e nao o de um minuto atras.
 */
export function resetDecisionCoverageMemo(): void {
  pageCoverageMemo.reset();
}
