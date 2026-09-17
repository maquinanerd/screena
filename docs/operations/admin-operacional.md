# Painel operacional da Cinerie — contrato

> **O que é:** o painel onde o dono vê o estado real do catálogo, das filas, das
> cotas, dos serviços e dos usuários, e força a atualização de um título sem
> abrir terminal.
>
> **O que não é:** editorial. Matéria, autor e publicação são do `cinerie-cms`.
>
> Este documento foi escrito ANTES do código (PARTE A da leva de 2026-09-15) e é
> o contrato do que cada tela pode prometer. Onde um número daqui contradisser o
> banco, o banco manda e este arquivo se corrige.

---

## 0. Onde o painel mora: `apps/admin`, e não `apps/web`

O pedido original dizia "grupo de rotas `/admin` dentro de `apps/web`". O
levantamento encontrou cinco fatos que mudam a resposta:

| Fato medido | Onde |
| --- | --- |
| Já existe um painel interno, `apps/admin`, com Basic Auth **fail-closed** em produção | `apps/admin/src/lib/access-protection.ts`, `apps/admin/middleware.ts` |
| A decisão registrada é que o painel interno **nunca** fica em `cinerie.com` | `docs/operations/admin-deploy.md` (tabela "Criar o serviço") |
| O layout raiz do `apps/web` impõe cabeçalho e o **rodapé escuro** a toda rota, e um teste exige um único `<html>` com `<SiteFooter />` | `apps/web/app/layout.tsx`; `app/_components/__tests__/footer-credits.test.tsx` |
| O `apps/web` proíbe `next/headers` e só 36 arquivos podem importar a autenticação de usuário | `tests/web/route-cache-policy.test.ts` (8); `tests/governance/user-platform-privacy.test.ts` |
| `users.role` existe (`admin` incluso), mas **nada o grava nem o confere**: promover alguém exigiria SQL à mão | `schema.prisma` (`UserRole`); `services/user-platform/src/core/request-guards.ts` (sem chamador) |

Consequência: o painel mora em `apps/admin` e **reusa a autenticação que já
existe ali** (Basic Auth por variável de ambiente, recusa em produção sem
credencial). O custo desta escolha é um passo do dono: criar o serviço no
EasyPanel (`admin-deploy.md`). O ganho é o painel não dividir processo, pool de
conexões nem guardas com o site público, e as consultas pesadas de cobertura
(3,9 M de episódios) nunca competirem com tráfego de leitor.

---

## 1. Catálogo — onde mora cada coisa

| Dado | Tabela / coluna | Portão de exibição |
| --- | --- | --- |
| Título | `movies.title_original`, `tv_shows.name_original`; pt-BR em `entity_translations.title` | — |
| Sinopse (filme/série) | `entity_translations.summary`, **em qualquer idioma** (a ficha mostra o de origem com aviso) | — |
| Sinopse (temporada/episódio) | `seasons.overview`, `episodes.overview` | — |
| Biografia | `people.biography` | texto **e** `biography_source_status` em official/licensed/third_party |
| Payload guardado | `api_cache.payload` (endpoint `/movie/<id>`…) e `tmdb_raw.payload`, bloco `translations.translations[]` | — |
| Pôster | `poster_path` (filme, série, temporada), `episodes.still_path`, `people.profile_path` | **FONTE**: `source_licenses` tmdb/image vigente |
| Trailer | `tmdb_videos` (a temporada usa o `tmdb_id` DELA) | **LINHA**: `display_allowed`, licença fora de unknown/blocked, YouTube, Trailer/Teaser, chave válida |
| Nota externa | `external_ratings` (só filme e série) | **LINHA + leitura**: decisão `rating_display` vigente, BR, licença-mãe exibível com `score_allowed`, frescor (`RATING_STALE_POLICY`), `score_type`, crédito |
| Cinerie Score | `cinerie_score_calculations` (último `calculated`) | decisão `cinerie_score_display` vigente + **≥ 2 fontes nomeadas** |
| `vote_average_tmdb` | `movies`/`tv_shows` | dado técnico; nunca nota editorial |
| Indexabilidade | `page_indexability_decisions` (vigente) fundida com os fatos vivos | temporada e episódio suspensos (`noindex,follow`) |

Confundir os portões faz a tela mentir: imagem com `display_allowed=false`
aparece na página (o portão é da fonte), vídeo com a mesma coluna não aparece
(o portão é da linha).

