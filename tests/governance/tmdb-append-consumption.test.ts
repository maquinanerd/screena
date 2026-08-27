/**
 * tmdb-append-consumption.test.ts — A TRAVA contra o quinto caso.
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
 * O QUARTO CASO ACONTECEU COM A TRAVA VERDE — E ELA E QUE ESTAVA ERRADA
 * ============================================================================
 * Ate 2026-08-27 esta trava comparava STRINGS: `unclassifiedAppendValues()`
 * achatava os cinco tipos num Set de valores. `credits` classificado para
 * `movie`/`tv` cobria, sozinho, o `credits` de `tv_season` e o de `tv_episode`
 * — dois pares que nenhum modulo jamais leu.
 *
 * Consequencia medida: os SETE appends de `/tv/{id}/season/{n}` eram pedidos a
 * cada sincronizacao e descartados inteiros, com este arquivo passando. A trava
 * cobria o caso que ela foi escrita para pegar e nao cobria o vizinho.
 *
 * Agora a unidade e o PAR `(tipo, valor)`. Um valor pedido em cinco tipos sao
 * cinco afirmacoes, e cada uma tem de ser feita separadamente.
 *
 * ============================================================================
 * O QUE A TRAVA FAZ (E O QUE ELA NAO FAZ)
 * ============================================================================
 * FAZ: garante COBERTURA por par. Todo par pedido ao TMDB esta classificado —
 * ou tem consumidor nomeado, ou tem justificativa escrita para ainda nao ter.
 *
 * NAO FAZ: garantir VERACIDADE. Ela nao verifica que o modulo citado realmente
 * le o campo; isso continua sendo leitura humana. A trava impede o caso caro
 * (ninguem SABER que um campo e pedido e jogado fora), nao o caso barato (um
 * caminho de arquivo desatualizado no registro). A auditoria de 22/08 achou
 * QUATRO entradas mentindo assim; foram corrigidas a mao em 27/08.
 *
 * Ela e deliberadamente do lado do PEDIDO, e nao do consumo: e o pedido que
 * gasta cota e cria a expectativa de que o dado existe.
 */

import { describe, expect, it } from 'vitest'

import {
  allRequestedAppendPairs,
  allRequestedAppendValues,
  APPEND_CONSUMED,
  APPEND_DEFERRED,
  appendPairKey,
  doublyClassifiedAppendPairs,
  TMDB_APPEND_BY_TYPE,
  unclassifiedAppendPairs,
  unrequestedRegistryPairs,
} from '../../api-clients/tmdb/src/index.js'

describe('todo par (tipo, valor) de append_to_response esta classificado', () => {
  it('CONTROLE POSITIVO: ha pares pedidos (a varredura nao e vacua)', () => {
    // Sem isto, um `TMDB_APPEND_BY_TYPE` vazio faria todo o resto passar.
    const pares = allRequestedAppendPairs()
    expect(pares.length).toBeGreaterThan(40)
    const chaves = pares.map(appendPairKey)
    expect(chaves).toContain('movie:watch/providers')
    expect(chaves).toContain('tv:recommendations')
    // Os sete da temporada — o conjunto que a versao por STRING nao enxergava.
    expect(chaves).toContain('tv_season:credits')
    expect(chaves).toContain('tv_season:watch/providers')
  })

  it('NENHUM par pedido fica sem classificacao', () => {
    // A asserçao central. Acrescentar um valor ao append de UM tipo sem dizer
    // quem o le (ou por que ainda ninguem o le) reprova AQUI, e nao seis meses
    // depois quando alguem abrir a pagina e ver o bloco vazio.
    expect(
      unclassifiedAppendPairs().map(appendPairKey),
      'par (tipo, valor) pedido ao TMDB sem consumidor nem justificativa. Classifique em ' +
        'api-clients/tmdb/src/append-consumption.ts (APPEND_CONSUMED ou APPEND_DEFERRED), ' +
        'nomeando o tipo em `types`.',
    ).toEqual([])
  })

  it('NEGATIVO: nada e classificado nas DUAS listas ao mesmo tempo', () => {
    // Estar nas duas significaria "e lido" e "nao e lido" — o registro deixaria
    // de dizer qualquer coisa. Por PAR: `images` pode ser consumido em
    // `tv_episode` e adiado em outro tipo sem que isso seja contradicao.
    expect(doublyClassifiedAppendPairs().map(appendPairKey)).toEqual([])
  })

  it('NEGATIVO: o registro nao classifica par que ninguem pede', () => {
    // Entrada morta e pior que ausencia: da a impressao de cobertura. Se um
    // valor sai do append de um tipo, o tipo sai do `types` daquela linha.
    expect(
      unrequestedRegistryPairs().map(appendPairKey),
      'classificacao de par que nao e pedido a ninguem',
    ).toEqual([])
  })
})

