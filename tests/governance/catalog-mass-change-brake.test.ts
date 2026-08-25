/**
 * catalog-mass-change-brake.test.ts — o freio de mudanca em massa continua
 * ligado no caminho que importa: o CICLO HORARIO NAO-ATENDIDO.
 *
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
 * ----------------------------------------------
 * `scripts/catalog/catalog-cycle-with-alert.sh` roda `index-decisions --apply`
 * de hora em hora via systemd timer, sem humano nenhum. O freio vive na CLI,
 * mas ele so vale alguma coisa enquanto o ciclo NAO passar o opt-in. Um dia
 * alguem cansa de ver o alerta, acrescenta `--confirm-mass-change` no script
 * "so para destravar", e o freio some sem que teste nenhum reclame — a CLI
 * continua correta, o cron e que passou a assinar sozinho pelo humano.
 *
 * O segundo elo e o EXIT CODE. O shell nao importa TypeScript: o `5` esta
 * escrito duas vezes, em duas linguagens. Divergir e silencioso — o ciclo
 * passaria a tratar o freio como falha generica, e o alerta voltaria a dizer a
 * coisa errada.
 *
 * LEITURA DE FONTE: pela porta unica (`tests/support/source-text.js`), sem
 * comentario. Aqui isso e essencial e nao cerimonia: o proprio cabecalho do
 * script EXPLICA como destravar e cita `--confirm-mass-change` em prosa. Um
 * guard que lesse o arquivo cru casaria com a explicacao e certificaria
 * exatamente o que existe para negar.
 */

import { describe, expect, it } from 'vitest'

import { EXIT_CODES } from '../../services/ingestion/src/cli/exit.js'
import { readSourceWithoutComments } from '../support/source-text.js'

const CYCLE_SCRIPT = 'scripts/catalog/catalog-cycle-with-alert.sh'

/** O script sem comentarios: so o que o bash executa de fato. */
const cycleCode = readSourceWithoutComments(CYCLE_SCRIPT)

/**
 * As linhas que MONTAM uma chamada da CLI.
 *
 * Medir "o arquivo contem a flag?" seria errado por um motivo concreto: a
 * mensagem do alerta cita `--confirm-mass-change` de proposito, para dizer ao
 * operador como destravar. Essa citacao e texto, nao argumento. O que precisa
 * estar ausente e a flag no LUGAR onde o bash a entregaria a CLI: uma invocacao
 * (`catalog_write`/`catalog_read`) ou os arrays de flags que elas concatenam.
 */
const invocationLines = cycleCode
  .split('\n')
  .filter((line) => /\b(catalog_write|catalog_read)\b/.test(line) || /^\s*GATE_(READ|WRITE)=/.test(line))

describe('o ciclo horario nao pode assinar pelo humano', () => {
  it('nenhuma invocacao da CLI carrega --confirm-mass-change', () => {
    // Se este teste ficar vermelho, o cron passou a autorizar indexacao em
    // massa sozinho — que e exatamente o que a secao 6 do CLAUDE.md proibe.
    const offending = invocationLines.filter((line) => line.includes('--confirm-mass-change'))
    expect(offending, `o ciclo nao-atendido nao pode confirmar mudanca em massa:\n${offending.join('\n')}`).toEqual([])
  })

  it('a lista de invocacoes NAO esta vazia (o filtro precisa achar alguma coisa)', () => {
    // Sem isto, renomear `catalog_write` esvaziaria o filtro e o teste acima
    // ficaria verde medindo o vazio.
    expect(invocationLines.length).toBeGreaterThan(3)
  })

  it('o script CONTINUA rodando index-decisions --apply (o freio nao virou remocao)', () => {
    // Sem esta assercao, apagar a linha inteira faria os testes acima passarem.
    expect(invocationLines.some((line) => line.includes('index-decisions --apply'))).toBe(true)
  })
})

describe('o exit code do freio e o mesmo dos dois lados', () => {
  it('o shell declara o mesmo numero que EXIT_CODES.massChangeBlocked', () => {
    const declared = /INDEX_DECISIONS_BRAKE_EXIT=(\d+)/.exec(cycleCode)
    expect(declared, `${CYCLE_SCRIPT} deve declarar INDEX_DECISIONS_BRAKE_EXIT`).not.toBeNull()
    expect(Number(declared?.[1])).toBe(EXIT_CODES.massChangeBlocked)
  })

  it('o code do freio nao colide com nenhum outro exit code da CLI', () => {
    const values = Object.values(EXIT_CODES)
    expect(new Set(values).size).toBe(values.length)
  })

  it('o ciclo trata o code do freio SEPARADO de falha generica', () => {
    // O ramo `elif` e o que impede o freio de virar "index-decisions falhou".
    expect(cycleCode).toContain('INDEX_DECISIONS_BRAKE_EXIT')
    expect(cycleCode).toMatch(/elif\s+\[\[\s+"\$idx_code"\s+-ne\s+0\s+\]\]/)
  })

  it('o freio NAO derruba o ciclo: nada de `return`/`exit` no ramo do freio', () => {
    // Um ciclo que sai vermelho toda hora deixa de ser lido, e a proxima falha
    // real do worker passa despercebida. O ramo do freio so alerta.
    const branch =
      /if\s+\[\[\s+"\$idx_code"\s+-eq\s+"\$INDEX_DECISIONS_BRAKE_EXIT"\s+\]\];\s+then([\s\S]*?)\n\s*elif\s/.exec(
        cycleCode,
      )
    expect(branch, 'ramo do freio nao encontrado no ciclo').not.toBeNull()
    const body = branch?.[1] ?? ''
    expect(body).toContain('emit_alert')
    expect(body).not.toMatch(/\breturn\b/)
    expect(body).not.toMatch(/\bexit\b/)
  })
})
