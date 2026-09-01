# FASE 4 — Integração dos quatro sistemas

> A pergunta do dono: **os quatro podem operar simultaneamente?**
>
> **Resposta curta: sim, e três deles já operam.** Não há colisão de banco, de
> porta, de domínio nem de cota entre os sistemas em produção. Os problemas de
> integração que existem são de outra natureza: um sistema essencial que não
> está implantado, um acoplamento de deploy de cinco serviços num único
> repositório, e uma decisão de produto (kal-el × Payload) que ainda não tem os
> elementos reunidos — que é o que este documento reúne.

---

## 1. O mapa real

```
┌─────────────────────────────────────────────────────────────────────┐
│  FORA DO SERVIDOR — máquina do dono (Windows, .bat, .venv)          │
│                                                                     │
│   MNScr  ──── SQLite local (25 tabelas)                             │
│     │                                                               │
└─────┼───────────────────────────────────────────────────────────────┘
      │ HTTP  (contrato editorial-publication-request-v1, hash de schema)
      │ HTTP  (/api/internal/entity-resolve, chave b299372f…)
      │ HTTP  (upload de mídia)
      ▼
┌─────┼───────────────────────────────────────────────────────────────┐
│  PAINEL EasyPanel — projeto rss_prime                               │
│     │                                                               │
│  ┌──▼────────────┐        ┌──────────────────┐                      │
│  │ cinerie-cms   │◄───────┤ cinerie-cms-db   │  postgres:16         │
│  │ (Payload)     │        │ (banco do CMS)   │  volume: —           │
│  │ cms.cinerie.  │        └──────────────────┘                      │
│  │ com:3002      │                                                  │
│  │ vol: cms-     │                                                  │
│  │ uploads       │                                                  │
│  └──┬────────────┘                                                  │
│     │ outbox (HTTP autenticado, claim/lease/ack)                    │
│  ┌──▼──────────────────────────┐                                    │
│  │ cinerie-publication-worker  │  ← ÚNICO que fala com os DOIS lados│
│  └──┬──────────────────────────┘                                    │
│     │ Prisma                                                        │
│  ┌──▼──────────────┐   ┌──────────────┐  ┌────────────────────────┐ │
│  │   screen-db     │◄──┤ screen-app   │  │ screen-catalog-worker  │ │
│  │  postgres:17    │   │ cinerie.com  │  │  (TMDB: 19.124 req/24h)│ │
│  │  10 GB, 90 tab. │   │ :3000        │  └────────────┬───────────┘ │
│  │  volume: —      │   └──────────────┘               │             │
│  └──────▲──────────┘   ┌──────────────┐               │             │
│         └──────────────┤ screen-cron  │◄──────────────┘             │
│                        │ VIVO (amarelo│                             │
│                        │  no painel)  │                             │
│                        └──────────────┘                             │
│                                                                     │
│  ┌──────────────────────────┐                                       │
│  │ feed (RSSPRIME)          │  SQLite em /app/data — volume: —      │
│  │ rss.thepeg.site:8080     │  Gemini com chave PRÓPRIA             │
│  └──────────┬───────────────┘                                       │
└─────────────┼───────────────────────────────────────────────────────┘
              │ superfeed RSS (público)
              └──────────────► MNScr (acima)   e   MN26 (Máquina Nerd)

┌─────────────────────────────────────────────────────────────────────┐
│  NUNCA IMPLANTADO                                                   │
│   kal-el  —  API Fastify + CMS Next + worker, PostgreSQL próprio    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Banco: nenhum compartilhamento

**Não há um único par de sistemas escrevendo na mesma tabela.**

| Sistema | Armazenamento | Onde vive | Volume persistente? |
| --- | --- | --- | --- |
| screena — app, workers, cron | PostgreSQL 17, banco `screena` (10 GB, 90 tabelas) | serviço `screen-db` | **não declarado** |
| screena — CMS Payload | PostgreSQL 16 | serviço `cinerie-cms-db` | **não declarado** (uploads têm volume à parte) |
| RSSPRIME | SQLite `/app/data/articles.db` | dentro do container `feed` | **não declarado** |
| MNScr | SQLite `data/app.db` (+ TMDB e indexer) | máquina do dono | n/a |
| kal-el | PostgreSQL próprio | não implantado | n/a |

**Escrita concorrente na mesma linha: não existe.** Cada banco tem um único
escritor, com uma exceção controlada:

**`screen-db` tem três escritores** — `screen-app` (dados de usuário e
consentimento), `screen-catalog-worker` (catálogo TMDB) e
`cinerie-publication-worker` (projeção editorial). Eles escrevem em **conjuntos
disjuntos de tabelas**: `user_*` / `movies|tv_shows|people|episodes|…` /
`articles|article_translations|entity_news_links`. Não achei sobreposição.

### A ponte, e por que ela é sólida

O `cinerie-publication-worker` é o único processo que toca os dois lados — e a
ponte é **assimétrica de propósito**: API HTTP do lado do Payload, Prisma do
lado do banco público. Isso não é só documentação: há um teste que **percorre o
fecho transitivo de imports** do worker para provar que ele não consegue
alcançar o banco do CMS
([`tests/governance/editorial-worker-boundary.test.ts`](../../tests/governance/editorial-worker-boundary.test.ts)):

> "Se o worker abrisse conexão com o banco do Payload, o isolamento do ADR 0015
> teria acabado — a outbox deixaria de ser uma fronteira e viraria uma tabela
> compartilhada. […] Não é um grep num arquivo só: bastaria um módulo
> intermediário para escapar de uma checagem assim."

O protocolo da outbox é **claim / lease / ack / fail** com `leaseToken` e
`leaseExpiresAt`, e `emissionSequence` para ordem. É o desenho certo.

### O risco de banco que EXISTE, e não é de concorrência

**Nenhum dos três serviços de dados declara volume no painel** (`mounts: -` em
`screen-db`, `cinerie-cms-db` e `feed`). Só o `cinerie-cms` tem volume, e é para
uploads. Para os bancos gerenciados pelo EasyPanel (`postgres:16`/`17`) a
plataforma normalmente provisiona o volume por fora do campo `mounts` — mas para
o **`feed`**, que é um app comum guardando SQLite em `/app/data/`, isso não vale.

**NÃO DETERMINADO** e é a verificação mais urgente deste documento: se o
`/app/data/articles.db` do RSSPRIME sobrevive a um redeploy. Fecha com o console
do serviço `feed`: `ls -la /app/data/` antes e depois de um deploy, ou
`docker inspect` do container.

---

## 3. Cota compartilhada: o que eu afirmei e o que a medição disse

Esta é uma das seções onde a auditoria se corrigiu. A versão inicial da FASE 0 afirmou
que "screena e MNScr compartilham a mesma chave Gemini e o mesmo token TMDB" —
verdade para os arquivos `.env` do **disco**, e **falsa** para produção.

Método: SHA-256, 16 primeiros hexdígitos, sem imprimir valor; os dois caminhos de
cálculo conferidos contra `sha256('abc') = ba7816bf8f01cfea`.

| Consumidor | Gemini | TMDB v4 | OMDb |
| --- | --- | --- | --- |
| `screen-app` (produção) | `3e5867225cfb55cc` | `344a0b0cf5d7c2ed` | `4765bc2696aae380` |
| `screen-cron` (produção) | `3e5867225cfb55cc` | `344a0b0cf5d7c2ed` | `4765bc2696aae380` |
| `screen-catalog-worker` (produção) | — | `344a0b0cf5d7c2ed` | — |
| `feed` / RSSPRIME (produção) | **`8f5f2c5f300c0ad6`** | — | — |
| `.env` do disco (screena e MNScr) | `3a7f26253643f0a9` | `ed701bd3651ed317` | — |

### Quem estoura primeiro

**1. TMDB — três processos, uma chave, e isso está OK.** `screen-app`,
`screen-cron` e `screen-catalog-worker` usam `344a0b…`. A cota do TMDB é de
**ritmo**, não diária: dividir causa disputa de vazão e `429`, não bloqueio. E o
consumo é assimétrico — medi **19.124 unidades de `quota_cost` do TMDB em 24 h**,
praticamente todas do catalog-worker. O `screen-app` não deveria emitir nenhuma
(invariante 3), e o auditor `audit:render` confirma que não emite. **Ninguém
estoura.**

**2. Gemini — não há disputa em produção.** O RSSPRIME tem chave própria e é o
único dos três que **contabiliza cota em tabela** (`status_429_count`,
`blocked_request_count`, cooldown de 1800 s). A produção do screena tem outra
chave, e o Entity Writer — que a usaria — nunca rodou (`entity_writer_jobs = 0`).

**3. A disputa real é MNScr × screena-rodado-à-mão, na máquina do dono.** Os dois
`.env` do disco carregam a **mesma** chave de Gemini e o **mesmo** token TMDB. O
MNScr usa a dele de verdade (ele roda de lá). Se o dono rodar `pnpm ratings` ou
`pnpm catalog` local enquanto o MNScr está no ciclo, os dois dividem um orçamento
**diário** de Gemini sem saber um do outro. **Quem chega depois não escreve.**

**4. OMDb tem cota diária de 1.000 e um só consumidor** — mas ele **estoura o
próprio envelope**: medi 923 e 850 unidades nos dois únicos dias em que a fila
rodou nos últimos sete, contra um envelope declarado de 700 e um limite útil de
850. Não é conflito entre sistemas; é conflito de um sistema com a própria
política.

### Correção de leitura sobre `content_blocks = 0`

A FASE 0 levantou a hipótese de que a disputa de cota poderia explicar a camada
editorial vazia. **A medição descarta:** a produção do screena tem chave de
Gemini exclusiva. Se o Entity Writer não produziu nada, não foi por cota
emprestada — foi porque **nunca foi executado** (`entity_writer_jobs = 0`,
`entity_writer_logs = 0`, e nenhuma fila do agendador o invoca).

---

## 4. Portas, domínios, volumes, CPU e memória

**Nenhum conflito.**

| Serviço | Porta | Domínio |
| --- | ---: | --- |
| `screen-app` | 3000 | `cinerie.com`, `www.cinerie.com`, `rss-prime-screen-app.nult1k…` |
| `cinerie-cms` | 3002 | `cms.cinerie.com` |
| `feed` | 8080 | `rss-prime-feed.nult1k…`, `rss.thepeg.site` |
| `screen-cron`, `screen-catalog-worker`, `cinerie-publication-worker` | — | sem domínio (correto) |
| `screen-db`, `cinerie-cms-db` | — | sem porta publicada (correto) |

**Nenhum banco está exposto na internet** — verifiquei: `ports: -` nos dois
Postgres. Bom.

**CPU e memória: nenhum serviço declara limite** (`resources: {}` nos oito).
Isso significa que um processo em disparada pode consumir a máquina inteira e
derrubar os outros sete. Medi `screen-db` a **115% de CPU** e 2,7 GB durante a
sessão. Não é conflito de configuração; é ausência de contenção.

---

## 5. Agendamentos que se sobrepõem

| Processo | Cadência | Recurso disputado |
| --- | --- | --- |
| `screen-cron` (13 filas) | de 6 h a 30 dias, conforme a fila | `screen-db` + TMDB + OMDb |
| `screen-catalog-worker` | contínuo (poll) | `screen-db` + TMDB |
| `cinerie-publication-worker` | contínuo (poll na outbox) | `screen-db` + API do CMS |
| `feed` (RSSPRIME) | ~15 min | SQLite próprio + Gemini próprio |
| MNScr | `CHECK_INTERVAL_MINUTES` | SQLite próprio + Gemini + API do Cinerie |

**Há dois produtores do mesmo job**, e o repositório sabe disso. O comentário de
[`services/sync/src/scheduler/config.ts`](../../services/sync/src/scheduler/config.ts)
registra que `runDiscovery` mandava `limit: null` (o export inteiro: 1,23 M
filmes + 228 k séries + 4,86 M pessoas) e que, com `enqueueDetails: true`, um
único ciclo enfileiraria **~6,3 milhões** de `sync_details`. A correção foi dar
ao agendador o mesmo teto do worker (`discoveryLimit` default 2000), e o runbook
manda **desligar o enfileirador de um quando o outro sobe**.

Ou seja: a sobreposição existe, é conhecida, e depende de **disciplina
operacional** — não de intertravamento no código. `screen-cron` está amarelo, e
o `screen-catalog-worker` está verde e ativo (19.124 requisições TMDB em 24 h),
o que é consistente com "o agendador está fora e o worker ficou".

---

## 6. Autenticação e sessão: colidem?

**Não.** São três domínios de identidade sem interseção:

| Sistema | Identidade | Onde |
| --- | --- | --- |
| `screen-app` | usuários públicos (`users` = **2**), Argon2 + sessão em tabela | `screen-db` |
| `cinerie-cms` | `editorial-users` + `service-accounts` (Payload) | `cinerie-cms-db` |
| MNScr → Cinerie | chave estática `CINERIE_CATALOG_RESOLVE_API_KEYS` + `MNSCR_PAYLOAD_API_KEY` | env |
| `feed` | `ADMIN_KEY` para rotas administrativas | env |
| kal-el | própria (RBAC completo) | não implantado |

O único segredo **deliberadamente compartilhado** é
`CINERIE_CATALOG_RESOLVE_API_KEYS` (`b299372f640b8f08`), idêntico no `screen-app`,
no `screen-cron` e nos dois `.env` — correto, é o segredo que autentica chamador
e chamado.

Um ponto de atenção declarado pelo próprio código: o rate limit de
`/api/internal/entity-resolve` é **por processo** (`Map` de módulo), então com N
réplicas o teto efetivo é N×. Hoje `replicas: 1`, então não morde.

---

## 7. Acoplamento de deploy: subir um quebra outro?

**Sim, em potencial — e é o acoplamento mais forte do ecossistema.**

**Cinco dos oito serviços saem do MESMO repositório e do MESMO branch**
(`maquinanerd/screena@main`):

| Serviço | Dockerfile |
| --- | --- |
| `screen-app` | `Dockerfile` |
| `screen-cron` | `Dockerfile` |
| `screen-catalog-worker` | `Dockerfile.catalog-worker` |
| `cinerie-cms` | `Dockerfile.cms` |
| `cinerie-publication-worker` | `Dockerfile.publication-worker` |

Um commit em `main` muda o código-fonte de cinco serviços ao mesmo tempo.

**O que impede o estrago é que `autoDeploy = false` nos cinco.** Nada sobe
sozinho. Isso transforma um risco de "quebra tudo automaticamente" num risco de
**deriva**: cada serviço roda o commit do dia em que foi implantado à mão, e
nada no painel diz qual é.

E há um agravante medido nesta auditoria: **a variável `CINERIE_BUILD_SHA`
existe nos serviços e não é confiável como identidade de build** — o histórico
deste ecossistema já registrou que ela ficou 38 commits atrasada. Ou seja, o
painel não responde "qual commit está rodando aqui?".

**Risco concreto de ordem:** o `cinerie-publication-worker` e o `cinerie-cms`
conversam por um contrato com **hash de schema**. Implantar um sem o outro, se o
contrato mudou, para a projeção editorial — e o modo `--loop` foi escrito
justamente para que "falha de ciclo não seja morte de processo", então a parada
seria **silenciosa**, visível só em `/readyz` e nos recibos.

**Ordem segura de implantação, derivada do que li:** `cinerie-cms` →
`cinerie-publication-worker` → `screen-app`; workers (`catalog`, `cron`) são
independentes.

---

## 8. Podem operar simultaneamente? — o veredito

**Sim.** Os quatro não competem por banco, tabela, porta, domínio nem (em
produção) por cota. O que a auditoria encontrou não foi conflito, foi **ausência**:

| Bloqueio real | Natureza |
| --- | --- |
| MNScr sem serviço implantado | operacional — o motor editorial depende de um `.bat` na máquina do dono |
| `ratings_omdb` e `airing_series` quebradas | operacional — o agendador está **vivo** (medi fila a fila); só essas duas falham. A OMDb é invocada todo dia e emite requisição em 2 de 10 |
| Entity Writer nunca executado | de escopo — `content_blocks = 0` |
| Sem limite de CPU/memória em nenhum serviço | contenção |
| RSSPRIME possivelmente sem volume | durabilidade |
| Cinco serviços num repositório, sem identidade de build confiável | deriva de deploy |

---

## 9. kal-el × Payload — a decisão de produto

### 9.1. O que o Payload (`cinerie-cms`) faz hoje, item por item

Medido: 17 coleções, 8 endpoints próprios, **36 migrations**.

| Item | Como está no Payload hoje |
| --- | --- |
| Coleções de conteúdo | `articles`, `authors`, `media` |
| Blocos do corpo | `paragraph`, `heading`, `image`, `gallery`, `video`, `embed`, `list`, `quote`, `divider` (9 tipos) |
| Identidade | `editorial-users` (humanos) e `service-accounts` (máquina) |
| Atores técnicos | dois, por **escopo**: `draft_ingest` → só `automation_draft`; `editorial_auto_publish` → até `published` (ADR 0017) |
| Autopublicação | ligada em produção (`EDITORIAL_AUTO_PUBLISH_ENABLED=true`), com **cinco dimensões de teto** (`DAILY`, `PER_AUTHOR`, `PER_SECTION`, `PER_CONTENT_TYPE`) e fuso da redação |
| Contadores de quota | `autopublish-quota-counters`, `autopublish-quota-usage` (coleções próprias, reserva transacional) |
| Entrega ao público | `publication-outbox` + endpoints `/internal/publication-outbox/claim`, `ack`, `fail`, com **lease** |
| Mídia | upload local em volume `cms-uploads` + endpoints `editorial-media`, `editorial-media-hero`, `publication-media` |
| Contrato | endpoint `/contracts` com **hash de schema** conferido pelo emissor |
| Publicação manual | endpoint `publish-now` |
| Vínculo de entidade | `entityReferences` com verificação por confiança (ADR 0018/0019), resolvida via `/api/internal/entity-resolve` do screen-app |
| Segredos | `payload_database_url` e `payload_secret` em `/run/secrets/` (não em env) |

### 9.2. O que o kal-el JÁ tem

Ver a tabela completa em [`04-kal-el.md`](04-kal-el.md). Em resumo, ele **já
cobre**: coleções e taxonomia (com `entities` e `sources`, que o Payload não
tem como coleção), validação por Zod, editor de texto, upload com interface de
provider, autenticação Argon2id, **RBAC completo em tabela**, **multi-site de
origem**, revisões de artigo, máquina de estados
(`submit`/`approve`/`reject`/`schedule`/`publish`/`unpublish`/`archive`),
**outbox**, **webhooks assinados com HMAC**, **idempotência**, **trilha de
auditoria**, **tokens de serviço**, preview por token, importador, e 6
migrations com teste de migration.

E tem uma vantagem estrutural sobre o Payload nesta arquitetura: **nenhuma chave
de fornecedor externo**. Ele não entra em nenhuma disputa de cota.

### 9.3. O que FALTA para substituir — a lista honesta

| Falta | Gravidade | Por quê |
| --- | --- | --- |
| **Nunca foi implantado** | **bloqueante** | Nenhum serviço no painel. Zero exercício com dado real, zero medição de desempenho, zero incidente aprendido |
| **Tetos de autopublicação** | **bloqueante** | O Payload tem 4 dimensões de teto + fuso IANA da redação + reserva transacional e 5 desfechos. Não há equivalente no kal-el — **e antes disso falta onde colocá-los**: `published` é alcançável de 3 estados, sem aresta única de gate (K-09) |
| **Os dois atores técnicos por escopo** | **alto** | O kal-el tem RBAC e `service_tokens` — a **base** existe —, mas a distinção `draft_ingest` × `editorial_auto_publish` do ADR 0017 precisa ser modelada como papel |
| **Contrato com hash de schema** | **alto** | O MNScr faz preflight contra `/contracts` e recusa divergência. Sem isso, a integração perde a trava que hoje impede envio incompatível |
| **Vínculo de entidade com confiança** | **alto** | ADR 0018/0019: `confidence ≥ 0.9` nasce verificado, via `/api/internal/entity-resolve`. O kal-el tem tabela `entities` e `article_entities`, mas a política de verificação é do Payload hoje |
| **Leitura pública** | **médio** | K-02: nenhuma rota anônima. Não bloqueia (a projeção usa credencial), mas muda o desenho se algum dia um portal quiser ler direto |
| **Estado `retracted` e recuperação de `archived`** | **médio** | K-10 e K-11: o Cinerie tem caminho de despublicação de emergência que distingue retratação de arquivamento; o kal-el colapsa os dois em `draft` e torna `archived` terminal |
| **`apps/cms/public/` fora da imagem** | **médio** | K-01 — trivial de corrigir, mas hoje o painel sobe sem logo |
| **Cobertura de teste do núcleo** | **médio** | 38 unitários; permissão/publicação/outbox só com Postgres embarcado |

### 9.4. O que quebra na troca

1. **O MNScr para de entregar** até que `app/cinerie/client.py` aponte para a API
   do kal-el e o contrato seja reimplementado do outro lado. O MNScr já tem o
   caminho abstraído (`PAYLOAD_INTERNAL_SERVICE_URL`, `MNSCR_PAYLOAD_API_KEY`) —
   e, revelador, **já existe um worktree chamado `mnscr-kalel-publication`** no
   disco do MNScr: alguém já começou.
2. **O `cinerie-publication-worker` precisa de outro adaptador.** Ele fala
   `claim/ack/fail` com lease; o kal-el tem `outbox_events` mas o protocolo HTTP
   é outro. O teste de fronteira (`editorial-worker-boundary.test.ts`) continua
   valendo e deve ser reapontado.
3. **As 164 matérias publicadas precisam migrar.** `articles = 164`,
   `article_translations = 164` (131 `published`, 33 `archived`), mais 134
   `editorial_media_assets`. É um volume pequeno — a migração é viável de uma vez.
4. **Os 297 recibos de projeção** (`editorial_projection_receipts`) são
   histórico; podem ficar como estão.
5. **Os tetos de autopublicação somem** até serem reimplementados — e enquanto
   isso a autopublicação teria de ficar **desligada**, o que devolve o fluxo
   editorial ao humano.

### 9.5. Caminho de migração e custo

**Ordem sugerida (cada etapa é reversível até a 5):**

| # | Etapa | Esforço | O que destrava |
| --- | --- | --- | --- |
| 1 | Corrigir K-01 (`COPY public/`) e implantar kal-el em **staging** no painel | baixo | Sai do território "nunca subiu" |
| 2 | Modelar os dois atores técnicos (`draft_ingest` × `editorial_auto_publish`) como papéis no RBAC existente | baixo–médio | Paridade com o ADR 0017 |
| 3 | Implementar `/contracts` com hash de schema, espelhando o do Payload | médio | O MNScr passa a poder fazer preflight |
| 4 | Implementar os cinco tetos de autopublicação com reserva transacional | **médio–alto** | É a peça que hoje protege a redação |
| 5 | Adaptador de outbox no `cinerie-publication-worker` (ou webhook, que o kal-el já assina) | médio | Projeção para o banco público |
| 6 | Migrar 164 artigos + 134 mídias; rodar os dois CMS em paralelo lendo do mesmo MNScr | médio | Comparação real, sem apostar tudo |
| 7 | Cortar o Payload | baixo | — |

**A recomendação, e ela é minha, com o dono decidindo:** as etapas 1–3 valem
por si mesmas mesmo que a troca nunca aconteça — elas transformam o kal-el de
"repositório" em "sistema exercitado". A etapa 4 é onde mora o custo real, e é
onde eu recomendaria medir de novo antes de comprometer: os tetos de
autopublicação do Payload são o mecanismo que separa "IA que ajuda a redação" de
"IA que publica sozinha em escala", e reimplementá-los mal é pior que não trocar.

E há um argumento contrário que precisa ser dito com a mesma clareza: **o
Payload de hoje funciona.** Ele publicou 131 matérias, tem outbox com lease,
tetos, dois atores e 36 migrations de história. O kal-el é mais bem desenhado em
várias dimensões (RBAC, multi-site, idempotência, webhook assinado) e tem **zero
horas de produção**. A troca compra elegância e independência de framework;
custa a maturidade operacional que o Payload já pagou.

---

## 10. O que NÃO determinei nesta fase

| Item | Comando/consulta |
| --- | --- |
| Se o SQLite do RSSPRIME sobrevive a redeploy | Console do `feed`: `ls -la /app/data/` e conferir volume do container |
| Qual commit cada um dos 5 serviços está rodando | `CINERIE_BUILD_SHA` é inconfiável; medir por hash do fonte dentro do container |
| Se `screen-cron` e `screen-catalog-worker` estão com o enfileiramento duplicado ligado | `CATALOG_WORKER_ENQUEUE_DISCOVERY` e `CATALOG_WORKER_ENQUEUE_CHANGES` no painel × `discoveryLimit` do cron |
| Uso de CPU/memória ao longo do tempo por serviço | Aba "Monitorar" do painel |
| Se o kal-el passa nos testes de integração | `corepack pnpm run test:integration` (rodando quando escrevi) |
| Volume real que o MNScr processa por dia | `SELECT count(*) FROM posts` no SQLite da máquina do dono |
