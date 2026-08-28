/**
 * cascade-cost.test.ts — O CUSTO DA CASCATA de `sync_details`, medido.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE ARQUIVO TRAVA — e ele nasceu de um CONSERTO
 * ============================================================================
 * Dar escopo a chave do filho (PR #256) descongelou `sync_seasons` e
 * `sync_episodes`, que eram noop desde o primeiro ciclo de cada titulo. Isso
 * estava certo. O que veio junto nao:
 *
 * `airing_series` roda DIARIO. Com o escopo CRU do pai, ela passou a reabrir a
 * cascata INTEIRA todo dia — inclusive a midia de cada episodio de cada
 * temporada. Medido com o catalogo real de 28/08/2026:
 *
 *   32.983 series · 136.650 temporadas · 3.921.368 episodios
 *   -> 4,14 temporadas e 118,9 episodios por serie
 *   -> 128,2 jobs e 254,2 requisicoes por serie, por ciclo
 *   -> 200 series/ciclo = 25.635 jobs/dia e 50.842 req/dia
 *
 * Um multiplicador de **128x** sobre o volume anterior, para rebuscar o still
 * de um episodio que foi ao ar em 2011.
 *
 * ============================================================================
 * O TETO NAO PODE SER "PARE NO ITEM N" — ELE PERDERIA TRABALHO
 * ============================================================================
 * Cortar o laco de temporadas em N deixaria a serie com 30 temporadas sem as
 * ultimas 10, para sempre e em silencio. O teto de uma arvore de jobs nao e
 * quantos filhos ela gera: e com que FREQUENCIA ela e reaberta.
 *
 * Por isso a folha de midia usa um balde de 7 dias (`coarsenScopeToDays`) e a
 * ENUMERACAO segue o escopo cru: o episodio que estreou hoje aparece hoje
 * (1,6% do custo), e o still dele e revisitado semanalmente (93,5% do custo).
 *
 * ============================================================================
 * O TESTE E POR CUSTO, NAO POR FORMA DE STRING
 * ============================================================================
 * Afirmar `expect(chave).toBe('s1e2:pt-BR:2026-08-24~7d')` seria transcricao:
 * passaria com o balde de 1 dia e o custo continuaria 7x maior. O eixo aqui e
 * QUANTAS CHAVES DISTINTAS a cascata produz numa janela — que e exatamente o
 * numero de vezes que ela vai ao TMDB.
 */

import { describe, expect, it } from 'vitest'

import {
  coarsenScopeToDays,
  LEAF_MEDIA_SCOPE_DAYS,
  scopedChildDiscriminator,
} from '../idempotency.js'

/** O catalogo, CONTADO em producao em 2026-08-28. */
const CATALOGO = {
  series: 32_983,
  temporadas: 136_650,
  episodios: 3_921_368,
} as const

const TEMPORADAS_POR_SERIE = CATALOGO.temporadas / CATALOGO.series
const EPISODIOS_POR_SERIE = CATALOGO.episodios / CATALOGO.series

/** O dia civil, como `dailyScope` o produz. */
function diaDoAgendador(fila: string, diaIso: string): string {
  return `${fila}:${diaIso}`
}