**Contagens:** esta leva não mediu produção. O código cita, com data, 37.554
filmes, 32.983 séries, 136.650 temporadas e 3.921.368 episódios (28/08,
`rhythms.ts`) e 48.611 filmes / 34.700 séries (31/08, `omdb-rotation.ts`). A tela
**Cobertura** mede ao vivo e a tabela `catalog_coverage_snapshots` guarda um
retrato por dia.

---

## 2. Filas — e a volta de cada uma

**Volta** = universo ÷ (teto por ciclo × ciclos por dia). Uma fila diária com
volta anual é uma fila anual com rótulo diário.

O teto global (`CINERIE_SCHEDULER_BATCH_LIMIT`, default 200) é variável do
`screen-cron` e **não é visível do painel**. Por isso a tela mostra duas voltas:
a **declarada** (teto do código) e a **medida** (média de `items_processed` dos
últimos 7 dias em `api_sync_logs`). Acima de 30 dias, vermelho.

| Fila | Ritmo | Teto | O que faz | Universo |
| --- | --- | --- | --- | --- |
| `deploy_reference` (nova) | 1 h | — | lê o `main` no GitHub e grava `deploy_main_commits` | não se aplica |
| `watch_offers` | 24 h | global | chama `/watch/providers` e grava ofertas | filmes + séries |
| `trending` | 6 h | 4 jobs | 4 `sync_lists` | 4 listas |
| `airing_series` | 24 h | global | `sync_details` | séries em exibição (status nulo incluso) |
| `title_media` | 24 h | 12.000 | `sync_media` | filmes + séries |
| `discovery` | 24 h | 3 jobs | `discover_ids` | export diário do TMDB — **fora do banco**: volta não determinável |
| `changes` | 6 h | 1 job | `sync_changes` | incremental por janela |
| `cinerie_score` | evento, 24 h | todos | CLI `compute-cinerie-score` | todos os títulos a cada ciclo |
| `search_projection` | evento, 24 h | todos | CLI `search-reindex` | todos a cada ciclo |
| `catalog_coverage` (nova) | 24 h | — | grava o retrato de cobertura do dia | não se aplica |
| `ratings_omdb` | 24 h | 700 | CLI `sync-omdb-ratings`, 85% cobertura / 15% atualização | cobertura: `imdb_id` e zero notas |
| `title_detail_active` | 7 d | global | `sync_details` | filme não `Released` + série não encerrada |
| `people` | 30 d | global | `sync_details` | todas as pessoas |
| `title_detail_ended` | 30 d | global | `sync_details` | filme `Released` + série `Ended`/`Canceled` |
| `awards` | 30 d (1 d na temporada) | global | CLI `promote-omdb-awards` | payloads da OMDb em `api_cache` |

Fila **produtora** reporta o desfecho do ENFILEIRAMENTO, não do trabalho. A tela
mede o trabalho em `catalog_jobs` pelo `run_id = 'scheduler:<fila>'`, que o filho
herda.

`catalog_jobs` é reivindicado por `priority ASC, available_at ASC`. Faixas:
sob demanda 10 · produtores (`discover_ids`, `sync_changes`) e trending 20 ·
`/changes` 50 · temporadas 65 · episódios 70 · mídia 70–80 (episódio 80) ·
agendado 80–96 · descoberta 100.

Até 2026-09-16 os produtores nasciam em 100 (o default do schema) e o "Forçar
fila" de `discovery`/`changes` caía no fim da fila junto com eles. Ver
[`fila-represada-2026-09-16.md`](./fila-represada-2026-09-16.md).

---

## 3. Provedores e cotas

| Provedor | Teto | Base | Onde o gasto é contado | Publica cabeçalho de cota? |
| --- | --- | --- | --- | --- |
| `omdb` | 1.000/dia (150 reservados ao leitor; fundo 700) | publicada | `api_sync_logs.quota_cost` — **requisições reais** do worker | **Não.** O número é o que NÓS contamos |
| `tmdb` | sem teto diário; ~40 req/s | piso assumido | `quota_cost` = **falhas de cache** no import; linhas do agendador de `title_media`/`trending` são **planejadas** | não lido |
| `tmdb-exports` | nenhum | publicada | sempre 0 | — |
| `github` (novo) | 60/h sem token | publicada | `quota_cost` = requisições da fila `deploy_reference` | sim (`x-ratelimit-*`) |
| `gemini` | — | — | **não grava** `api_sync_logs` | — |
| `streaming_availability`, `imdb236`, `rapidapi_film_show_ratings` | aposentados (2026-09-02) | — | a chave fica por FK | — |

