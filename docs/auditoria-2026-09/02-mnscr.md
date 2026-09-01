# FASE 1 — Auditoria do repositório `MNScr`

**Cobertura: abri e li 20 de 297 arquivos versionados (6,7%).**

Como no relatório do `screena`, o número de arquivos não é o método inteiro:

| Instrumento | Alcance |
| --- | --- |
| Leitura integral ou substancial | **20 arquivos**, escolhidos por risco |
| Varredura por padrão | **100% dos 297**, em 9 varreduras temáticas |
| Execução da suíte | **3.521 testes** rodados de verdade (`uv run pytest`) |
| Inspeção de configuração | `.env` (só nomes), `pyproject.toml`, `ci.yml`, manifesto de contratos |

Os 122 arquivos de `tests/` entram no denominador e **não** foram lidos um a um
— rodei os 3.521 casos em vez disso.

> **Armadilha do ambiente, registrada.** `git grep` neste repositório devolve
> ruído massivo: existem **12 worktrees** em `.claude/worktrees/` com cópias
> completas do código, e um diretório `build/lib/app/` com uma cópia de build.
> Nenhum deles é versionado (o índice tem 297 arquivos), mas qualquer busca
> recursiva ingênua multiplica cada achado por 14. Toda contagem abaixo usa
> `git grep` ou `git ls-files`, nunca `grep -r`.

---

## Sumário — os cinco achados mais graves

| # | Achado | Gravidade |
| --- | --- | --- |
| 1 | **A defesa contra SSRF existe, está documentada, e o caminho que o pipeline realmente usa não passa por ela.** `extractor.py:909` usa `requests` cru com `allow_redirects=True`; `extractor.py:482`, no mesmo arquivo, usa o `safe_get` endurecido. Três chamadores de produção usam o primeiro. | **CRÍTICO** |
| 2 | **O motor editorial do Cinerie não tem serviço implantado.** Roda de um `.bat` na máquina do dono. Todo o fluxo de matéria depende de alguém executar um arquivo à mão — e `docs/operations/mnscr-easypanel.md` descreve uma implantação que não existe. | **CRÍTICO** (operacional) |
| 3 | **O `.env` descreve um sistema que não existe mais.** ~40 variáveis de WordPress, Yoast, IndexNow, Google Indexing, sitemap-ping e recrawl — exatamente as funções que o `README.md` lista em "O que NÃO faz". Amostrei 10: **9 têm zero referências no Python versionado**. | **ALTO** |
| 4 | **A chave do Gemini é a mesma do `screena`** (provado por SHA-256). O código suporta rotação de múltiplas chaves (`GEMINI_KEY*`), e só uma está configurada — compartilhada com o Entity Writer. Cota diária disputada por dois sistemas que não se conhecem. | **ALTO** |
| 5 | **`MNSCR_DB_PATH` não está no `.env`.** O código lê `os.getenv('MNSCR_DB_PATH', 'data/app.db')`; a configuração define `TMDB_DB_PATH` e `INDEXER_DB_PATH`, que são outros bancos. O banco principal roda no default. | **MÉDIO** |

O contraponto: **3.521 testes, zero falhas**, CI offline por construção, 25
tabelas SQLite com contratos versionados por hash de schema. É um sistema
maduro, mal implantado.

---

## D1 — Estrutura e build

### O que é (três frases minhas)

1. É um motor editorial em Python que consome acontecimentos do RSS Prime,
   extrai e limpa o HTML das fontes originais, redige em pt-BR com Gemini (com
   DeepSeek como alternativa) e entrega um rascunho estruturado ao Cinerie.
2. Entre a redação e a entrega existem quatro camadas de contenção que o
   diferenciam de um gerador de texto comum: um QA determinístico, um
   *editorial gate* versionado, uma avaliação factual que separa o que o texto
   **afirma** do que as fontes **sustentam**, e um contrato de saída com hash de
   schema conferido antes do envio.
