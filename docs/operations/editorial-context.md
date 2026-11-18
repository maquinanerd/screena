# Cinerie Context Service — `POST /api/internal/editorial-context`

> Rota do **screen-app** (`apps/web`), como a de resolução. É o componente que o
> [ADR 0015, §3.2](../adr/0015-editorial-boundaries.md) chamava de "futuro": interno,
> autenticado, somente leitura, fora do alcance do navegador, servindo o contrato versionado
> `cinerie-editorial-context-v1` (`packages/editorial-contracts`).

## 1. Para que serve

"Para estas obras, me dê a ficha que a Cinerie pode entregar." O consumidor manda uma ou mais
obras (filme ou série) e recebe, por obra:

| Grupo | O que vem | Portão |
| --- | --- | --- |
| Identidade | id interno, slug pt-BR, URL canônica da ficha, ids TMDB/IMDb/Wikidata | slug canônico pt-BR obrigatório |
| Descrição | título localizado, título original, sinopse, estreia, duração, gêneros, temporadas/episódios | o mesmo `selectSynopsis` da ficha pública |
| Pessoas | elenco (12 primeiros na ordem de créditos), direção, roteiro, com a página da pessoa quando existe | — |
| Imagens | backdrop, até 3 cenas (1280 px) e pôster (780 px); cada peça leva `entityKind` + `entityId` (filme e série têm sequências de id próprias) | licença `tmdb/image` (o mesmo `getImageDisplayAuthorization` da página) **e** a chave de uso editorial (§4) |
| Trailer | link do YouTube e do player sem cookie | linha `tmdb_videos.display_allowed` (o mesmo `getTrailerForEntity`) |
| Onde assistir | plataformas no Brasil por modalidade, com o crédito da fonte | a cadeia de licença inteira (`licensedWatchWhere`) |
| Lacunas | `omissions`: sem sinopse em português, imagem bloqueada, sem oferta confirmada | — |

**O que a Cinerie não pode mostrar, o contexto não entrega.** Os portões são os da página
pública, chamados no mesmo request; uma revogação de licença vale na chamada seguinte.

Primeiros consumidores: o **MN-Prime** (redige a matéria do Máquina Nerd com a ficha) e o
**portal do Máquina Nerd** (mostra a ficha ao lado do texto). O MNScr pode usar a mesma rota.

## 2. Autenticação

```
POST https://cinerie.com/api/internal/editorial-context
Authorization: Bearer <chave>
Content-Type: application/json
```

`API-Key <chave>` também é aceito. O escopo é `catalog_context`, declarado pelo **nome da
variável** `CINERIE_EDITORIAL_CONTEXT_API_KEYS`: uma chave do resolve
(`CINERIE_CATALOG_RESOLVE_API_KEYS`) não abre esta rota, e o contrário também não.

A rota **nasce desligada**: sem chave configurada responde `503 context_disabled`.

## 3. Pedido

```json
{
  "requestId": "mn-prime:evento-123",
  "language": "pt-BR",
  "items": [
    { "kind": "movie", "entityId": "4242" },
    { "kind": "tv", "tmdbId": 94997 },
    { "kind": "movie", "slug": "duna-parte-dois" },
    { "kind": "tv", "title": "House of the Dragon", "year": 2022 }
  ]
}
```

- `kind`: `movie` ou `tv`. Pessoa, temporada e episódio não têm ficha de título aqui.
- Cada item aponta a obra por **um** caminho, nesta ordem de preferência: `entityId` (id
  interno), `tmdbId`, `slug` (o da URL `https://cinerie.com/pt/filmes/<slug>/`) ou `title`
  (+ `year`, recomendado).
- `title` passa pelo **mesmo tradutor** da rota de resolução
  ([entity-resolve.md](entity-resolve.md)): casa título pt-BR, título original e títulos
  alternativos, exatos; homônimo devolve `null` com motivo, nunca "o mais popular".
- Até **5 itens** e **16 KiB** por chamada. Um item mal montado derruba o pedido (`422` com a
  lista de problemas).
- `requestId` (opcional) volta ecoado; sem ele, a rota gera um.

## 4. Resposta

```json
{
  "context": { "contractVersion": "cinerie-editorial-context-v1", "entities": [...], "media": [...], "availability": [...], "omissions": [...] },
  "resolutions": [
    { "index": 0, "kind": "movie", "entityId": "4242", "matchedBy": "entity_id", "confidence": 1, "reason": null },
    { "index": 3, "kind": "tv", "entityId": null, "matchedBy": null, "confidence": 0, "reason": "ambiguous_title" }
  ]
}
```

- `context` é o contrato `cinerie-editorial-context-v1`. A saída do presenter passa pelo parser
  oficial do contrato em teste (`apps/web/src/lib/__tests__/editorial-context-presenter.test.ts`).
- Campos que este serviço acrescentou ao contrato (opcionais, compatíveis): `genres`,
  `seasonCount`, `episodeCount`, `lastAirDate`, `ended` na entidade; `role`
  (`poster|backdrop|scene|trailer`), `entityKind`, `entityId` e `embedUrl` na mídia;
  `entityKind` na oferta. **Case mídia e oferta pela dupla tipo + id**: `movie:12` e `tv:12` são
  obras diferentes.