"Gasto de hoje" = `SUM(quota_cost)` desde 00:00 **UTC**.

Recusa **do fornecedor** por cota: só `error_code = 'omdb-quota-exhausted'` é
certa. `TmdbHttpError`/`HttpError` misturam 429, 404 e 5xx. Recusa pelo NOSSO
contador (`quota-denied`) não é gravada em coluna nenhuma.

**Alerta vermelho obrigatório:** recusa da OMDb hoje com o nosso contador abaixo
de 1.000. É o único sinal de que o contador subconta.

---

## 4. Serviços e versões

| Serviço | Imagem | Sinal que existia antes desta leva |
| --- | --- | --- |
| `screen-app` | `Dockerfile` | `/api/health/` — `version` lida de env (**mente**) |
| `screen-cron` | `Dockerfile` + comando | `/healthz`, `/status`; linhas `scheduler/*` a cada fila vencida |
| `screen-catalog-worker` | `Dockerfile.catalog-worker` | `/healthz`, `/readyz`; `catalog_jobs.heartbeat_at` só com job em voo |
| `cinerie-publication-worker` | `Dockerfile.publication-worker` | `/healthz`, `/readyz`; `editorial_projection_receipts` |
| `cinerie-cms` | `Dockerfile.cms` | `/readyz`; banco PRÓPRIO |
| `cinerie-admin` (este painel) | `Dockerfile.admin` | nenhum; ainda não criado |

Todas as imagens copiam o repositório inteiro e **nenhuma tem `.git`**.
`CINERIE_BUILD_SHA` é env estática do EasyPanel: ficou 38 commits atrasada.

**Método adotado (e por que não mente):**

1. Cada serviço, na subida, calcula o **SHA-1 de blob git** de cada arquivo-fonte
   que está no disco do container (`apps|packages|services|api-clients/*/{src,app,bin,prisma}`)
   e grava um **digest** em `service_heartbeats`, com sinal de vida a cada 60 s.
2. A fila `deploy_reference` lê do GitHub (repositório público, sem token) os
   últimos 30 commits do `main` e a árvore de cada um, e aplica **a mesma regra**.
3. O commit em execução é o commit do `main` cuja árvore dá o **mesmo digest** que
   o disco. A diferença sai da API de comparação do GitHub.

O identificador é o conteúdo que o processo carregou, não um rótulo digitado.
Commits que só mudam documentação têm o mesmo digest do anterior — a tela diz
isso em vez de escolher um.

`cinerie-cms` fica **não determinado**: usa banco próprio e a ADR 0015 proíbe a
ponte.

**O `screen-cron` "amarelo desde sempre" (medido em 16/09/2026):** o serviço usa
a imagem do `Dockerfile`, cujo `HEALTHCHECK` sondava fixo a porta 3000; o agendador
escuta na 3005. O container nunca ficava saudável e era substituído em loop — os
sinais de vida mostraram **129 containers do agendador numa hora**, ~121 s cada,
e as filas longas pararam de registrar execução. Foram os sinais de vida desta
leva que tornaram o defeito mensurável: um serviço de longa duração tem ~1
instância por hora, e "tem sinal" sozinho não distingue um processo estável de
um que renasce a cada dois minutos.

Consertado pelo código, sem configuração no painel: o `HEALTHCHECK` reconhece o
serviço pelo comando do container (`scripts/healthcheck/`). Ver
[`ingestion-scheduler.md`](./ingestion-scheduler.md) → "O HEALTHCHECK do
container". A nota do `screen-cron` em `apps/admin/src/server/ops/services.ts`
ainda fala em hipótese: mudar fonte do admin altera a impressão digital de TODOS
os serviços (a tela os pintaria "atrás do main" até cada um ser reimplantado), então
ela sai junto com a próxima mudança de código do painel.

---

## 5. Usuários — o que existe e o que não existe

| Coisa | Estado | Tabela |
| --- | --- | --- |
| Conta, e-mail, status, verificação | existe, com rota e tela | `users` (e-mail em **texto puro**, único) |
| Login | existe | `user_sessions` (uma linha por login), `user_auth_audit_logs` (`login_succeeded`) |
| Último acesso | **não existe** (`last_used_at` nunca é gravado) | proxy: última sessão criada |
| Origem do cadastro | **não existe** | — |
| Papel (admin/moderador) | coluna existe, **nada grava nem confere** | `users.role` |
| Nota dada por usuário | existe, com widget na ficha | `user_ratings` (escala 5, passo 0,5) |
| Review | **não implementado** (tabela sem rota nem escrita) | `user_reviews` |
| Watchlist, favoritos, listas | existe | `user_lists` (`system_key`), `user_list_items` |
| Estado assistido, progresso de episódio, diário | existe | `user_watch_states`, `user_episode_progress`, `user_viewing_events` |
| Importação | existe | `user_import_jobs` |
| Recomendação | **não implementado** (sem rota) | — |
| Seguir, comentar | **não existe** no schema | — |

