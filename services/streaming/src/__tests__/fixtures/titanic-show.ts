/**
 * titanic-show.ts — Fixture SANITIZADA do payload real de
 * `GET /shows/tt0120338?series_granularity=episode&output_language=en`
 * (Titanic), como devolvido pela Streaming Availability API (Movie of the Night).
 *
 * SANITIZACAO (o payload real e enorme e volatil):
 *  - nenhuma `x-rapidapi-key` ou segredo;
 *  - `imageSet` reduzido a URLs curtas e estaveis (o mapper NUNCA le imageSet,
 *    entao os valores sao so para provar que ele os ignora);
 *  - links de streaming sao exemplos http(s) realistas, sem tokens assinados;
 *  - campos que o mapper deve ignorar (`rating`, `overview`, `cast`, `directors`,
 *    `title`) ficam presentes DE PROPOSITO, para o teste provar que nenhum deles
 *    vaza para `watch_availability`.
 *
 * COBERTURA de `streamingOptions.br`: subscription valido, rent com preco, buy
 * com preco, free e um `addon` (que deve ser DESCARTADO como `unmapped:addon`).
 * Ha ainda um pais nao-BR (`us`) para provar que o mapper o ignora.
 *
 * Tipado como `unknown`: o mapper reconhece defensivamente um payload cru.
 */
export const TITANIC_SHOW_PAYLOAD: unknown = {
  itemType: 'show',
  showType: 'movie',
  id: '136',
  imdbId: 'tt0120338',
  tmdbId: 'movie/597',
  title: 'Titanic',
  originalTitle: 'Titanic',
  releaseYear: 1997,
  // Campos que o mapper NAO pode ler para watch_availability:
  rating: 88,
  overview: 'Sinopse externa que NUNCA deve ser copiada nem lida pelo mapper.',
  cast: ['Leonardo DiCaprio', 'Kate Winslet'],
  directors: ['James Cameron'],
  imageSet: {
    verticalPoster: {
      w240: 'https://cdn.example/p/w240.jpg',
      w360: 'https://cdn.example/p/w360.jpg',
    },
  },
  streamingOptions: {
    br: [
      {
        service: {
          id: 'netflix',
          name: 'Netflix',
          homePage: 'https://www.netflix.com/br/',
        },
        type: 'subscription',
        link: 'https://www.netflix.com/br/title/12345678',
        videoLink: 'https://www.netflix.com/br/watch/12345678',
        quality: 'uhd',
        availableSince: 1_704_067_200,
        expiresSoon: false,
      },
      {
        service: { id: 'apple', name: 'Apple TV' },
        type: 'rent',
        link: 'https://tv.apple.com/br/movie/titanic/umc.cmc.rent',
        quality: 'hd',
        price: { amount: '14.90', currency: 'BRL', formatted: 'R$ 14,90' },
        expiresSoon: false,
      },
      {
        service: { id: 'google', name: 'Google Play Movies' },
        type: 'buy',
        link: 'https://play.google.com/store/movies/details/titanic',
        quality: 'hd',
        price: { amount: '34.90', currency: 'BRL', formatted: 'R$ 34,90' },
      },
      {
        service: { id: 'plutotv', name: 'Pluto TV' },
        type: 'free',
        link: 'https://pluto.tv/br/on-demand/movies/titanic',
        quality: 'sd',
      },
      {
        // `addon`: camada PAGA dentro de outro servico. Deve ser DESCARTADO
        // (unmapped:addon), nunca coagido a subscription.
        service: { id: 'prime', name: 'Prime Video' },
        type: 'addon',
        addon: { id: 'maxamazonchannel', name: 'Max Amazon Channel' },
        link: 'https://www.primevideo.com/br/detail/titanic',
        quality: 'hd',
        price: { amount: '19.90', currency: 'BRL', formatted: 'R$ 19,90' },
      },
    ],
    // Pais nao-BR: deve ser IGNORADO pelo mapper (nunca vira oferta BR).
    us: [
      {
        service: { id: 'max', name: 'Max' },
        type: 'subscription',
        link: 'https://play.max.com/movie/titanic',
        quality: 'uhd',
      },
    ],
  },
}
