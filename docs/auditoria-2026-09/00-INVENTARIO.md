# FASE 0 — Inventário dos quatro repositórios

> O denominador de tudo o que vem depois. Nada aqui é estimativa: cada número foi
> lido de `git`, do painel EasyPanel ou do PostgreSQL de produção. Onde não medi,
> está escrito **NÃO DETERMINADO** com o comando que fecharia.

Data da medição: **2026-09-01**, entre 00:00 e 00:35 (horário local, UTC−3).

---

## 0. Método e ferramentas

| Fonte | Como acessei | Observação |
| --- | --- | --- |
| Código | `git ls-files`, `git log`, leitura direta | Os quatro repositórios no disco local |
| Painel | EasyPanel `https://161.97.181.82`, API tRPC `projects.inspectProject` autenticada pela sessão do navegador | Preferi a **API** ao console porque o console é canvas |
| Banco | DbGate embutido no EasyPanel, conexão `screena@screena` | **Somente SELECT.** Nenhum DDL, DML ou comando de manutenção |
| Site público | `curl` e navegador | Medições reais de HTTP |

**Incidente registrado:** durante a tentativa de abrir o console do banco eu **parei
o serviço `screen-db` por acidente**, derrubando o site por ~3 minutos. Causa,
recuperação e a regra que adotei estão em
[`anexos/incidente-2026-09-01-screen-db.md`](anexos/incidente-2026-09-01-screen-db.md).
Não escondo isso e ele não afeta nenhuma outra medição — as leituras do banco são
posteriores ao restabelecimento.

---

## 1. Os quatro repositórios (nomes REAIS confirmados em `maquinanerd`)

Confirmei via `gh repo list maquinanerd`. A organização tem **37 repositórios**; os
quatro do escopo são:

