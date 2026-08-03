/**
 * import-map.test.ts — a travessia entre o que a configuracao PEDE e o que o
 * import map OFERECE.
 *
 * POR QUE ESTE ARQUIVO EXISTE.
 *
 * Um componente customizado que o Payload nao consegue resolver **nao quebra a
 * tela**: o campo simplesmente nao aparece, e o formulario continua com cara de
 * normal. O aviso sai no console do SERVIDOR, nao no do navegador. Foi assim que
 * a marca, o dashboard e seis componentes ficaram inertes sem ninguem notar — o
 * typecheck passava (as chaves sao strings validas), o lint passava, os testes
 * puros passavam, e o E2E so acusou porque tentou preencher um campo que tinha
 * sumido.
 *
 * A regra que quebrou, e que este teste trava:
 *
 *   `getFromImportMap` procura por `path + '#' + exportName`, e
 *   `parsePayloadComponent` assume `exportName = 'default'` quando a string da
 *   configuracao nao traz `#`.
 *
 * Entao `Field: '/src/admin/SlugField'` na collection precisa de
 * `'/src/admin/SlugField#default'` no map. A diferenca e um sufixo, e o custo de
 * erra-lo e uma tela inteira que parece certa e nao funciona.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const cmsRoot = resolve(here, '../..')

/**
 * O map e lido como TEXTO, nao importado.
 *
 * Importar o modulo puxaria os componentes React de verdade e, com eles, o CSS
 * do `@payloadcms/ui` — que o runner puro nao sabe carregar. E o que importa
 * aqui e exatamente a string da chave, que o texto entrega sem intermediario.
 */
const importMapSource = readFileSync(
  resolve(cmsRoot, 'app/(payload)/admin/importMap.ts'),
  'utf8',
)

/** Chaves declaradas no objeto `importMap`. */
function importMapKeys(): string[] {
  const body = importMapSource.slice(importMapSource.indexOf('export const importMap'))
  return [...body.matchAll(/'([^']+)':\s*[A-Za-z]/g)].map((match) => match[1] as string)
}

/** Identificadores importados no topo do arquivo. */
function importedIdentifiers(): string[] {
  return [...importMapSource.matchAll(/^import\s+([A-Za-z0-9_]+)\s+from/gm)].map(
    (match) => match[1] as string,
  )
}

/** Caminhos `/src/admin/...` que a configuracao referencia POR STRING. */
function componentPathsDeclaredInConfig(): string[] {
  const sources = ['src/collections.ts', 'src/payload.config.ts'].map((file) =>
    readFileSync(resolve(cmsRoot, file), 'utf8'),
  )
  const found = new Set<string>()
  for (const source of sources) {
    for (const match of source.matchAll(/'(\/src\/admin\/[A-Za-z0-9_]+(?:#[A-Za-z0-9_]+)?)'/g)) {
      found.add(match[1] as string)
    }
  }
  return [...found].sort()
}

/** A mesma conta que o Payload faz: sem `#`, o export e `default`. */
function resolutionKeyFor(declared: string): string {
  return declared.includes('#') ? declared : `${declared}#default`
}

describe('import map do painel', () => {
  it('CONTROLE POSITIVO: a configuracao declara componentes customizados', () => {
    // Sem esta assercao, apagar todos os componentes da config deixaria os
    // testes abaixo verdes por vacuidade.
    expect(componentPathsDeclaredInConfig().length).toBeGreaterThanOrEqual(6)
  })

  it('TODO componente pedido pela configuracao existe no map, com o sufixo certo', () => {
    const keys = importMapKeys()
    const missing = componentPathsDeclaredInConfig()
      .map(resolutionKeyFor)
      .filter((key) => !keys.includes(key))

    // A mensagem nomeia a chave EXATA que falta: o modo de falha original era
    // silencioso, e um teste que so dissesse "false !== true" repetiria o
    // problema em outra camada.
    expect(missing, `chaves ausentes no importMap: ${missing.join(', ')}`).toEqual([])
  })

  it('nenhuma chave do map esquece o `#export`', () => {
    // Uma chave sem sufixo NUNCA e encontrada pelo Payload — ela e peso morto
    // que parece cobertura. Este e o teste que teria pego o defeito original.
    const withoutExport = importMapKeys().filter((key) => !key.includes('#'))
    expect(withoutExport, `chaves sem '#export': ${withoutExport.join(', ')}`).toEqual([])
  })

  it('toda chave aponta para um identificador REALMENTE importado', () => {
    // Um valor que nao veio de `import` seria `undefined` em runtime — e
    // `undefined` no map falha do mesmo jeito silencioso da chave errada.
    const declared = new Set(importedIdentifiers())
    const body = importMapSource.slice(importMapSource.indexOf('export const importMap'))
    const dangling = [...body.matchAll(/'([^']+)':\s*([A-Za-z0-9_]+)/g)]
      .filter((match) => !declared.has(match[2] as string))
      .map((match) => `${match[1] as string} -> ${match[2] as string}`)
    expect(dangling, `valores nao importados: ${dangling.join(', ')}`).toEqual([])
  })

  it('o map nao carrega componente que ninguem pede', () => {
    // Nao e erro fatal, mas entrada orfa costuma ser rastro de refatoracao pela
    // metade — e confunde quem for depurar a proxima ausencia.
    const requested = new Set(componentPathsDeclaredInConfig().map(resolutionKeyFor))
    const orphans = importMapKeys().filter((key) => !requested.has(key))
    expect(orphans, `entradas orfas no importMap: ${orphans.join(', ')}`).toEqual([])
  })
})
