/**
 * tmdb-append-consumption.test.ts — A TRAVA contra o quarto caso.
 *
 * ============================================================================
 * O PADRAO QUE ESTE ARQUIVO EXISTE PARA QUEBRAR
 * ============================================================================
 * Tres vezes em tres semanas, o mesmo defeito, em tres frentes diferentes:
 *
 *   1. `watch/providers` (PR #181) — no append desde sempre, chegava em toda
 *      requisicao de detalhe, descartado no normalizador. A disponibilidade de
 *      streaming ficou meses "por coletar" enquanto ja era coletada.
 *   2. `biography` de pessoa — chegava no payload, nao havia coluna. A pagina
 *      registrava a ausencia com motivo certo e causa errada.
 *   3. `recommendations` / `similar` — nos DOIS appends, nunca lidos. "Mais como
 *      este" nasceu apoiado em COLECAO por falta de sinal, e a serie ficou sem
 *      trilho nenhum — com a refutacao ja escrita na propria PR.
 *
 * Nao sao tres bugs. E UM buraco estrutural: `TMDB_APPEND_BY_TYPE` diz o que
 * PEDIMOS, os tipos em `types.ts` sao um SUBSET declarado a mao, e nada obrigava
 * os dois a concordarem. Campo pedido e nao declarado desaparece no limite do
 * tipo — sem erro, sem aviso, e com a cota ja paga.
 *
 * ============================================================================
 * O QUE A TRAVA FAZ (E O QUE ELA NAO FAZ)
 * ============================================================================
 * FAZ: garante COBERTURA. Todo valor pedido ao TMDB esta classificado — ou tem
 * consumidor nomeado, ou tem justificativa escrita para ainda nao ter.
 *
 * NAO FAZ: garantir VERACIDADE. Ela nao verifica que o modulo citado realmente
 * le o campo; isso continua sendo leitura humana. A trava impede o caso caro
 * (ninguem SABER que um campo e pedido e jogado fora), nao o caso barato (um
 * caminho de arquivo desatualizado no registro).
 *
 * Ela e deliberadamente do lado do PEDIDO, e nao do consumo: e o pedido que
 * gasta cota e cria a expectativa de que o dado existe.
 */

import { describe, expect, it } from 'vitest'

import {
  allRequestedAppendValues,
  APPEND_CONSUMED,
  APPEND_DEFERRED,
  TMDB_APPEND_BY_TYPE,
  unclassifiedAppendValues,
} from '../../api-clients/tmdb/src/index.js'

describe('todo valor de append_to_response esta classificado', () => {
  it('CONTROLE POSITIVO: ha valores pedidos (a varredura nao e vacua)', () => {
    // Sem isto, um `TMDB_APPEND_BY_TYPE` vazio faria todo o resto passar.
    const pedidos = allRequestedAppendValues()
    expect(pedidos.length).toBeGreaterThan(10)
    expect(pedidos).toContain('watch/providers')
    expect(pedidos).toContain('recommendations')
    expect(pedidos).toContain('similar')
  })

  it('NENHUM valor pedido fica sem classificacao', () => {
    // A asserçao central. Acrescentar um valor ao append sem dizer quem o le
    // (ou por que ainda ninguem o le) reprova AQUI, e nao seis meses depois
    // quando alguem notar que a feature "faltando" ja estava sendo baixada.
    expect(
      unclassifiedAppendValues(),
      'valor pedido ao TMDB sem consumidor nem justificativa. Classifique em ' +
        'api-clients/tmdb/src/append-consumption.ts (APPEND_CONSUMED ou APPEND_DEFERRED).',
    ).toEqual([])
  })

  it('NEGATIVO: nada e classificado nas DUAS listas ao mesmo tempo', () => {
    // Estar nas duas significaria "e lido" e "nao e lido" — o registro deixaria
    // de dizer qualquer coisa.
    const consumidos = new Set(APPEND_CONSUMED.map((c) => c.value))
    const nosDois = APPEND_DEFERRED.filter((d) => consumidos.has(d.value)).map((d) => d.value)
    expect(nosDois).toEqual([])
  })

  it('NEGATIVO: o registro nao classifica valor que ninguem pede', () => {
    // Entrada morta e pior que ausencia: da a impressao de cobertura. Se um
    // valor sai do append, a linha dele sai daqui junto.
    const pedidos = new Set(allRequestedAppendValues())
    const fantasmas = [...APPEND_CONSUMED.map((c) => c.value), ...APPEND_DEFERRED.map((d) => d.value)]
      .filter((v) => !pedidos.has(v))
    expect(fantasmas, 'classificacao de valor que nao e pedido a ninguem').toEqual([])
  })
})

describe('a classificacao carrega informacao de verdade', () => {
  it('todo consumidor nomeia um MODULO, nao uma promessa', () => {
    for (const c of APPEND_CONSUMED) {
      expect(c.consumedBy, c.value).toMatch(/^(services|api-clients|packages)\/[\w/-]+\.ts$/)
    }
  })

  it('todo adiamento tem motivo ESCRITO, nao um rotulo', () => {
    // "TODO" e "fora de escopo" nao explicam nada. O piso de caracteres nao
    // garante qualidade, mas impede o placeholder de um palavra.
    for (const d of APPEND_DEFERRED) {
      expect(d.reason.trim().length, d.value).toBeGreaterThan(60)
    }
  })
})

describe('os tres casos historicos seriam pegos por esta trava', () => {
  it('`watch/providers` e `recommendations`/`similar` estao como CONSUMIDOS hoje', () => {
    // Prova que a trava e sobre um padrao real e nao sobre um cenario inventado:
    // os tres valores que ja causaram o defeito estao no registro, do lado certo.
    const consumidos = APPEND_CONSUMED.map((c) => c.value)
    expect(consumidos).toContain('watch/providers')
    expect(consumidos).toContain('recommendations')
    expect(consumidos).toContain('similar')
  })

  it('filme e serie pedem os DOIS sinais de parentesco', () => {
    // A serie ficou sem "Mais como este" por falta de sinal. Ela sempre pediu.
    expect(TMDB_APPEND_BY_TYPE.movie).toContain('recommendations')
    expect(TMDB_APPEND_BY_TYPE.movie).toContain('similar')
    expect(TMDB_APPEND_BY_TYPE.tv).toContain('recommendations')
    expect(TMDB_APPEND_BY_TYPE.tv).toContain('similar')
  })
})
