/**
 * watch-providers-payload.ts — Payload de detalhe de FILME com o sub-recurso
 * `watch/providers`, na forma em que ele chega ao `tmdb_raw`.
 *
 * PROVENIENCIA — leia antes de confiar nesta fixture:
 *
 * A FORMA vem da documentacao publica do TMDB (`/movie/{id}/watch/providers`:
 * `{ id, results: { <ISO-3166-1>: { link, flatrate[], rent[], buy[], free[],
 * ads[] } } }`, cada item com `provider_id`, `provider_name`, `logo_path`,
 * `display_priority`) e do `append_to_response`, que aninha o sub-recurso sob a
 * chave literal `watch/providers` dentro do detalhe.
 *
 * Ela NAO foi extraida de uma linha real de `tmdb_raw`, e isto precisa ficar
 * dito: nenhuma credencial TMDB e nenhuma `DATABASE_URL` estavam disponiveis na
 * maquina onde este arquivo foi escrito, e o Postgres de producao nao e
 * alcancavel de fora da rede do EasyPanel.
 *
 * COMO CONFRONTAR COM BYTES REAIS, quando houver um banco a mao:
 * `bin/reprocess-watch-providers.ts --sample` le `tmdb_raw` e imprime a FORMA
 * dos blocos `watch/providers` realmente arquivados (quantos tem o bloco,
 * quais modalidades, quais paises) sem escrever nada e sem tocar o TMDB. Se a
 * forma real divergir desta fixture, e a fixture que esta errada.
 *
 * SANITIZACAO: nenhum segredo, nenhum token, nenhuma URL assinada. Campos que
 * o normalizador DEVE ignorar (`title`, `overview`, `vote_average`) ficam
 * presentes DE PROPOSITO, para o teste provar que nenhum deles vaza para
 * `watch_availability` — em especial `vote_average`, que e dado tecnico do
 * provider e NUNCA nota editorial (invariantes 1 e 2).
 *
 * Tipado como `unknown`: o reconhecedor le um payload cru defensivamente.
 */
export const WATCH_PROVIDERS_MOVIE_PAYLOAD: unknown = {
  id: 550,
  title: 'Fight Club',
  overview: 'Campo que o normalizador deve ignorar.',
  vote_average: 8.4,
  vote_count: 30000,
  'watch/providers': {
    id: 550,
    results: {
      BR: {
        link: 'https://www.themoviedb.org/movie/550-fight-club/watch?locale=BR',
        flatrate: [
          {
            logo_path: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg',
            provider_id: 8,
            provider_name: 'Netflix',
            display_priority: 0,
          },
        ],
        rent: [
          {
            logo_path: '/peURlLlr8jggOwK53fJ5wdQl05y.jpg',
            provider_id: 2,
            provider_name: 'Apple TV',
            display_priority: 3,
          },
        ],
        buy: [
          {
            logo_path: '/peURlLlr8jggOwK53fJ5wdQl05y.jpg',
            provider_id: 2,
            provider_name: 'Apple TV',
            display_priority: 3,
          },
        ],
        free: [
          {
            logo_path: '/mEiBVX1i5vfSY3QoDCcRPqTMxWY.jpg',
            provider_id: 300,
            provider_name: 'Pluto TV',
            display_priority: 12,
          },
        ],
        ads: [
          {
            logo_path: '/mEiBVX1i5vfSY3QoDCcRPqTMxWY.jpg',
            provider_id: 300,
            provider_name: 'Pluto TV',
            display_priority: 12,
          },
        ],
      },
      // Minusculo DE PROPOSITO: o TMDB ja devolveu a chave assim, e o codigo de
      // pais precisa chegar MAIUSCULO na FK `countries.code`.
      us: {
        link: 'https://www.themoviedb.org/movie/550-fight-club/watch?locale=US',
        flatrate: [
          {
            logo_path: '/Ajqyt5aNxNGjmF9uOfxArGrdf3X.jpg',
            provider_id: 1899,
            provider_name: 'Max',
            display_priority: 5,
          },
        ],
      },
    },
  },
}
