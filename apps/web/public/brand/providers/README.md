# Logos dos serviços de streaming (`/brand/providers/`)

Um arquivo por **provedor canônico registrado** em
[`services/streaming/src/provider-registry.ts`](../../../../../services/streaming/src/provider-registry.ts)
— o nome do arquivo é o `watch_providers.slug`.

> Nada aqui é decorativo nem desenhado. Cada arquivo é declarado pela licença do
> provedor em
> [`authorization-spec.ts`](../../../../../services/legal/src/authorization-spec.ts)
> (`PROVIDER_LOGO_FILES` → `providerLogoAsset`) e só vai ao ar por ela.

## De onde vieram (2026-09-11)

**Ordem do proprietário, 2026-09-11:** *"inclua OBRIGATORIAMENTE AS LOGOS dos
serviços de stream"*. A permissão de exibir a marca de cada provedor já existia
desde 2026-08-20 (decisão do proprietário, base `owner_decision`); faltavam os
arquivos.

**Origem dos bytes:** o `logo_path` que o bloco `watch/providers` do TMDB entrega
para cada `provider_id` — catálogo de provedores da região BR, lido em
2026-09-11, tamanho `w154` (`https://image.tmdb.org/t/p/w154<logo_path>`),
gravado **sem recodificação**. É a origem que a pesquisa de 2026-08-20 já
registrava para titular sem página de marca: o arquivo é *TMDB Content*, sob a
licença que já temos; o direito de **exibir** a marca do terceiro vem da decisão
do proprietário, e o registro grava exatamente isso.

O `provider_id` é o **primeiro alias `tmdb`** do provedor no registro.
`tests/governance/brand-asset-format.test.ts` confere que todo provedor
registrado tem arquivo, que o id bate com o registro e que formato e dimensões
declarados batem com os bytes.

## Regras

- **Nunca recolorir, cortar ou esticar.** O CSS (`.watch-logo`) fixa uma caixa
  quadrada com `object-fit: contain` — o raro arquivo não quadrado
  (`belas-artes-a-la-carte.png`, 153×116) encolhe, não distorce.
- **O nome continua escrito.** O logo é decorativo no HTML (`alt=""`); a
  palavra-marca e o `aria-label` do link nomeiam a plataforma.
- **Provedor novo exige arquivo novo.** Sem ele, o teste de governança reprova —
  a tela nunca fica com logo faltando em silêncio.
- **Trocar um arquivo** = substituir os bytes pela nova entrega do TMDB e
  atualizar `PROVIDER_LOGO_FILES` (logo_path e dimensões) na mesma mudança.

## Arquivos

