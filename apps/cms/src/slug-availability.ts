/**
 * slug-availability.ts — Resolve a slug contra o que JA existe no banco.
 *
 * POR QUE ESTE ARQUIVO EXISTE.
 *
 * Ha DOIS caminhos que criam materia: `endpoints/editorial-publications.ts`
 * (autopublicacao) e `endpoints/editorial-drafts.ts` (ingestao de rascunho do
 * MNScr). So o primeiro resolvia colisao — o segundo gravava a `slugProposal`
 * crua (`draft-intake.ts:192`). Enquanto nao havia constraint, isso passava:
 * duas materias com a mesma slug conviviam e a briga so aparecia na projecao,
 * no banco publico, com erro de outro sistema.
 *
 * Com o indice unico `(language, slug)` de
 * `migrations/20260805_013000_articles_slug_unique_per_language`, o segundo
 * caminho passaria a estourar no INSERT com mensagem do PostgreSQL nomeando o
 * indice. Foi exatamente o que a suite de integracao mostrou quando o indice
 * entrou — a constraint nao criou o defeito, ela o tornou visivel.
 *
 * A logica mora aqui, e nao duplicada nos dois endpoints, porque foi a
 * duplicacao que deixou um deles para tras.
 */

import type { PayloadRequest, Where } from 'payload'

import { describeArticleHolder, resolveSlugCollision, SlugCollisionError } from './canonical-slug.js'

/** Quantas variacoes buscar de uma vez. Acompanha o teto de sufixos. */
const LOOKUP_LIMIT = 60

/**
 * Devolve uma slug LIVRE para `(language)`, sufixando se preciso.
 *
 * A busca e escopada por IDIOMA porque a unicidade real e do par: a versao en e
 * a pt-BR da mesma materia podem — e devem — compartilhar a slug. Varrer sem o
 * filtro inventava colisao entre traducoes e sufixava uma URL que estava livre.
 *
 * `excludeId` tira a propria materia da conta numa ATUALIZACAO; sem ele, toda
 * regravacao acharia a si mesma e sufixaria a slug a cada save.
 *
 * Lanca `SlugCollisionError` quando nem o sufixo resolve. Nao devolve a slug
 * colidida: seguir com ela era o que o `catch` vazio fazia, e o resultado era
 * 2xx aqui com falha depois, longe de quem poderia entender.
 */
export async function resolveAvailableSlug(
  req: PayloadRequest,
  input: {
    readonly slug: string
    readonly language: string
    readonly excludeId?: string | null
  },
): Promise<string> {
  const slug = input.slug.trim()
  // Slug vazia e "ainda nao tem slug", nao colisao: o indice e parcial e
  // ignora vazio e nulo justamente para o rascunho poder existir sem titulo.
  if (slug === '') return slug

  const conditions: Where[] = [
    { slug: { like: `${slug}%` } },
    { language: { equals: input.language } },
  ]
  if (input.excludeId !== undefined && input.excludeId !== null) {
    conditions.push({ id: { not_equals: input.excludeId } })
  }

  const found = await req.payload.find({
    collection: 'articles',
    where: { and: conditions },
    limit: LOOKUP_LIMIT,
    depth: 0,
    // Leitura de VERIFICACAO: precisa enxergar o acervo inteiro para nao
    // liberar uma slug que existe e o ator apenas nao pode ler.
    overrideAccess: true,
    req,
  })

  const holders = new Map<string, string>()
  for (const doc of found.docs) {
    const taken = String((doc as { slug?: unknown }).slug ?? '')
    if (taken === '') continue
    holders.set(taken, describeArticleHolder(doc as unknown as Record<string, unknown>))
  }

  const resolved = resolveSlugCollision(slug, new Set(holders.keys()))
  if (resolved === null) {
    throw new SlugCollisionError(slug, input.language, holders.get(slug) ?? null)
  }
  return resolved
}
