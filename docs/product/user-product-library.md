# Biblioteca pessoal — watchlist, tracker, listas, notas e importação (C8)

> Idioma: pt-BR. Código e identificadores em inglês. Este documento descreve a
> **arquitetura executável** da camada de produto pessoal do usuário logado
> (Prompt 08 / Backend C C8): watch state, tracker de séries, listas, notas
> pessoais, histórico e importação de dados. As **decisões canônicas** (o
> "porquê") vivem em [`user-product-decisions.md`](user-product-decisions.md) —
> em especial a entrada datada **2026-07-27 (C8)**. Aqui está o "como".
>
> Nada nesta camada é indexável: toda superfície de biblioteca é privada,
> `noindex` e `force-dynamic` por construção (invariante 5 — `noindex` técnico).
> A camada de render pública (`apps/web/src/server/**`) continua pura: só lê
> PostgreSQL, nunca chama a biblioteca no caminho de request indexável.

---

## 1. Camadas

```
apps/web/app/pt/{minha-lista,tracker,historico,listas,importar}  ← telas (client, noindex)
apps/web/app/api/me/**                                           ← 19 rotas HTTP (sessão + CSRF)
apps/web/src/server/auth/runtime.ts (runLibraryEndpoint)         ← ponte web → runtime
services/user-platform/src/auth-runtime/*-services.ts            ← orquestração (transação)
services/user-platform/src/{lists,tracking,ratings,stats,imports}← DOMÍNIO PURO (sem IO)
services/user-platform/src/persistence/prisma/*                  ← adapters Prisma (least-privilege)
PostgreSQL 16  (entities registry por TRIGGER; nunca inserido à mão)
```

Regras estruturais mantidas de C7:

- **Domínio puro** (`lists/`, `tracking/`, `ratings/`, `stats/`, `imports/`):
  sem DB, sem rede, sem relógio. `now` é **injetado** por `deps.now()`.
- **Executores least-privilege** (`Pick<PrismaClient, ...>`): cada adapter só
  enxerga os modelos que precisa (`PrismaLibraryExecutor`,
  `PrismaCatalogExecutor`, `PrismaExportExecutor`).
- **Conflitos esperados não envenenam a transação** (regra C7B1.1): sondas antes
  de escrita dependente de FK, `createMany`+`skipDuplicates` (ON CONFLICT DO
  NOTHING), `updateMany` com pré-condição (CAS sobre `version`/`status`); zero
  `catch` de erro esperado nos adapters.
- **Runners de transação separados**: `runInLibraryTransaction` para as stores
  da biblioteca; `runInTransaction` para as stores de auth.

---

## 2. Watch state — a fonte canônica

`user_watch_states` guarda **um** estado por `(userId, entityType, entityId)`,
para `entity_type IN ('movie','tv')`. Enum `WatchState`:

`planned` · `watching` · `watched` · `paused` · `dropped` · `rewatching` · `not_interested`

- **`planned` É a watchlist.** "Quero assistir" grava `status = planned`. Não há
  uma segunda tabela de watchlist; a watchlist é a projeção `status = planned`.
- **`watched`** carimba `completed_at` e sobe `version`.
- **`watching`** (só séries) representa acompanhamento em andamento.
- `not_interested` alimenta exclusão em recomendações; nunca é exibido como
  atividade.
- **Optimistic locking** por `version` + `Expected-Version` na borda: escrita com
  versão defasada falha com conflito explícito, nunca sobrescreve em silêncio.
- **Undo** (`clearWatchState`) restaura o estado mas preserva o evento no
  histórico: o diário é append-only; o estado atual é projeção mutável.

### Watchlist × favorites × listas de sistema — decisão canônica

Há **duas famílias** que não se confundem (ver decisão 2026-07-27 em
`user-product-decisions.md`):

1. **`UserWatchState` é a fonte canônica** de "quero assistir / assistindo /
   assistido". A watchlist do produto **é** `status = planned`. É essa família
   que o botão de entidade (filme/série) e a tela "Minha lista" leem e escrevem.
