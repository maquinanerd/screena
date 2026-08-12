/**
 * secret-handling.test.ts — A chave da OMDb viaja em query. Isto prova que ela
 * nao vaza para lugar nenhum alem do proprio upstream.
 *
 * A OMDb nao aceita header, entao `?apikey=` e o unico mecanismo. O risco real
 * disso e a chave acabar persistida em `api_cache.request_key` ou impressa num
 * erro. As duas coisas sao barradas ESTRUTURALMENTE (ordem de montagem e
 * conteudo do erro), e e isso que este arquivo verifica.
 */

import {
  RapidApiHttpClient,
  RapidApiHttpError,
  type HttpRequest,
  type RapidApiClientConfig,
} from '@screena/rapidapi-core'
import { describe, expect, it } from 'vitest'

import { buildOmdbByImdbIdRequest } from '../client.js'
import { loadOmdbConfig, OMDB_KEY_ENV } from '../config.js'
import { OMDB_API_KEY_QUERY_PARAM, OMDB_ENDPOINT, buildImdbTitleUrl, isImdbId } from '../provider.js'

/** Valor sentinela: se ele aparecer onde nao deve, o teste pega. */
const FAKE_KEY = 'CHAVE-SENTINELA-NAO-REAL-0123456789'

function config(): RapidApiClientConfig {
  return loadOmdbConfig({ [OMDB_KEY_ENV]: FAKE_KEY })
}

describe('config', () => {
  it('exige a chave e falha citando so o NOME da variavel', () => {
    expect(() => loadOmdbConfig({})).toThrow(new RegExp(OMDB_KEY_ENV))
    // A mensagem nunca pode conter um valor.
    try {
      loadOmdbConfig({})
    } catch (error) {
      expect((error as Error).message).not.toContain(FAKE_KEY)
    }
  })

  it('declara auth por query param (a OMDb nao aceita header)', () => {
    expect(config().auth).toEqual({ kind: 'query-param', param: OMDB_API_KEY_QUERY_PARAM })
  })

  it('o provider tecnico e "omdb" e nunca uma fonte editorial', () => {
    expect(config().providerApi).toBe('omdb')
  })
})

describe('a chave NUNCA entra na chave de cache', () => {
  it('request_key nao contem a chave nem o nome do parametro dela', () => {
    const request = buildOmdbByImdbIdRequest('tt3896198')
    expect(request.cacheKey.requestKey).not.toContain(FAKE_KEY)
    expect(request.cacheKey.requestKey).not.toContain(OMDB_API_KEY_QUERY_PARAM)
  })

  it('os params publicos nao carregam a chave', () => {
    const request = buildOmdbByImdbIdRequest('tt3896198')
    expect(Object.keys(request.params)).not.toContain(OMDB_API_KEY_QUERY_PARAM)
    expect(request.params['i']).toBe('tt3896198')
  })

  it('a chave de cache e deterministica para o mesmo id', () => {
    const a = buildOmdbByImdbIdRequest('tt3896198')
    const b = buildOmdbByImdbIdRequest('tt3896198')
    expect(a.cacheKey).toEqual(b.cacheKey)
  })

  it('ids diferentes produzem chaves diferentes', () => {
    const a = buildOmdbByImdbIdRequest('tt3896198')
    const b = buildOmdbByImdbIdRequest('tt0000001')
    expect(a.cacheKey.paramsHash).not.toBe(b.cacheKey.paramsHash)
  })
})

