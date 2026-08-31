/**
 * error-response.ts — Classificador do erro da OMDb. Modulo PURO.
 *
 * ============================================================================
 * POR QUE ISTO PRECISA EXISTIR
 * ============================================================================
 * A OMDb sinaliza TODO erro com **HTTP 200** e `{"Response":"False","Error":...}`.
 * Para o executor HTTP isso e sucesso: `consecutiveFailures` nao incrementa, o
 * circuit breaker nao abre, o lote segue.
 *
 * Enquanto o unico erro frequente era "id nao existe", isso era barulho. Deixa
 * de ser no dia em que a fila passa de 200 requisicoes por SEMANA para centenas
 * por DIA: cruzar o teto passa a ser rotina, e sem reconhecimento o dia inteiro
 * depois do teto vira cota queimada em silencio — todo dia. Cada uma dessas
 * chamadas e contada pelo fornecedor e nao traz nada.
 *
 * ============================================================================
 * DOIS DESFECHOS QUE NAO PODEM CONTINUAR INDISTINGUIVEIS
 * ============================================================================
 *   `not-found`  — fato sobre o TITULO. Legitimo, esperado, isolado. O lote
 *                  CONTINUA: o proximo id nao tem nada a ver com este.
 *   `quota`      — fato sobre o DIA. O lote PARA: se a cota acabou para este
 *                  id, acabou para todos os seguintes, e insistir e queimar
 *                  cota que o fornecedor ja contabilizou.
 *
 * Colapsar os dois num "0 notas" generico foi o estado ate 2026-08-31.
 *
 * ============================================================================
 * A COMPARACAO E POR SUBSTRING, E ISSO E DELIBERADO
 * ============================================================================
 * A OMDb publica ao menos DUAS redacoes para o mesmo fato:
 *
 *   {"Response":"False","Error":"Request limit reached!"}
 *   {"Response":"False","Error":"Daily request limit reached!"}
 *
 * Uma igualdade exata contra a primeira daria FALSO para a segunda — e o modo de
 * falha seria exatamente o que este modulo existe para impedir, agora com um
 * teste verde por cima. O invariante das duas e `limit reached`; e nele que
 * casamos, sem acento, sem pontuacao, sem caixa.
 *
 * O risco oposto (casar demais) e pequeno e verificado: "Movie not found!",
 * "Incorrect IMDb ID.", "Invalid API key!" e "Series not found!" nao contem a
 * expressao. O teste de controle NEGATIVO trava isso — sem ele, um classificador
 * que devolvesse `quota` para tudo passaria no teste positivo.
 */

/** O que a OMDb quis dizer com `Response: "False"`. */
export type OmdbErrorKind =
  /** Teto de requisicoes do fornecedor atingido. Fato sobre o DIA. */
  | 'quota'
  /** Chave ausente/invalida/expirada. Fato sobre a CREDENCIAL. */
  | 'auth'
  /** Titulo inexistente, id malformado. Fato sobre o TITULO. */
  | 'not-found'

/**
 * Expressoes que identificam ESTOURO DE COTA, ja normalizadas (minusculas, sem
 * pontuacao). `limit reached` cobre as duas redacoes conhecidas; as outras sao
 * defesa barata contra redacoes que ainda nao vimos.
 */
const QUOTA_MARKERS: readonly string[] = [
  'limit reached',
  'request limit',
  'maximum usage',
  'too many requests',
]

/** Expressoes que identificam problema de CREDENCIAL. */
const AUTH_MARKERS: readonly string[] = ['invalid api key', 'no api key']

/**
 * Normaliza para comparacao: minusculas, pontuacao virando espaco, espacos
 * colapsados. `"Request limit reached!"` e `"Daily request-limit reached."`
 * chegam aqui iguais no que importa.
 */
function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
}

/**
 * Classifica o campo `Error` de uma resposta `Response: "False"`.
 *
 * FAIL-OPEN para `not-found` de proposito: um erro desconhecido e tratado como
 * fato sobre o titulo, e o lote continua. O contrario (desconhecido = cota)
 * abriria o breaker e mataria o ciclo inteiro por causa de um id ruim — trocaria
 * uma perda pequena e recuperavel por uma grande.
 */
export function classifyOmdbError(rawError: unknown): OmdbErrorKind {
  if (typeof rawError !== 'string') return 'not-found'
  const message = normalize(rawError)
  if (message === '') return 'not-found'

  if (QUOTA_MARKERS.some((marker) => message.includes(marker))) return 'quota'
  if (AUTH_MARKERS.some((marker) => message.includes(marker))) return 'auth'
  return 'not-found'
}

/**
 * Um erro que deve INTERROMPER o lote?
 *
 * Cota e credencial sao fatos sobre o AMBIENTE: o proximo id encontraria
 * exatamente a mesma parede. `not-found` e fato sobre o titulo e nao diz nada
 * sobre o proximo.
 */
export function omdbErrorAbortsBatch(kind: OmdbErrorKind): boolean {
  return kind === 'quota' || kind === 'auth'
}