3. Ele nunca decide estado público: pede publicação e aceita `ROUTED_TO_REVIEW`
   ou `BLOCKED` como resposta legítima.

### Árvore

| Caminho | Arquivos | Papel |
| --- | ---: | --- |
| `app/` | 119 | 55 módulos na raiz + 7 subpacotes (`cinerie` 20, `factual` 11, `delivery` 9, `contracts` 8, `editorial_gate` 7, `editorial` 5, `submitters` 4) |
| `tests/` | 122 | Suíte |
| `docs/` | 11 | ADRs, runbooks, relatórios de execução |
| `contracts/cinerie/` | 5 | Schemas JSON versionados + manifesto com hash |
| `config/` | 5 | Política do gate editorial |

**69.836 linhas de Python versionado.**

### Build e teste — resultado real

| Comando | Resultado |
| --- | --- |
| `uv run pytest -q` | **3.521 testes, 0 falhas, 0 erros, 0 skips** |
| `uv run ruff check .` (via CI) | configurado; não rodei localmente |

Dependências: 15 diretas em `pyproject.toml`. O arquivo é notável por
**declarar o porquê de cada piso de versão** em comentário — `urllib3>=2.7.0` e
`cryptography>=50.0.0` estão lá com a explicação de que um pino exato "impede o
próprio conserto" e foi o que segurou o lock numa versão vulnerável.
`defusedxml` está declarado com a justificativa de XXE/billion-laughs. Isso é
higiene de dependência acima da média.

### CI

`.github/workflows/ci.yml`, com um cabeçalho que vale citar porque é o tipo de
garantia que costuma faltar:

> "Tudo offline. Nenhum job acessa produção, EasyPanel, screen-db, RSS Prime
> real ou a internet."

Dois jobs: `quality` (ruff + `uv lock --check` + `git diff --check`) e `tests`
(suíte completa). `MNSCR_ENVIRONMENT: development` no ambiente do workflow para
que nenhum job peça publicação.

### Qual serviço roda este código

**Nenhum.** Varri os 12 projetos do painel EasyPanel procurando origem `mnscr` —
zero resultados. O que existe são `MNScr.bat` (menu interativo) e `iniciar.bat`,
ambos apontando para `.venv\Scripts\python.exe` na pasta do repositório.

O modo contínuo é `BlockingScheduler(timezone="America/Sao_Paulo")` com
`add_job(run_pipeline_cycle_guarded, "interval", minutes=CHECK_INTERVAL_MINUTES)`
([`app/entrypoint.py:162`](app/entrypoint.py)).

E existe `docs/operations/mnscr-easypanel.md` — um runbook de implantação para
um serviço que não foi criado. O comentário de `app/config.py:89` também aponta
para ele. **A documentação descreve um estado que não existe.**

---

## D2 — Persistência

**SQLite**, não PostgreSQL. `DB_PATH = os.getenv('MNSCR_DB_PATH', 'data/app.db')`
([`app/config.py:90`](app/config.py)).

**25 tabelas** criadas por `CREATE TABLE` no código:

`api_key_status` · `api_usage` · `article_queue` · `cinerie_dispatch_locks` ·
`cinerie_media_assets` · `cinerie_publication_attempts` · `cinerie_publications` ·
`claim_evidence_links` · `delivery_attempts` · `editorial_deliveries` ·
`editorial_gate_results` · `event_processing_attempts` · `factual_assessments` ·
`factual_claims` · `factual_conflicts` · `factual_evidence` · `failures` ·
`feed_status` · `ingestion_cursors` · `link_store` · `pipeline_state` · `posts` ·
`rssprime_events` · `seen_articles` · `superfeed_covered_urls`

O desenho é bom: há **event store com revisão** (`UNIQUE(event_key, revision)`,
[`app/event_store.py:115`](app/event_store.py)) e replay por revisão
(`entrypoint.py:531`), o que permite reprocessar um acontecimento exatamente
como ele chegou.

