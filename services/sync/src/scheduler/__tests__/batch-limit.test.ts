/**
 * batch-limit.test.ts — O TETO POR CICLO e uma decisao, e a decisao tem de
 * fechar a JANELA que a propria fila declara.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE ARQUIVO TRAVA
 * ============================================================================
 * `title_media` nasceu (PR #256) com cadencia diaria, janela de 7 dias e o teto
 * GLOBAL de 200 itens por ciclo. Com 67.288 titulos no catalogo, a volta
 * completa levava **336 dias**.
 *
 * Uma fila diaria com volta anual nao e uma fila diaria: e uma fila anual com
 * rotulo diario. E o rotulo mentiroso e pior que a lentidao, porque o painel
 * fica verde — a fila roda todo dia, reporta sucesso todo dia, e o acervo nao
 * anda. E exatamente o defeito da OMDb a 200 titulos/semana, com outro nome.
 *
 * ============================================================================
 * O TESTE E POR VOLTA, NAO POR CONSTANTE
 * ============================================================================
 * `expect(batchLimit).toBe(10_000)` seria transcricao: passaria com 10.000 num
 * catalogo de um milhao de titulos, e a volta continuaria sendo de anos. O eixo
 * aqui e a ARITMETICA que importa — teto x cadencia fecha a janela declarada? —
 * com o tamanho do catalogo medido como entrada.
 */

import { describe, expect, it } from 'vitest'

import {
  effectiveBatchLimit,
  effectiveIntervalHours,
  findRhythm,
  RHYTHMS,
  type Rhythm,
} from '../rhythms.js'

/**
 * O tamanho do catalogo, medido na auditoria #254 (2026-08-28):
 * 34.802 filmes + 32.486 series.
 *
 * NAO inclui temporada (32.483) nem episodio (135.926): a midia deles entra
 * pela cascata de `sync_details`, nao por esta fila. Dimensionar `title_media`
 * pelo numero de episodios pediria um teto que ela nao precisa.
 */
const TITULOS_NO_CATALOGO = 34_802 + 32_486

/** O teto global default (`CINERIE_SCHEDULER_BATCH_LIMIT`). */
const TETO_GLOBAL = 200

/** Quantos DIAS a fila leva para dar uma volta completa no seu universo. */
function diasParaUmaVolta(universo: number, tetoPorCiclo: number, intervaloHoras: number): number {
  const ciclosPorDia = 24 / intervaloHoras
  return universo / (tetoPorCiclo * ciclosPorDia)
}

describe('o teto por ciclo respeita a janela que a fila declara', () => {
  it('CONTROLE NEGATIVO: com o teto GLOBAL, title_media levaria mais de 300 dias', () => {
    const rhythm = findRhythm('title_media')!
    const volta = diasParaUmaVolta(TITULOS_NO_CATALOGO, TETO_GLOBAL, rhythm.intervalHours)
    // Este e o estado que o teto proprio existe para impedir. Se alguem remover
    // o teto proprio, o teste abaixo reprova e este continua descrevendo o porque.
    expect(volta).toBeGreaterThan(300)
  })

  it('title_media fecha a volta DENTRO da janela de 7 dias que ela declara', () => {
    const rhythm = findRhythm('title_media')!
    const teto = effectiveBatchLimit(rhythm, TETO_GLOBAL)
    const volta = diasParaUmaVolta(TITULOS_NO_CATALOGO, teto, rhythm.intervalHours)
    expect(volta).toBeLessThanOrEqual(7)
    // E o teto declarado nao passa do que a config aceita (`readInt` 1..10_000):
    // um numero fora da faixa faria o servico morrer na subida.
    expect(teto).toBeLessThanOrEqual(10_000)
  })

  it('o custo do teto cabe no orcamento medido da auditoria #254', () => {
    const rhythm = findRhythm('title_media')!
    const teto = effectiveBatchLimit(rhythm, TETO_GLOBAL)
    // 2 requisicoes por titulo: `/images` + `/videos` dedicados.
    const requisicoesPorDia = teto * 2 * (24 / rhythm.intervalHours)
    // Desenho recomendado pela #254: 135.373 req/dia. Esta fila e uma fatia.
    expect(requisicoesPorDia).toBeLessThan(135_373)
    // E folgadamente abaixo da varredura por forca bruta (874.379 req/dia).
    expect(requisicoesPorDia).toBeLessThan(874_379 / 10)
  })
})

describe('o teto proprio so existe onde o limitante e diferente', () => {
  it('a fila da OMDb NAO ganha teto proprio: ela e limitada por COTA, nao por relogio', () => {
    // 200 esta CERTO para ela. `backgroundOmdbSlots` usa este numero contra o
    // saldo de 1.000/dia com reserva de 150 — subir aqui envenenaria a cota.
    const omdb = findRhythm('ratings_omdb')!
    expect(omdb.batchLimit).toBeNull()
    expect(effectiveBatchLimit(omdb, TETO_GLOBAL)).toBe(TETO_GLOBAL)
  })

  it('toda fila declara o teto explicitamente — nunca por omissao', () => {
    for (const rhythm of RHYTHMS) {
      expect(Object.prototype.hasOwnProperty.call(rhythm, 'batchLimit'), rhythm.queue).toBe(true)
    }
  })

  it('teto proprio, quando existe, tem de ser MAIOR que o global — senao e ruido', () => {
    for (const rhythm of RHYTHMS) {
      if (rhythm.batchLimit === null) continue
      expect(rhythm.batchLimit, rhythm.queue).toBeGreaterThan(TETO_GLOBAL)
    }
  })
})

describe('effectiveBatchLimit — fallback seguro', () => {
  const base = findRhythm('watch_offers')!

  it('null cai no global', () => {
    expect(effectiveBatchLimit({ ...base, batchLimit: null }, 200)).toBe(200)
  })

  it('valor invalido cai no global — nunca zero, nunca NaN', () => {
    for (const ruim of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const torto: Rhythm = { ...base, batchLimit: ruim }
      expect(effectiveBatchLimit(torto, 200), String(ruim)).toBe(200)
    }
  })

  it('trunca decimal em vez de propagar fracao para um LIMIT de SQL', () => {
    expect(effectiveBatchLimit({ ...base, batchLimit: 750.9 }, 200)).toBe(750)
  })

  it('o teto proprio NAO altera o intervalo — sao decisoes independentes', () => {
    const rhythm = findRhythm('title_media')!
    expect(effectiveIntervalHours(rhythm, true)).toBe(rhythm.intervalHours)
    expect(effectiveIntervalHours(rhythm, false)).toBe(rhythm.intervalHours)
  })
})
