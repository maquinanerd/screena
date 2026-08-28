/**
 * indexability-writer.ts — PRODUTOR de `page_indexability_decisions`.
 * Coberto por `tsconfig.runtime.json`.
 *
 * Le os fatos de cada entidade de catalogo, aplica a politica pura
 * (`@screena/seo` -> `decideCatalogIndexability`) e persiste a decisao VIGENTE.
 *
 * A POLITICA NAO E REIMPLEMENTADA AQUI. Este arquivo so LE FATOS. Toda pergunta
 * do tipo "isso indexa?" e respondida pelo modulo puro — inclusive a pergunta
 * "a serie dona e publicavel?", que e respondida rodando a MESMA funcao sobre a
 * serie (ver `readPublishableSeriesIds`) em vez de reescrever o gate em SQL.
 * Regra duplicada em SQL e regra que diverge em silencio.
 *
 * DUAS FASES, NAO UMA. Ate a introducao do freio, este produtor lia e gravava no
 * MESMO laco. Agora ele PLANEJA tudo primeiro (fase 1, sem escrita nenhuma),
 * mede o tamanho da mudanca e so entao grava (fase 2). Isso e o que permite
 * recusar a execucao INTEIRA — e nao "as ultimas 40 mil, depois que as
 * primeiras 10 mil ja sairam do sitemap".
 *
 * FREIO DE MUDANCA EM MASSA. `catalog index-decisions --apply` roda de hora em
 * hora sem humano nenhum. Sem freio, mudar a politica pura em `@screena/seo` (ou
 * subir `CATALOG_POLICY_VERSION` junto com regra nova) reindexaria o catalogo
 * inteiro no primeiro ciclo depois do deploy — exatamente a "indexacao em massa"
 * que a secao 6 do CLAUDE.md manda submeter a revisao humana. O produtor conta
 * quantas entidades ENTRAM ou SAEM do sitemap (`@screena/seo` ->
 * `evaluateMassChangeBrake`) e, passando do teto sem `confirmMassChange`,
 * grava ZERO linhas e devolve o censo.
 *
 * O freio mede EFEITO, nao rotulo: o sitemap trata ausencia de decisao como
 * "dentro", entao `null -> index` nao e flip e o crescimento normal do catalogo
 * passa livre. Ver o cabecalho de `packages/seo/src/catalog-mass-change.ts`.
 *
 * Isto importa em dobro depois que temporada e episodio entraram em
 * `DECIDABLE_ENTITY_TYPES`: sao ~30.400 das ~53.000 URLs do sitemap, e quase
 * todas nascem `null -> noindex`. Sem o freio, esse conjunto sai do indice de uma
 * vez, no primeiro ciclo horario depois do deploy.
 *
 * SEM CHURN: quando a decisao nova e igual a persistida (mesmo veredito, mesma
 * razao, mesma versao de politica), NADA e gravado. Uma execucao diaria sobre um
 * catalogo estavel deve produzir zero escritas — se produzir uma linha por
 * entidade por execucao, a tabela vira log de execucao em vez de registro de
 * decisao.
 *
 * SUPERSEDE em transacao: a decisao anterior e despromovida (`is_current=false`)
 * e a nova aponta para ela via `supersedes_id`, na MESMA transacao — o historico
 * fica encadeado e nunca ha janela com duas vigentes.
 *
 * DUAS VIGENTES: o BANCO recusa. `page_indexability_decisions_current_unique`
 * (unique parcial em `(entity_type, entity_id, language_code) WHERE is_current`)
 * e criado por `20260715120000_data_governance_hardening`. Este cabecalho ja
 * afirmou o contrario — a busca de origem procurou `UNIQUE` e `is_current` na
 * MESMA linha do SQL, e o `WHERE is_current = true` esta na linha seguinte. Ver
 * `docs/backend/catalog-operations.md` secao 3. O `flock` do ciclo evita
 * desperdicio de cota; quem garante uma unica vigente e o PostgreSQL.
 *
 * NAO LIGA INDEXACAO: escrever `decision='index'` registra o que a politica diz.
 * A chave global (`CINERIE_PUBLIC_INDEXING_ENABLED`) continua desligada.
 *
 * O TETO DE 100.000 (removido em 2026-08-28). O `limit` deste produtor nascia
 * `100_000` e virava um `LIMIT` de SQL POR TIPO. O censo de producao de
 * 2026-08-28 reportou `season`, `episode` e `person` com EXATAMENTE 100.000
 * avaliadas cada — tres numeros redondos iguais, lidos como medicao por todo
 * mundo que abriu o relatorio. Nao eram medicao: eram o teto se apresentando
 * como total. Consequencias, em ordem de gravidade:
 *
 *   1. `evaluated` era piso, entao `byDecision`/`byReason` tambem eram piso;
 *   2. `flipRatio` = flips / evaluated tinha o DENOMINADOR errado, e o freio de
 *      mudanca em massa media contra um universo que nao existe;
 *   3. e o relatorio somava "306.800 noindex" como se fosse o corte inteiro.
 *
 * Agora a leitura e PAGINADA por chave (`e.id > ultimo`, ver `readFactsPages`),
 * o padrao e varrer o tipo INTEIRO, e um teto — quando o operador declara um —
 * sai no JSON como `EntityTypeCensus.truncated` e num aviso em texto.
 */