A tela escreve "não implementado" onde a coisa não existe, nunca zero. E-mail
aparece na tela, **não** vai para URL, log nem exportação.

---

## 6. Autenticação

- `apps/web` tem sessão de usuário (cookie `__Host-cinerie_session`, httpOnly,
  30 dias), mas não serve ao painel: ver a seção 0.
- `apps/admin` tem Basic Auth fail-closed: em `NODE_ENV=production` a proteção é
  exigida mesmo sem flag, e sem `ADMIN_BASIC_AUTH_USER`/`ADMIN_BASIC_AUTH_PASSWORD`
  toda rota responde 401. **É esta que o painel usa.**
- A credencial é compartilhada: a auditoria registra `ADMIN_OPERATOR_LABEL` (texto
  livre, não secreto) e diz que o painel não distingue pessoas.

---

## 7. O que cada tela promete

Toda medida mostra **valor · fonte · momento**. Consulta que falha mostra
**"não determinado"** com o motivo — nunca zero, nunca o último valor.

| Tela | Fica vermelho quando |
| --- | --- |
| Visão geral | qualquer item abaixo |
| Filas | fila parada (2× o intervalo); represada (pendente > 24 h); volta > 30 dias |
| Cotas | recusa do fornecedor com contador abaixo do teto; gasto ≥ teto |
| Serviços | sem sinal há mais de 3 min; commit diferente do `main`; digest sem commit correspondente |
| Cobertura | — (a série diária é o sinal; a tela não inventa limiar) |
| Título | job em dead-letter; título sem `imdb_id` (a OMDb não alcança) |

---

## 8. Ações — o que cada botão enfileira

Nenhuma ação executa CLI ou chama API no painel. Toda ação mostra o custo
**antes** de confirmar e grava `admin_action_audits` na **mesma transação** do
enfileiramento.

| Ação | Onde entra | Chave | Quem executa |
| --- | --- | --- | --- |
| Detalhe | `catalog_jobs` (`sync_details`, prioridade 10) | `…:pt-BR:admin:<nonce do formulário>` (24 hex, o mesmo `request_token` da auditoria) — o filho herda o escopo | `screen-catalog-worker` |
| Mídia | `catalog_jobs` (`sync_media`) | idem | `screen-catalog-worker` |
| Temporadas e episódios | `catalog_jobs` (`sync_seasons`) | idem | `screen-catalog-worker` |
| Nota externa | `scheduler_force_requests` | — | `screen-cron` (CLI com `--id`, consumidor `on_demand`) |
| Recalcular Score | `scheduler_force_requests` | — | `screen-cron` (CLI com `--entity-id`) |
| Forçar fila | `scheduler_force_requests` (um aberto por fila) | — | `screen-cron`, no próximo tique |

Nota e Score não passam por `catalog_jobs` porque não há tipo de job para eles, e
quem já guarda a credencial da OMDb e já roda essas CLIs é o `screen-cron`. Levar
isso ao worker de catálogo exigiria um valor novo de enum e a mesma credencial
em mais um serviço.

O painel **não** apaga nada, não muda licença nem `display_allowed`, não altera
cadência nem teto, não reinicia nem implanta serviço e não exporta e-mail.

---

## 9. Como ficou implementado

| Peça | Onde |
| --- | --- |
| Telas | `apps/admin/app/{page,filas,cotas,servicos,cobertura,titulos,usuarios,logs,acoes}`; o painel editorial foi para `/editorial` |
| Leituras (só `$queryRaw` parametrizado) | `apps/admin/src/server/ops/*` |
| Leituras que são conhecimento do agendador (universo, ritmo observado, trabalho por `run_id`) | `services/sync/src/scheduler/runtime/queue-panel.ts` |
| Cobertura (a mesma consulta para a tela e para o retrato diário) | `services/sync/src/scheduler/runtime/coverage.ts` |
| Julgamentos puros (volta, versão, cota, visibilidade, custo, quebrados) | `apps/admin/src/lib/ops/*`, `services/sync/src/scheduler/lap.ts` |
| O que cada botão enfileira | `services/sync/src/scheduler/admin-action-plan.ts` (puro) |
| A escrita (INSERT em três tabelas, auditoria na mesma transação) | `services/sync/src/scheduler/runtime/admin-actions.ts` |
| A Server Action | `apps/admin/src/server/ops-actions.ts` |
| Sinal de vida e impressão digital | `packages/db/src/service-heartbeat.ts`, `packages/db/src/source-fingerprint.ts`; ligado em cada serviço |
| Referência do `main` | fila `deploy_reference`, `services/sync/src/scheduler/runtime/deploy-reference.ts` |
| Pedidos ao `screen-cron` | `services/sync/src/scheduler/force-requests.ts` + `runtime/force-requests.ts`; atendidos no tique de `bin/cinerie-scheduler.ts` |

