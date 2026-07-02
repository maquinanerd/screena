# scripts/import — Import em massa de entidades (TMDB -> PostgreSQL, com revisao)

> Esta pasta documenta o alvo historico de **import/ingestao em massa**. O estado
> real atual ja tem client TMDB e ingestao por ID/lista curada em
> `api-clients/tmdb`, `services/ingestion` e `services/sync` (TypeScript/Node +
> Prisma). Popular/trending/changes e import em massa continuam para fases
> futuras.

## Objetivo

Popular a base canonica (PostgreSQL) com entidades — filmes, series, temporadas,
episodios, pessoas — a partir do **TMDB** (e fontes correlatas), de forma
**controlada, logada e revisavel**, sem nunca contaminar o render publico.

## Principios (invariantes que este import respeita)

1. **Zero API externa no render**: o import roda **offline** (hoje em
   TypeScript/Node + Prisma para TMDB; workers Python podem virar shim futuro).
   O TMDB e chamado **aqui**, jamais no caminho de render. O app publico le
   **somente PostgreSQL/cache local**.
2. **`provider_api` != `rating_source`**: o TMDB e um **fornecedor tecnico**
   (provider_api), nunca a fonte editorial de uma nota. Notas externas guardam
   sua propria `rating_source`, escala e atribuicao.
3. **IMDb != Rotten Tomatoes**: o import nunca mistura fontes, escalas, icones ou
   linguagem. Nota de uma fonte nunca vira rotulo de outra.
4. **Licenca antes de exibir**: dado importado com `license_status`
   `unknown`/`blocked` ou `display_allowed=false` **nao** vai para pagina
   indexavel. O import grava o estado de licenca; a exibicao e gateada depois.
5. **Todo sync gera log**: cada execucao escreve em `api_sync_logs` (e usa
   `api_cache` quando aplicavel). Nenhuma ingestao silenciosa.
6. **pt-BR primeiro**: traducoes `en`/`es` importadas nascem em **draft/noindex**
   ate revisao humana.
7. **Sem publicacao automatica**: o import **stage**ia dados; promover para
   `published`/`index` exige **revisao humana**. O import nunca publica sozinho.
8. **Sem inventar fatos**: o import apenas mapeia o payload do provedor para o
   schema canonico; nao gera texto editorial (isso e do Entity Writer, offline e
   versionado em `content_blocks`).

## Fluxo de import (alvo)

```
TMDB API  ->  worker de import (offline, com log)  ->  staging  ->  revisao humana  ->  PostgreSQL canonico
                         |                                                                    |
                    api_cache                                                          slugs / redirects
                  api_sync_logs                                                  entity_external_ids (mapa TMDB->canonico)
```

1. **Selecao**: definir o lote (ex.: por id, por descoberta/discover, por
   atualizacao recente). Lotes grandes sao paginados e rate-limited.
2. **Fetch + cache**: buscar do TMDB respeitando rate limit; gravar resposta crua
   em `api_cache`; registrar a execucao em `api_sync_logs`.
3. **Normalizacao**: mapear o payload para o schema canonico (movies, tv_shows,
   seasons, episodes, people, cast_members, crew_members, images, etc.),
   preservando `provider_api` e ids externos (`entity_external_ids`).
4. **Idempotencia**: usar o id externo do TMDB para fazer upsert; reimportar nao
   duplica entidades.
5. **Staging + diff**: gravar em area de staging; produzir um **diff** legivel do
   que entraria/mudaria.
6. **Revisao humana**: aprovar o lote. Decisoes de licenca e de indexacao em
   massa **sempre** passam por humano.
7. **Commit**: aplicar o lote aprovado ao canonico; gerar `slugs`/`redirects`
   conforme necessario.
8. **Indexabilidade**: a decisao `index`/`noindex` segue o **gate anti-thin**
   (>= 2 blocos de valor proprios). Entidade recem-importada, sem blocos, nao
   indexa.

## Scripts previstos (a implementar)

| Script | Responsabilidade |
| --- | --- |
| `services/ingestion` | Implementacao atual: fetch TMDB -> cache/log -> upsert canonico por ID/lista curada. |
| `api-clients/tmdb` | Client TMDB real em TypeScript, com auth v4/v3, retry, rate limit e circuit breaker. |
| `tmdb-import.py` | Historico/roadmap: worker Python de import em massa, se um dia virar shim. |
| `normalize.py` | Historico/roadmap: mapeia payload TMDB para o schema canonico. |
| `stage-diff.py` | Gera diff legivel do lote (o que entra/muda). |
| `commit-batch.py` | Aplica lote aprovado ao PostgreSQL (idempotente). |
| `link-external-ids.py` | Mantem `entity_external_ids` (TMDB -> canonico). |

## Agendamento (systemd timer — alvo)

O import roda como pipeline offline, nunca dentro de um request HTTP. A
implementacao atual e TS/Node; systemd timers podem acionar CLI/worker no futuro.
Frequencia e janela sao definidas por lote (ex.: descoberta diaria, refresh
semanal de entidades populares).

## Variaveis de ambiente esperadas (no servidor, fora do git)

- `TMDB_READ_ACCESS_TOKEN` (v4, preferido) ou `TMDB_API_KEY` (v3) — **so em env
  var**, usado **apenas** pelo pipeline offline, nunca pelo frontend nem em
  codigo versionado.
- `DATABASE_URL` — destino canonico.
- Parametros de rate limit / concorrencia do import.

> O TMDB e provedor tecnico. Atribuicao e termos de uso da fonte devem ser
> respeitados; estado de licenca e gravado por entidade e gateia toda exibicao
> indexavel.