import type { PrismaClient } from '@screena/db/server'
import {
  censusMassChange,
  classifyIndexFlip,
  decideCatalogIndexability,
  decisionChanged,
  evaluateMassChangeBrake,
  type CatalogDecisionEntityType,
  type CatalogEntityFacts,
  type CatalogIndexabilityDecision,
  type IndexFlip,
  type MassChangeThresholds,
  type MassChangeVerdict,
  type PlannedTransition,
} from '@screena/seo'

/**
 * Tipos processados por padrao.
 *
 * Temporada e episodio NAO tem slug proprio (a URL deriva do slug da serie mais
 * os numeros), e por isso ficaram de fora ate aqui — mas eles SAO 30.400 das
 * 53.000 URLs do sitemap. Deixa-los sem decisao significa que o gate nunca os
 * alcanca: a clausula `NOT EXISTS` do sitemap os inclui por falta de linha.
 */
export const DECIDABLE_ENTITY_TYPES: readonly CatalogDecisionEntityType[] = [
  'movie',
  'tv',
  'season',
  'episode',
  'person',
]

/** Uma mudanca planejada, com o que a fase 2 precisa para gravar. */
interface PlannedWrite extends PlannedTransition {
  readonly entityType: CatalogDecisionEntityType
  readonly entityId: bigint
  readonly url: string
  readonly decision: CatalogIndexabilityDecision
}

/**
 * O que a FASE 2 faria (ou fez) com as linhas da tabela.
 *
 * `planned` sozinho ("mudariam N") nao respondia a pergunta que o operador faz
 * antes de assinar: quantas linhas NASCEM e quantas linhas TROCAM de veredito.
 * Sao efeitos diferentes — `created` e cobertura nova (a entidade nunca teve
 * decisao), `updated` e uma entidade que JA tinha veredito e passa a ter outro,
 * e so o segundo pode tirar do indice uma pagina que o Google ja conhece.
 */
export interface DecisionWriteCensus {
  /** Sem decisao vigente: a fase 2 INSERE uma linha nova. */
  readonly created: number
  /** Ja havia decisao vigente: despromove a antiga e insere a nova. */
  readonly updated: number
  /** Decisao identica a vigente (veredito + razao + versao): nada e gravado. */
  readonly unchanged: number
}

/** Censo de UM tipo de entidade. */
export interface EntityTypeCensus {
  readonly evaluated: number
  /**
   * A avaliacao deste tipo foi COMPLETA (`false`) ou parou num teto (`true`)?
   *
   * Existe como BOOLEANO, e nao como algo a inferir do numero, porque foi
   * exatamente a inferencia que falhou: com o teto antigo de 100.000 por tipo,
   * `season`, `episode` e `person` reportavam `evaluated: 100000` cada um, e
   * nada no JSON dizia que aqueles tres numeros eram o teto e nao o total. Um
   * censo truncado nao e um censo menor — e um censo cujo denominador esta
   * errado, e portanto cujo `flipRatio` tambem esta.
   */
  readonly truncated: boolean
  /** Quantas avaliadas caem em cada veredito (`index`/`noindex`/...). */
  readonly byDecision: Readonly<Record<string, number>>
  /** O motivo agregado — por que aquele veredito, e em quantas entidades. */
  readonly byReason: Readonly<Record<string, number>>
  readonly writes: DecisionWriteCensus
}

/**
 * Versao da FORMA do resumo em JSON.
 *
 * O `--json` deste comando e lido por script de operacao. Um consumidor precisa
 * poder afirmar "eu entendo esta forma" sem inspecionar campo a campo; subir
 * este numero e o sinal de que a forma mudou de maneira incompativel. Campos
 * ADICIONADOS nao sobem a versao (adicionar nao quebra leitor).
 */
export const INDEXABILITY_SUMMARY_SCHEMA_VERSION = 1