### O achado 5: o banco principal roda no default

O código lê `MNSCR_DB_PATH`. A configuração de ambiente **não define essa
variável** — define `TMDB_DB_PATH` e `INDEXER_DB_PATH`, que são outros dois
bancos. Consequência: o banco principal fica em `data/app.db` relativo ao
diretório de trabalho. Rodar o MNScr de outra pasta cria um banco vazio novo e o
sistema parece ter perdido o histórico.

**NÃO DETERMINADO:** o conteúdo real desses bancos. Eles vivem na máquina do
dono, fora do que esta auditoria mediu. Fecha com:
`sqlite3 data/app.db ".tables"` e `SELECT count(*) FROM posts;`

---

## D3 — APIs externas

| Provedor | Variável | Cota | Como sabe que estourou |
| --- | --- | --- | --- |
| **Gemini** | `GEMINI_KEY_1` (o código aceita `GEMINI_KEY*`, `GEMINI_API*`) | **diária por chave (RPD)** | Trata `google_exceptions.ResourceExhausted` e HTTP 429 explicitamente ([`app/ai_client_gemini.py:380`](app/ai_client_gemini.py)) |
| **DeepSeek** | `DEEPSEEK_API_KEY` | não determinada | — |
| **TMDB** | `TMDB_API_KEY` / `TMDB_ACCESS_TOKEN` (ambos com o token v4) | de ritmo | — |
| **Cinerie** (interno) | `CINERIE_CATALOG_RESOLVE_API_KEYS`, `MNSCR_CINERIE_MEDIA_API_KEY`, `MNSCR_PAYLOAD_API_KEY` | — | contrato versionado com preflight |

**Mérito:** o log de erro de cota mascara a chave — `Chave ****{slot.key[-4:]}`.
Nunca imprime o segredo.

### O achado 4 — a chave compartilhada

Provei por SHA-256 (comparando digests, sem imprimir valores) que
`MNScr.GEMINI_KEY_1` e `screena.GEMINI_API_KEY` são **a mesma chave**
(digest `3a7f26253643f0a9`). O mesmo vale para o token TMDB v4
(`ed701bd3651ed317`), presente em **duas** variáveis do MNScr e uma do screena.

A diferença entre os dois casos importa:

- **TMDB** tem cota de **ritmo**. Compartilhar degrada vazão e gera `429`; é
  incômodo, não fatal.
- **Gemini** tem cota **diária por chave**. Dois sistemas na mesma chave
  dividem o mesmo orçamento e **nenhum sabe do outro**. Quem chegar depois
  simplesmente não escreve.

O MNScr **já suporta rotação de múltiplas chaves** (`app/config.py:550`, padrão
`GEMINI_KEY*`). A capacidade existe e não está sendo usada: há uma chave só, e
ela é emprestada.

---

## D4 — Filas, jobs, agendamento

Uma fila principal, `article_queue`, com estados e retry diferido
(`get_articles_to_process` respeita `deferred_retry`).

Cadência: um ciclo a cada `CHECK_INTERVAL_MINUTES`. Tetos por ciclo declarados
na configuração: `MAX_PER_CYCLE`, `MAX_PER_FEED_CYCLE`, `MAX_ARTICLES_PER_FEED`,
mais espaçamentos (`ARTICLE_SLEEP_S`, `BETWEEN_BATCH_DELAY_S`,
`BETWEEN_PUBLISH_DELAY_S`, `FEED_STAGGER_S`, `AI_MIN_INTERVAL_S`) e backoff
(`BACKOFF_BASE_S`, `BACKOFF_MAX_S`).

**A VOLTA não se aplica da mesma forma aqui.** Diferente do `screena`, o
universo do MNScr não é um catálogo fechado: é o fluxo de notícias do dia. A
pergunta certa não é "quanto tempo para cobrir tudo", e sim "o ciclo consome o
que chega". **NÃO DETERMINADO** — depende do volume real do RSS Prime e do
conteúdo de `article_queue`, que estão na máquina do dono.

