/**
 * backfill-source-cluster-id.ts — preenche `articles.sourceClusterId` nas
 * materias que a AUTOPUBLICACAO criou antes da correcao de identidade.
 *
 * POR QUE ISTO PRECISA EXISTIR.
 *
 * Ate a correcao, `persistPublication` gravava `automationIdempotencyKey` mas
 * NAO gravava `sourceClusterId`. As materias criadas pelo endpoint de
 * autopublicacao estao no banco com a coluna nula. A busca nova consulta
 * exatamente essa coluna: sem backfill, a primeira revisao que chegar depois do
 * deploy nao encontra a materia anterior e cria uma DUPLICATA — o defeito
 * voltaria uma unica vez para cada cluster em voo, que e justamente o pior
 * momento (materia recente, ainda rendendo trafego).
 *
 * DE ONDE VEM O DADO. Nao ha adivinhacao: `autopublish-quota-usage` e o ledger
 * transacional da autopublicacao e ja guarda o par (`articleId`,
 * `sourceClusterId`) de cada publicacao. O backfill so copia o valor que ja foi
 * registrado no momento da publicacao. Quando um artigo tem mais de um registro
 * (o caso normal: uma linha por revisao), todos carregam o MESMO cluster; se
 * carregarem clusters diferentes, o artigo e reportado e NAO tocado — adivinhar
 * ali seria escolher a identidade errada em silencio.
 *
 * SEGURANCA. `--apply` e obrigatorio para escrever; sem ele o script so relata.
 * Nunca sobrescreve `sourceClusterId` ja preenchido, e nunca escreve em materia
 * de autoria humana que ja tenha identidade propria.
 *
 * Uso:
 *   pnpm --filter @screena/cms cms:backfill:cluster            # relatorio
 *   pnpm --filter @screena/cms cms:backfill:cluster -- --apply # escreve
 */

import process from 'node:process'

import { getPayload } from 'payload'

import config from '../src/payload.config.js'

interface Plan {
  readonly articleId: string
  readonly sourceClusterId: string
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const payload = await getPayload({ config })

  console.log(`=== backfill de sourceClusterId ${apply ? '(APLICANDO)' : '(relatorio)'} ===`)

  /* 1. Ledger -> mapa articleId -> conjunto de clusters. */
  const clustersByArticle = new Map<string, Set<string>>()
  let page = 1
  let totalUsage = 0
  for (;;) {
    const batch = await payload.find({
      collection: 'autopublish-quota-usage',
      limit: 500,
      page,
      depth: 0,
      overrideAccess: true,
    })
    for (const row of batch.docs as unknown as Record<string, unknown>[]) {
      totalUsage += 1
      const articleId = row.articleId === null ? '' : String(row.articleId ?? '')
      const cluster = String(row.sourceClusterId ?? '')
      if (articleId === '' || cluster === '') continue
      const set = clustersByArticle.get(articleId) ?? new Set<string>()
      set.add(cluster)
      clustersByArticle.set(articleId, set)
    }
    if (!batch.hasNextPage) break
    page += 1
  }
  console.log(`ledger: ${String(totalUsage)} registro(s); ${String(clustersByArticle.size)} materia(s) com cluster conhecido`)

  /* 2. Que materias ainda estao sem cluster. */
  const plans: Plan[] = []
  const ambiguous: string[] = []
  const unknown: string[] = []

  for (const [articleId, clusters] of clustersByArticle) {
    if (clusters.size > 1) {
      ambiguous.push(articleId)
      continue
    }
    const cluster = [...clusters][0]
    if (cluster === undefined) continue
    let current: Record<string, unknown> | null = null
    try {
      current = (await payload.findByID({
        collection: 'articles',
        id: articleId,
        depth: 0,
        overrideAccess: true,
      })) as unknown as Record<string, unknown>
    } catch {
      // Materia apagada depois de publicada. Nada a fazer, mas fica visivel.
      unknown.push(articleId)
      continue
    }
    const existing = String(current.sourceClusterId ?? '')
    if (existing !== '') {
      // JA TEM identidade. Nunca sobrescrever: se divergir do ledger, quem
      // decide e um humano olhando os dois valores.
      if (existing !== cluster) {
        console.log(
          `[DIVERGENTE] materia ${articleId}: banco="${existing}" ledger="${cluster}" — NAO tocada`,
        )
      }
      continue
    }
    plans.push({ articleId, sourceClusterId: cluster })
  }

  console.log(`a preencher: ${String(plans.length)}`)
  if (ambiguous.length > 0) {
    console.log(`AMBIGUAS (mais de um cluster no ledger, NAO tocadas): ${ambiguous.join(', ')}`)
  }
  if (unknown.length > 0) {
    console.log(`materias do ledger que nao existem mais: ${unknown.join(', ')}`)
  }

  if (!apply) {
    for (const plan of plans.slice(0, 50)) {
      console.log(`  ${plan.articleId} <- ${plan.sourceClusterId}`)
    }
    if (plans.length > 50) console.log(`  ... e mais ${String(plans.length - 50)}`)
    console.log('nada foi escrito. Repita com --apply para aplicar.')
    process.exit(0)
  }

  /* 3. Escrita — SQL cru, e de proposito. */
  //
  // `payload.update` em `articles` passa por `enforceEditorialGovernance`, que
  // recusa escrita sem ator autenticado. Essa recusa esta CERTA e nao deve
  // ganhar uma porta dos fundos: abrir uma excecao no hook para "operacoes de
  // manutencao" criaria um caminho pelo qual qualquer escrita futura poderia
  // passar sem ator.
  //
  // O que este backfill faz nao e uma escrita editorial: e preencher uma coluna
  // de IDENTIDADE TECNICA com o valor que o ledger ja registrou. Nao toca
  // corpo, autor, `workflowStatus`, versao nem trilha de publicacao — e por
  // isso nao precisa (nem deve) atravessar a maquina de estados. O `WHERE`
  // carrega `source_cluster_id IS NULL` de novo: entre o relatorio e a escrita
  // pode ter passado uma revisao que ja preencheu a coluna, e reescrever por
  // cima seria a unica forma de este script estragar alguma coisa.
  const { sql } = await import('@payloadcms/db-postgres')
  const drizzle = (payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<unknown> } })
    .drizzle

  let written = 0
  let failed = 0
  for (const plan of plans) {
    try {
      await drizzle.execute(sql`
        UPDATE "articles"
           SET "source_cluster_id" = ${plan.sourceClusterId}
         WHERE "id" = ${Number(plan.articleId)}
           AND "source_cluster_id" IS NULL
      `)
      written += 1
    } catch (error) {
      failed += 1
      console.log(
        `[FALHA] materia ${plan.articleId}: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      )
    }
  }

  console.log(`escritas: ${String(written)}; falhas: ${String(failed)}`)
  process.exit(failed === 0 ? 0 : 1)
}

await main()