2. **`SystemListKey`** (`watchlist`, `favorites`, `watching`, `watched`) são
   **listas de sistema** — coleções nomeadas, separadas, para agrupamento e
   futura superfície social. **`favorites` existe só como lista de sistema**; não
   há estado "favorito" no enum `WatchState`. Marcar favorito é adicionar à lista
   `favorites`, não mudar o watch state.

Consequência: mudar o watch state para `watched` **não** move nada para a lista
de sistema `watched` automaticamente, e vice-versa. São eixos independentes por
desenho — o watch state é o fato de progresso; as listas de sistema são curadoria.

---

## 3. Tracker de séries e progresso de episódio

`user_episode_progress` guarda progresso por episódio (`entity_type = 'episode'`),
com `version` para CAS. `tracker-services.ts`:

- `setEpisodeWatched` — marca/desmarca um episódio; deriva progresso da série
  **não destrutivamente** (só promove `planned → watching` e `watching →
  watched` quando todos os episódios conhecidos estão vistos; nunca rebaixa
  estado nem apaga datas do usuário).
- `markSeriesEpisodes` — marca em massa uma faixa de episódios da série.
- `readSeriesProgress` — devolve o progresso agregado (total, vistos, próximo).

**Escala de 21 mil episódios** (a maior série real tem dezenas de milhares de
episódios entre temporadas e especiais):

- Enumeração **paginada** no servidor: `SERIES_PAGE_SIZE = 2000` por página, até
  `SERIES_BULK_MAX_EPISODES = 50_000` (teto de segurança).
- Escrita em massa **set-based e chunked** (`createMany` + `updateMany`), nunca
  um `INSERT` por episódio.
- `readSeriesProgress` usa `count`/`aggregate`, **nunca** `findMany().length`.
- Especiais (temporada 0) ficam **de fora por padrão** (`DEFAULT_INCLUDE_SPECIALS
  = false`); o chamador precisa optar explicitamente.

O validador PostgreSQL 16 real semeia **5 000 episódios** e prova a estratégia
(marca a série inteira gerando um número **constante** de eventos de diário, não
um por episódio).

---

## 4. Histórico / diário

- **Estado ≠ evento**: `user_watch_states`/`user_episode_progress` guardam a
  projeção atual; `viewing_events` guarda o histórico **append-only**, com
  `idempotency_key` por usuário para reprocessamento seguro.
- Marcar, desmarcar e importar geram eventos; desfazer preserva o evento e muda
  só a projeção.

---

## 5. Listas customizadas

`user_lists` + `user_list_items`. Limites (`LIST_LIMITS`):

| Limite | Valor |
| --- | --- |
| Listas customizadas por usuário | 100 |
| Itens por lista | 1000 |
| Título | 120 caracteres |
| Descrição | 2000 caracteres |
| Nota do item | 1000 caracteres |

- **Privadas por padrão** (`visibility = private`; também `unlisted`/`public`).
- Operações: criar, renomear, mudar visibilidade, adicionar/remover item,
  **reordenar** (posições contíguas `0..n-1` recalculadas no banco), apagar.
- **Ownership é sempre do servidor**: o `userId` vem da sessão autenticada,
  **nunca** do corpo da requisição. Um usuário não lê, não muta nem apaga a lista
  de outro (provado nos checks 27–29 e 49–51 do validador real).

---

## 6. Nota pessoal (rating)

Já registrado em `user-product-decisions.md` §1; resumo operacional:

- **0,5 a 5,0 estrelas, passo 0,5** (`scale = 5`), com CHECK no banco
  (`value*2 = floor(value*2)`): o passo é lei do banco, não só da UI. Nota fora
  da grade é recusada **antes** do CHECK (validação pura) e, em última linha,
  pelo próprio CHECK.
- **`user_ratings` é tabela própria, sem relação com `external_ratings`.** A nota
  do usuário **nunca** vira nota de fonte externa e vice-versa (invariantes 1 e
  2). Nenhuma média de usuários é publicada como `AggregateRating`.