/** Resumo por decisao e por razao. */
export interface IndexabilityRunSummary {
  /** Ver `INDEXABILITY_SUMMARY_SCHEMA_VERSION`. */
  readonly schemaVersion: number
  readonly language: string
  readonly dryRun: boolean
  readonly evaluated: number
  readonly written: number
  readonly unchanged: number
  /**
   * Tipos cuja avaliacao parou num teto. VAZIO = `evaluated` e o total real.
   *
   * Nao-vazio significa que `evaluated`, `byDecision`, `byReason` e o
   * `flipRatio` do freio sao PISO, nunca total — e o comando avisa em texto,
   * alem de dizer aqui.
   */
  readonly truncatedTypes: readonly string[]
  /** Mudancas PLANEJADAS (gravadas ou nao — o freio pode ter recusado todas). */
  readonly planned: number
  /** Criadas/alteradas/inalteradas — o que a fase 2 faria com a tabela. */
  readonly writes: DecisionWriteCensus
  /** Censo COMPLETO por tipo de entidade (nao so os flips). */
  readonly byEntityType: Readonly<Record<string, EntityTypeCensus>>
  readonly byDecision: Readonly<Record<string, number>>
  readonly byReason: Readonly<Record<string, number>>
  /**
   * Veredito do freio de mudanca em massa. `blocked=true` implica
   * `written === 0`: a execucao inteira e recusada, nunca metade dela.
   */
  readonly massChange: MassChangeVerdict
  /** Censo dos FLIPS por razao (por que a entidade entrou/saiu do sitemap). */
  readonly flipsByReason: Readonly<Record<string, number>>
  /** Censo dos FLIPS por tipo de entidade. */
  readonly flipsByEntityType: Readonly<Record<string, number>>
  /** Amostra das mudancas, para revisao antes de aplicar. */
  readonly changes: readonly {
    readonly entityType: string
    readonly entityId: string
    readonly from: string | null
    readonly to: string
    readonly reason: string
    /** A entidade entra/sai do sitemap com esta mudanca? */
    readonly flip: IndexFlip
  }[]
}

/**
 * Fato cru lido do banco para UMA entidade.
 *
 * Uma unica forma para os cinco tipos: cada consulta preenche o que faz sentido
 * e neutraliza o resto (`false`/`0`). Cinco interfaces diferentes dariam cinco
 * caminhos de codigo para o mesmo `decideCatalogIndexability`.
 */
interface EntityFactRow {
  readonly entity_id: bigint
  readonly has_slug: boolean
  readonly has_title: boolean
  readonly has_translation: boolean
  readonly credits: number
  /** Sinopse/overview que a pagina exibe (ver `hasSynopsis` na politica). */
  readonly has_synopsis: boolean
  /** Imagem principal persistida (poster/still/profile) — fato, nao licenca. */
  readonly has_image: boolean
  /** Biografia EXIBIVEL: texto + `biography_source_status` liberado. */
  readonly has_biography: boolean
  /** Episodios listados pela temporada. */
  readonly listed_episodes: number
  /** Serie dona (temporada/episodio); `null` nos demais tipos. */
  readonly parent_id: bigint | null
  /** Numero da temporada (temporada/episodio); `null` nos demais. */
  readonly season_number: number | null
  /** Numero do episodio (episodio); `null` nos demais. */
  readonly episode_number: number | null
  /** Slug canonico da entidade — ou da SERIE, no caso de temporada/episodio. */
  readonly url: string | null
  readonly cur_decision: string | null
  readonly cur_reason: string | null
  readonly cur_policy: string | null
}

/**
 * Rota publica de cada tipo (usada para preencher `url`, que e NOT NULL).
 *
 * Espelha `apps/web/src/lib/routes.ts`. A copia e deliberada: `services/*` nao
 * importa de `apps/web`. Divergir aqui so afeta a coluna de auditoria — o
 * sitemap monta a URL pelo seu proprio caminho —, mas uma URL errada no registro
 * de decisao e uma pista falsa numa investigacao.
 */
function routeFor(entityType: CatalogDecisionEntityType, row: EntityFactRow): string {
  const slug = row.url ?? String(row.entity_id)
  switch (entityType) {
    case 'movie':
      return `/pt/filmes/${slug}/`
    case 'tv':
      return `/pt/series/${slug}/`
    case 'person':
      return `/pt/pessoas/${slug}/`
    case 'season':
      return `/pt/series/${slug}/temporadas/${row.season_number ?? 0}/`
    case 'episode':
      return `/pt/series/${slug}/temporadas/${row.season_number ?? 0}/episodios/${row.episode_number ?? 0}/`
    default:
      return `/pt/${slug}/`
  }
}