/** Os N dias seguidos a partir de uma data. */
function diasSeguidos(inicio: string, n: number): string[] {
  const base = Date.parse(`${inicio}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) =>
    new Date(base + i * 86_400_000).toISOString().slice(0, 10),
  )
}

describe('a ENUMERACAO segue o escopo cru — o episodio de hoje aparece hoje', () => {
  it('cada dia produz uma chave nova de sync_episodes', () => {
    const chaves = diasSeguidos('2026-08-24', 7).map((dia) =>
      scopedChildDiscriminator('pt-BR', diaDoAgendador('airing_series', dia), 's3'),
    )
    // Sete dias, sete trabalhos: e o que `airing_series` promete.
    expect(new Set(chaves).size).toBe(7)
  })

  it('mas o MESMO dia nao duplica, quantas vezes o ciclo repetir', () => {
    const escopo = diaDoAgendador('airing_series', '2026-08-28')
    const chaves = [1, 2, 3].map(() => scopedChildDiscriminator('pt-BR', escopo, 's3'))
    expect(new Set(chaves).size).toBe(1)
  })
})

describe('a MIDIA DE FOLHA usa o balde — e e ele o teto da cascata', () => {
  /** Chaves distintas de midia de episodio ao longo de N dias corridos. */
  function chavesDeFolha(inicio: string, dias: number, comBalde: boolean): number {
    const chaves = diasSeguidos(inicio, dias).map((dia) => {
      const escopo = diaDoAgendador('airing_series', dia)
      return scopedChildDiscriminator(
        'pt-BR',
        comBalde ? coarsenScopeToDays(escopo) : escopo,
        's3e12',
      )
    })
    return new Set(chaves).size
  }

  /**
   * O QUE O BALDE GARANTE E A TAXA, NAO O ALINHAMENTO.
   *
   * A primeira versao deste teste afirmava que sete dias corridos colapsam em
   * UMA chave. Falso, e o codigo estava certo: o balde e ancorado na EPOCA, e
   * uma janela de sete dias que nao comeca na borda cai em dois baldes. Exigir
   * uma chave obrigaria a ancorar o balde no "agora" — que e exatamente o
   * defeito que a ancora na epoca existe para evitar (duas replicas subindo em
   * dias diferentes veriam baldes diferentes, e o trabalho duplicaria).
   *
   * A grandeza que importa e quantas vezes a folha e reaberta por mes, porque e
   * ela que vira requisicao ao TMDB.
   */
  it('em 28 dias a folha e reaberta ~4 vezes, nao 28', () => {
    const comBalde = chavesDeFolha('2026-08-24', 28, true)
    expect(comBalde).toBeGreaterThanOrEqual(4) // nunca menos: senao congelou
    expect(comBalde).toBeLessThanOrEqual(5) // 28/7 + a borda parcial
  })

  it('CONTROLE NEGATIVO: com o escopo CRU seriam 28 — o custo que o balde corta', () => {
    expect(chavesDeFolha('2026-08-24', 28, false)).toBe(28)
  })

  it('dentro de UM balde, quantos ciclos rodarem, a chave e uma so', () => {
    // A garantia forte, medida onde ela vale: dias do mesmo balde.
    const dias = diasSeguidos('2026-08-24', 28)
    const porBalde = new Map<string, Set<string>>()
    for (const dia of dias) {
      const balde = coarsenScopeToDays(diaDoAgendador('airing_series', dia)) as string
      const chave = scopedChildDiscriminator('pt-BR', balde, 's3e12')
      const jaVistas = porBalde.get(balde) ?? new Set<string>()
      jaVistas.add(chave)
      porBalde.set(balde, jaVistas)
    }
    for (const [balde, chaves] of porBalde) {
      expect(chaves.size, balde).toBe(1)
    }
  })

  it('o balde ABRE de novo depois da janela — nao congela como a chave sem escopo', () => {
    // O par do controle acima. Sem ele, um balde infinito (ou uma chave fixa)
    // passaria em tudo e reintroduziria o congelamento que a #256 consertou.
    expect(chavesDeFolha('2026-08-24', 90, true)).toBeGreaterThanOrEqual(12)
  })
})

describe('o CUSTO da cascata, com o catalogo real', () => {
  /** Requisicoes que UMA serie gera num ciclo, dado o fator de reabertura da folha. */
  function requisicoesPorSerie(fatorDeReaberturaDaFolha: number): number {
    const enumeracao = 1 + TEMPORADAS_POR_SERIE // sync_seasons + 1 sync_episodes por temporada
    const midiaTitulo = 2
    const midiaFolha = 2 * TEMPORADAS_POR_SERIE + 2 * EPISODIOS_POR_SERIE
    return enumeracao + midiaTitulo + midiaFolha * fatorDeReaberturaDaFolha
  }

  it('a midia de FOLHA e a esmagadora maioria do custo — por isso e ela que ganha balde', () => {
    const total = requisicoesPorSerie(1)
    const folha = 2 * TEMPORADAS_POR_SERIE + 2 * EPISODIOS_POR_SERIE
    expect(folha / total).toBeGreaterThan(0.9)
  })

  it('o balde de 7 dias corta o custo diario da cascata em mais de 5x', () => {
    const cru = requisicoesPorSerie(1)
    const comBalde = requisicoesPorSerie(1 / LEAF_MEDIA_SCOPE_DAYS)
    expect(cru / comBalde).toBeGreaterThan(5)
  })

  it('com 200 series/ciclo, a fila diaria cabe num orcamento de 10.000 req/dia', () => {
    // 10.000 = folga confortavel dentro do desenho recomendado pela auditoria
    // #254 (135.373 req/dia para o pipeline inteiro). Com o escopo cru eram
    // 50.842 e o teste reprovaria — que e o ponto.
    const porDia = 200 * requisicoesPorSerie(1 / LEAF_MEDIA_SCOPE_DAYS)
    expect(porDia).toBeLessThan(10_000)
  })

  it('CONTROLE NEGATIVO: sem balde, as mesmas 200 series estouram o orcamento', () => {
    expect(200 * requisicoesPorSerie(1)).toBeGreaterThan(10_000)
  })
})

describe('coarsenScopeToDays — comportamento de borda', () => {
  it('escopo nulo ou vazio continua nulo (o backfill nao tem escopo)', () => {
    expect(coarsenScopeToDays(null)).toBeNull()
    expect(coarsenScopeToDays('')).toBeNull()
    expect(coarsenScopeToDays('   ')).toBeNull()
  })

  it('escopo SEM data volta inalterado — engrossar o que nao se le colidiria', () => {
    expect(coarsenScopeToDays('rotulo-sem-data')).toBe('rotulo-sem-data')
  })

  it('preserva o resto do escopo: o nome da fila continua separando filas', () => {
    const a = coarsenScopeToDays(diaDoAgendador('airing_series', '2026-08-28'))
    const b = coarsenScopeToDays(diaDoAgendador('title_detail_active', '2026-08-28'))
    expect(a).not.toBe(b)
    expect(a).toContain('airing_series')
  })

  it('o balde e ancorado na EPOCA, nao no "agora" — duas replicas veem o mesmo', () => {
    // Mesma data, chamadas em momentos diferentes: mesmo balde. Ancorar no agora
    // faria o balde deslizar a cada reinicio do container.
    const primeira = coarsenScopeToDays('x:2026-08-28')
    const segunda = coarsenScopeToDays('x:2026-08-28')
    expect(segunda).toBe(primeira)
    // E dias do MESMO balde colapsam, dias de baldes diferentes nao.
    expect(coarsenScopeToDays('x:2026-08-27')).toBe(coarsenScopeToDays('x:2026-08-28'))
  })

  it('tamanho de balde invalido nao produz chave degenerada', () => {
    for (const ruim of [0, -3, 0.4]) {
      expect(coarsenScopeToDays('x:2026-08-28', ruim), String(ruim)).toBe(
        coarsenScopeToDays('x:2026-08-28', 1),
      )
    }
  })
})
