/**
 * entity-resolve-fold.test.ts — as DUAS dobras de texto tem de ser a MESMA.
 *
 * Quem grava `search_documents.normalized_aliases` e
 * `immutable_unaccent(lower(primary_text))` e o worker de ingestao, com
 * `foldText` (`services/ingestion/src/search/fold.ts`). Quem monta o termo de
 * busca da rota interna de resolucao e `foldEntityText`
 * (`apps/web/src/lib/entity-resolve.ts`).
 *
 * POR QUE ISTO PRECISA DE TESTE, e nao de um comentario. Uma divergencia entre
 * as duas nao quebra nada ruidosamente: nao ha erro, nao ha log, nao ha teste
 * vermelho. O que acontece e que o casamento EXATO deixa de casar, e a rota
 * passa a responder `not_found` para titulos que existem no catalogo. O MNScr le
 * `not_found`, deixa de citar a entidade, e ninguem descobre a causa — que e o
 * mesmo tipo de silencio que a rota inteira existe para fechar.
 *
 * As duas funcoes sao duplicadas de proposito: `apps/web` nao importa
 * `services/ingestion` (sao processos diferentes, com dependencias diferentes),
 * e um pacote compartilhado so para quatro linhas de `String.prototype` seria
 * mais acoplamento do que o problema pede. O preco dessa escolha e este arquivo.
 */

import { describe, expect, it } from 'vitest'

import { foldEntityText } from '../../apps/web/src/lib/entity-resolve'
import { foldText } from '../../services/ingestion/src/search/fold'

/**
 * Corpus com os casos que separam uma dobra da outra.
 *
 * Nao e uma lista de titulos bonitos: cada entrada existe por um motivo —
 * acento composto, cedilha, caixa alta, espaco duplo, espaco nas pontas,
 * pontuacao (que NENHUMA das duas remove), numero romano, aspas tipograficas e
 * caractere fora do BMP.
 */
const CORPUS: readonly string[] = [
  'Clube da Luta',
  'Amélie',
  'CORAÇÃO',
  'A Viagem  de   Chihiro',
  '   Cidade de Deus   ',
  'Homem-Aranha: Sem Volta Para Casa',
  'Star Wars: Episódio V — O Império Contra-Ataca',
  'Ó Irmão, Onde Estás?',
  'WALL·E',
  '¡Ay, Carmela!',
  'Spider-Man 2',
  'Æon Flux',
  'Crouching Tiger, Hidden Dragon',
  'Não',
  'ÑOÑO',
  'Café Society',
  '“Aspas” e ‘apóstrofos’',
  'Emoji 🎬 no título',
  'ﬁlme com ligadura',
  '',
  '   ',
]

describe('a dobra do screen-app e a dobra da ingestao sao a mesma funcao', () => {
  it('concorda em todo o corpus', () => {
    for (const value of CORPUS) {
      expect(foldEntityText(value), JSON.stringify(value)).toBe(foldText(value))
    }
  })

  it('concorda tambem em entradas geradas', () => {
    // Combina acento, caixa e espaco em series curtas: e onde uma reescrita
    // "equivalente" de uma das duas costuma escorregar.
    const pieces = ['Ação', 'à', 'ÉPICO', '  ', 'sub-título', 'Nº', 'Ünïcödé']
    for (const a of pieces) {
      for (const b of pieces) {
        const value = `${a} ${b}`
        expect(foldEntityText(value), JSON.stringify(value)).toBe(foldText(value))
      }
    }
  })

  it('o controle NEGATIVO acusa: uma dobra alterada diverge do corpus', () => {
    // Sem este caso, o teste acima passaria mesmo se as duas funcoes fossem a
    // mesma referencia importada duas vezes — e nao provaria nada.
    const alterada = (input: string): string => foldEntityText(input).replace(/[^a-z0-9 ]/g, '')
    const divergentes = CORPUS.filter((value) => alterada(value) !== foldText(value))
    expect(divergentes.length).toBeGreaterThan(0)
  })
})