| | screena | MNScr | RSSPRIME | kal-el |
| --- | --- | --- | --- | --- |
| URL | [maquinanerd/screena](https://github.com/maquinanerd/screena) | [maquinanerd/MNScr](https://github.com/maquinanerd/MNScr) | [maquinanerd/RSSPRIME](https://github.com/maquinanerd/RSSPRIME) | [maquinanerd/kal-el](https://github.com/maquinanerd/kal-el) |
| Visibilidade | pública | pública | **privada** | pública |
| Branch default | `main` | `main` | `main` | `main` |
| Branch no disco | `claude/auditoria-…` (worktree) | `main` | `main` | **`feat/login-comic-caption`** |
| Último commit | `c24dba1` · 2026-08-31 | `6fdfc25` · 2026-08-28 | `2d66c10` · 2026-08-05 | `699d2d4` · 2026-08-24 |
| Commit mais antigo | `e12edac` · **2026-06-25** | `104b673` · **2026-07-15** | `5bd904a` · **2025-09-10** | `573d012` · **2026-08-14** |
| Idade | 2 meses | 1,5 mês | **12 meses** | 18 dias |
| Total de commits | **482** | 74 | 316 | 181 |
| Arquivos versionados | **2.174** | 297 | 543 | 532 |
| Sujo no disco | 0 | 2 | 8 | 1 |
| Linguagem principal | TypeScript | Python | Python | TypeScript |
| Gerenciador | pnpm 9.15.4 | uv / pip (`pyproject`) | uv / pip | pnpm |
| Framework | Next.js App Router + Prisma | CLI/daemon próprio | Flask + gunicorn | Fastify + Next + Drizzle |
| CI | `.github/workflows/ci.yml` | `.github/workflows/ci.yml` | **nenhum** | `.github/workflows/ci.yml` |

### Linhas por linguagem (só arquivos versionados)

| Repositório | Linguagem | Arquivos | Linhas |
| --- | --- | ---: | ---: |
| **screena** | TypeScript `.ts` | 1.539 | **324.076** |
| | TSX | 158 | 27.424 |
| | Markdown | 254 | 65.463 |
| | JSON | 93 | 168.751 |
| | SQL | 26 | 5.170 |
| | Python (legado) | 6 | 379 |
| **MNScr** | Python | 244 | **69.836** |
| **RSSPRIME** | Python | 175 | **43.811** |
| | NDJSON (logs versionados!) | 181 | — |
| | `.pyc` (bytecode versionado!) | 55 | — |
| **kal-el** | TypeScript | 165 | **21.199** |
| | TSX | 48 | 10.143 |
| | Markdown | 121 | — |
| | PNG/WEBP | 106 | — |

**Denominador total do escopo: 3.546 arquivos versionados.**

Dois achados já saltam do inventário:

- **RSSPRIME versiona 55 arquivos `.pyc` e 181 arquivos de log `.ndjson`.** Bytecode
  e log não são fonte; `.pyc` versionado ainda pode divergir do `.py` ao lado.
- **kal-el está no disco numa branch de feature** (`feat/login-comic-caption`), não
  em `main`. Auditei o que está no disco e digo isso onde importa.

### Testes e migrations

| Repositório | Arquivos de teste | Migrations |
| --- | ---: | ---: |
| screena | **600** (`.test.`/`.spec.`/`tests/`) | **26** (Prisma, `20260625` → `20260825`) |
| MNScr | 122 (`tests/*.py`) | — (SQLite, sem migrations formais) |
| RSSPRIME | 56 | — (SQLite) |
| kal-el | 50 | 6 arquivos `.sql` (Drizzle) |

### Superfícies contadas (screena)

- **40** rotas de página (`app/**/page.tsx`)
- **43** manipuladores de rota (`app/**/route.ts`)
- **35** CLIs (`*/bin/*.ts`)
- **19** scripts em `scripts/`
- **25** workspaces pnpm

### Superfícies contadas (demais)

- **RSSPRIME:** 15 rotas Flask, 55 módulos em `app/`
- **MNScr:** 119 módulos em `app/`, 5 artefatos de contrato em `contracts/cinerie/`
- **kal-el:** 4 apps (`api`, `cms`, `worker`, `fixture`), 9 packages

---

## 2. O painel: 8 serviços, 2 repositórios

Projeto `rss_prime`, criado em 2026-05-11. Lido da API do painel, não da tela.

| Serviço | Tipo | Origem | Build | Comando | Domínios | Volumes | autoDeploy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cinerie-cms` | app | gh **screena**@main | `Dockerfile.cms` | — | `cms.cinerie.com:3002` | `cms-uploads`→`/data/cms-uploads` + 2 secrets em `/run/secrets/` | **false** |
| `cinerie-cms-db` | postgres | `postgres:16` | — | — | — | — | — |
| `cinerie-publication-worker` | app | gh **screena**@main | `Dockerfile.publication-worker` | `pnpm --filter @screena/news-ingestion exec tsx bin/project-editorial.ts --loop --allow-production-url` | — | — | **false** |
| `feed` | app | git **RSSPRIME**@main | `Dockerfile` | — | `rss-prime-feed.nult1k.easypanel.host:8080`, `rss.thepeg.site:8080` | — | (não declarado) |
| `screen-app` | app | gh **screena**@main | `Dockerfile` | — | `cinerie.com:3000`, `www.cinerie.com:3000`, `rss-prime-screen-app.nult1k…` | — | **false** |
| `screen-catalog-worker` | app | gh **screena**@main | `Dockerfile.catalog-worker` | — | — | — | **false** |
| `screen-cron` | app | gh **screena**@main | `Dockerfile` | `corepack pnpm --filter @screena/sync scheduler:start` | — | — | **false** |
| `screen-db` | postgres | `postgres:17` | — | — | — | — | — |

Nenhum serviço declara limite de CPU ou memória (`resources: {}` em todos).

### As duas perguntas da FASE 0

**Existe serviço sem repositório?** **Não.** Os 8 serviços saem de `screena` (5),
`RSSPRIME` (1) ou são imagens oficiais de Postgres (2).

**Existe repositório sem serviço?** **Sim — dois: `MNScr` e `kal-el`.**
Verifiquei não só o projeto `rss_prime`: varri **os 12 projetos** do painel
(`quarteldotrafego`, `giro_homologacao`, `partlabcrm`, `mecanicodigital`,
`rss_prime`, `n8n`, `extra`, `videocarro`, `langfuse`, `md-app`,
`clube_do_mecanico`, `fabrica-de-conteudo`) procurando qualquer serviço cuja
origem cite `mnscr`, `kal-el`, `screena` ou `RSSPRIME`. Só apareceram os 6 acima.

Isso tem consequência direta:

- **O MNScr — o motor editorial que gera as matérias do Cinerie — não roda no
  servidor.** Ele tem `MNScr.bat` e `iniciar.bat` na raiz: é operado **à mão, da
  máquina do dono**. Todo o fluxo editorial depende de alguém executar um `.bat`.
- **O kal-el nunca foi implantado.** A decisão "kal-el substitui o Payload?" é,
  hoje, uma decisão sobre um sistema que nunca subiu.

### `screen-cron` está degradado

Na sidebar do painel, `screen-cron` aparece **amarelo** enquanto os outros sete
estão verdes. Isso é **anterior** à minha intervenção — o primeiro screenshot da
sessão, antes de qualquer clique meu, já o mostrava assim. `screen-cron` é quem roda
`@screena/sync scheduler:start`, ou seja, **o relógio de todas as filas**.

**NÃO DETERMINADO:** o motivo exato do estado amarelo. Fecha com: abrir
`https://161.97.181.82/projects/rss_prime/app/screen-cron`, aba Logs, e ler o
último ciclo; ou consultar `SELECT max(created_at) FROM api_sync_logs WHERE ...`.

---

## 3. O banco: um cluster, 10 GB, 90 tabelas

`screen-db` → PostgreSQL **17.11**. Bancos: `postgres` (7,5 MB), **`screena` (10 GB)**,
`template1` (7,6 MB). 31 conexões ativas do usuário `screena` no momento da medição.

`cinerie-cms-db` é um **serviço separado** (`postgres:16`) — é o banco do Payload,
e não compartilha cluster com o `screen-db`.

### Os quatro compartilham banco?

**Não.** São três armazenamentos disjuntos:

| Sistema | Armazenamento |
| --- | --- |
| screena (app, workers, cron) | PostgreSQL 17 em `screen-db`, banco `screena` |
| screena (CMS Payload) | PostgreSQL 16 em `cinerie-cms-db` |
| RSSPRIME | **SQLite** (`DATABASE_PATH`), dentro do container `feed` |
| MNScr | **SQLite** local (`TMDB_DB_PATH`, `INDEXER_DB_PATH`), na máquina do dono |
| kal-el | PostgreSQL próprio (`DATABASE_URL` local) — **não implantado** |

A única ponte que fala com **dois** lados é o `cinerie-publication-worker`: lê a
outbox do Payload por **HTTP** e escreve no banco público por **Prisma**. Isso é o
desenho declarado no `CLAUDE.md` e está coerente com o que o painel mostra.

### As 12 maiores tabelas

| # | Tabela | Linhas (est.) | Tamanho |
| --- | --- | ---: | ---: |
| 1 | `api_cache` | 543.936 | **5.075 MB** |
| 2 | `episodes` | 3.728.290 | 926 MB |
| 3 | `tmdb_images` | 2.175.848 | 806 MB |
| 4 | `cast_members` | 2.798.041 | 745 MB |
| 5 | `title_recommendations` | 2.569.085 | 577 MB |
| 6 | `entities` | 5.346.761 | 449 MB |
| 7 | `crew_members` | 1.615.670 | 436 MB |
| 8 | `people` | 1.288.664 | 380 MB |
| 9 | `catalog_jobs` | 513.549 | 302 MB |
| 10 | `api_sync_logs` | 471.163 | 103 MB |
| 11 | `search_documents` | 140.523 | 74 MB |
| 12 | `tmdb_videos` | 103.688 | 73 MB |

**`api_cache` sozinho é ~50% do banco.**

### Contagens exatas que decidem a leitura do produto

| Tabela | `count(*)` exato | O que isso significa |
| --- | ---: | --- |
| `movies` | **48.613** | catálogo real de filmes |
| `tv_shows` | **34.701** | catálogo real de séries |
| `external_ratings` | **1.507** | **1,8%** das obras têm nota externa persistida |
| `cinerie_score_calculations` | 52.833 | o Score foi calculado |
| `watch_availability` | 70.869 | onde assistir tem dado |
| `articles` | **164** | a redação publicou 164 matérias |
| `page_indexability_decisions` | **164** | 164 decisões para 5,3 M de entidades |
| `content_blocks` | **0** | **a camada editorial de IA está vazia** |
| `entity_writer_jobs` | **0** | o Entity Writer nunca rodou aqui |
| `entity_writer_logs` | **0** | idem |
| `languages` | **3** | o recorte de 5 idiomas não chegou ao dado |
| `genres` | 35 | dicionário populado |
| `watch_providers` | 33 | |
| `tmdb_raw` | **300** | o espelho bruto está praticamente vazio |
| `users` | **2** | a plataforma de usuário não tem uso |

**29 tabelas têm exatamente ZERO linhas**, entre elas `content_blocks`,
`entity_writer_jobs`, `entity_writer_logs`, `keywords`, `collections`, `networks`,
`production_companies`, `tv_networks`, `movie_production_companies`,
`tv_production_companies`, `entity_keywords`, `entity_alternative_titles`,
`source_items`, `editorial_sources`, `article_source_links`,
`hero_curation_decisions` e toda a família `user_*` de produto.

### Índices

**330 índices; 143 (43,3%) nunca foram usados** (`idx_scan = 0`), ocupando
**122,3 MB**. Extensões instaladas: `plpgsql`, `pgcrypto`, `unaccent`, `pg_trgm`.
**`pg_stat_statements` NÃO está instalado** — sem ele não há medição de tempo por
consulta em produção.

---

## 4. APIs externas e a pergunta que só a visão dos quatro responde

### Por repositório (nome da variável; **nenhum valor foi lido ou impresso**)

| Provedor | screena | MNScr | RSSPRIME | kal-el |
| --- | --- | --- | --- | --- |
| TMDB v4 | `TMDB_READ_ACCESS_TOKEN` | `TMDB_API_KEY`, `TMDB_ACCESS_TOKEN` | — | — |
| TMDB v3 | `TMDB_API_KEY`, `SCREENA_TMDB_API_KEY` | — | — | — |
| OMDb | `OMDB_API_KEY` | — | — | — |
| Gemini | `GEMINI_API_KEY` | `GEMINI_KEY_1` | `GEMINI_API_KEY` | — |
| DeepSeek | — | `DEEPSEEK_API_KEY` | — | — |
| RapidAPI (ratings) | `RAPIDAPI_FILM_SHOW_RATINGS_KEY` | — | — | — |
| RapidAPI (streaming) | `RAPIDAPI_STREAMING_AVAILABILITY_KEY` | — | — | — |
| Brevo (e-mail) | `BREVO_API_KEY` | — | — | — |
| S3/R2 | `EDITORIAL_MEDIA_S3_*`, `TMDB_RAW_R2_*` | — | — | `MEDIA_STORAGE_PROVIDER` |
| Google Indexing | — | `GOOGLE_INDEXING_CREDENTIALS_FILE` | — | — |
| Cinerie (interno) | `CINERIE_CATALOG_RESOLVE_API_KEYS` | `CINERIE_CATALOG_RESOLVE_API_KEYS`, `MNSCR_CINERIE_MEDIA_API_KEY`, `MNSCR_PAYLOAD_API_KEY` | — | — |

### Existe chave COMPARTILHADA entre repositórios?

**Sim.** Provei por **hash SHA-256** dos valores, comparando os dois primeiros bytes
do digest — sem imprimir nenhum segredo:

| Chave | screena | MNScr | Veredito |
| --- | --- | --- | --- |
| Token TMDB v4 | `ed701bd3651ed317` | `ed701bd3651ed317` (em **duas** variáveis) | **MESMA CHAVE** |
| Gemini | `3a7f26253643f0a9` | `3a7f26253643f0a9` | **MESMA CHAVE** |
| `CINERIE_CATALOG_RESOLVE_API_KEYS` | `b299372f640b8f08` | `b299372f640b8f08` | **MESMA CHAVE** (correto: é segredo compartilhado de autenticação) |
| TMDB v3 (`TMDB_API_KEY` vs `SCREENA_TMDB_API_KEY`) | `3143799f3d048b0a` | — | duplicata interna do mesmo valor |

E o RSSPRIME (serviço `feed`) também declara `GEMINI_API_KEY` no painel — é
**o terceiro consumidor** de Gemini. **NÃO DETERMINADO:** se é a mesma chave dos
outros dois; não tenho o `.env` do RSSPRIME no disco (ele só existe no container).
Fecha com: ler o valor de `GEMINI_API_KEY` do serviço `feed` no painel e comparar
o hash com `3a7f26253643f0a9`.

**Por que isso importa, exatamente como o dono formulou:** a cota do TMDB é de
**ritmo** (requisições por segundo, sem teto diário) — dois sistemas na mesma chave
disputam vazão, e o efeito é lentidão e `429`, não bloqueio. Já a cota do **Gemini
é diária por chave (RPD)** — e aí o segundo a chegar simplesmente não escreve.
Como o MNScr é quem redige as matérias e o Entity Writer do screena é quem
geraria os `content_blocks`, **os dois disputam o mesmo orçamento diário de
Gemini, e nenhum dos dois sabe da existência do outro.**

Isso conversa direto com o número da seção 3: `content_blocks = 0`.
Não é prova de causa — é uma hipótese que a FASE 4 vai testar.

### RapidAPI: dependência remanescente (regra 6 do escopo)

O dono decidiu que **RapidAPI não é mais usado**. Mesmo assim:

- O serviço **`screen-app`** (o render público) carrega em produção
  `RAPIDAPI_FILM_SHOW_RATINGS_KEY`, `RAPIDAPI_FILM_SHOW_RATINGS_HOST`,
  `RAPIDAPI_FILM_SHOW_RATINGS_BASE_URL`, `RAPIDAPI_STREAMING_AVAILABILITY_KEY`,
  `RAPIDAPI_STREAMING_AVAILABILITY_HOST`, `RAPIDAPI_STREAMING_AVAILABILITY_BASE_URL`.
- O repositório versiona os workspaces `api-clients/rapidapi-core`,
  `api-clients/film_show_ratings` e `api-clients/streaming_availability`.

É achado, e volta na FASE 1 com arquivo e linha.

### O serviço de render carrega credenciais que não deveria usar

`screen-app` — a superfície pública, sob a invariante 3 ("zero API externa no
render") — tem **51** variáveis, incluindo `GEMINI_API_KEY`, `OMDB_API_KEY`, os três
identificadores TMDB, as quatro chaves RapidAPI, `BREVO_API_KEY`,
`EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY` e `TMDB_RAW_R2_SECRET_ACCESS_KEY`.

Por contraste, o `screen-catalog-worker` — que **deve** falar com o TMDB — tem
**14** variáveis e só o `TMDB_READ_ACCESS_TOKEN`. O worker está certo; o app é que
carrega o mundo.

---

## 5. Medições do site público

`curl` com `Cache-Control: no-cache`, medido em 2026-09-01 00:33 local.

| Rota | HTTP | TTFB | Total | Bytes |
| --- | ---: | ---: | ---: | ---: |
| `/pt` | 308 → | 0,318 s | | 4 |
| `/pt/` | **200** | 1,246 s | 1,458 s | 112.561 |
| `/pt/filmes/` | **200** | 0,707 s | 0,909 s | 100.915 |
| `/pt/series/` | **200** | 1,006 s | 1,204 s | 104.381 |
| `/pt/pessoas/` | **200** | 1,369 s | 1,561 s | 57.617 |
| `/pt/noticias/` | **200** | 0,423 s | 0,592 s | 84.729 |

Toda rota sem barra final devolve **308** para a versão com barra. As páginas
respondem entre 0,4 s e 1,6 s de TTFB — bem melhor que os 3–4 s de que a
documentação interna fala, mas **ainda é render dinâmico** (a rota mais lenta é
`/pt/pessoas/`, justamente a de tabela maior).

Já no HTML de `/pt/filmes/` (capturado pelo navegador) confirmei:
`<meta name="robots" content="index, follow">`, `<link rel="canonical"
href="https://cinerie.com/pt/filmes/">`, Open Graph e Twitter Card presentes.

E um defeito visível a olho nu, que volta na FASE 6: o **ticker** de novidades da
página de filmes lista, numa página `lang="pt-BR"`, os títulos
**`Астероид-77F`**, **`По контуру`**, `Of Men and Monsters` e `Switch Over` —
títulos em cirílico e em inglês, sem tradução, apresentados como "estreia hoje".

---

## 6. Estado da orquestração com o Codex

Conforme o protocolo, o Codex foi usado em duas frentes.

**FASE 5 (concorrência) — CONCLUÍDA COM ÊXITO.**
Comando: `codex exec --sandbox read-only --skip-git-repo-check - < fase5-concorrencia.txt`
Modelo `gpt-5.6-terra`, reasoning `high`. Ele navegou nos sites reais, produziu 380
linhas com 12 capítulos, tabela comparativa de 24 concorrentes e análise do mercado
brasileiro, marcando cada afirmação como `[VERIFICADO]`, `[CONHECIMENTO]` ou
`[INFERIDO]` e recusando-se a inventar números de tráfego e receita. Resultado em
[`11-concorrencia.md`](11-concorrencia.md). Custo: 94.251 tokens.

**FASE 2 (revisão cega dos 4 repositórios) — PRIMEIRA TENTATIVA FALHOU.**
Disparei as quatro em paralelo às 00:25. Todas as quatro **estouraram o limite de
uso da conta Codex** por volta das 03:29 UTC, depois de gastar
**260.147 + 199.899 + 177.479 + 161.799 = 799.324 tokens** explorando os
repositórios — e **nenhuma chegou a escrever o relatório final**.

A culpa é do meu enunciado: pedi as 8 dimensões sem teto de exploração, e o modelo
gastou todo o orçamento lendo. A mensagem do serviço diz que a cota volta às
**04:54**. A segunda tentativa vai com prompt limitado ("explore no máximo N
chamadas, depois ESCREVA, declarando a cobertura parcial").

O que sobrou de útil são as **narrações parciais** do modelo antes do corte. Elas
são **pistas a verificar**, não achados — e estão em
[`anexos/codex-parciais.md`](anexos/codex-parciais.md). As mais acionáveis:

- **screena:** "há clientes, variáveis, aliases e serviços RapidAPI ainda
  versionados; e o CMS tem um endpoint de publicação automática que permite a uma
  credencial técnica chegar a `published`, embora o `CLAUDE.md` proíba publicação
  automática."
- **MNScr:** "o pipeline chama `ContentExtractor._fetch_html`, que usa `requests`
  diretamente com redirecionamentos automáticos; a função segura existente não é
  usada nesse ponto."
- **kal-el:** "o Dockerfile do CMS afirma que não há `public/`, mas o repositório
  tem imagens usadas pela tela de login/marca; a imagem final não as copia" e
  "as rotas de conteúdo são todas autenticadas — não há endpoint de leitura pública
  de artigos publicados."

Este último é decisivo para a FASE 4 e será verificado por mim.

---

## 7. Plano dimensionado das fases seguintes

| Fase | Escopo medido | Como vou dimensionar |
| --- | --- | --- |
| 1 — auditoria por repositório | 3.546 arquivos | Prioridade por risco: os ~600 arquivos que gravam em banco, chamam API externa, renderizam página pública ou decidem licença/indexabilidade. Fixture, snapshot, `.pyc`, log e asset entram no denominador mas **não** em leitura linha a linha — declarado por diretório no anexo de cada relatório. |
| 2 — revisão cega Codex | 4 repositórios | Relançar após 04:54 com teto de exploração e ordem de escrever cedo. |
| 3 — confronto | 3 baldes por repositório | Cada item exclusivo verificado por mim, com evidência. |
| 4 — integração | 8 serviços, 3 armazenamentos, 2 chaves compartilhadas provadas | Já tenho o essencial; falta a conta de cota e o caso kal-el × Payload. |
| 5 — concorrência | **pronta** | — |
| 6 — design | 40 rotas de página | Medir em viewport de celular e desktop, com captura. |
| 7 — documento final | — | Consolidação. |

---

## Anexo — o que NÃO determinei nesta fase

| Item | Comando/consulta que fecharia |
| --- | --- |
| Motivo do estado amarelo do `screen-cron` | Logs do serviço no painel; `SELECT provider_api, status, max(created_at) FROM api_sync_logs GROUP BY 1,2` |
| Se o `GEMINI_API_KEY` do RSSPRIME é a mesma chave dos outros dois | Ler a variável do serviço `feed` no painel e comparar o SHA-256 com `3a7f26253643f0a9` |
| Conteúdo do banco SQLite do RSSPRIME em produção | Console do container `feed`: `sqlite3 $DATABASE_PATH ".tables"` |
| CPU/memória reais por serviço ao longo do tempo | Aba "Monitorar" do painel (a leitura pontual que vi é instantânea, não série) |
| Tempo por consulta em produção | Instalar `pg_stat_statements` (mudança de configuração — **não fiz**, é decisão do dono) |
