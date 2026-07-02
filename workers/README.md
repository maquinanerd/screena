# Workers Screen (Python 3.12)

Camada de **ingestao e processamento offline** do Screen. Os workers rodam fora
do ciclo de request: eles populam o PostgreSQL, e o app Next apenas **le** desse
banco. Nenhuma API externa e chamada no render.

`workers/` contem scaffolds/roadmap Python e nomes legados. TMDB e Entity Writer
estao atualmente implementados em TypeScript/Node + Prisma.

> Fase 0 / Fundacao: todos os modulos abaixo sao **esqueletos**. Cada `main()`
> apenas registra `"Fase 0: nao implementado"` via `logging` e nao faz nenhuma
> chamada de rede, banco ou IA.

> **Atualizacao Fase 2 (decisao D2.1/D2.4 em `docs/PHASE_2_TMDB_PLAN.md`):** a
> ingestao **TMDB** foi implementada em **TypeScript/Node + Prisma** em
> `api-clients/tmdb`, `services/ingestion` e `services/sync` (persistencia via
> Prisma, mesmo ecossistema de testes/lint/typecheck). Nesta fase a importacao
> TMDB e **por ID explicito + lista curada pequena de dev** (sem discovery):
> **popular/trending/changes ficam para fase futura**. `workers/tmdb_worker.py`
> e `workers/scheduler.py` permanecem como **legado/scaffold** — nesta fase NAO
> implementam persistencia TMDB e podem, no futuro, virar apenas shims de
> systemd que invocam o CLI Node. Os workers Python seguem no roadmap para
> **ratings, streaming, RSSPRIME e Entity Writer** (fases futuras), mas NAO sao
> a implementacao TMDB da Fase 2.

## Fluxo geral

```
Fontes externas            Workers (offline, Python 3.12)         Armazenamento        Leitura
---------------            ------------------------------         -------------        -------
TMDB (via provider)  --->  tmdb_worker.py        ─┐
Ratings (via provider) ->  ratings_worker.py      │
Streaming (via prov.) -->  streaming_worker.py    ├─ escrevem -->  PostgreSQL  -->  Next (RSC/ISR)
RSSPRIME (upstream)  --->  rssprime_worker.py     │                                  le SO o banco
(payload do banco)   --->  entity_writer_worker.py┘                                  e cache local
                           scheduler.py  (orquestra / systemd timers + fila no PG)
```

- **Ingestao -> PostgreSQL -> Next le.** O render publico nunca toca em API
  externa nem em Gemini.
- **Nota:** o ramo **TMDB** do diagrama acima e historico (Python). Na Fase 2 a
  ingestao TMDB roda em **TS/Node** (`services/ingestion`, por ID + lista curada);
  ver a nota da Fase 2 no topo.
- O **Entity Writer** e o unico que aciona o Gemini, e SEMPRE offline, a partir
  de um payload controlado do PostgreSQL, com validacao anti-alucinacao e sem
  publicacao automatica.

## Modulos

| Arquivo | Papel | Periodicidade (referencia) |
|---|---|---|
| `tmdb_worker.py` | **Legado/scaffold** — a ingestao TMDB da Fase 2 roda em TS/Node (`services/ingestion`, por ID + lista curada) | n/a nesta fase (popular/trending/changes = fase futura) |
| `ratings_worker.py` | Ratings externos atribuidos (IMDb, RT, Metacritic, ...) | quentes: 12-24h; catalogo: 7 dias |
| `streaming_worker.py` | Onde assistir por pais (so destinos legais) | catalogo por pais: diario |
| `rssprime_worker.py` | Noticias via upstream RSSPRIME, em clusters | coleta: 15-30min |
| `entity_writer_worker.py` | Motor editorial (content_blocks versionados) | fila: a cada 5-15min |
| `scheduler.py` | Orquestracao via systemd timers + fila simples no PostgreSQL | — |

## Invariantes que os workers reforcam

1. **Zero API externa no render** — paginas indexaveis leem apenas PostgreSQL/cache.
2. **Zero Gemini no render** — IA so gera `content_blocks` offline, salvos e validados.
3. **provider_api != rating_source** — o fornecedor tecnico nunca e a fonte editorial.
4. **IMDb != Rotten Tomatoes** — nunca misturar fontes, escalas, icones ou linguagem.
5. **Sem pirataria** — onde assistir lista apenas destinos legais; "Atualizado em" sempre visivel.
6. **Licenca clara** — dados com `license_status` unknown/blocked ou `display_allowed=false` nao aparecem em pagina indexavel.
7. **pt-BR primeiro** — en/es nascem em draft/noindex ate revisao humana.
8. **Entity Writer nao inventa nem publica** — escreve so a partir de payload controlado e nunca publica sozinho.
9. **API keys so em env vars** — nunca no frontend; todo sync externo gera log (`api_sync_logs`).

## Dependencias

Declaradas em `requirements.txt` (httpx, tenacity, pydantic, psycopg[binary],
python-dotenv, google-generativeai, structlog). **Na Fase 0 nao sao instaladas** —
os esqueletos usam apenas a stdlib. Lint/format configurados em `pyproject.toml`
(ruff e black, target `py312`, line-length 100).

## Execucao (futuro)

Em producao, cada worker e disparado por um **systemd timer** no VPS (CloudPanel),
via `python -m workers.<worker>`. A coordenacao de jobs finos (Entity Writer) usa
uma **fila simples no PostgreSQL** (`entity_writer_jobs`) com claim atomico
(`FOR UPDATE SKIP LOCKED`). Detalhes em `scheduler.py`.