/**
 * Estados de `people.biography_source_status` que autorizam EXIBIR a biografia
 * (invariante 6). MESMA lista de `selectSourceBiography` em apps/web — fechada
 * de proposito: estado novo no enum nao passa a exibir por omissao.
 */
const BIOGRAPHY_DISPLAYABLE_STATUSES = "('official','licensed','third_party')"

/** SQL dos fatos de um tipo de entidade. `$1` e sempre o `language_code`. */
function factsSql(entityType: CatalogDecisionEntityType, limit: number, afterId: bigint): string {
  // `LIMIT ALL` para teto ausente/infinito: `LIMIT 9007199254740991` funciona,
  // mas polui o plano e mente sobre a intencao.
  const cap =
    Number.isFinite(limit) && limit < Number.MAX_SAFE_INTEGER
      ? `LIMIT ${Math.max(1, Math.floor(limit))}`
      : 'LIMIT ALL'
  // Paginacao por CHAVE (keyset), nao por OFFSET: `ORDER BY e.id` ja existe em
  // todas as consultas, entao `e.id > <ultimo visto>` continua de onde parou em
  // tempo constante. `afterId` vem SEMPRE de uma linha lida do proprio banco
  // (bigint), nunca de entrada de usuario — por isso vai interpolado, como ja
  // faz `finalization-backfill.ts`.
  const after = `e.id > ${afterId.toString()}`
  const currentDecision = (type: string, idExpr: string) => `
      LEFT JOIN page_indexability_decisions d
        ON d.entity_type = '${type}' AND d.entity_id = ${idExpr}
       AND d.language_code = $1 AND d.is_current`

  if (entityType === 'movie' || entityType === 'tv') {
    const table = entityType === 'movie' ? 'movies' : 'tv_shows'
    const titleCol = entityType === 'movie' ? 'title_original' : 'name_original'
    return `
      SELECT e.id AS entity_id,
             (s.slug IS NOT NULL) AS has_slug,
             (BTRIM(COALESCE(e.${titleCol}, '')) <> '') AS has_title,
             (t.entity_id IS NOT NULL) AS has_translation,
             0 AS credits,
             -- Sinopse em QUALQUER idioma: selectSynopsis (apps/web) aceita o
             -- idioma de origem com aviso na tela para titulo entrado sob
             -- demanda. Filtrar por $1 aqui marcaria como sem sinopse a pagina
             -- que exibe sinopse.
             EXISTS (SELECT 1 FROM entity_translations tx
                      WHERE tx.entity_type = '${entityType}' AND tx.entity_id = e.id
                        AND BTRIM(COALESCE(tx.summary, '')) <> '') AS has_synopsis,
             (BTRIM(COALESCE(e.poster_path, '')) <> '') AS has_image,
             false AS has_biography,
             0 AS listed_episodes,
             NULL::bigint AS parent_id,
             NULL::int AS season_number,
             NULL::int AS episode_number,
             s.slug AS url,
             d.decision::text AS cur_decision,
             d.reason AS cur_reason,
             d.policy_version AS cur_policy
        FROM ${table} e
        LEFT JOIN slugs s
          ON s.entity_type = '${entityType}' AND s.entity_id = e.id
         AND s.language_code = $1 AND s.is_canonical
        LEFT JOIN entity_translations t
          ON t.entity_type = '${entityType}' AND t.entity_id = e.id AND t.language_code = $1
        ${currentDecision(entityType, 'e.id')}
       WHERE ${after}
       ORDER BY e.id
       ${cap}`
  }

  if (entityType === 'person') {
    return `
      SELECT e.id AS entity_id,
             (s.slug IS NOT NULL) AS has_slug,
             (BTRIM(COALESCE(e.name, '')) <> '') AS has_title,
             (t.entity_id IS NOT NULL) AS has_translation,
             (SELECT COUNT(*)::int FROM cast_members cm
                JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
                  AND ws.language_code = $1 AND ws.is_canonical
               WHERE cm.person_id = e.id AND cm.entity_type IN ('movie','tv'))
           + (SELECT COUNT(*)::int FROM crew_members rm
                JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
                  AND ws.language_code = $1 AND ws.is_canonical
               WHERE rm.person_id = e.id AND rm.entity_type IN ('movie','tv')) AS credits,
             false AS has_synopsis,
             (BTRIM(COALESCE(e.profile_path, '')) <> '') AS has_image,
             -- Texto E licenca: a coluna de governanca nasce unknown, e bio
             -- ingerida sem liberacao nao aparece na tela.
             (BTRIM(COALESCE(e.biography, '')) <> ''
              AND e.biography_source_status::text IN ${BIOGRAPHY_DISPLAYABLE_STATUSES}) AS has_biography,
             0 AS listed_episodes,
             NULL::bigint AS parent_id,
             NULL::int AS season_number,
             NULL::int AS episode_number,
             s.slug AS url,
             d.decision::text AS cur_decision,
             d.reason AS cur_reason,
             d.policy_version AS cur_policy
        FROM people e
        LEFT JOIN slugs s
          ON s.entity_type = 'person' AND s.entity_id = e.id
         AND s.language_code = $1 AND s.is_canonical
        LEFT JOIN entity_translations t
          ON t.entity_type = 'person' AND t.entity_id = e.id AND t.language_code = $1
        ${currentDecision('person', 'e.id')}
       WHERE ${after}
       ORDER BY e.id
       ${cap}`
  }

  if (entityType === 'season') {
    return `
      SELECT e.id AS entity_id,
             (s.slug IS NOT NULL) AS has_slug,
             (BTRIM(COALESCE(sh.name_original, '')) <> '' AND e.season_number >= 1) AS has_title,
             -- Temporada NAO tem linha em entity_translations (a ingestao so
             -- cria para movie/tv/person). A politica sabe disso e nao consulta
             -- este campo para este tipo.
             true AS has_translation,
             0 AS credits,
             (BTRIM(COALESCE(e.overview, '')) <> '') AS has_synopsis,
             (BTRIM(COALESCE(e.poster_path, '')) <> '') AS has_image,
             false AS has_biography,
             (SELECT COUNT(*)::int FROM episodes ep WHERE ep.season_id = e.id) AS listed_episodes,
             e.tv_show_id AS parent_id,
             e.season_number AS season_number,
             NULL::int AS episode_number,
             s.slug AS url,
             d.decision::text AS cur_decision,
             d.reason AS cur_reason,
             d.policy_version AS cur_policy
        FROM seasons e
        JOIN tv_shows sh ON sh.id = e.tv_show_id
        LEFT JOIN slugs s
          ON s.entity_type = 'tv' AND s.entity_id = e.tv_show_id
         AND s.language_code = $1 AND s.is_canonical
        ${currentDecision('season', 'e.id')}
       WHERE ${after}
       ORDER BY e.id
       ${cap}`
  }

  return `
    SELECT e.id AS entity_id,
           (s.slug IS NOT NULL) AS has_slug,
           (BTRIM(COALESCE(sh.name_original, '')) <> ''
            AND se.season_number >= 1 AND e.episode_number >= 1) AS has_title,
           true AS has_translation,
           0 AS credits,
           (BTRIM(COALESCE(e.overview, '')) <> '') AS has_synopsis,
           (BTRIM(COALESCE(e.still_path, '')) <> '') AS has_image,
           false AS has_biography,
           0 AS listed_episodes,
           e.tv_show_id AS parent_id,
           se.season_number AS season_number,
           e.episode_number AS episode_number,
           s.slug AS url,
           d.decision::text AS cur_decision,
           d.reason AS cur_reason,
           d.policy_version AS cur_policy
      FROM episodes e
      JOIN seasons se ON se.id = e.season_id
      JOIN tv_shows sh ON sh.id = e.tv_show_id
      LEFT JOIN slugs s
        ON s.entity_type = 'tv' AND s.entity_id = e.tv_show_id
       AND s.language_code = $1 AND s.is_canonical
      ${currentDecision('episode', 'e.id')}
     WHERE ${after}
     ORDER BY e.id
     ${cap}`
}