| Arquivo | Nome no TMDB | provider_id | logo_path | Dimensões | Tamanho |
|---|---|---|---|---|---|
| `netflix.png` | Netflix | 8 | `/rK1KljqmbvO9HQa1PBFLILWah72.png` | 154×154 | 4.588 B |
| `prime-video.png` | Amazon Prime Video | 119 | `/gMZdpavHmxFNnLpMHwVxfqeux2g.png` | 154×154 | 9.804 B |
| `amazon-video.png` | Amazon Video | 10 | `/jn6TLbtaTZntTRX9UYucHJvpQx1.png` | 154×154 | 9.963 B |
| `max.png` | HBO Max | 1899 | `/skypuy7SXuugIQeYg0IglmzoKaS.png` | 154×154 | 9.755 B |
| `apple-tv.png` | Apple TV Store | 2 | `/qdEGArH3lKfFnAtYXMkSYk5wxuG.png` | 154×154 | 17.668 B |
| `pluto-tv.png` | Pluto TV | 300 | `/fN4czqaMQNLeF6sSSIjGbAWzvwK.png` | 154×154 | 6.014 B |
| `google-play.png` | Google Play Movies | 3 | `/aZRENwYILujqs0RVOZutTh0BVGV.png` | 154×154 | 9.214 B |
| `disney-plus.png` | Disney Plus | 337 | `/5eZ872CghnHFLB1j8grszbrx0dx.png` | 154×154 | 25.290 B |
| `globoplay.png` | Globoplay | 307 | `/9A6Oxd3F7iXm7mds7CxYOBicojs.png` | 154×154 | 29.678 B |
| `hbo-max-amazon-channel.png` | HBO Max Amazon Channel | 1825 | `/64fLWeSyZ1KQZhIdvTdy4QHeWty.png` | 154×154 | 6.030 B |
| `claro-video.png` | Claro video | 167 | `/zTJg0WVErBkcJv4S9FkQRUyXjnq.png` | 154×154 | 11.880 B |
| `telecine-amazon-channel.png` | Telecine Amazon Channel | 2156 | `/jRpdu5KkWx8ZvPCmBY5c4YHhWuK.png` | 154×154 | 6.979 B |
| `paramount-plus-amazon-channel.png` | Paramount+ Amazon Channel | 582 | `/bxX0YVOCY7bI85BKRlJAAQ2EjUR.png` | 154×154 | 15.471 B |
| `claro-tv-plus.png` | Claro tv+ | 484 | `/olzQMHt2SX7iNy8WDMR299hVFcL.png` | 154×154 | 6.301 B |
| `paramount-plus.png` | Paramount Plus | 531 | `/pkx3klJlwW5JdtaulvDx6hDNtch.png` | 154×154 | 17.562 B |
| `paramount-plus-premium.png` | Paramount Plus Premium | 2303 | `/4N4BMd0Mm0kHAmF7RZgL5lW3cwc.png` | 154×154 | 18.173 B |
| `universal-plus-amazon-channel.png` | Universal+ Amazon Channel | 1889 | `/j3Q750FwRyIejO5MrNu25Kia57.png` | 154×154 | 15.692 B |
| `oldflix.png` | Oldflix | 499 | `/86Ja8MBdaS8Fkjsegy3fQsUgNMu.png` | 154×154 | 9.534 B |
| `mercado-play.png` | Mercado Play | 2302 | `/1jZnP6bS5nNOqwY7GGJuyLhWEYW.png` | 154×154 | 12.011 B |
| `sony-one-amazon-channel.png` | Sony One Amazon Channel | 2161 | `/COoISLyfBkZ9Vgr5NbjmnxacSb.png` | 154×154 | 9.734 B |
| `paramount-plus-apple-tv-channel.png` | Paramount Plus Apple TV channel | 1853 | `/xu4LyKTwasTbta1Z0qWtZG48yZ3.png` | 154×154 | 11.909 B |
| `looke.png` | Looke | 47 | `/jsAseYgBGuHRkl0sJs9AAQHHU8P.png` | 154×154 | 23.097 B |
| `netmovies.png` | NetMovies | 19 | `/l8qT4DDRBVZWQouiT5OUnkw45m7.png` | 154×154 | 16.739 B |
| `lionsgate-plus-amazon-channels.png` | Lionsgate+ Amazon Channels | 2358 | `/1356slxu4QrHOMrEVDKHJXRo5sW.png` | 154×154 | 22.731 B |
| `plex.png` | Plex | 538 | `/blAEhvx3XX8sV0fFVFk88FFjubs.png` | 154×154 | 9.135 B |
| `belas-artes-a-la-carte.png` | Belas Artes à La Carte | 447 | `/azTwwwABsjSV0rSORM5DyKmMPV3.png` | 153×116 | 10.270 B |
| `looke-amazon-channel.png` | Looke Amazon Channel | 683 | `/AezYndUHveajt0XbYnKlGoHlY9i.png` | 154×154 | 12.748 B |
| `mgm-plus-apple-tv-channel.png` | MGM+ Apple TV Channel | 2142 | `/oeic4RyNDK988h5sZctewo6uRwO.png` | 154×154 | 13.285 B |
| `filmelier-plus-amazon-channel.png` | Filmelier Plus Amazon Channel | 2356 | `/qsa5pNRHmZReAhr4CFBQoaPh253.png` | 154×154 | 8.070 B |
| `gospel-play.png` | GOSPEL PLAY | 477 | `/ue3vrsZiLSLfhncP3vppZVNyLaE.png` | 154×154 | 13.894 B |
| `mgm-plus-amazon-channel.png` | MGM Plus Amazon Channel | 2141 | `/gk7O3l9qHttE9F3hgDNnhbhlOs7.png` | 154×154 | 13.942 B |
| `arte-amazon-channel.png` | Arte Amazon Channel | 2607 | `/tFyIFaAolJqZVmonNoMuZfEi0j1.png` | 154×154 | 8.835 B |
| `reserva-imovision-amazon-channel.png` | Reserva Imovision Amazon Channel | 2157 | `/c0sG3OmJrwYnUeAISP4IxlQBbSE.png` | 154×154 | 6.660 B |
