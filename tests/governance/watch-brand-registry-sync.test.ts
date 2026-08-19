/**
 * watch-brand-registry-sync.test.ts — A decomposicao de marca e o registro
 * canonico de provedores falam dos MESMOS slugs. Um nao anda sem o outro.
 *
 * ============ POR QUE ESTE ARQUIVO PRECISA EXISTIR ============
 *
 * A decisao do dono foi "os tres campos sao declarados no registro". Eles nao
 * puderam morar LITERALMENTE em `services/streaming/src/provider-registry.ts`
 * por uma razao de arquitetura, nao de gosto: aquele arquivo pertence a um
 * WORKER, e o render publico nao pode depender de um servico de worker — nem
 * por um tipo — sem abrir a porta para um import futuro arrastar Prisma ou um
 * client de API para dentro do bundle (invariante 3).
 *
 * Entao a identidade tecnica (slug + aliases + evidencia) ficou no registro, e a
 * decomposicao de apresentacao (marca / variante / vendido em) ficou em
 * `@screena/public-contracts`, o pacote cuja razao de existir e exatamente
 * "contratos de apresentacao do render publico".
 *
 * DUAS LISTAS SAO UMA SO QUANDO NAO PODEM DIVERGIR. E o que este arquivo
 * garante, nos DOIS sentidos:
 *
 *  - provedor registrado sem declaracao => a tela decidiria por omissao, e um
 *    provedor novo entraria sem ninguem ter escolhido se ele agrupa;
 *  - declaracao para slug que nao existe => uma marca sem provedor, que nunca
 *    aparece e ninguem percebe (e que mascara um slug digitado errado).
 *
 * A alternativa — deixar os dois arquivos se olharem de longe — e exatamente
 * como o registro e a colheita divergiram antes de `evidence` existir.
 */

import { describe, expect, it } from 'vitest'

import {
  WATCH_BRAND_DECLARATIONS,
  findWatchBrand,
  validateWatchBrandDeclarations,
} from '@screena/public-contracts'

import { WATCH_PROVIDER_REGISTRY } from '../../services/streaming/src/provider-registry'

const registrySlugs = new Set(WATCH_PROVIDER_REGISTRY.map((entry) => entry.slug))
const declaredSlugs = new Set(WATCH_BRAND_DECLARATIONS.map((entry) => entry.slug))

describe('marca declarada x registro canonico', () => {
  it('a forma das declaracoes e valida', () => {
    expect(validateWatchBrandDeclarations(WATCH_BRAND_DECLARATIONS)).toEqual([])
  })

  it('TODO provedor registrado tem decisao de agrupamento declarada', () => {
    // `brand: null` conta: e a afirmacao "este aparece sozinho". O que nao pode
    // e o silencio — um provedor novo caindo no comportamento solo porque
    // ninguem escreveu nada.
    const semDeclaracao = [...registrySlugs].filter((slug) => !declaredSlugs.has(slug)).sort()
    expect(semDeclaracao).toEqual([])
  })

  it('TODA declaracao aponta para um provedor que existe no registro', () => {
    // Uma declaracao orfa nunca aparece na tela — e por isso mesmo esconde um
    // slug digitado errado, que so seria notado quando o agrupamento esperado
    // nao acontecesse em producao.
    const orfas = [...declaredSlugs].filter((slug) => !registrySlugs.has(slug)).sort()
    expect(orfas).toEqual([])
  })

  it('as duas listas tem exatamente o mesmo conjunto de slugs', () => {
    expect([...declaredSlugs].sort()).toEqual([...registrySlugs].sort())
  })
})

describe('as marcas que a leva BR criou', () => {
  it('cada marca com MAIS de um slug e um agrupamento real', () => {
    const porMarca = new Map<string, string[]>()
    for (const entry of WATCH_BRAND_DECLARATIONS) {
      if (entry.brand === null) continue
      const atual = porMarca.get(entry.brand) ?? []
      atual.push(entry.slug)
      porMarca.set(entry.brand, atual)
    }
    // As marcas que existem justamente porque a leva BR criou linhas repetidas.
    expect(porMarca.get('HBO Max')?.sort()).toEqual(['hbo-max-amazon-channel', 'max'])
    expect(porMarca.get('Paramount+')?.sort()).toEqual([
      'paramount-plus',
      'paramount-plus-amazon-channel',
      'paramount-plus-apple-tv-channel',
      'paramount-plus-premium',
    ])
    expect(porMarca.get('MGM+')?.sort()).toEqual([
      'mgm-plus-amazon-channel',
      'mgm-plus-apple-tv-channel',
    ])
    expect(porMarca.get('Looke')?.sort()).toEqual(['looke', 'looke-amazon-channel'])
  })

  it('CONTROLE NEGATIVO: os pares de nome parecido tem marcas DIFERENTES', () => {
    // Sao os pares que uma derivacao por string fundiria. Aqui a prova e sobre a
    // DECLARACAO (nao sobre a tela): os dois lados afirmam `brand: null`, logo
    // nunca compartilham balde.
    for (const slug of ['claro-video', 'claro-tv-plus', 'amazon-video', 'prime-video']) {
      expect(findWatchBrand(slug)?.brand, `${slug} nao pode ter marca`).toBeNull()
    }
  })

  it('todo qualificador nomeia um hospedeiro que o leitor reconhece', () => {
    // `soldVia` e a informacao que impede a linha de mentir: ela diz que o
    // leitor precisa do hospedeiro TAMBEM. Um valor tecnico ("amazon_channel")
    // ou um slug vazariam identificador de sistema para a tela.
    const hospedeiros = new Set(
      WATCH_BRAND_DECLARATIONS.map((entry) => entry.soldVia).filter(
        (value): value is string => value !== null,
      ),
    )
    expect([...hospedeiros].sort()).toEqual(['Apple TV', 'Prime Video'])
    for (const nome of hospedeiros) {
      expect(nome).not.toMatch(/[_-]/)
      expect(nome).toBe(nome.trim())
    }
  })
})