/**
 * Le UMA PAGINA dos fatos de indexabilidade de um tipo de entidade.
 *
 * Uma consulta por pagina, com LEFT JOIN na decisao vigente — evita N+1 e
 * permite decidir "mudou?" sem uma segunda ida ao banco por entidade.
 */
async function readFactsPage(
  prisma: PrismaClient,
  entityType: CatalogDecisionEntityType,
  language: string,
  pageSize: number,
  afterId: bigint,
): Promise<EntityFactRow[]> {
  return await prisma.$queryRawUnsafe<EntityFactRow[]>(
    factsSql(entityType, pageSize, afterId),
    language,
  )
}

/**
 * Tamanho de uma pagina de leitura. NAO e teto de avaliacao — e quantas linhas
 * ficam na memoria de cada vez.
 *
 * Confundir os dois foi exatamente o defeito: o antigo `limit ?? 100_000` era um
 * `LIMIT` de SQL que parava a leitura, e o censo reportava o que tinha lido como
 * se fosse o total. Ver `EntityTypeCensus.truncated`.
 */
export const FACTS_PAGE_SIZE = 20_000

/**
 * Varre TODAS as linhas de um tipo, em paginas por chave (`e.id > ultimo`).
 *
 * `cap` (o `--limit` do operador) e um teto DECLARADO de quantas entidades
 * avaliar. Quando ele existe e e atingido, o chamador precisa saber — daqui sai
 * `truncated`, e nao uma inferencia de "veio numero redondo".
 *
 * Sem `cap`, varre ate a pagina voltar vazia: o censo soma o TOTAL REAL.
 *
 * `outcome.truncated` e escrito por REFERENCIA porque um `for await` descarta o
 * valor de retorno do gerador. E a distincao importa: um tipo com exatamente
 * `cap` linhas foi lido INTEIRO, e reporta-lo como truncado faria o operador
 * desconfiar de um censo completo. Por isso a varredura confirma o fim
 * consultando UMA pagina a mais em vez de deduzir do numero.
 */
