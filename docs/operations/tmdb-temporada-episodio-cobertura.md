# Cobertura de temporada e episódio no TMDB — o que passou a ser chamado, quanto custa e em qual fila entra

> Data: 2026-08-27. Origem: a comparação lado a lado entre
> `https://cinerie.com/pt/series/ted-lasso/temporadas/2/episodios/1/` e
> `https://www.themoviedb.org/tv/97546-ted-lasso/season/2/episode/1`, que
> mostrou título, data, duração e um parágrafo de um lado, contra 31 artistas
> convidados, 13 pessoas na equipe (com Direção e Roteiro nomeados) e 15 imagens
> do outro.

---

## 1. A causa, em uma frase

Cinco métodos do cliente TMDB existiam e **nenhum worker os chamava**; e o único
worker que tocava episódio lia o payload errado.

`syncEpisodes` buscava `/tv/{id}/season/{n}` e passava cada item de `episodes[]`
para os cinco extratores de `services/ingestion/src/episodes/normalize.ts`. Esse
item é um RESUMO. As duas formas nunca foram iguais:

| bloco | item de `episodes[]` da TEMPORADA | detalhe do EPISÓDIO |
|---|---|---|
| elenco regular | ausente | `credits.cast` |
| guest stars | `guest_stars` no TOPO | topo + `credits.guest_stars` |
| equipe (direção/roteiro) | `crew` no TOPO | topo + `credits.crew` |
| ids externos | ausente | `external_ids` (append) |
| stills | ausente (só um `still_path`) | `images.stills` (append) |

Resultado medido: **quatro dos cinco extratores devolviam `[]` em toda
execução**, e o job reportava `success` com `cast: 0, crew: 0, externalIds: 0,
stills: 0`. `extractEpisodeCrew` era o caso mais caro — o TMDB **mandava** `crew`
no topo, com direção e roteiro dentro, e ele lia só `credits.crew`. O dado
chegava e era jogado fora na mesma linha.

Os testes de unidade não pegaram porque **toda fixture alimentava a forma do
DETALHE** (`credits: {...}`) — a que o chamador de produção nunca fornecia.

---

## 2. Os cinco endpoints ligados

| Método | Endpoint | O que preenche | Quem chama agora |
|---|---|---|---|
| `getTvEpisode` | `/tv/{id}/season/{n}/episode/{e}` | elenco convidado, elenco regular, **direção e roteiro**, ids externos, stills do append | `sync_episodes` |
| `getSeasonImages` | `/tv/{id}/season/{n}/images` | pôsteres da temporada | `sync_media` (`kind='season'`) |
| `getSeasonVideos` | `/tv/{id}/season/{n}/videos` | **o trailer da temporada** | `sync_media` (`kind='season'`) |
| `getEpisodeImages` | `.../episode/{e}/images` | o conjunto COMPLETO de stills (a galeria do episódio) | `sync_media` (`kind='episode'`) |
| `getEpisodeVideos` | `.../episode/{e}/videos` | vídeos do episódio | `sync_media` (`kind='episode'`) |

`getEpisodeVideos` não estava na encomenda: é o **quinto da mesma família**, e
deixá-lo fora manteria a mesma classe de defeito aberta. O custo dele está
separado abaixo para que possa ser desligado sozinho.

### Por que o endpoint próprio, se `images`/`videos` já vêm no append

Porque a cópia do append é **filtrada por idioma**. O detalhe vai com
`language=pt-BR` e o TMDB filtra `/images` e `/videos` por ele: sobrariam as
poucas artes com `iso_639_1=pt`, e o trailer oficial em `en` da maioria dos
títulos sumiria. O endpoint próprio vai **sem** `language`. É a mesma conclusão
que `sync_media` de filme/série já aplicava desde a PR #181, registrada em
`api-clients/tmdb/src/append-consumption.ts`.

Os dois caminhos gravam na **mesma chave única** de `tmdb_images`
(`entity_type, tmdb_id, image_type, file_path`), então rodar os dois é
idempotente — não duplica linha.

---

## 3. O custo, medido em requisições

Para UMA temporada com **N** episódios:

| Trabalho | Requisições | Antes |
|---|---|---|
| `sync_episodes`: temporada (lista os números) | 1 | 1 |
| `sync_episodes`: detalhe de cada episódio | **N** | 0 |
| `sync_media` de temporada: `/images` + `/videos` | **2** | 0 |
| `sync_media` de episódio: `/images` + `/videos` (× N) | **2N** | 0 |
| **total** | **3N + 3** | 1 |

Ted Lasso T2 (N = 12): **39 requisições**, contra 1 antes.

Os cinco `append_to_response` do episódio cabem num único pedido (teto de 20
sub-requests), então não há multiplicação além dessa.

### Em jobs, que é o custo que a fila sente

| Job | Quantidade | Prioridade |
|---|---|---|
| `sync_episodes` | 1 por temporada | 70 |
| `sync_media` (`season`) | 1 por temporada | 75 |
| `sync_media` (`episode`) | **1 por episódio** | 80 |

A prioridade é crescente na ordem do valor: o detalhe do episódio POVOA a
página, o trailer da temporada a enriquece, e a galeria de stills é
enriquecimento de uma sub-página. **Menor = mais prioritário.**

### Os dois freios

Ambos default `true`, ambos desligáveis **independentemente**:

- `sync_seasons` → `enqueueSeasonMedia: false` — corta 1 job e 2 requisições por
  temporada.
- `sync_episodes` → `enqueueEpisodeMedia: false` — corta **N jobs e 2N
  requisições**, a dimensão cara. Com ele desligado os stills continuam
  entrando pela cópia do append do detalhe, só que no subconjunto que o filtro
  de idioma deixa passar.

---

## 4. A chave de gravação NÃO é o id da série

`sync_media` recusava temporada e episódio desde sempre, com esta justificativa
no código:

> a chave de mídia é (entityType, tmdbId) e para temporada o tmdbId é o da SÉRIE
> — todas as temporadas colidiriam na mesma chave de cache

**A colisão era real.** O que estava errado era a conclusão: o conserto não era
recusar, era separar dois papéis que estavam num número só.

- **`tmdbId` do job** → endereça a URL. É o id da SÉRIE, porque é assim que o
  TMDB endereça (`/tv/97546/season/2/images`).
- **chave de `tmdb_images`/`tmdb_videos`** → é o id **PRÓPRIO** da entidade
  (`seasons.tmdb_id`, `episodes.tmdb_id`), resolvido no banco pelo adapter.
- **`endpointBase`** → o caminho REAL, que vai para `api_cache` e para o
  `endpoint` de `api_sync_logs`. Antes era derivado como
  `/{entityType}/{tmdbId}`, o que para temporada produziria
  `/season/119051/images` — um caminho que não existe no TMDB, e um log mentindo
  sobre o que foi requisitado.

**Fail-closed:** sem `tmdb_id` próprio no banco, o job é RECUSADO
(`missing_own_tmdb_id`). Gravar a mídia da temporada sob o id da série é
exatamente a corrupção que a recusa antiga temia, e continua sendo pior que
recusar.

A segunda metade daquela justificativa — *"nada se perde: os stills de episódio
já entram por `sync_episodes`"* — era **falsa**, pelo motivo da seção 1. Foi ela
que manteve a ausência parecendo intencional.

---

## 5. Os SETE appends de `/tv/{id}/season/{n}`

A auditoria de 22/08 apontou que os sete eram pedidos a cada sincronização e
descartados inteiros. A causa era estrutural: o registro de consumo era chaveado
pelo **valor** do append, sozinho. `credits` classificado para `movie`/`tv`
cobria, de graça, o `credits` de `tv_season` e o de `tv_episode` — dois pares que
nenhum módulo jamais leu. A trava passava verde.

**A chave agora é o par `(tipo, valor)`.** Um valor pedido em cinco tipos são
cinco afirmações, e cada uma tem de ser feita separadamente (`types` é
obrigatório em toda entrada).