- Rating aceita `movie/tv/season/episode`, **nunca** `person` (CHECK).

---

## 7. Importação de dados

Fluxo obrigatório, **sem exceção**:

```
upload → parse (CSV) → normalize → match → conflicts → PREVIEW (zero escrita) → APPLY
```

O `preview` é uma **promessa**: nenhuma linha da biblioteca é tocada até o
usuário aprovar. O job nasce `uploaded` e termina o preview em `preview_ready`.

### 7.1 Formatos suportados (o que o código REALMENTE aceita)

| `source` | Formato | Match |
| --- | --- | --- |
| `cinerie_csv` | CSV canônico da Cinerie (`entity_type,tmdb_id,imdb_id,title,year,state,watched_at,list,rating`) | Exato por `tmdb_id`/`imdb_id` |
| `letterboxd_csv` | CSV oficial que o usuário baixa (`Date,Name,Year,Letterboxd URI,Rating`) | Só por título+ano (sem id) |

> **Trakt JSON**, esboçado na decisão v1 de Backend C, **não** está implementado
> em C8 e não é oferecido na UI — não prometemos um formato que o código não
> parseia. Fica registrado como trabalho futuro separado. IMDb e outros formatos
> idem.

### 7.2 Segurança do upload (fail-closed por bytes)

`validateAndDecodeUpload` reprova o **arquivo inteiro** antes de qualquer parse:

- **Tamanho**: máximo `IMPORT_MAX_FILE_BYTES = 5 MB`.
- **Assinatura binária**: recusa por *magic bytes* — **ZIP** (`PK\x03\x04`,
  `PK\x05\x06`), **GZIP** (`\x1f\x8b`), **RAR**, **7Z**, **PDF**. Não abrimos
  arquivo comprimido: isso elimina de uma vez zip-bomb, path traversal e
  entradas ilimitadas, em vez de tentar defender cada uma. O export do Letterboxd
  vem em ZIP → o usuário precisa extrair o CSV antes de enviar (a UI diz isso).
- **UTF-8 estrito** (decode `fatal`) e rejeição de **byte NUL**: bytes que não
  são texto viram erro claro, nunca "parseados" como se fossem.
- **CSV** RFC 4180 com teto `CSV_MAX_ROWS = 20_000` linhas.
- Nome de arquivo saneado (`IMPORT_FILENAME_MAX_LENGTH = 200`; aspas/`<>|` e
  caracteres de controle removidos) — o nome nunca é usado em caminho de disco.
- Fórmulas de planilha (`=`, `+`, `-`, `@` no início de célula) são
  neutralizadas na normalização (anti-CSV-injection).

### 7.3 Matching — só o inequívoco é aplicado (fail-closed)

`classifyMatch` (`AUTO_APPLICABLE_CONFIDENCES = {exact}`):

| Confiança | Quando | Auto-aplica? |
| --- | --- | --- |
| `exact` | 1 acerto por id externo único (`tmdb_id`/`imdb_id`) | **Sim** |
| `high_confidence` | título+ano com resultado único | Não (precisa de 1 clique) |
| `ambiguous` | título sem ano; ou >1 candidato; ou id externo duplicado no catálogo | Não |
| `not_found` | nenhum candidato | Não |