async function* readFactsPages(
  prisma: PrismaClient,
  entityType: CatalogDecisionEntityType,
  language: string,
  cap: number | null,
  outcome: { truncated: boolean } = { truncated: false },
): AsyncGenerator<readonly EntityFactRow[], void, void> {
  let after = 0n
  let lidas = 0
  for (;;) {
    const restante = cap === null ? FACTS_PAGE_SIZE : Math.min(FACTS_PAGE_SIZE, cap - lidas)
    if (restante <= 0) {
      // Bateu no teto. So e TRUNCADO se ainda houver linha depois — uma sonda de
      // 1 linha responde isso sem varrer o resto do tipo.
      const sobra = await readFactsPage(prisma, entityType, language, 1, after)
      outcome.truncated = sobra.length > 0
      return
    }
    const page = await readFactsPage(prisma, entityType, language, restante, after)
    if (page.length === 0) return
    lidas += page.length
    // `ORDER BY e.id` garante que o ultimo da pagina e o maior id visto.
    after = page[page.length - 1]?.entity_id ?? after
    yield page
    // Pagina incompleta = fim do conjunto (nao ha mais linha depois de `after`).
    if (page.length < restante) return
  }
}

/** Monta os fatos puros a partir da linha crua, por tipo. */
function toFacts(
  entityType: CatalogDecisionEntityType,
  language: string,
  row: EntityFactRow,
  publishableSeries: ReadonlySet<string>,
): CatalogEntityFacts {
  const base = {
    entityType,
    language,
    hasCanonicalSlug: row.has_slug,
    hasTitle: row.has_title,
    hasTranslation: row.has_translation,
  }
  if (entityType === 'person') {
    return {
      ...base,
      publishableCreditCount: Number(row.credits),
      hasDisplayableBiography: row.has_biography,
      hasImage: row.has_image,
    }
  }
  if (entityType === 'season' || entityType === 'episode') {
    return {
      ...base,
      parentPublishable: row.parent_id !== null && publishableSeries.has(String(row.parent_id)),
      hasSynopsis: row.has_synopsis,
      hasImage: row.has_image,
      listedEpisodeCount: Number(row.listed_episodes),
    }
  }
  return { ...base, hasSynopsis: row.has_synopsis, hasImage: row.has_image }
}

/**
 * Ids das SERIES publicaveis, para o gate herdado de temporada/episodio.
 *
 * Roda a POLITICA sobre cada serie em vez de traduzir o gate para SQL: se
 * amanha a serie ganhar uma condicao nova, temporada e episodio a herdam sem
 * que ninguem se lembre de editar uma segunda consulta.
 *
 * SEM `cap`: o teto do comando corta quantas temporadas/episodios sao
 * avaliados, nunca quantas series sustentam o gate. Cortar aqui faria
 * temporadas legitimas cairem em `parent_not_publishable` so porque a serie
 * dona ficou fora da pagina de leitura — e o censo apontaria uma cascata que
 * nao existe.
 */
async function readPublishableSeriesIds(
  prisma: PrismaClient,
  language: string,
): Promise<ReadonlySet<string>> {
  const ids = new Set<string>()
  for await (const page of readFactsPages(prisma, 'tv', language, null)) {
    for (const row of page) {
      const decision = decideCatalogIndexability(toFacts('tv', language, row, new Set()))
      if (decision.decision === 'index') ids.add(String(row.entity_id))
    }
  }
  return ids
}

/**
 * Roda o produtor sobre TODOS os tipos pedidos, numa unica execucao.
 *
 * "Todos numa execucao" nao e detalhe de implementacao: o censo do freio e
 * GLOBAL. 300 filmes e 300 series saindo do sitemap sao 600 flips, nao dois
 * lotes de 300 — contar por tipo deixaria a mudanca inteira passar.
 *
 * `dryRun` calcula tudo e nao grava — e o modo que permite revisar quantas
 * entidades mudariam de estado ANTES de mexer numa tabela que o sitemap le.
 *
 * `confirmMassChange` e o opt-in HUMANO do freio: sem ele, uma execucao cujos
 * flips passem do teto grava zero linhas (ver `massChange.blocked` no resumo).
 * O ciclo horario nao-atendido nunca passa essa flag — e por isso que ele nao
 * consegue reindexar o catalogo sozinho.
 */
