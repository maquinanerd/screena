# 07 — Classificação de subsistemas

> Cada subsistema classificado como **pronto**, **parcial**, **ausente**, **bloqueado** ou
> **legado**, com o critério explícito e a evidência. SHA `73c58e9`.

## Critério de classificação

| Classe | Significado operacional |
| --- | --- |
| **pronto** | Implementado, **wired** (alcançável em runtime), coberto por teste e exercitado nesta auditoria. |
| **parcial** | Implementado e testado, mas **não alcançável** pelo usuário final, ou coberto só em parte. |
| **ausente** | Não existe código (ou existe só README/contrato). |
| **bloqueado** | O código está pronto, mas algo externo impede operar (dado, licença, credencial, decisão humana). |
| **legado** | Existe, não é caminho canônico, e não deve receber trabalho novo. |

> **"Existe" ≠ "wired".** Esta é a distinção mais importante do documento. Vários subsistemas
> têm código completo e testado que **nenhum caminho de produção invoca**.

---

## 1. Aplicações

| Subsistema | Classe | Evidência |
| --- | --- | --- |
| `apps/web` — render público | **pronto** | 27 rotas no build; smoke 17/17 HTTP real; 19.350 linhas |
| `apps/web` — runtime de autenticação | **parcial** | 4 rotas `/api/auth/**` + 2 páginas no build; **falta UI de login/cadastro** (nenhuma rota de sessão no build) |
| `apps/admin` — leitura editorial | **pronto** | 12 páginas; 33 testes em `tests/admin` |
| `apps/admin` — escrita editorial | **bloqueado** | Código real (`editorial-actions.ts:98…244`) atrás de `ADMIN_EDITORIAL_ACTIONS_ENABLED`, **default desligado** |
| `apps/admin` — gate de tipo | **ausente** | `tsconfig.json` não inclui `apps/**`; CI builda só `@screena/web` (**R-05**) |

## 2. Packages

| Subsistema | Classe | Evidência |
| --- | --- | --- |
| `packages/config` | **pronto** | invariantes, `PUBLISHED_LOCALES`, `RATING_SOURCES`/`RATING_SCALES` |
| `packages/db` | **pronto** | 75 modelos, 42 enums, 12 migrations; 636 asserções em PG real |
| `packages/seo` | **pronto** | resolver de 8 níveis; 36/36 em `validate:seo-runtime`; sitemap paginado no banco |
| `packages/schemas` | **pronto** | validadores de rating e saída do Entity Writer |
| `packages/public-contracts` | **pronto** | 1.868 linhas; único lugar autorizado a conter o host de imagem TMDB |
| `packages/types` | **pronto** | 94 linhas |
| `packages/ui` | **parcial** | apenas 277 linhas em 3 arquivos — bem menor do que a documentação sugere |
| `packages/cinerie-score` | **bloqueado** | 559 linhas; validado (`51/51`) porém **bloqueado por licença** — `validate:source-authorization` confirma "Cinerie Score bloqueado" |
| `seo/` (raiz) | **legado** | 224 linhas, **zero importadores**, fora dos aliases (**R-28**) |

## 3. Serviços

| Subsistema | Classe | Evidência |
| --- | --- | --- |
| `services/ingestion` — TMDB/catálogo | **pronto** | 28.643 linhas; `validate:tmdb-platform` 15/15; `validate:catalog-platform-complete` 78/78 |
| `services/sync` — stale policy | **parcial** | apenas 110 linhas; orquestrador fino sobre `ingestion` |
| `services/entity-writer` | **parcial** | 8.019 linhas, pipeline offline + adapter Gemini validados; **nenhum bloco publicado** (catálogo vazio) |
| `services/user-platform` | **parcial** | 31.626 linhas, 141/141 em PG real; auth **wired**; listas/watchlist/ratings de usuário **sem rota pública** |
| `services/ratings` | **bloqueado** | 7.531 linhas, 51/51 verdes; ratings **não são produto público ativo** (**R-17**, ⚠️) |
| `services/streaming` | **bloqueado** | 5.615 linhas, 11/11 stores; painel público existe, gateado por `display_allowed` |
| `services/legal` | **pronto** | 1.852 linhas; `validate:source-authorization` 18/18 |
| `services/news-ingestion` | **ausente** | só `README.md`, sem `package.json` (**R-35**) |

## 4. Clients de API

| Subsistema | Classe | Evidência |
| --- | --- | --- |
| `api-clients/tmdb` | **pronto** | 2.322 linhas; 38 métodos-endpoint conferidos por `api:coverage` |
| `api-clients/rapidapi-core` | **pronto** | 1.256 linhas; retry/rate-limit/breaker compartilhados |
| `api-clients/streaming_availability` | **pronto** | 731 linhas; 5 endpoints conferidos |
| `api-clients/film_show_ratings` | **pronto** | 603 linhas; 2 endpoints conferidos |
| `api-clients/imdb` | **ausente** | só `README.md` |
| `api-clients/kaso` | **ausente** | só `README.md` |
| `api-clients/rotten_tomatoes` | **ausente** | sem código no worktree |

## 5. Plataforma e operação

| Subsistema | Classe | Evidência |
| --- | --- | --- |
| CI | **pronto** | 24 passos; toda a bateria roda com PG efêmero |
| Build/deploy Docker | **pronto** | `Dockerfile` Node 22; migrations no boot com falha ruidosa |
| Backup/restore | **bloqueado** | scripts prontos, **nunca executados** (**R-02**, P0) |
| Testes unitários/integração | **pronto** | 282 arquivos, 3.375 testes, 0 skipped |
| Testes E2E | **ausente** | nenhum framework no repositório (**R-24**) |
| `workers/*.py` | **legado** | 379 linhas de esqueleto Python; o real é TS/Node |
| `database/` | **legado** | `migrations/` vazio; `seeds/` só README (**R-36**) |
| `prompts/` | **pronto** | 8 prompts versionados em pt-BR |

---

## 6. Quadro consolidado

| Classe | Contagem | Leitura |
| --- | ---: | --- |
| **pronto** | 18 | Fundação técnica é sólida e provada por execução. |
| **parcial** | 7 | Código existe e é testado, mas o usuário final não alcança. |
| **bloqueado** | 5 | Prontos, travados por licença, flag, dado ou decisão humana. |
| **ausente** | 6 | Não existem — inclusive 3 diretórios que aparentam existir. |
| **legado** | 3 | Não devem receber trabalho novo. |

### Interpretação honesta do estado

O repositório é uma **plataforma de dados madura sem produto público de conteúdo**.

- A **infraestrutura** (banco, ingestão, SEO, governança, CI, auth) está *pronta* e provada por
  4.028 asserções verdes.
- O **produto de entretenimento** — catálogo, ratings, onde assistir, editorial — está
  *bloqueado* ou *parcial*: o catálogo está **vazio** (**R-04**) e ratings/score estão
  travados por licença.
- A distância entre "fundação pronta" e "produto no ar" é essencialmente **dado e decisão
  humana de licença**, não código faltando.

Isso é consistente com o `CLAUDE.md`, que descreve o estado como "fundação avançada / vertical
slice técnica" — com a ressalva de que a documentação subestima o quanto de plataforma de
usuário já foi construído (**R-14**, divergência D-6).