- `resolutions` diz, item a item, como cada pedido chegou (ou não) a uma obra. **Um `entityId`
  com `reason` preenchido não existe** — não use.

### Mídia: o que cada flag quer dizer

| Peça | `allowedForEditorial` | `allowedForHero` / `allowedForSocial` | Crédito |
| --- | --- | --- | --- |
| backdrop, cena | sim | sim (capa e imagem social) | `TMDB`, obrigatório na legenda |
| pôster | sim | **não** — arte vertical com título estampado; um corte 16:9 decapita a arte | `TMDB`, obrigatório |
| trailer | sim, **só incorporado** pelo player oficial do YouTube | não | o próprio player |

O consumidor aplica `isMediaUsableForEditorial` (do contrato): só `licenseStatus = approved` com
`allowedForEditorial = true` passa.

### Decisão do dono, 18/11/2026: imagens do catálogo nas matérias do Máquina Nerd

O pedido do dono, nesta data, foi que o Máquina Nerd "capture imagens, conteúdo, trailers" da
Cinerie para construir as notícias sobre o filme ou a série. É uso **fora** da Cinerie da mesma
arte que a Cinerie já exibe sob a licença `tmdb/image`, com o mesmo crédito. Por isso:

- o uso editorial das imagens é uma chave **própria**, separada da licença:
  `CINERIE_EDITORIAL_CONTEXT_MEDIA` — ligada por padrão; `off` tira todas as imagens do contexto
  na chamada seguinte, sem deploy de código, e a lacuna aparece em `omissions`
  (`license_blocked`);
- sem a licença `tmdb/image` vigente e exibível, nenhuma imagem sai, com a chave ligada ou não;
- o crédito `TMDB` é obrigatório em toda imagem (`requiresAttribution = true`);
- trailer e oferta não dependem desta chave: seguem os próprios portões de licença;
- **o desligamento vale para as consultas seguintes**, não retroage: a imagem que o MN-Prime já
  subiu para o Kal El numa matéria publicada, ou guardou no rascunho de uma entrega que vai ser
  reenviada, continua lá. Retirar o que já foi ao ar é trabalho editorial no CMS de quem publicou.

## 5. Erros

| Status | `error` | O que fazer |
| --- | --- | --- |
| `400` | `invalid_json` | corrigir o corpo |
| `401` | `unauthenticated` | conferir a chave do cliente |
| `405` | `method_not_allowed` | só `POST` |
| `413` / `422` | `payload_too_large`, `validation_failed`, `too_many_items` | ver `issues` |
| `429` | `rate_limited` | esperar `retry-after` |
| `503` | `context_disabled` | nenhuma chave no servidor |
| `503` | `context_failed` (`retryable: true`) | falha de leitura: tentar depois, nunca tratar como "não existe" |

Toda resposta sai com `cache-control: no-store` e `x-robots-tag: noindex, nofollow`, sem CORS.

## 6. Variáveis de ambiente (screen-app)

| Variável | Obrigatória | Default | O que faz |
| --- | --- | --- | --- |
| `CINERIE_EDITORIAL_CONTEXT_API_KEYS` | **sim, para a rota existir** | — | uma ou mais chaves (vírgula), ≥ 24 caracteres. Escopo `catalog_context`. Mais de uma serve para rotação |
| `CINERIE_EDITORIAL_CONTEXT_RATE_LIMIT_PER_MINUTE` | não | `300` | teto por chave, por processo |
| `CINERIE_EDITORIAL_CONTEXT_MEDIA` | não | ligado | `off` tira as imagens do contexto (§4) |

Gerar uma chave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

**Uma chave por consumidor**, as duas na mesma variável (`<chave do portal>,<chave do MN-Prime>`):
o teto é por chave, e com uma chave só uma rajada do portal (depois de um deploy, um crawler)
deixaria o MN-Prime sem ficha numa matéria que sai na hora. Também deixa revogar um sem tocar no
outro. No Máquina Nerd: `CINERIE_SERVICE_TOKEN` no portal; painel `/chaves`, provedor `cinerie`,
no MN-Prime.

Chave com menos de 24 caracteres é **ignorada também na comparação** (desde 18/11/2026; antes, uma
chave curta ao lado da verdadeira abria a rota — o mesmo valia para o resolve, corrigido junto) e
gera o aviso `editorial_context_credential_rejected` a cada chamada.

## 7. Custo

Por obra: ~12 leituras indexadas (registro, slug, traduções, gêneros, elenco, equipe, slugs das
pessoas, ids externos, ofertas, trailer, cenas) e uma da licença de imagem por chamada. Nada é
guardado em cache aqui: quem chama guarda (o portal, por uma hora com a tag `cinerie:titles`).

## 8. Como isto é verificado

- `apps/web/src/lib/__tests__/editorial-context-request.test.ts` — o pedido, os tetos e as
  chaves por variável própria;
- `apps/web/src/lib/__tests__/editorial-context-presenter.test.ts` — a resposta é o contrato
  v1 (parser oficial), pôster nunca é capa, chave de mídia desligada não entrega imagem, licença
  negada vira omissão, ofertas sem duplicata e com crédito.