describe('a chave vai para o upstream — e so para ele', () => {
  it('a URL enviada carrega a chave no parametro esperado', async () => {
    let seen: HttpRequest | null = null
    const client = new RapidApiHttpClient(config(), {
      transport: async (request) => {
        seen = request
        return { status: 200, headers: {}, body: '{"Response":"True"}' }
      },
    })

    await client.request(OMDB_ENDPOINT, { i: 'tt3896198' })

    expect(seen).not.toBeNull()
    const url = new URL(seen!.url)
    expect(url.searchParams.get(OMDB_API_KEY_QUERY_PARAM)).toBe(FAKE_KEY)
    expect(url.searchParams.get('i')).toBe('tt3896198')
  })

  it('NAO envia os headers da RapidAPI para um host que nao e da RapidAPI', () => {
    let seen: HttpRequest | null = null
    const client = new RapidApiHttpClient(config(), {
      transport: async (request) => {
        seen = request
        return { status: 200, headers: {}, body: '{}' }
      },
    })

    return client.request(OMDB_ENDPOINT, {}).then(() => {
      expect(seen!.headers['x-rapidapi-key']).toBeUndefined()
      expect(seen!.headers['x-rapidapi-host']).toBeUndefined()
      expect(JSON.stringify(seen!.headers)).not.toContain(FAKE_KEY)
    })
  })

  it('o modo header (default) continua intacto para os clients RapidAPI', async () => {
    let seen: HttpRequest | null = null
    // Mesma config, SEM `auth`: comportamento historico.
    const { auth: _ignored, ...headerConfig } = config()
    const client = new RapidApiHttpClient(headerConfig, {
      transport: async (request) => {
        seen = request
        return { status: 200, headers: {}, body: '{}' }
      },
    })

    await client.request('/popular/', {})

    expect(seen!.headers['x-rapidapi-key']).toBe(FAKE_KEY)
    expect(new URL(seen!.url).searchParams.get(OMDB_API_KEY_QUERY_PARAM)).toBeNull()
  })
})

describe('a chave NUNCA entra num erro', () => {
  it('erro HTTP permanente carrega o path, nunca a URL com a chave', async () => {
    const client = new RapidApiHttpClient(config(), {
      transport: async () => ({
        status: 401,
        headers: {},
        body: '{"Response":"False","Error":"Invalid API key!"}',
      }),
    })

    await expect(client.request(OMDB_ENDPOINT, { i: 'tt3896198' })).rejects.toThrow(
      RapidApiHttpError,
    )

    try {
      await client.request(OMDB_ENDPOINT, { i: 'tt3896198' })
    } catch (error) {
      const serialized = `${(error as Error).message} ${(error as RapidApiHttpError).body} ${(error as RapidApiHttpError).endpoint}`
      expect(serialized).not.toContain(FAKE_KEY)
      expect(serialized).not.toContain(OMDB_API_KEY_QUERY_PARAM)
      // O corpo do upstream continua util para diagnostico.
      expect((error as RapidApiHttpError).body).toContain('Invalid API key')
    }
  })

  it('falha de transporte vira mensagem sintetica — a URL nunca propaga', async () => {
    const client = new RapidApiHttpClient({ ...config(), maxRetries: 0 }, {
      transport: async () => {
        // O `fetch` real embute a URL na mensagem/`cause`. Simulamos o pior caso.
        throw new Error(`falha ao buscar https://www.omdbapi.com/?apikey=${FAKE_KEY}&i=tt1`)
      },
    })

    try {
      await client.request(OMDB_ENDPOINT, { i: 'tt3896198' })
      expect.unreachable('deveria ter lancado')
    } catch (error) {
      expect((error as Error).message).not.toContain(FAKE_KEY)
    }
  })
})

describe('linkback do IMDb', () => {
  it('monta a URL canonica a partir do imdbID', () => {
    expect(buildImdbTitleUrl('tt3896198')).toBe('https://www.imdb.com/title/tt3896198/')
  })

  it('e HTTPS (o gate de exibicao recusa credito nao-HTTPS)', () => {
    expect(buildImdbTitleUrl('tt3896198')!.startsWith('https://')).toBe(true)
  })

  it('devolve null para id malformado — nunca monta URL a partir de lixo', () => {
    for (const bogus of ['3896198', 'tt', '', 'ttabc', '../etc/passwd']) {
      expect(buildImdbTitleUrl(bogus), bogus).toBeNull()
    }
  })

  it('isImdbId aceita so tt<digitos>', () => {
    expect(isImdbId('tt3896198')).toBe(true)
    expect(isImdbId(' tt3896198 ')).toBe(true)
    expect(isImdbId('nm3896198')).toBe(false)
  })
})