describe('CONTROLE NEGATIVO: a chave por VALOR nao pegaria os sete da temporada', () => {
  /**
   * Este bloco existe para provar que a trava mudou de fato, e nao so de nome.
   *
   * Ele reconstroi a comparacao ANTIGA (por string) sobre o registro ATUAL e
   * mostra que ela daria "tudo classificado" para pares que nenhum modulo le.
   * Se alguem reverter `unclassifiedAppendPairs` para comparar valores, este
   * teste continua verde — por isso ele nao substitui o de cima; ele documenta
   * a diferenca entre os dois criterios, com numero.
   */
  it('os sete pares de tv_season sao classificados INDIVIDUALMENTE, nao por herança', () => {
    const daTemporada = allRequestedAppendPairs().filter((par) => par.type === 'tv_season')
    expect(daTemporada).toHaveLength(7)

    // Cada um dos sete tem uma entrada que NOMEIA `tv_season` em `types` —
    // nenhum e coberto por uma entrada que so fala de movie/tv.
    for (const par of daTemporada) {
      const cobre = (entries: readonly { value: string; types: readonly string[] }[]): boolean =>
        entries.some((e) => e.value === par.value && e.types.includes('tv_season'))
      expect(
        cobre(APPEND_CONSUMED) || cobre(APPEND_DEFERRED),
        `tv_season:${par.value} sem entrada propria (heranca de movie/tv nao vale)`,
      ).toBe(true)
    }
  })

  it('a comparacao por VALOR, sozinha, declararia cobertura total (e por isso saiu)', () => {
    // A prova de que o criterio antigo era cego: por string, o conjunto de
    // valores classificados cobre TODO valor pedido — inclusive os que so tem
    // leitor em outro tipo. Verde com o defeito presente.
    const porValor = new Set([
      ...APPEND_CONSUMED.map((c) => c.value),
      ...APPEND_DEFERRED.map((d) => d.value),
    ])
    const semClassificacaoPorValor = allRequestedAppendValues().filter((v) => !porValor.has(v))
    expect(semClassificacaoPorValor).toEqual([])
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

  it('toda entrada NOMEIA os tipos que cobre, e nenhum vem vazio', () => {
    // `types: []` classificaria zero pares parecendo classificar algo — a
    // versao silenciosa do buraco que este arquivo acabou de fechar.
    for (const entry of [...APPEND_CONSUMED, ...APPEND_DEFERRED]) {
      expect(entry.types.length, `${entry.value}: types vazio`).toBeGreaterThan(0)
    }
  })

  it('leitura de ENDPOINT PROPRIO tem justificativa da copia do append', () => {
    // `dedicated-endpoint` significa que a copia do append segue sem leitor. Sem
    // esta linha, um append pago e nunca lido volta a ser invisivel.
    for (const c of APPEND_CONSUMED.filter((e) => e.source === 'dedicated-endpoint')) {
      expect(
        c.appendCopyRationale?.trim().length ?? 0,
        `${c.value} (${c.types.join(',')}): sem appendCopyRationale`,
      ).toBeGreaterThan(60)
    }
  })
})

describe('os casos historicos seriam pegos por esta trava', () => {
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

  it('`watch/providers` de TEMPORADA e adiado com a recusa NOMEADA', () => {
    // O caso da auditoria de 22/08: pedido a cada temporada e recusado por
    // `normalizeWatchProviders`, sem que nada registrasse a recusa. Agora a
    // recusa esta escrita, e o teste exige que continue escrita.
    const entrada = APPEND_DEFERRED.find(
      (d) => d.value === 'watch/providers' && d.types.includes('tv_season'),
    )
    expect(entrada, 'tv_season:watch/providers sem justificativa').toBeDefined()
    expect(entrada?.reason).toContain('normalizeWatchProviders')
  })
})