**Idempotência:** por `event_key` + revisão, com `UNIQUE(event_key, revision)` no
`event_store`. Há também `cinerie_dispatch_locks` (trava de despacho) e
`cinerie_publication_attempts` (tentativas registradas). O desenho é de
*at-least-once com dedupe*, não de exceção capturada.

**Dedup** em quatro eixos, conforme o README e confirmado nos módulos:
`event_key`, assinatura de cluster, URL canônica e similaridade de título.

**Watchdog:** `ARTICLE_WATCHDOG_TIMEOUT_S` e `MAX_ARTICLE_FAIL_COUNT` existem, e
`failures` é tabela própria.

---

## D5 — Frontend / saída

**Não há frontend.** A saída é: um submitter local (arquivos em
`MNSCR_LOCAL_DRAFT_DIR`), opcionalmente o Payload CMS como `draft`, e
opcionalmente um pedido de publicação ao Cinerie sob
`editorial-publication-request-v1`.

O contrato é levado a sério — `contracts/cinerie/contract-manifest.json` declara
cada contrato com **hash SHA-256 do schema** e nível de compatibilidade:

| Contrato | Versão | Direção | Compat. |
| --- | --- | --- | --- |
| `editorial-draft-v1` | — | inbound | stable |
| `editorial-publication-request-v1` | **1.1.0** | inbound | stable |
| `publication-event-v1` | — | outbound | additive |
| `cinerie-editorial-context-v1` | — | (…) | (…) |

O preflight (`app/cinerie/preflight.py`) confere o contrato antes de enviar, com
TTL configurável (`MNSCR_CONTRACT_PREFLIGHT_TTL_SECONDS`).


### A fronteira com o Cinerie — e um código morto que afirma o contrário

Li `app/cinerie/` procurando defeito na fronteira que o Cinerie depende, e o que
achei primeiro foi o oposto: **é a peça mais bem construída dos quatro
repositórios.**

`app/cinerie/forbidden.py` recusa campos **antes** da validação de schema, com
três varreduras de profundidade diferente e a razão declarada:
`additionalProperties: false` já recusaria os mesmos campos, *"mas com um
'propriedade adicional nao permitida' que nao ensina nada: o pipeline
corrigiria adivinhando"*. As listas vêm de
`contracts/cinerie/seo-policy.json`, exportado dos mesmos arrays do Screen-App —
não são redigitadas.

`app/cinerie/outcomes.py` documenta os seis desfechos numa tabela com código
HTTP e semântica de reenvio, e explica a armadilha do `DEFERRED`: ele chega em
**429**, *"o codigo que qualquer cliente HTTP trata como 'voce esta rapido
demais' — mas aqui ele nao fala de taxa, e sim de teto diario da redacao"*. O
reenvio precisa manter o **mesmo `requestId`**, porque um novo contaria como
publicação nova e consumiria vaga do teto do dia seguinte.

Os seis desfechos batem exatamente com os cinco do gate no lado do `screena`
(`apps/cms/src/auto-publication.ts`) mais o `OPERATIONAL_ERROR` do transporte.
**Os dois lados do contrato concordam.**

#### O defeito

`outcomes.py:266` define `should_resend(result) -> (bool, str)` — a decisão de
reenvio com **motivo registrado**, um caso por desfecho. Está exportada em
`__all__`, tem docstring longa e é coberta por teste.

E o docstring declara por que ela existe:

> *"A funcao existe para que a resposta seja uma decisao explicita com motivo
> registrado, **em vez de um `if` espalhado pelo orquestrador**."*

**Ela nunca é chamada em produção.** `git grep` no código versionado:

| Chamador | Onde |
| --- | --- |
| `tests/test_cinerie_delivery.py:573` | teste |
| `tests/test_cinerie_delivery.py:596` | teste (`resend_not_before`) |
| `tests/test_cinerie_delivery.py:678` | teste (`resend_not_before`) |
| — | **nenhum em `app/`** |

