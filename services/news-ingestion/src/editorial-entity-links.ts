/**
 * editorial-entity-links.ts — `event.entities` -> vinculos de `entity_news_links`.
 * PURO.
 *
 * Este e o elo que estava cortado: o CMS ja emitia as entidades confirmadas por
 * humano e o worker as descartava no mapeamento. Sem esta traducao, uma materia
 * chegava ao banco publico sem saber de que filme ela fala — e as tres
 * superficies que dependem de `entity_news_links` (ficha do titulo na materia,
 * chips de entidade citada e "noticias relacionadas" na ficha do filme) ficavam
 * permanentemente vazias, com o dado existindo dos dois lados.
 *
 * O que este modulo NAO faz, de proposito:
 *  - nao verifica se a entidade existe no catalogo (isso e IO; fica no adapter);
 *  - nao inventa suporte a tipo que o lado publico nao sabe renderizar.
 */

/**
 * Tipos de entidade que o lado publico REALMENTE vincula a uma materia.
 *
 * Deliberadamente menor que `ENTITY_KINDS` do contrato (que tem `season`,
 * `episode`, `character` e `franchise`) e menor que o enum `EntityType` do banco
 * (que tem `season` e `episode`).
 *
 * O corte nao e preguica: `entity_news_links` so vale se alguem resolver o
 * vinculo em titulo + slug canonico, e as tres superficies publicas
 * (`news-pages.ts`, `related-news.ts`, `home-editorial.ts`) resolvem
 * exclusivamente movie|tv|person. Gravar um vinculo de `season` produziria uma
 * linha que nenhuma pagina le — dado morto que parece feature.
 *
 * `character` e `franchise` nao existem nem como `EntityType` no banco: gravar
 * um deles abortaria a transacao inteira no enum do PostgreSQL, levando junto o
 * recibo e transformando uma materia projetavel em falha permanente.
 */
export const PUBLIC_LINKABLE_ENTITY_KINDS = ['movie', 'tv', 'person'] as const
export type PublicLinkableEntityKind = (typeof PUBLIC_LINKABLE_ENTITY_KINDS)[number]

export function isPublicLinkableEntityKind(kind: string): kind is PublicLinkableEntityKind {
  return (PUBLIC_LINKABLE_ENTITY_KINDS as readonly string[]).includes(kind)
}

/** Entidade confirmada, como o evento a entrega. */
export interface EventEntityLink {
  readonly entityKind: string
  /** Id interno do Cinerie, em texto (o contrato usa `stableId`). */
  readonly entityId: string
  readonly relation: string
}

/** Vinculo pronto para `entity_news_links` (ainda nao verificado no catalogo). */
export interface PlannedEntityLink {
  readonly entityType: PublicLinkableEntityKind
  /** Id numerico em texto: o adapter converte para BigInt. */
  readonly entityId: string
}

export interface EntityLinkPlan {
  readonly links: readonly PlannedEntityLink[]
  /** Avisos operacionais — nao bloqueiam a publicacao, mas ficam no log. */
  readonly warnings: readonly string[]
}

/**
 * `entityId` do contrato -> id numerico canonico, ou `null`.
 *
 * FAIL-CLOSED. `entity_id` e BigInt no banco; qualquer coisa que nao seja um
 * inteiro positivo decimal e recusada em vez de "melhor esforco". Um `parseInt`
 * tolerante aqui transformaria `"12abc"` em vinculo para o filme 12 — uma
 * materia sobre um filme apontando para outro, silenciosamente.
 */
export function toCatalogEntityId(value: string): string | null {
  const trimmed = value.trim()
  if (!/^[0-9]+$/.test(trimmed)) return null
  // Zeros a esquerda produziriam duas representacoes textuais do mesmo id e
  // furariam a deduplicacao abaixo.
  const normalized = trimmed.replace(/^0+(?=[0-9])/, '')
  if (normalized === '0') return null
  // `entity_id` e BIGINT no PostgreSQL. O `BigInt` do JavaScript aceita
  // inteiro de qualquer tamanho, entao um id de 30 digitos passaria a regex,
  // viraria BigInt sem reclamar e SO estouraria no banco — abortando a
  // transacao e levando junto o recibo, o que transforma uma materia
  // publicavel em falha permanente por causa de um digito a mais.
  if (BigInt(normalized) > MAX_BIGINT) return null
  return normalized
}

/** Teto de `bigint` do PostgreSQL (`int8`). */
const MAX_BIGINT = 9_223_372_036_854_775_807n

/**
 * Planeja os vinculos publicos de uma materia.
 *
 * O conjunto devolvido e AUTORITATIVO: o evento carrega todas as entidades
 * verificadas do documento, entao o adapter pode reconciliar (remover o que
 * saiu) sem adivinhar. Uma entidade que o editor desmarcou tem de deixar de
 * aparecer nas relacionadas do filme — nao basta parar de inserir.
 */
export function planEntityLinks(entities: readonly EventEntityLink[]): EntityLinkPlan {
  const links: PlannedEntityLink[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  for (const entity of entities) {
    const kind = entity.entityKind.trim()

    if (!isPublicLinkableEntityKind(kind)) {
      // Aviso ESTRUTURADO e nao erro: o CMS aceita `season`/`franchise` como
      // relacao editorial legitima, e recusar a materia por causa disso seria
      // punir a redacao por uma lacuna do lado publico.
      warnings.push(
        `entidade nao vinculavel: kind=${kind === '' ? '(vazio)' : kind} id=${entity.entityId} relation=${entity.relation}; suportados: ${PUBLIC_LINKABLE_ENTITY_KINDS.join('|')}`,
      )
      continue
    }

    const entityId = toCatalogEntityId(entity.entityId)
    if (entityId === null) {
      warnings.push(
        `entidade com id invalido: kind=${kind} id=${entity.entityId === '' ? '(vazio)' : entity.entityId}; esperado inteiro positivo`,
      )
      continue
    }

    const key = `${kind}:${entityId}`
    if (seen.has(key)) {
      // A unique do banco e (article, type, id): a mesma entidade citada duas
      // vezes com relacoes diferentes e UM vinculo, nao duas linhas.
      warnings.push(`entidade repetida ignorada: ${key}`)
      continue
    }
    seen.add(key)
    links.push({ entityType: kind, entityId })
  }

  return { links, warnings }
}
