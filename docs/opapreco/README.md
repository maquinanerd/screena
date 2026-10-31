# OpaPreço Ads na Cinerie

Ofertas afiliadas (Shopee) servidas pelo ad server da OpaPreço. Substituiu o
Google AdSense em 2026-10-30: a metatag de verificação, o `/ads.txt` e o slot
antigo saíram (guarda: `tests/web/sem-adsense.test.ts`).

## O que está no ar (desde 2026-10-31): o SDK do OpaPreço nas matérias

A matéria (`/pt/noticias/{slug}/`) usa o **SDK oficial** do OpaPreço, como manda
o guia de integração do publisher (no repositório do OpaPreço,
`docs/OPAPRECO-ADS-PUBLISHER-INTEGRATION.md`):

| Item | Valor |
|---|---|
| Endpoint | `https://opapreco.com.br` |
| `siteKey` | `cinerie` (cadastrado e aprovado para a Shopee no painel do OpaPreço) |
| Slots na matéria | `article-top`, `article-inline-01`, `article-inline-02`, `article-bottom` |
| `sidebar` | não entra: a matéria tem coluna única de 720px, sem barra lateral |
| Contexto do slot | `section` = categoria, `tags` = títulos citados, `content-id` = id do artigo |

- `apps/web/src/lib/opapreco-ads.ts` — puro: endereços, chave do site, slots, chave de liga/desliga.
- `apps/web/app/_components/opapreco-ad.tsx` — `<OpaPrecoAd slotKey contentId section tags>`, server component: renderiza o `<op-slot>` e põe o script e a folha de estilo do SDK no `<head>` (só nas páginas com slot).
- `apps/web/app/pt/noticias/[slug]/page.tsx` — as quatro posições; `article.css` — só a margem em volta do slot, que zera quando ele colapsa.
- `apps/web/middleware.ts` — o CSP libera `opapreco.com.br` em `script-src`, `style-src`, `connect-src` e `img-src`, e `cf.shopee.com.br` em `img-src` (a imagem do produto vem de um ou de outro).
- Política de Privacidade `2026-10.2` — itens 2.3, 3, 5.8, 6, 7, 11 e 12.
- Política de Privacidade `2026-10.3` — ofertas também na home, nas listagens e nas fichas de filme e de série (itens 2.3, 3, 5.8, 6 e 11).

O script do OpaPreço faz o resto, e a Cinerie não refaz nada: reserva a altura,
pede a oferta (`POST /v1/ads/serve`), desenha, colapsa sem anúncio e conta
impressão e clique por beacon. O clique vai direto para `s.shopee.com.br`. O
pedido sai do navegador depois do render, sem cookie e sem dado do leitor: a
página continua sem API externa no render (invariante 3).

### Fora da matéria: home, listagens e fichas (2026-10-31)

O mesmo `<OpaPrecoAd>` entra em mais três superfícies, nas posições que os
slots de 30/10 tinham. As chaves são as do contrato **v1.2.0** do OpaPreço:
enquanto o servidor não as aceitar, o pedido volta recusado e o script colapsa
o slot (margem zero, nada sobra na página).

| Página | Slots | Onde | Contexto |
|---|---|---|---|
| `/pt/` | `home-01`, `home-02`, `home-03` | grade depois de Popular, depois de "Seu mês em números" e depois de "Em breve" (antes de Notícias) | `content-id` = `home` |
| `/pt/filmes/`, `/pt/series/` | `listing-01`, `listing-02`, `listing-03` | as mesmas três posições (`home-like.tsx`) | `content-id` = `filmes`/`series`, `section` = "Filmes"/"Séries" |
| `/pt/filmes/{slug}/`, `/pt/series/{slug}/` | `detail-01`, `detail-02` | card entre a obra (na série, os episódios) e o elenco; grade depois de "Mais como este" | `content-id` = `movie-{id}`/`series-{id}`, `section` = vertical, `tags` = título + gêneros |

A margem fica no próprio `<op-slot>` e zera no colapso (`home-like.css`,
`detail.css`). Pessoa, Explorar, Onde assistir, Listas, Notícias e Entrar
continuam sem anúncio.

### Ligar e desligar (runtime, sem rebuild)

| `NEXT_PUBLIC_OPAPRECO_ADS_ENABLED` | Efeito |
|---|---|
| ausente | liga só na produção oficial (`CINERIE_PUBLIC_SITE_URL=https://cinerie.com` + `NODE_ENV=production`) |
| `false` | desliga em qualquer ambiente: some o slot, o script e a folha de estilo |
| `true` | liga em qualquer ambiente; fora de `cinerie.com` o OpaPreço responde 403 e o slot colapsa |

O nome é o do guia do OpaPreço, mas a variável é lida **no servidor, por
requisição**: o release constrói a imagem sem env pública, e um `NEXT_PUBLIC_`
lido no navegador seria congelado no build. Do lado do OpaPreço, "Pausar site"
em `/admin/anuncios` faz todo pedido virar 204.

### Conferir

O servidor só aceita pedido com `Origin` de `cinerie.com` (ou subdomínio); em
`localhost` a resposta é 403. Confira no ar:

```bash
curl -s -D - -o /dev/null -X POST https://opapreco.com.br/v1/ads/serve -H 'Content-Type: text/plain' -H 'Origin: https://cinerie.com' --data '{"siteKey":"cinerie","slotKey":"article-inline-01","page":{"url":"https://cinerie.com/","canonicalUrl":"https://cinerie.com/","title":"Teste"},"client":{"viewport":"desktop","locale":"pt-BR","containerWidth":720}}'
```

Numa matéria publicada, em desktop e celular: cada `<op-slot>` com
`data-op-estado="pronto"` (ou `"colapsado"`, sem buraco), links começando com
`https://s.shopee.com.br/`, clique disparando `/v1/ads/click` com 204, o "Link de
afiliado" visível e o layout parado. Um 204 traz o motivo em
`X-OpaPreco-Ads-Reason` (`no_candidates`, `slot_disabled`, `site_not_approved`…).

## A integração ANTERIOR (2026-10-30), removida em 2026-10-31

O PR #346 montou um sistema próprio, de mesma origem, contra um contrato
(`GET {url}/v1/ad?publisher=…&slot=…`) que o servidor do OpaPreço não implementa.
**Saiu do repositório em 2026-10-31**: `<AdSlot>` e os 6 componentes
(`apps/web/app/_components/opapreco/`), `apps/web/src/lib/opapreco/`, as rotas
`apps/web/app/api/opapreco/{ad,img,track}`, o harness `/dev/ad-preview` e
`services/opapreco` (`@screena/opapreco`). Os slots da home, das listagens, das
fichas, de Pessoa, Explorar, Onde assistir, Listas e Entrar saíram junto: essas
posições não existem no cadastro do OpaPreço. Ficam só como histórico:

| Pasta | O que é |
|---|---|
| `spec/` | especificação de produção v1 e tokens (cópia do handoff) |
| `contracts/` | schemas da resposta do ad server e da oferta, CHANGELOG |
| `fixtures/` | ofertas de teste, incluindo `mustNotRender` e `mustHideDiscount` |
| `DECISIONS.md` | decisões e divergências, com as da implementação na Cinerie |

As variáveis `OPAPRECO_AD_SERVER_URL`, `OPAPRECO_PUBLISHER_ID` e `OPAPRECO_MODE`
não são mais lidas por nenhum código; podem sair do ambiente.