| Valor | Decisão | Motivo |
|---|---|---|
| `images` | **CONSUMIDO** — endpoint próprio | `sync_media` de temporada. A cópia do append vem filtrada por idioma (seção 2). |
| `videos` | **CONSUMIDO** — endpoint próprio | idem. É o trailer da temporada. |
| `credits` | **ADIADO** | Elenco da TEMPORADA (não do episódio). Nenhuma tela do canônico tem esse bloco: a ficha da série mostra o elenco da série e a página de episódio mostra o do episódio — este ficaria entre os dois, repetindo um e competindo com o outro. |
| `aggregate_credits` | **ADIADO** | Elenco agregado com `roles[]` e contagem de episódios. Não há consumidor (o registro afirmava `normalizers/credits.ts` e a string nunca esteve lá — grep devolve zero em `services/**`). Consumi-lo exigiria coluna de contagem por crédito, que o schema não tem. |
| `external_ids` | **ADIADO** | Ids externos da temporada. `entity_external_ids` aceita `entity_type='season'`, mas nada os consulta: atribuição e linkback da página de temporada apontam para a SÉRIE, e nenhum provedor de nota ou oferta é chaveado por temporada. |
| `translations` | **ADIADO** | Porta de en/es, que dependem de `PUBLISHED_LOCALES` e de revisão humana (invariante 7). |
| `watch/providers` | **ADIADO** | `normalizeWatchProviders` aceita SÓ `movie`/`tv` e recusa este bloco. A recusa é deliberada: `watch_availability` é chaveada por entidade renderizável com página de oferta, e a temporada não tem essa página. |

**Nenhum descarte silencioso: cinco adiamentos com motivo escrito, dois
consumos com o caminho do módulo.**

### Quatro entradas do registro estavam mentindo

Corrigidas na mesma leva, verificadas por grep:

| Valor | Dizia | Diz agora |
|---|---|---|
| `aggregate_credits` | CONSUMIDO por `normalizers/credits.ts` | ADIADO — a string não existe em `services/**` |
| `combined_credits` | CONSUMIDO por `normalizers/credits.ts` | ADIADO — única ocorrência é um comentário em `bin/promote-tmdb-raw.ts` |
| `keywords` | ADIADO, "não há superfície que a use" | CONSUMIDO — `extractKeywords` em `catalog-services.ts:314` |
| `alternative_titles` | ADIADO | CONSUMIDO — `extractAlternativeTitles` em `catalog-services.ts:315` |

A trava garante **cobertura**, não **veracidade** — o próprio arquivo declara
isso. Conferir o caminho continua sendo trabalho humano.

---

## 6. Como rodar

```bash
# Detalhe + créditos + equipe + ids + stills de UMA temporada.
# Enfileira sync_media por episódio (desligue com enqueueEpisodeMedia=false).
pnpm catalog episodes --id 97546 --season 2 --apply

# Trailer e pôsteres de UMA temporada. --id é o da SÉRIE.
pnpm catalog media --entity season --id 97546 --season 2 --apply

# Stills e vídeos de UM episódio.
pnpm catalog media --entity episode --id 97546 --season 2 --episode 1 --apply
```

Sem `--apply` é dry-run e o plano imprime o caminho REAL que seria chamado.

### O trailer ainda precisa de um segundo passo

`tmdb_videos` nasce `display_allowed = false` e `license_status = 'unknown'`.
Coletar **não acende**. A promoção é operação governada, fora do render:

```bash
pnpm catalog promote:media --target video --entity-type season --reviewer <nome> --confirm
```

São DOIS passos, como em ratings e em streaming, e o segundo é decisão humana
registrada — nunca deploy.

---

## 7. O que isto NÃO resolve

- **A fila precisa de consumidor.** Estes jobs entram em `catalog_jobs`; se
  ninguém os drena, a página continua vazia. A auditoria de 22/08 mediu 608 jobs
  100% `pending` e o serviço `screen-catalog-worker` ausente do painel. Ligar os
  endpoints é condição necessária, não suficiente.
- **A licença de vídeo por LINHA.** Ver acima: coletar não acende.
- **Nada foi escrito em produção por esta leva.** As telas foram provadas com
  `pnpm --filter @screena/web qa:episode-season`, que sobe PostgreSQL efêmero em
  `127.0.0.1` e semeia a T2 de Ted Lasso. É fixture, não catálogo.