### Índice novo em `catalog_jobs`

`(run_id, created_at)`. O trabalho de cada fila e a cascata de cada decisão do
painel são contados por `run_id` numa janela; sem o índice cada leitura varreria a
fila inteira. A migration o constrói sem `CONCURRENTLY` (o Prisma roda a migration
em transação): escritas em `catalog_jobs` esperam enquanto ele é construído.

### O que só vale depois do redeploy

Sem a versão nova, os serviços não gravam sinal de vida e o `screen-cron` não roda
`deploy_reference`, `catalog_coverage` nem os pedidos do painel. A tela diz isso em
vermelho ("NUNCA deu sinal de vida", "NUNCA RODOU", "a fila deploy_reference ainda
não leu o main") em vez de mostrar verde. Ver [`admin-deploy.md`](./admin-deploy.md).

### Provas

| O quê | Onde |
| --- | --- |
| Cada número contra PostgreSQL real, com controle negativo | `apps/admin/scripts/validate-ops-panel-real-postgres.ts` (CI, depois do `build:admin`) |
| Vermelho alcançável (volta de 300 dias, commit 3 atrás, fila parada, cota recusada) | idem + `tests/admin/ops-describe.test.ts`, `tests/admin/ops-lib.test.ts` |
| Ficha = página (nota, trailer, imagem, Score) | `tests/governance/admin-visibility-mirror.test.ts` |
| Cobertura = portões da página | `tests/governance/admin-coverage-mirror.test.ts` + validador (SQL = TS linha a linha) |
| O botão enfileira com escopo novo, sem colidir, e o reenvio é uma ação só | validador + `services/sync/src/scheduler/__tests__/admin-action-plan.test.ts` |
| Só INSERT em três tabelas; nada de licença, cadência, apagamento | `tests/admin/ops-actions-guard.test.ts` |
| Fora do índice, 401 sem credencial | `tests/admin/ops-noindex.test.ts` + validador (por requisição) |
| Nenhum segredo no HTML nem no log | validador |
| A migration aplica num PostgreSQL real | validador (`migrate deploy` antes de qualquer prova) + `tests/admin/ops-actions-guard.test.ts`: nenhuma definição de índice converte tipo. A primeira versão usava `entity_type::text` e o PostgreSQL recusou (42P17: conversão de enum não é IMMUTABLE) |
| O painel não depende do fuso do banco | validador sobe o PostgreSQL em `America/Sao_Paulo` e confere que o fuso vale; uma linha de ontem às 23h UTC não entra no gasto de hoje; o sinal de vida de 10 min aparece como "há 10 min", não "há 3,2 h" |
| Capturas das telas | validador com `CINERIE_OPS_SCREENSHOTS_DIR` (Chrome headless pelo proxy de credencial). As desta leva estão em [`capturas/admin-operacional/`](./capturas/admin-operacional/) — dados sintéticos do banco efêmero, e-mails no domínio reservado `.test` |

### O que ficou de fora, e como fechar

| Item | Por quê | Como fechar |
| --- | --- | --- |
| Estado e versão do `cinerie-cms` | banco próprio; a ADR 0015 proíbe a ponte | medir pelo `/readyz` do CMS no próprio EasyPanel |
| "Último acesso" por coluna | a coluna de último uso do login nunca é gravada | gravar `last_used_at` no runtime de auth (leva própria, `services/user-platform`) |
| Origem do cadastro | não há coluna | decisão de produto + migration |
| Exportar e-mails | fora desta leva por decisão do dono | — |
| Recusa por cota do TMDB | `TmdbHttpError` mistura 429, 404 e 5xx | gravar `error_code` específico para 429 no cliente TMDB |
| Gasto do Gemini | o Entity Writer não grava `api_sync_logs` | gravar log por geração no Entity Writer |
