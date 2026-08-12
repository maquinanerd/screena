/**
 * fixture.ts — Payload REAL da OMDb usado pelos testes, com CONTROLE POSITIVO.
 *
 * Por que este arquivo existe separado dos testes: ja se perderam suites
 * inteiras neste repositorio por fixture malformada — testes que passavam pelo
 * motivo errado, porque o dado de entrada tinha deixado de representar o que o
 * teste dizia estar provando. Um teste verde sobre uma fixture quebrada e pior
 * que nenhum teste: ele afirma cobertura que nao existe.
 *
 * A defesa e `assertFixtureIntact()`: uma verificacao INDEPENDENTE do codigo de
 * producao (nao importa nada de `mapping.ts`, `value.ts` nem `sources.ts`) que
 * confere, literal por literal, que a fixture ainda e o payload documentado. O
 * teste `fixture.test.ts` a executa. Se alguem trocar `"85%"` por `"8.5"`,
 * apagar uma fonte ou mexer no `imdbID`, o controle positivo ESTOURA — mesmo
 * que todos os outros testes continuem verdes.
 *
 * Fonte: resposta real de
 * `GET https://www.omdbapi.com/?apikey=<chave>&i=tt3896198`
 * (Guardians of the Galaxy Vol. 2). A chave nunca aparece aqui.
 */

/** Payload real da OMDb (recortado nos campos que o adapter le). */
export const OMDB_GUARDIANS_PAYLOAD = {
  Title: 'Guardians of the Galaxy: Vol. 2',
  Ratings: [
    { Source: 'Internet Movie Database', Value: '7.6/10' },
    { Source: 'Rotten Tomatoes', Value: '85%' },
    { Source: 'Metacritic', Value: '67/100' },
  ],
  Metascore: '67',
  imdbRating: '7.6',
  imdbVotes: '828,114',
  imdbID: 'tt3896198',
  Response: 'True',
} as const

/** O erro da OMDb: HTTP 200 no transporte, `Response: "False"` no corpo. */
export const OMDB_ERROR_PAYLOAD = {
  Response: 'False',
  Error: 'Incorrect IMDb ID.',
} as const

/**
 * CONTROLE POSITIVO. Falha se a fixture deixar de ser o payload documentado.
 *
 * Deliberadamente ESCRITO A MAO e sem reuso do codigo de producao: se ele
 * chamasse `parseOmdbRatingValue` para conferir os valores, uma regressao no
 * parser passaria despercebida aqui — o controle validaria a fixture com a
 * mesma lente que ele deveria estar protegendo.
 *
 * @throws {Error} com a divergencia exata.
 */
export function assertFixtureIntact(payload: unknown): void {
  const fail = (message: string): never => {
    throw new Error(
      `FIXTURE CORROMPIDA: ${message}. ` +
        'A fixture deixou de representar o payload real da OMDb; qualquer teste que ' +
        'dependa dela esta passando pelo motivo errado. Restaure o payload documentado ' +
        'em services/ratings/src/omdb/__tests__/fixture.ts.',
    )
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return void fail('payload nao e objeto')
  }
  const record = payload as Record<string, unknown>

  if (record['Response'] !== 'True') {
    return void fail(`Response deveria ser "True", veio ${JSON.stringify(record['Response'])}`)
  }
  if (record['imdbID'] !== 'tt3896198') {
    return void fail(`imdbID deveria ser "tt3896198", veio ${JSON.stringify(record['imdbID'])}`)
  }

  const ratings = record['Ratings']
  if (!Array.isArray(ratings)) return void fail('Ratings deveria ser array')
  if (ratings.length !== 3) {
    return void fail(`Ratings deveria ter 3 entradas (tres fontes), veio ${ratings.length}`)
  }

  // Os TRES literais exatos, na ordem exata em que a OMDb os publica. Os
  // formatos sao o ponto central do desenho: fracao/10, percentual, fracao/100.
  const expected: readonly (readonly [string, string])[] = [
    ['Internet Movie Database', '7.6/10'],
    ['Rotten Tomatoes', '85%'],
    ['Metacritic', '67/100'],
  ]
  for (const [index, [source, value]] of expected.entries()) {
    const entry = ratings[index] as Record<string, unknown> | undefined
    if (entry === undefined || typeof entry !== 'object') {
      return void fail(`Ratings[${index}] ausente ou nao e objeto`)
    }
    if (entry['Source'] !== source) {
      return void fail(
        `Ratings[${index}].Source deveria ser ${JSON.stringify(source)}, veio ${JSON.stringify(entry['Source'])}`,
      )
    }
    if (entry['Value'] !== value) {
      return void fail(
        `Ratings[${index}].Value deveria ser ${JSON.stringify(value)}, veio ${JSON.stringify(entry['Value'])}`,
      )
    }
  }

  // Os campos redundantes de topo TEM de bater com o array — a fixture existe
  // justamente para exercitar a verificacao cruzada no caso CONCORDANTE.
  if (record['imdbRating'] !== '7.6') {
    return void fail(
      `imdbRating deveria ser "7.6" (igual a Ratings[0]), veio ${JSON.stringify(record['imdbRating'])}`,
    )
  }
  if (record['Metascore'] !== '67') {
    return void fail(
      `Metascore deveria ser "67" (igual a Ratings[2]), veio ${JSON.stringify(record['Metascore'])}`,
    )
  }
}
