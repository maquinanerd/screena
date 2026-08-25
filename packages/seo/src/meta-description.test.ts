/**
 * Testes de `buildMetaDescription`.
 *
 * O caso que originou a funcao esta aqui como fixture real: a sinopse de
 * "A Origem" servida por producao em 2026-08-24, com 504 caracteres, ia
 * inteira para a tag.
 */

import { describe, expect, it } from 'vitest'

import {
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  buildMetaDescription,
} from './meta-description.js'

/**
 * Sinopse longa de verdade (mais de 400 caracteres, varias frases). Espelha o
 * formato do `summary` que os presenters usavam como fallback.
 */
const SINOPSE_LONGA =
  'Dom Cobb e um ladrao habilidoso, o melhor na perigosa arte da extracao: ' +
  'roubar segredos valiosos do fundo do subconsciente durante o estado de sonho, ' +
  'quando a mente esta mais vulneravel. A habilidade rara de Cobb fez dele um ' +
  'jogador cobicado no traicoeiro mundo da espionagem corporativa, mas tambem o ' +
  'transformou num fugitivo internacional e custou a ele tudo o que amava. ' +
  'Agora Cobb recebe uma chance de redencao, numa ultima tarefa impossivel.'

describe('buildMetaDescription', () => {
  it('devolve null para ausencia de texto, em vez de fabricar descricao', () => {
    expect(buildMetaDescription(null)).toBeNull()
    expect(buildMetaDescription(undefined)).toBeNull()
    expect(buildMetaDescription('')).toBeNull()
    expect(buildMetaDescription('   \n\t  ')).toBeNull()
  })

  it('nao mexe no texto que ja cabe', () => {
    const curto = 'Um ladrao que rouba segredos do subconsciente ganha uma ultima chance.'
    expect(buildMetaDescription(curto)).toBe(curto)
    expect(curto.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX)
  })

  it('normaliza espaco, quebra de linha e tabulacao', () => {
    expect(buildMetaDescription('  Um   ladrao\n\nde  sonhos.\t ')).toBe('Um ladrao de sonhos.')
  })

  it('aceita exatamente o teto sem cortar', () => {
    const exato = 'a'.repeat(META_DESCRIPTION_MAX)
    expect(buildMetaDescription(exato)).toBe(exato)
    expect(buildMetaDescription(exato)?.length).toBe(META_DESCRIPTION_MAX)
  })

  it('CASO REAL: a sinopse de 504 caracteres nao vai mais inteira para a tag', () => {
    // O texto de producao tinha 504; este fixture tem a mesma ordem de grandeza.
    expect(SINOPSE_LONGA.length).toBeGreaterThan(META_DESCRIPTION_MAX * 2)

    const saida = buildMetaDescription(SINOPSE_LONGA)
    expect(saida).not.toBeNull()
    expect(saida!.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX)
    expect(saida!.length).toBeGreaterThanOrEqual(META_DESCRIPTION_MIN)
  })

  it('NUNCA corta uma palavra ao meio', () => {
    const saida = buildMetaDescription(SINOPSE_LONGA)!
    const semReticencia = saida.replace(/…$/u, '')
    // Toda palavra da saida tem de existir inteira na origem normalizada.
    const origem = SINOPSE_LONGA.replace(/\s+/g, ' ').trim()
    const ultima = semReticencia.trim().split(' ').at(-1)!
    expect(origem.split(' ')).toContain(ultima.replace(/[.,;:!?]+$/u, ''))
    // E a saida inteira e um prefixo da origem (a menos da reticencia/pontuacao).
    expect(origem.startsWith(semReticencia.replace(/[\s,;:.!?]+$/u, ''))).toBe(true)
  })

  it('prefere terminar em fim de frase, e ai nao usa reticencia', () => {
    const duasFrases =
      'Primeira frase com tamanho suficiente para passar do piso minimo exigido pela regra de corte, ' +
      'entao ela sozinha ja qualifica como ponto de corte valido. ' +
      'Segunda frase que estoura o teto e portanto precisa ficar de fora do resultado final.'
    const saida = buildMetaDescription(duasFrases)!
    expect(saida.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX)
    expect(saida.endsWith('.')).toBe(true)
    expect(saida.endsWith('…')).toBe(false)
  })

  it('nao corta dentro de sigla pontuada nem de numero decimal', () => {
    const comSigla =
      'A equipe da S.H.I.E.L.D. investiga um caso com 8.4 de nota media entre os criticos ' +
      'e segue por varias linhas ate estourar com folga o teto permitido para a descricao curta da pagina.'
    const saida = buildMetaDescription(comSigla)!
    expect(saida.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX)
    expect(saida).not.toMatch(/S\.H\.$/u)
    expect(saida).not.toMatch(/\b8\.$/u)
  })

  it('nao deixa pontuacao pendurada antes da reticencia', () => {
    const comVirgula =
      'Uma lista longa de coisas, outra coisa, mais uma coisa, ainda outra coisa, ' +
      'e mais uma coisa qualquer, seguida de outra, e outra, e outra, ate estourar o teto de caracteres.'
    const saida = buildMetaDescription(comVirgula)!
    expect(saida).not.toMatch(/[,;:]…$/u)
  })

  it('palavra unica gigante ainda respeita o teto', () => {
    const monstro = 'x'.repeat(500)
    const saida = buildMetaDescription(monstro)!
    expect(saida.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX)
    expect(saida.endsWith('…')).toBe(true)
  })

  it('CONTROLE NEGATIVO: a propria origem reprovaria o teto', () => {
    // Se este teste passar com a funcao devolvendo a entrada crua, a suite nao
    // estaria medindo nada. Aqui fica explicito que a entrada viola o contrato.
    expect(SINOPSE_LONGA.length).toBeGreaterThan(META_DESCRIPTION_MAX)
    expect(buildMetaDescription(SINOPSE_LONGA)).not.toBe(SINOPSE_LONGA)
  })
})
