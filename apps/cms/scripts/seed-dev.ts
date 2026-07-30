/**
 * seed-dev.ts — Seed de DESENVOLVIMENTO do CMS editorial.
 *
 * Cria apenas o que precisa existir para a redacao funcionar num ambiente novo:
 * o autor institucional **Redacao Cinerie**.
 *
 * O que este seed DELIBERADAMENTE nao faz:
 *  - nao cria administrador nem qualquer usuario com senha;
 *  - nao cria service account;
 *  - nao gera API key;
 *  - nao imprime segredo, URL de banco ou credencial.
 *
 * Seed que cria credencial conhecida e um backdoor com nome amigavel: se ele
 * rodar por engano num ambiente exposto, a conta ja nasce comprometida. Contas
 * humanas e tecnicas sao criadas por quem opera o servico, uma a uma.
 *
 * IDEMPOTENTE: rodar duas vezes nao duplica. Se o autor ja existir, so os campos
 * GOVERNADOS por este seed sao reconciliados — nome, rotulo e o marcador de
 * organizacao. `active` NAO e tocado: desativar a Redacao e uma decisao
 * editorial, e o seed nao a desfaz.
 */

import { requireCmsConfig } from '../src/env.js'

/** Slug do autor institucional. Chave de idempotencia deste seed. */
export const INSTITUTIONAL_AUTHOR_SLUG = 'redacao-cinerie'

/** Campos que este seed governa. Tudo fora desta lista e do humano. */
export const SEEDED_AUTHOR_FIELDS = ['name', 'roleLabel', 'isOrganization'] as const

const INSTITUTIONAL_AUTHOR = {
  name: 'Redação Cinerie',
  slug: INSTITUTIONAL_AUTHOR_SLUG,
  roleLabel: 'Redação',
  isOrganization: true,
} as const

export type SeedOutcome = 'created' | 'updated' | 'unchanged'

/** `true` quando o ambiente aparenta ser produtivo. */
export function looksLikeProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production'
}

/**
 * Aplica o seed. Recebe o `payload` ja inicializado para ser testavel contra o
 * PostgreSQL efemero sem duplicar a logica de bootstrap.
 */
export async function seedInstitutionalAuthor(payload: {
  find: (args: unknown) => Promise<{ docs: Record<string, unknown>[] }>
  create: (args: unknown) => Promise<Record<string, unknown>>
  update: (args: unknown) => Promise<Record<string, unknown>>
}): Promise<{ outcome: SeedOutcome; authorId: string }> {
  const existing = await payload.find({
    collection: 'authors',
    where: { slug: { equals: INSTITUTIONAL_AUTHOR_SLUG } },
    limit: 1,
    overrideAccess: true,
  })

  const current = existing.docs[0]
  if (current === undefined) {
    const created = await payload.create({
      collection: 'authors',
      data: { ...INSTITUTIONAL_AUTHOR, active: true },
      overrideAccess: true,
    })
    return { outcome: 'created', authorId: String(created.id) }
  }

  // Reconcilia SO os campos governados. `active` fica de fora de proposito.
  const drift: Record<string, unknown> = {}
  for (const field of SEEDED_AUTHOR_FIELDS) {
    const desired = INSTITUTIONAL_AUTHOR[field]
    if (current[field] !== desired) drift[field] = desired
  }

  if (Object.keys(drift).length === 0) {
    return { outcome: 'unchanged', authorId: String(current.id) }
  }

  const updated = await payload.update({
    collection: 'authors',
    id: current.id,
    data: drift,
    overrideAccess: true,
  })
  return { outcome: 'updated', authorId: String(updated.id) }
}

async function main(): Promise<void> {
  if (looksLikeProduction()) {
    throw new Error('seed:dev nao roda em producao. Abortado.')
  }

  // Valida a configuracao ANTES de subir o Payload: garante banco proprio e
  // recusa colisao com o banco publico. Nao imprime a URL.
  requireCmsConfig()

  const [{ getPayload }, configModule] = await Promise.all([
    import('payload'),
    import('../src/payload.config.js'),
  ])
  const payload = await getPayload({ config: configModule.default })

  try {
    const result = await seedInstitutionalAuthor(payload as never)
    const label =
      result.outcome === 'created'
        ? 'criado'
        : result.outcome === 'updated'
          ? 'reconciliado'
          : 'ja estava correto'
    console.log(`[seed:dev] autor institucional "${INSTITUTIONAL_AUTHOR.name}": ${label}`)
    console.log('[seed:dev] nenhum usuario, service account ou API key foi criado.')
  } finally {
    await payload.db.destroy?.()
  }
}

// Executa so quando chamado como script (o modulo tambem e importado por teste).
if (process.argv[1] !== undefined && process.argv[1].includes('seed-dev')) {
  main().catch((error: unknown) => {
    console.error('[seed:dev]', error instanceof Error ? error.message : 'falha desconhecida')
    process.exit(1)
  })
}