E o `if` que a função existia para eliminar **está no orquestrador**, em
`app/cinerie_service.py:507`:

```python
if result.outcome == O.DEFERRED:
    ...
    return STATUS_DEFERRED
```

O comportamento **está correto** — `cinerie_service.py` trata `DEFERRED`, guarda
`next_eligible_at` (linhas 440 e 494) e ainda registra um aviso quando um
`nextEligibleAt` aparece num desfecho já aceito (linha 472). Não há defeito
funcional.

O defeito é de **duplicação e de verdade**: a política de reenvio está escrita
em **dois** lugares que podem divergir, e o docstring do lugar canônico afirma
que o outro não existe. Quem alterar `should_resend` — por exemplo, para tornar
`CONFLICT` retentável — vai alterar código morto e ver os testes passarem.

É a forma mais silenciosa do padrão `implementado ≠ chamado`: **testado, verde e
inerte.**

**Correção sugerida (não apliquei — muda comportamento):** fazer
`cinerie_service.py` consumir `should_resend`/`resend_not_before` em vez do `if`
próprio, ou remover as duas funções e o docstring que promete o que elas não
fazem. A primeira é melhor: o motivo textual que `should_resend` devolve é
exatamente o que falta no log hoje.


---

## D6 — Segurança

### O achado 1 — SSRF, em detalhe

O repositório tem [`app/safe_http.py`](app/safe_http.py), e o cabeçalho dele é
uma das melhores peças de documentação de segurança que li neste ecossistema.
Ele nomeia o alvo clássico (`169.254.169.254`), lista **três defesas**
(destino resolvido, verificação a **cada salto** de redirect, teto de bytes
recebidos **e** descomprimidos) e **declara a própria limitação** (janela de
DNS rebinding) em vez de escondê-la.

O `extractor.py` tem **duas** funções de busca:

**A que respeita a defesa** — [`app/extractor.py:469`](app/extractor.py):

```python
def _get(url, timeout=25, tries=2):
    """... `requests.get(..., allow_redirects=True)` entregava o redirect sem
    exame nenhum: a primeira URL podia ser inocente e o `Location` apontar
    para a rede interna. Ver `app/safe_http.py`."""
    resultado = safe_get(url, headers=..., read_timeout=timeout,
                         max_bytes=ARTICLE_MAX_BYTES)
```

**A que a burla** — [`app/extractor.py:906`](app/extractor.py):

```python
self.session = requests.Session()
...
def _fetch_html(self, url: str) -> Optional[str]:
    resp = self.session.get(url, timeout=20.0, allow_redirects=True)
```

E os chamadores de produção usam **a segunda**:

| Chamador | Linha |
| --- | --- |
| `app/pipeline.py` | **1326** — `html_content = extractor._fetch_html(article_url)` |
| `app/cluster_extractor.py` | **72** |
| `app/multi_source_builder.py` | **200** |

As URLs vêm de feed RSS — entrada de fora. Quem controla um item de feed (ou um
redirect a partir dele) faz o MNScr buscar o endereço que quiser, **sem
verificação de destino, sem verificação por salto e sem teto de corpo**. Como o
MNScr roda na máquina do dono, a "rede interna" alcançável é a LAN dele.

O comentário de `_get` prova que o risco foi entendido. O defeito é que a
correção foi aplicada a uma função e não à que o pipeline chama. É a forma mais
pura do padrão **`implementado ≠ chamado`**.

**Correção sugerida (não apliquei — muda comportamento):** trocar o corpo de
`_fetch_html` por uma chamada a `safe_get`, com os mesmos tetos de `_get`.
Existe teste que faz `monkeypatch` de `_fetch_html`
(`tests/test_pipeline_draft_cycle.py:139`), então a troca é coberta.

### Segredos