export async function produceIndexabilityDecisions(
  prisma: PrismaClient,
  options: {
    readonly language: string
    readonly entityTypes?: readonly CatalogDecisionEntityType[]
    /**
     * Teto EXPLICITO de entidades avaliadas POR TIPO. Omitido = sem teto (varre
     * o tipo inteiro, em paginas de {@link FACTS_PAGE_SIZE}).
     *
     * Quando informado e atingido, o tipo sai marcado `truncated` no censo e o
     * comando avisa em texto. Um teto silencioso e o defeito que esta opcao
     * deixou de ter.
     */
    readonly limit?: number
    readonly dryRun: boolean
    readonly now: () => Date
    /** Opt-in explicito para mudanca em massa. Default: false. */
    readonly confirmMassChange?: boolean
    /** Tetos do freio. Omitidos = `DEFAULT_MASS_CHANGE_THRESHOLDS`. */
    readonly massChangeThresholds?: Partial<MassChangeThresholds>
  },
): Promise<IndexabilityRunSummary> {
  const types = options.entityTypes ?? DECIDABLE_ENTITY_TYPES
  // SEM TETO POR PADRAO. Ate 2026-08-28 este default era `100_000`, aplicado
  // como `LIMIT` de SQL POR TIPO. `season`, `episode` e `person` batiam nele e o
  // censo reportava exatamente 100.000 avaliadas para cada um — tres numeros
  // redondos identicos que qualquer leitor tomava por medicao. Nao era: era o
  // teto se declarando como resultado. O `--limit` continua existindo como teto
  // EXPLICITO do operador, e agora quem o usa e avisado (ver `truncated`).
  const cap = options.limit ?? null
  const byDecision: Record<string, number> = {}
  const byReason: Record<string, number> = {}
  const plan: PlannedWrite[] = []
  let evaluated = 0
  let unchanged = 0

  // Censo por TIPO, acumulado no mesmo laco que ja visita cada linha. Uma
  // segunda passada sobre `plan` daria created/updated, mas nao daria
  // `byDecision`/`byReason` por tipo: o plano so contem o que MUDA, e a pergunta
  // "quantos filmes ficam noindex" inclui os que ja estavam.
  const perType = new Map<
    string,
    {
      evaluated: number
      byDecision: Record<string, number>
      byReason: Record<string, number>
      created: number
      updated: number
      unchanged: number
      truncated: boolean
    }
  >()
  const bucket = (entityType: string) => {
    let found = perType.get(entityType)
    if (found === undefined) {
      found = {
        evaluated: 0,
        byDecision: {},
        byReason: {},
        created: 0,
        updated: 0,
        unchanged: 0,
        truncated: false,
      }
      perType.set(entityType, found)
    }
    return found
  }

  // O gate herdado precisa das series MESMO quando `--entity season` nao pede
  // `tv`: sem isso toda temporada cairia em `parent_not_publishable` e o censo
  // mentiria sobre a causa.
  const needsParents = types.includes('season') || types.includes('episode')
  const publishableSeries = needsParents
    ? await readPublishableSeriesIds(prisma, options.language)
    : new Set<string>()

  // ---- FASE 1: planeja. Nenhuma escrita acontece neste laco. ----
  for (const entityType of types) {
    const slotTipo = bucket(entityType)
    const varredura = { truncated: false }
    for await (const rows of readFactsPages(prisma, entityType, options.language, cap, varredura)) {
      for (const row of rows) {
        evaluated += 1
        const decision: CatalogIndexabilityDecision = decideCatalogIndexability(
          toFacts(entityType, options.language, row, publishableSeries),
        )

        byDecision[decision.decision] = (byDecision[decision.decision] ?? 0) + 1
        byReason[decision.reason] = (byReason[decision.reason] ?? 0) + 1

        const slot = bucket(entityType)
        slot.evaluated += 1
        slot.byDecision[decision.decision] = (slot.byDecision[decision.decision] ?? 0) + 1
        slot.byReason[decision.reason] = (slot.byReason[decision.reason] ?? 0) + 1

        const previous =
          row.cur_decision === null
            ? null
            : {
                decision: row.cur_decision,
                reason: row.cur_reason,
                policyVersion: row.cur_policy,
              }

        if (!decisionChanged(decision, previous)) {
          unchanged += 1
          slot.unchanged += 1
          continue
        }

        // NASCE (nunca teve linha vigente) vs TROCA (ja tinha veredito). So o
        // segundo pode tirar do indice uma pagina que o buscador ja conhece.
        if (row.cur_decision === null) slot.created += 1
        else slot.updated += 1

        plan.push({
          entityType,
          entityId: row.entity_id,
          // `routeFor` precisa da LINHA (temporada/episodio montam a URL com os
          // numeros), entao a rota e resolvida ja no plano — a fase 2 nao guarda
          // as linhas cruas so para isso.
          url: routeFor(entityType, row),
          decision,
          previousDecision: row.cur_decision,
          nextDecision: decision.decision,
          nextReason: decision.reason,
        })
      }
    }
    // TRUNCADO = a varredura parou no teto E AINDA HAVIA LINHA depois. Nao e
    // inferido de "o numero veio redondo", nem de "bateu no teto": e o proprio
    // produtor dizendo que deixou entidade para tras.
    slotTipo.truncated = varredura.truncated
  }

  // ---- Mede o tamanho da mudanca ANTES de gravar qualquer coisa. ----
  const census = censusMassChange(plan, evaluated)
  const massChange = evaluateMassChangeBrake({
    census,
    ...(options.massChangeThresholds !== undefined
      ? { thresholds: options.massChangeThresholds }
      : {}),
    confirmed: options.confirmMassChange === true,
  })

  // Congela o censo por tipo uma vez so — `summary()` e chamado em dois pontos.
  const byEntityType: Record<string, EntityTypeCensus> = {}
  let created = 0
  let updated = 0
  for (const [entityType, slot] of perType) {
    created += slot.created
    updated += slot.updated
    byEntityType[entityType] = Object.freeze({
      evaluated: slot.evaluated,
      truncated: slot.truncated,
      byDecision: Object.freeze({ ...slot.byDecision }),
      byReason: Object.freeze({ ...slot.byReason }),
      writes: Object.freeze({
        created: slot.created,
        updated: slot.updated,
        unchanged: slot.unchanged,
      }),
    })
  }
  Object.freeze(byEntityType)

  const truncatedTypes = Object.freeze(
    [...perType.entries()].filter(([, slot]) => slot.truncated).map(([tipo]) => tipo),
  )

  const summary = (written: number): IndexabilityRunSummary => ({
    schemaVersion: INDEXABILITY_SUMMARY_SCHEMA_VERSION,
    language: options.language,
    dryRun: options.dryRun,
    evaluated,
    written,
    unchanged,
    truncatedTypes,
    planned: plan.length,
    writes: Object.freeze({ created, updated, unchanged }),
    byEntityType,
    byDecision: Object.freeze(byDecision),
    byReason: Object.freeze(byReason),
    massChange,
    flipsByReason: census.byReason,
    flipsByEntityType: census.byEntityType,
    changes: plan.slice(0, 50).map((p) => ({
      entityType: p.entityType,
      entityId: String(p.entityId),
      from: p.previousDecision,
      to: p.nextDecision,
      reason: p.nextReason,
      flip: classifyIndexFlip(p.previousDecision, p.nextDecision),
    })),
  })

  // ---- FASE 2: grava, se o freio deixar. ----
  // `blocked` recusa a execucao INTEIRA: zero linhas. Aplicar "a parte segura"
  // deixaria o catalogo num estado que nenhuma politica descreve.
  if (massChange.blocked || options.dryRun) return summary(0)

  let written = 0
  for (const item of plan) {
    const decidedAt = options.now()

    // Despromove a anterior e insere a nova apontando para ela, na MESMA
    // transacao: nunca ha janela com duas vigentes nem historico orfao.
    await prisma.$transaction(async (tx) => {
      const current = await tx.pageIndexabilityDecision.findFirst({
        where: {
          entityType: item.entityType as never,
          entityId: item.entityId,
          languageCode: options.language,
          isCurrent: true,
        },
        select: { id: true },
      })
      if (current !== null) {
        await tx.pageIndexabilityDecision.update({
          where: { id: current.id },
          data: { isCurrent: false },
        })
      }
      await tx.pageIndexabilityDecision.create({
        data: {
          entityType: item.entityType as never,
          entityId: item.entityId,
          languageCode: options.language,
          url: item.url,
          decision: item.decision.decision as never,
          reason: item.decision.reason,
          isCurrent: true,
          supersedesId: current?.id ?? null,
          policyVersion: item.decision.policyVersion,
          decisionOrigin: item.decision.origin,
          decidedAt,
        },
      })
    })
    written += 1
  }

  return summary(written)
}