- **Nunca cria entidade de catálogo** para uma linha que não casou. Uma linha
  sem correspondência fica registrada no preview como não-aplicável — jamais vira
  filme/série fantasma (provado no check 46 do validador: a linha ambígua "Alien
  sem ano" **não** duplica a entidade).
- Um `tmdb_id`/`imdb_id` duplicado no catálogo (violaria o unique) é tratado como
  `ambiguous`, não como acerto silencioso.

### 7.4 Aplicação — idempotente, retomável, isolada

- **Idempotência**: a aplicação reusa os uniques de destino (watch state por
  `(user, entidade)`; evento por `idempotency_key`). Reaplicar não duplica.
- **Nunca rebaixa — re-derivado atomicamente no apply.** A política anti-rebaixamento
  do preview (`plan.ts`) é calculada contra um **snapshot** do estado no momento do
  preview. Entre preview e apply esse snapshot envelhece (tempo do usuário, retomada,
  ou o próprio arquivo listando a mesma entidade em duas linhas). Por isso a decisão é
  **re-derivada no banco, de forma atômica**, no `applyAction`:
  - **"Quero assistir" (`planned`)** usa escrita **insert-only** (`INSERT … ON
    CONFLICT DO NOTHING`): cria `planned` se não houver estado; se já houver
    **qualquer** estado (`watched`/`watching`/…), é no-op. `planned` é o sinal mais
    fraco — importar nunca rebaixa um estado existente.
  - **"Assistido" (`watched`)** é uma **promoção**: `planned`/`watching` → `watched`,
    e no-op quando já assistido. Nunca rebaixa.
  - **Nota do arquivo** entra por **insert-only** (`insertIfAbsent`): só grava se o
    usuário ainda não tem nota; jamais sobrescreve a nota local (fecha o TOCTOU).
  Provado no runtime (`import-services.test.ts` 5–7) e no PostgreSQL 16 real
  (checks 52–53).
- **Lotes curtos e retomáveis**: `IMPORT_APPLY_BATCH = 200` ações por transação;
  o `applied_count` avança como **cursor**. Se o processo cair no meio, uma nova
  chamada `applyImport` retoma do cursor (`applying → applying`), aplicando só o
  que falta — e, sendo idempotente, ainda que reaplique uma ação já feita, o
  total permanece correto (provado nos checks 47–48).
- **CAS de status**: dois `apply` concorrentes do mesmo job → o `transition`
  (`preview_ready → applying`) elege **um** vencedor; o segundo recebe `conflict`.
  Reaplicar um job já `applied` é **recusado** (`precondition_failed`).
- **Cancelamento**: `cancelImport` encerra um job antes de aplicar, sem efeitos
  colaterais.
- **Ownership**: `apply`/`cancel`/`read` exigem que o job seja do titular logado
  (checks 49–51).

---

## 8. LGPD — exportação e encerramento

- **Exportação** (`requestDataExport`) inclui as superfícies novas de C8: watch
  states, progresso de episódios, listas + itens, notas, histórico e metadados de
  jobs de importação. O conteúdo passa por **`toJsonSafe`** (recursivo):
  `BigInt → string`, `Decimal → string`, `Date → ISO`. Sem isso, qualquer usuário
  com biblioteca quebraria o export com *"Do not know how to serialize a BigInt"*
  (bug real capturado pelo validador PG16, hoje coberto por teste — **não
  reverter**).
- A exportação **nunca** inclui segredo: `passwordHash`, `csrfTokenHash`,
  `tokenHash`, hash de IP, sessões — nada disso vai no payload (check 34).
- **Encerramento de conta** executa a retenção declarada em
  `DATA_CLASSIFICATION`: `product_content = delete` → `purgeForUser` **apaga** a
  biblioteca (watch states, progresso, listas, itens, notas, eventos); os
  registros de **consentimento** e **pedidos LGPD** têm `retain_indefinitely` e
  **permanecem**. A linha de `users` vira uma **tumba** sem PII (email
  anonimizado, `status = deleted`). A purga é **por titular**: não toca outro
  usuário (checks 35–41).
- Conta encerrada **não muta mais** a biblioteca: chamadas de escrita com status
  `deleted` são recusadas.

---

## 9. Ação explícita nunca depende de consentimento de tracking opcional

Marcar "quero assistir", "assistido", acompanhar série, criar lista ou importar
são **ações explícitas do usuário**. Os serviços de biblioteca **nunca** chamam
`hasActiveConsent`: o consentimento de tracking opcional governa telemetria
implícita, não o que o usuário pediu com um clique. Misturar os dois faria uma
recusa de telemetria bloquear o produto — proibido.

---

## 10. Rotas HTTP (`/api/me/**`)

Todas exigem **sessão** (cookie HttpOnly) e, nas mutações, **CSRF** (double-submit
reusado de C7D via `requireCsrf` + `authFetch`). 19 rotas:

```
watch-state (POST)                 watch-state/remove (POST)
episodes (POST)                    episodes/bulk (POST)
series-progress/[id] (GET)         history (GET)
library (GET)
lists (GET/POST)                   lists/[id] (GET/PATCH)
lists/[id]/items (POST)            lists/[id]/items/[itemId]/remove (POST)
lists/[id]/reorder (POST)          lists/[id]/delete (POST)
ratings (POST)                     ratings/remove (POST)
imports (GET/POST)                 imports/[id] (GET)
imports/[id]/apply (POST)          imports/[id]/cancel (POST)
```

> Remoção/apagar são **POST dedicados** (`/remove`, `/delete`), não `DELETE`: a
> ponte `readJsonBody` só aceita corpo em POST — um handler `DELETE` responderia
> 405. Um guard de governança tranca isso.

---

## 11. Runbook — importação travada ou falha

Sintoma: um job de importação fica preso ou falha no meio.

1. **Diagnóstico** — o dono consulta `GET /api/me/imports/[id]`: `status` e
   `appliedCount` mostram onde parou.
   - `status = applying` com `appliedCount < itemCount`: caiu no meio de um lote.
   - `status = failed`: `error` traz o motivo.
2. **Retomar** — o dono chama `POST /api/me/imports/[id]/apply` de novo. Como o
   `applied_count` é cursor e as ações são idempotentes, a retomada aplica só o
   que falta e **não duplica** o que já entrou. Seguro repetir.
3. **Cancelar** — se o usuário desistir, `POST /api/me/imports/[id]/cancel`
   encerra o job. Nenhum dado já aplicado é revertido automaticamente (a reversão
   é uma ação explícita do usuário sobre cada item), mas nenhuma ação nova é
   feita.
4. **Reprocessar do zero** — reenviar o arquivo cria um **novo** job com novo
   preview. Reimportar o mesmo conteúdo é idempotente por desenho (uniques de
   destino): não gera watch states nem eventos duplicados.
5. **Nunca** editar `user_import_jobs` na produção à mão para "consertar" um job.
   O caminho correto é retomar/cancelar/reprocessar pela API, que respeita o CAS
   de status. Mexer no status por SQL bruto pode furar a eleição de vencedor
   entre dois `apply`.

### Rollback de um item importado

Não há "desfazer importação" em massa por desenho (evita apagar dado que o
usuário depois editou). Para reverter um título específico: o usuário usa
`clearWatchState` / remoção de item de lista / remoção de nota pela UI. Cada
reversão preserva o evento no histórico.

---

## 12. Provas (onde está garantido)

- **Domínio puro**: `services/user-platform/src/{lists,tracking,ratings,stats,imports}/__tests__`.
- **Runtime**: `services/user-platform/src/auth-runtime/__tests__/*` — inclui
  `import-services.test.ts` (preview sem escrita, ZIP recusado, ambígua não
  aplicada, apply+reimport idempotente, apply concorrente com CAS, retomada,
  cancelamento, ownership, tamanhos 10/1000/10000).
- **PostgreSQL 16 real**:
  `services/user-platform/scripts/validate-library-tracker-import-real-postgres.ts`
  (`pnpm --filter @screena/user-platform validate:library`), 52 checks:
  watchlist/assistido/CAS, tracker de 5 000 episódios, listas+reordenação+
  ownership, nota pessoal, exportação LGPD serializável e sem segredo,
  encerramento com purga por titular, e o bloco de importação (preview sem
  escrita, exact aplicado, ambígua fail-closed, idempotência, retomada,
  cancelamento, ownership).
- **Governança**: `tests/governance/user-platform-privacy.test.ts` (allowlist das
  rotas `/api/me`, delegação transport-agnostic), boundary tests de camadas.