**Nenhum segredo versionado.** O `.gitignore` cobre `.env`, `.env.*`,
`service-account*.json` e `*service-account*.json`. Existe um
`service-account.json` real no disco (credencial Google, com `private_key`), e
ele está **corretamente fora do índice** — confirmei com `git ls-files`.

### Entrada não confiável

- **XML/sitemap:** `defusedxml` declarado como dependência, com o motivo escrito
  no `pyproject.toml` (billion laughs, XXE). Correto.
- **HTML:** BeautifulSoup + `trafilatura`. Sem `eval`.
- **SSRF:** ver acima.

### Cabeçalhos / superfície exposta

Não há superfície HTTP: o MNScr é cliente, não servidor. `DASHBOARD_TOKEN`
existe na configuração, mas não encontrei servidor HTTP no código versionado —
**NÃO DETERMINADO** se há um painel; fecha com
`git grep -n "Flask\|FastAPI\|http.server" -- '*.py'`.

---

## D7 — Testes

**122 arquivos, 3.521 casos, 100% verde.** Nenhum skip, nenhum xfail — o que é
incomum e bom: uma suíte sem skips não esconde caso desligado.

**Testes que ratificam defeito:** não encontrei. O que encontrei é relevante
para o achado 1 e preciso registrar com honestidade: **existem testes que fazem
`monkeypatch` de `_fetch_html`** (`test_pipeline_draft_cycle.py:139`,
`test_single_source_publication.py:600`) e testes que o substituem por mock
(`test_cluster_extractor_rate_limit.py:74`). Eles não *ratificam* o defeito —
não afirmam que buscar sem verificação é correto — mas **tornam o defeito
invisível para a suíte**: nenhum teste exercita o caminho real de rede, então
nenhum teste percebe que ele não passa pelo `safe_http`.

Não há teste que toque produção: o CI declara isso e o ambiente do workflow
força `MNSCR_ENVIRONMENT: development`.

Cobertura de linhas: **não há ferramenta configurada** (sem `pytest-cov` nas
dependências de dev, que são só `pytest` e `ruff`).

---

## D8 — Dívida

### O achado 3 — o `.env` descreve outro sistema

O `README.md` tem uma seção "O que NÃO faz" que lista, textualmente:

> publicar em WordPress · criar post · criar categoria · criar tag · enviar
> imagem · produzir campos Yoast · disparar Google News · enviar IndexNow ·
> pingar sitemap · validar News Sitemap · executar URL Inspection · agendar
> recrawl · decidir canonical, robots, JSON-LD ou indexabilidade

E o `.env` de produção define, entre outras: `YOAST_NEWS_SITEMAP_ENABLED`,
`YOAST_NEWS_SITEMAP_URL`, `INDEXNOW_ENABLED`, `INDEXNOW_ENDPOINT`,
`GOOGLE_INDEXING_ENABLED`, `GOOGLE_INDEXING_CREDENTIALS_FILE`,
`GOOGLE_URL_INSPECTION_ENABLED`, `SITEMAP_PING_ENABLED`,
`SITEMAP_PING_ENDPOINTS`, `RSS_PING_ENABLED`, `RSS_PING_XMLRPC_URL`,
`RECRAWL_ENABLED`, `RECRAWL_MAX_ATTEMPTS`, `FORCE_INDEX_ALL_POSTS`,
`ALLOW_MANUAL_INDEX_OVERRIDE`, `INDEXER_NOTIFY_ON_PUBLISH`, `PUBLISHER_LOGO_URL`.

Amostrei 10 dessas variáveis contra o Python versionado:

| Variável | Referências em `.py` versionado |
| --- | ---: |
| `YOAST_NEWS_SITEMAP_ENABLED` | **0** |
| `INDEXNOW_ENABLED` | **0** |
| `GOOGLE_INDEXING_ENABLED` | **0** |
| `SITEMAP_PING_ENABLED` | **0** |
| `RSS_PING_ENABLED` | **0** |
| `RECRAWL_ENABLED` | **0** |
| `PUBLISH_ALL_PROCESSABLE` | **0** |
| `FORCE_INDEX_ALL_POSTS` | **0** |
| `INDEXER_NOTIFY_ON_PUBLISH` | **0** |
| `PAYLOAD_CMS_ENABLED` | 3 (vivo) |

Nove de dez são **configuração morta**. O risco não é técnico — é de leitura:
quem abrir o `.env` para entender o sistema conclui que o MNScr publica em
WordPress e avisa o Google. Ele não faz nada disso. E `GOOGLE_INDEXING_CREDENTIALS_FILE`
aponta para um `service-account.json` real que continua no disco.

Há ainda duas famílias **duplicadas** de configuração do Payload:
`PAYLOAD_CMS_*` (7 variáveis) e `PAYLOAD_*` (4 variáveis), com
`PAYLOAD_CMS_BASE_URL`, `PAYLOAD_CMS_TOKEN`, `PAYLOAD_BASE_URL` e
`PAYLOAD_API_TOKEN` todas **vazias**, enquanto a entrega real usa
`PAYLOAD_INTERNAL_SERVICE_URL` + `MNSCR_PAYLOAD_API_KEY`.

### Comentários mentirosos

Nos 14 arquivos que li, **nenhum comentário falso**. O padrão aqui é o mesmo do
`screena`: o comentário registra a medição e o erro anterior. O de
`safe_http.py` chega a declarar a limitação que a implementação **não** cobre.

O que está desatualizado é **documentação de operação**, não comentário de
código: `docs/operations/mnscr-easypanel.md` e o comentário de
`app/config.py:89` descrevem uma implantação em EasyPanel que não existe.

### Código morto

`build/lib/app/` existe no disco com uma cópia antiga (`pipeline.py` em 1.062
linhas contra 1.326+ do atual) — **não é versionado**, mas polui busca e pode
enganar quem investiga. Idem os 12 worktrees em `.claude/worktrees/`.

---

## Tabela de achados

| # | Grav. | Arquivo:linha | Achado | Evidência | Consequência |
| --- | --- | --- | --- | --- | --- |
| M-01 | **CRÍTICO** | `app/extractor.py:909` + `pipeline.py:1326`, `cluster_extractor.py:72`, `multi_source_builder.py:200` | `_fetch_html` usa `requests` cru com `allow_redirects=True`, ignorando `safe_http` | código | SSRF a partir de URL de feed; sem teto de corpo; alcança a LAN do dono |
| M-02 | **CRÍTICO** | painel EasyPanel (ausência) | Motor editorial sem serviço; roda de `.bat` na máquina do dono | painel + repositório | O fluxo de matéria do Cinerie depende de execução manual |
| M-03 | **ALTO** | `.env` (~40 variáveis) | Configuração de WordPress/Yoast/IndexNow/Google que o código não lê | 9 de 10 amostradas com 0 referências | Quem lê a config entende errado o sistema |
| M-04 | **ALTO** | `GEMINI_KEY_1` | Mesma chave Gemini do `screena` (SHA-256 idêntico) | hash | Cota diária disputada; rotação suportada e não usada |
| M-05 | **MÉDIO** | `app/config.py:90` | `MNSCR_DB_PATH` não definido; banco principal no default relativo | código + config | Rodar de outra pasta cria banco vazio |
| M-06 | **MÉDIO** | `docs/operations/mnscr-easypanel.md` | Runbook de implantação inexistente | painel | Documentação afirma estado que não existe |
| M-07 | **MÉDIO** | testes que fazem monkeypatch de `_fetch_html` | Nenhum teste exercita o caminho real de rede | suíte | O defeito M-01 é invisível para 3.521 testes verdes |
| M-11 | **MÉDIO** | `app/cinerie/outcomes.py:266` × `app/cinerie_service.py:507` | `should_resend()`/`resend_not_before()` exportadas, documentadas e testadas — **chamadas só por teste**; o `if` que elas existiam para eliminar está no orquestrador | `git grep` | Política de reenvio duplicada em dois lugares que podem divergir; o docstring afirma o contrário |
| M-08 | **BAIXO** | `.env` | Duas famílias `PAYLOAD_CMS_*` e `PAYLOAD_*`, ambas vazias | config | Ambiguidade sobre qual caminho está ativo |
| M-09 | **BAIXO** | `app/store.py:1478,1481` | `datetime.utcnow()` deprecado; adapter datetime do sqlite3 deprecado | execução | Ruído de warning; quebra em Python futuro |
| M-10 | **BAIXO** | `build/lib/`, `.claude/worktrees/` (12) | Cópias não versionadas que poluem busca | disco | Contagem inflada em auditoria ingênua |

---

## O que está morto

- ~40 variáveis de ambiente de funções removidas (WordPress/SEO/indexação).
- As famílias `PAYLOAD_CMS_*` e `PAYLOAD_*` vazias.
- `build/lib/app/` (cópia de build antiga, não versionada).

## O que mente

1. O **`.env`**, que descreve um publicador WordPress que não existe mais.
1b. O **docstring de `should_resend`**, que diz existir para evitar "um `if`
   espalhado pelo orquestrador" — e o `if` está lá, em `cinerie_service.py:507`.
2. **`docs/operations/mnscr-easypanel.md`** e o comentário de `app/config.py:89`,
   que apontam para uma implantação inexistente.
3. **A suíte verde**, no sentido preciso de M-07: 3.521 testes passam e nenhum
   toca o caminho de rede que tem o defeito crítico.

Nenhum comentário de código mente.

---

## O que NÃO determinei — e o comando que fecha

| Item | Comando |
| --- | --- |
| Conteúdo real dos bancos SQLite (volume processado, fila, falhas) | `sqlite3 data/app.db ".tables"` e `SELECT count(*) FROM posts, article_queue, failures;` |
| Se `_fetch_html` já foi explorado | Não há log de destino recusado nesse caminho — por definição, ele não recusa nada |
| Volume real do fluxo e se o ciclo dá conta | `SELECT count(*) FROM article_queue WHERE status='queued';` ao longo de um dia |
| Existência de painel HTTP (`DASHBOARD_TOKEN`) | `git grep -n "Flask\|FastAPI\|http.server" -- '*.py'` |
| Cota real consumida do Gemini por dia | `SELECT * FROM api_usage;` no banco local |
| Vulnerabilidades de dependência | `uv run pip-audit` ou `uv run python -m pip_audit` |

---

## Anexo — os 20 arquivos que abri

`README.md` · `pyproject.toml` · `.github/workflows/ci.yml` · `main.py` ·
`app/entrypoint.py` (trechos) · `app/config.py` (trechos) ·
`app/safe_http.py` (cabeçalho + constantes) · `app/extractor.py` (trechos:
`_get` e `_fetch_html`) · `app/ai_client_gemini.py` (trechos de cota) ·
`app/event_store.py` (trechos) · `contracts/cinerie/contract-manifest.json` ·
`MNScr.bat` · `iniciar.bat` · `.env` (só nomes de variáveis) ·
`app/cinerie/forbidden.py` · `app/cinerie/outcomes.py` · `app/cinerie_service.py`
(trechos) · `app/cinerie/client.py` (trechos) · `contracts/cinerie/seo-policy.json`
(por referência) · `app/editorial_gate/` (inventário de tamanho)

**Não abri:** os 122 arquivos de `tests/` (rodei os 3.521 casos), os 11 de
`docs/`, os 5 de `config/`, e os subpacotes `factual/`, `delivery/`,
`editorial_gate/`, `editorial/`, `submitters/` — 36 arquivos de `app/` que
merecem uma segunda passagem se o dono quiser profundidade na camada factual.
