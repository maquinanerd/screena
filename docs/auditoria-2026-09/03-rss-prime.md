# FASE 1 — Auditoria do repositório `RSSPRIME`

**Cobertura: abri e li 13 de 543 arquivos versionados (2,4%).**

| Instrumento | Alcance |
| --- | --- |
| Leitura integral ou substancial | **13 arquivos** |
| Varredura por padrão | **100% dos 543**, em 8 varreduras |
| Execução da suíte | **564 testes** rodados — depois de contornar dois bloqueios (ver D7) |
| Inspeção de configuração | `Dockerfile`, `requirements.txt`, `pyproject.toml`, env do serviço `feed` no painel |

Dos 543 arquivos, **236 não são fonte**: 55 `.pyc`, 181 `.ndjson` de log.
Eles entram no denominador e não são lidos — e a existência deles já é achado.

---

## Sumário — os cinco achados mais graves

| # | Achado | Gravidade |
| --- | --- | --- |
| 1 | **O `README.md` descreve outro sistema.** Ele diz que o repositório é o "LANCE! RSS/Atom Feed Generator… puramente educativo" para o portal de esportes LANCE!. O sistema real é o RSS Prime: 50+ fontes, clustering multi-fonte com embeddings e Gemini, alimentando o motor editorial do Cinerie. | **ALTO** |
| 2 | **Dois manifestos de dependência que discordam.** `requirements.txt` (usado pelo `Dockerfile`) tem 17 pacotes; `pyproject.toml`/`uv.lock` têm 15 — faltam `thefuzz`, `unidecode` e **`google-genai`**. Quem usar `uv sync` recebe uma instalação quebrada. | **ALTO** |
| 3 | **A suíte não roda a partir de um checkout limpo.** Dois arquivos na raiz consultam uma tabela SQLite **no import**, e o pytest aborta a coleta inteira (`Interrupted: 2 errors during collection`). Sem CI, ninguém percebe. | **ALTO** |
| 4 | **55 arquivos `.pyc` e 181 `.ndjson` de log versionados** — inclusive bytecode de **duas** versões de Python (3.11 e 3.13) para os mesmos módulos. | **MÉDIO** |
| 5 | **`/admin/refresh`, endpoint vivo e exposto, tem uma URL do LANCE! fixa no código** (`source_url = 'https://www.lance.com.br/mais-noticias'`) — resíduo da origem do repositório num sistema que hoje serve entretenimento. | **MÉDIO** |

Contraponto: **564 testes passam**, os endpoints administrativos são
**fechados por padrão** com comparação em tempo constante, e a contabilidade de
cota do Gemini é a mais completa dos quatro repositórios.

---

## D1 — Estrutura e build

### O que é (três frases minhas)

1. É um serviço Python/Flask que coleta artigos de dezenas de fontes — por RSS e
   por scrapers dedicados, um por veículo — normaliza, deduplica e persiste em
   SQLite.
2. Sobre isso, o subpacote `superfeed/` detecta quando várias fontes cobrem o
   **mesmo acontecimento**, agrupa em cluster com embeddings e validação por
   Gemini, e publica um feed RSS enriquecido com metadados `sf:*`.
3. Ele não é um leitor de RSS para usuários: é uma **fonte de eventos para
   pipelines editoriais** — hoje o MNScr (Cinerie) e o MN26 (Máquina Nerd).

### Árvore

| Caminho | Arquivos | Papel |
| --- | ---: | --- |
| `logs/` | **181** | NDJSON de execução, **versionados** |
| `app/` | 108 | 55 módulos: servidor Flask, agendador, ~30 scrapers por veículo, filtros, store |
| `superfeed/` | 27 | Clustering multi-fonte: orchestrator, event_grouper, embeddings, Gemini, `v2/` |
| `.local/` | 36 | Estado do Replit, **versionado** |
| `tests/` | 34 | Suíte |
| `EXPLICACAO/` | 23 | Documentação |
| `config/` | 12 | Configuração de fontes/tópicos |

**43.811 linhas de Python versionado.** Além de `tests/`, há **~15 arquivos
`test_*.py` soltos na raiz** — parte deles é script, não teste (ver D7).

### Build — e o achado 2

Existem **dois manifestos que não concordam**:

| Manifesto | Pacotes | Quem usa |
| --- | ---: | --- |
| `requirements.txt` | **17** | O `Dockerfile` (`pip install -r requirements.txt`) → **é o que roda em produção** |
| `pyproject.toml` + `uv.lock` | **15** | Quem rodar `uv sync` |

Faltam no `pyproject.toml`/`uv.lock`, e estão no `requirements.txt`:

- **`google-genai>=1.0.0`** — o cliente do Gemini, do qual o validador do
  superfeed inteiro depende
- `thefuzz>=0.22.1`
- `unidecode>=1.3.8`

E `thefuzz`/`unidecode` são importados por **código de produção**, não só por
teste: `app/server.py`, `app/feed_processor.py`, `app/rss_filtering.py`,
`superfeed/event_grouper.py`, `superfeed/v2/classifier.py`,
`superfeed/v2/coherence.py`.

> **Correção que fiz em mim mesmo antes de escrever.** Meu primeiro achado foi
> "dependência de produção não declarada". Ao abrir o `Dockerfile` vi que ele usa
> `requirements.txt`, e ali os três estão. **Produção monta certo.** O defeito
> real é a divergência entre os dois manifestos — e ela me mordeu de verdade: o
> `uv run pytest` falhou com `ModuleNotFoundError: No module named 'thefuzz'`.

Resíduo adicional: o `pyproject.toml` declara `name = "repl-nix-workspace"` —
nome de workspace do Replit — e lista `psycopg2-binary` (PostgreSQL) num sistema
que usa **SQLite**.

### CI

**Não existe.** Nenhum `.github/workflows`. É o único dos quatro repositórios
sem CI, e é o que mais precisaria: é o único com dois manifestos divergentes e
uma suíte que não coleta.

### Serviço que roda este código

`feed` no painel EasyPanel: origem `git@github.com:maquinanerd/RSSPRIME.git@main`,
build por `Dockerfile`, `gunicorn main:app --workers 1 --threads 4`, porta 8080,
domínios `rss-prime-feed.nult1k.easypanel.host` e **`rss.thepeg.site`**.
Banco em `/app/data/articles.db`. `ADMIN_KEY` definida.

---

## D2 — Persistência

**SQLite** (`DATABASE_PATH=/app/data/articles.db` em produção). Tabelas
principais do superfeed: `sf_clusters` (nome confirmado pelo erro de coleta) e
o ledger de dedupe/artigos em `superfeed/v2/article_ledger.py` e
`superfeed/dedup_ledger.py`.

**NÃO DETERMINADO:** contagem de linhas, tamanho e retenção efetiva do banco de
produção. Ele vive dentro do container `feed`, sem volume declarado no painel —
o que significa que **o banco não está num volume persistente**: um redeploy
recria o container. Fecha com: console do serviço `feed`,
`sqlite3 /app/data/articles.db ".tables"` e `SELECT count(*) FROM sf_clusters;`

> Esse ponto merece destaque: o painel mostra `mounts: -` para o serviço `feed`.
> O `cinerie-cms` tem volume (`cms-uploads`), o `feed` não. Se o banco de
> artigos e clusters vive só no sistema de arquivos do container, **todo
> redeploy perde o histórico de dedupe**. Não confirmei que é isso que acontece
> — mas é o que a configuração indica, e é verificável em um comando.

Retenção existe em código: `app/retention.py`, com `RETENTION_ENABLED`,
`RETENTION_HOURS`, `READY_RETENTION_HOURS`, `QUEUE_RETENT…` no ambiente.

---

## D3 — APIs externas

### Gemini — a melhor contabilidade dos quatro repositórios

| Item | Valor |
| --- | --- |
| Variável | `GEMINI_API_KEY` (no serviço `feed`) |
| Cota | diária por chave (RPD) |
| Como sabe que estourou | `superfeed/gemini_usage.py:344` — `_QUOTA_MARKERS = ("RESOURCE_EXHAUSTED", "429", "quota", "rate limit", "rate_limit")`, reconhecendo **"sem depender do tipo da exceção"** |
| Cooldown | `GEMINI_QUOTA_COOLDOWN_SECONDS`, default **1800 s** |
| Contabilidade | Tabela própria com `request_count`, `item_count`, `success_count`, `error_count`, **`status_429_count`**, `cache_hits`, `cache_misses`, `blocked_request_count` |
| Tetos por ciclo | `MAX_AI_VALIDATIONS_PER_TOPIC_PER_CYCLE`, `MAX_AI_VALIDATIONS_TOTAL_PER_CYCLE`, `AI_VALIDATOR_TIMEOUT_SECONDS` |

Isto é notavelmente melhor que o resto do ecossistema: é o único lugar onde o
**estouro de cota é contado numa tabela**, e não apenas logado.

### A chave é compartilhada? — medido

Comparei digests SHA-256 (16 primeiros hexdígitos), sem imprimir valor, com o
método validado contra um controle conhecido (`sha256('abc') = ba7816bf8f01cfea`
nos dois lados):

| Origem | Gemini |
| --- | --- |
| `feed` (RSSPRIME, produção) | **G-3** |
| `screen-app` / `screen-cron` (produção) | **G-2** |
| `.env` local do screena e do MNScr | **G-1** |

**O RSSPRIME tem chave própria.** Não divide cota do Gemini com ninguém. Este é
o comportamento correto, e é o único dos três consumidores que o pratica.

O `feed` **não** carrega `TMDB_READ_ACCESS_TOKEN`, `OMDB_API_KEY` nem
`CINERIE_CATALOG_RESOLVE_API_KEYS` — o menor privilégio está respeitado.

### Embeddings

`EMBED_MODEL`, `EMBED_DIM`, `EMBED_BATCH_SIZE` no ambiente;
`superfeed/embedding_client.py` no código. **NÃO DETERMINADO** se o provedor de
embedding é o próprio Gemini ou um modelo local — fecha com
`sed -n '1,60p' superfeed/embedding_client.py`.

---

## D4 — Filas, jobs, agendamento

`app/scheduler.py` + `app/scheduler_locks.py`. Cadência declarada no README
antigo como 15 minutos; os tópicos são **hardcoded** em `TOPIC_DEFINITIONS`
dentro de `app/scheduler.py` (o `PROJECT_OVERVIEW.md` registra isso como
limitação conhecida).

Há trava de agendamento (`scheduler_locks.py`), o que evita ciclo concorrente —
importante porque o `gunicorn` roda com `--workers 1 --threads 4`.

**A VOLTA:** como no MNScr, o universo não é um catálogo fechado e sim o fluxo
do dia; a métrica certa é se o ciclo consome o que chega.
**NÃO DETERMINADO** — depende do banco de produção.

### MN26 continua no laço

`app/scheduler.py:23` importa `build_article_for_mn26` e a linha **868** o chama
dentro do ciclo do agendador. Isso não é defeito do RSSPRIME — ele é upstream
compartilhado, e serve tanto a Máquina Nerd quanto o Cinerie. Registro porque o
`CLAUDE.md` do screena afirma que "**MN26 está fora da arquitetura da Cinerie**…
não participa de nenhum fluxo daqui": é verdade do lado do Cinerie, e vale
saber que **o mesmo processo que produz o superfeed do Cinerie também monta
artigo para o MN26**, no mesmo ciclo e com a mesma cota de Gemini.

---

## D5 — Saída HTTP

**15 rotas Flask** em `app/server.py`:

| Rota | Protegida? |
| --- | --- |
| `GET /` (dashboard) | não |
| `GET /logs`, `/api/logs`, `/api/logs/list` | **sim** (`@require_admin`) |
| `GET /feeds/topic/<topic>/<format>` | não (público, é o produto) |
| `GET /feeds/superfeed/<topic>/rss` | não (público) |
| `GET /feeds/<source>/<section>/<format>` | não (público) |
| `GET /feeds/lance/rss.xml`, `/feeds/lance/atom.xml` | não — **rotas do LANCE!, ainda vivas** |
| `GET /health` | não |
| `GET /admin/refresh`, `/admin/refresh-topic/<topic>`, `/admin/diagnostics`, `/admin/stats` | **sim** |
| `GET /debug/superfeed/<topic>` | **NÃO DETERMINADO** |

SEO não se aplica: a saída é feed XML, não página indexável.

---

## D6 — Segurança

### O que está certo

`require_admin` (`app/server.py:180`) é **fechado por padrão**:

```python
if not ADMIN_KEY:
    return ... 403 'Acesso negado: A chave de administrador (ADMIN_KEY) ...'
```

Sem chave configurada, o endpoint **nega** — não libera. E a comparação é em
tempo constante (`app/utils.py:217`):

```python
return hmac.compare_digest(provided, expected)
```

Aceita `Authorization: Bearer <ADMIN_KEY>` ou `X-Admin-Key`. `ADMIN_KEY` está
definida no serviço `feed` — confirmei no painel (só a presença; não li o valor).

### O que preocupa — e o que eu fechei

**1. `/debug/superfeed/<topic>`: FECHADO, está protegido.** Deixei isso como
NÃO DETERMINADO na primeira passagem e voltei para verificar. A rota tem
`@require_admin` (`app/server.py:1486`), e o docstring registra
que já foi diferente:

> *"Always requires a valid ADMIN_KEY header […]. It used to be open whenever
> ADMIN_KEY was unset, which exposed event keys, URLs and titles to anyone who
> could reach the port."*

Ou seja: era um buraco real, foi fechado, e o motivo ficou escrito. Bom.

**2. ReDoS em `parse_query_filter`: FECHADO, não existe.** Também levantei como
suspeita e fui ao consumidor. Os termos são usados em
`app/store.py:368`:

```python
like_conditions = ["(title LIKE ? OR description LIKE ?)" for _ in search_terms]
where_conditions.append(f"({' OR '.join(like_conditions)})")
for term in search_terms:
    params.extend([f'%{term}%', f'%{term}%'])
...
cursor.execute(query, params)
```

O `f-string` monta só o **esqueleto** de `OR`, a partir da *contagem* de termos —
nunca do conteúdo. Os valores vão como **parâmetro ligado** (`?`). Não há
`re.compile` sobre entrada do usuário e não há concatenação de dado em SQL.
**Sem ReDoS e sem injeção.**

**3. O que continua sendo achado: `/admin/refresh` com alvo fixo no código.**

```python
# Fixed source URL for security
source_url = 'https://www.lance.com.br/mais-noticias'
```

O comentário está certo sobre a segurança — é melhor que aceitar URL do usuário.
Mas o alvo é o **portal de esportes de onde o repositório nasceu**, num sistema
que hoje serve entretenimento para o Cinerie. O endpoint administrativo
"atualizar" atualiza a coisa errada.

### Segredos

Nenhum segredo versionado. Não há `.env` no repositório nem no disco local
(o serviço recebe tudo do painel).

### Dependências

`pip-audit`/`uv audit`: **NÃO DETERMINADO**. Nota relevante: o `Dockerfile`
instala com `>=` em todas as linhas e **não há lockfile no caminho de build** —
`requirements.txt` sem pinos significa que dois builds em datas diferentes
produzem árvores de dependência diferentes. O `uv.lock` existe mas não é usado
pelo `Dockerfile`.

---

## D7 — Testes

### O achado 3, em detalhe

Um checkout limpo **não consegue rodar a suíte**. Precisei de dois contornos:

**Contorno 1 — dependências.** `uv run pytest` falha com
`ModuleNotFoundError: No module named 'thefuzz'` e `'unidecode'`, porque o
`pyproject.toml` não os declara (ver D1). Rodei com
`--with pytest --with thefuzz --with unidecode --with python-Levenshtein`.

**Contorno 2 — dois arquivos que consultam o banco no import.**

```
ERROR test_mn26_v2.py       - sqlite3.OperationalError: no such table: sf_clusters
ERROR test_superfeed_xml.py - sqlite3.OperationalError: no such table: sf_clusters
!!!!!!!!!!!!!!!!!! Interrupted: 2 errors during collection !!!!!!!!!!!!!!!!!!!
```

`test_superfeed_xml.py:15` executa `conn.execute(...)` em **nível de módulo**.
Como o pytest importa todo arquivo `test_*.py` para coletar, esse único
`SELECT` **aborta a coleta da suíte inteira** — não só desses dois arquivos.
Exit code 2, zero testes rodados.

Esses arquivos também **imprimem** resultados (`OK 'Article | WebMD' -> 'Article'`):
são scripts de diagnóstico com nome de teste, não testes.

**Com os dois contornos: 564 testes passam, em 128 s. Zero falhas.**

E aqui está o ponto que fecha o achado: **não há CI**. Ninguém jamais rodaria a
suíte num ambiente limpo para descobrir isso.

### Testes que ratificam defeito

Não encontrei. Mas há **testes na raiz que dependem de estado de produção**
(`test_mn26_v2.py`, `test_superfeed_xml.py`, e provavelmente
`test_cluster_store.py`, `test_full_cycle.py`) — o que é o parente próximo:
teste que só passa se o banco estiver populado não afirma nada sobre o código,
afirma sobre a máquina.

Cobertura de linhas: **não há ferramenta configurada**.

---

## D8 — Dívida

### O achado 1 — o README

O `README.md` do repositório, na primeira linha:

> **# LANCE! RSS/Atom Feed Generator**
> Um gerador de feeds RSS e Atom não oficiais para o portal de notícias LANCE!
> Este projeto é puramente educativo…

E, logo abaixo: *"não deve ser usado para fins comerciais"*.

O sistema real, descrito em `PROJECT_OVERVIEW.md` (auditoria interna de
26/05/2026), é: *"coleta artigos de 50+ fontes externas… agrupa duplicatas por
tópico… foi projetado para alimentar pipelines editoriais externos"*, e hoje
alimenta o motor editorial de um produto comercial.

O commit mais antigo é de **2025-09-10** ("Initial commit"); o mais recente de
2026-08-05. **Em 12 meses o README nunca foi atualizado.** É o documento que
qualquer pessoa lê primeiro, e ele descreve outro produto — com uma cláusula de
uso não comercial que não corresponde ao uso atual.

### Artefatos versionados que não deveriam estar

- **55 arquivos `.pyc`**, incluindo bytecode de **duas** versões de Python para
  os mesmos módulos (`app/__pycache__/__init__.cpython-311.pyc` **e**
  `…cpython-313.pyc`). Bytecode versionado pode divergir do `.py` ao lado e é
  carregado preferencialmente se o timestamp bater.
- **181 arquivos `.ndjson`** em `logs/` — log de execução no controle de versão.
- **36 arquivos em `.local/`** — estado do agente Replit, incluindo
  `rapid_build_success` / `rapid_build_started`.

### Nomes e restos

- `pyproject.toml`: `name = "repl-nix-workspace"`.
- `psycopg2-binary` declarado; o sistema usa SQLite.
- Rotas `/feeds/lance/rss.xml` e `/feeds/lance/atom.xml` ainda no ar.
- `Procfile` (Heroku) convivendo com `Dockerfile` (EasyPanel).
- 15 arquivos `test_*.py` na raiz, fora de `tests/`.
- Um `.replit` versionado.

### Documentação: 53 arquivos Markdown na raiz

`CHANGELOG.md`, `CHANGELOG_CLUSTERING_V2.md`, `CHANGELOG_SESSOES.md`,
`DOCUMENTACAO.md`, `DOCUMENTACAO_COMPLETA.md`, `DOCUMENTACAO_FEEDS_SUPERFEED.md`,
`SISTEMA_COMPLETO.md`, `SISTEMA_RSSPRIME_DEFINITIVO.md`, `RSSPRIME_DOCS.md`,
`PROJECT_OVERVIEW.md`… Não determinei quais concordam entre si. O padrão
"DEFINITIVO"/"COMPLETA"/"COMPLETO" em três arquivos diferentes é, por si só, um
sinal de que nenhum é a fonte única.

### Comentários mentirosos

Nos 11 arquivos que li, um caso limítrofe: o `# Fixed source URL for security`
de `/admin/refresh` é **verdadeiro sobre a segurança** e **falso sobre o
propósito** — a URL é fixa, mas fixa no alvo errado para o sistema atual.

---

## Tabela de achados

| # | Grav. | Arquivo:linha | Achado | Evidência | Consequência |
| --- | --- | --- | --- | --- | --- |
| R-01 | **ALTO** | `README.md:1` | Descreve o "LANCE! Feed Generator, puramente educativo, não comercial" | leitura | O primeiro documento do repositório descreve outro produto e outra licença de uso |
| R-02 | **ALTO** | `pyproject.toml` × `requirements.txt` | Faltam `google-genai`, `thefuzz`, `unidecode` no pyproject/uv.lock | execução (`ModuleNotFoundError`) | `uv sync` produz instalação quebrada; produção salva-se por usar o outro manifesto |
| R-03 | **ALTO** | `test_superfeed_xml.py:15`, `test_mn26_v2.py` | `SELECT` em nível de módulo aborta a coleta inteira | execução (exit 2) | Suíte não roda em checkout limpo; sem CI, invisível |
| R-04 | **ALTO** | ausência de `.github/workflows` | Sem CI | inspeção | R-02 e R-03 nunca seriam detectados |
| R-05 | **MÉDIO** | painel, serviço `feed` | `mounts: -` — banco em `/app/data/` sem volume declarado | painel | Redeploy pode perder histórico de dedupe/clusters |
| R-06 | **MÉDIO** | `app/server.py:1402` | `/admin/refresh` com URL do LANCE! fixa | código | Endpoint administrativo atualiza a fonte errada |
| R-07 | **MÉDIO** | 55 `.pyc` + 181 `.ndjson` + 36 `.local/` | Artefatos de build, log e IDE versionados | `git ls-files` | Bytecode de 2 versões de Python pode divergir do fonte |
| R-08 | **MÉDIO** | `Dockerfile:17` | `pip install -r requirements.txt` sem lockfile e com `>=` em tudo | código | Builds não reprodutíveis |
| ~~R-09~~ | — | `app/server.py:1486` | **FECHADO na verificação:** a rota TEM `@require_admin`, e o docstring registra que já foi aberta e foi corrigida | código | Sem achado |
| R-10 | **BAIXO** | `pyproject.toml:2` | `name = "repl-nix-workspace"`; `psycopg2-binary` num sistema SQLite | leitura | Identidade e dependência erradas |
| R-11 | **BAIXO** | raiz | 53 Markdown, três deles "DEFINITIVO/COMPLETO/COMPLETA" | `ls` | Sem fonte única de documentação |
| R-12 | **BAIXO** | `app/scheduler.py:868` | MN26 montado no mesmo ciclo do superfeed do Cinerie | código | Compartilha cota e tempo de ciclo com o Cinerie |

---

## O que está morto

- Rotas `/feeds/lance/*` e o scraper do LANCE! como propósito declarado.
- `Procfile` (Heroku) — o deploy é Docker/EasyPanel.
- `.local/` (estado do Replit) e `.replit`.
- `psycopg2-binary` declarado sem uso.
- 55 `.pyc` e 181 `.ndjson`.

## O que mente

1. **O `README.md`** — nome, propósito e cláusula de uso.
2. **O `pyproject.toml`** — declara 15 dependências para um sistema que precisa de 17.
3. **Os dois `test_*.py` da raiz** — têm nome de teste e são script de diagnóstico
   contra banco populado.

---

## O que NÃO determinei — e o comando que fecha

| Item | Comando |
| --- | --- |
| Volume/linhas do banco de produção e se ele persiste entre deploys | Console do `feed`: `sqlite3 /app/data/articles.db ".tables"`, `SELECT count(*) FROM sf_clusters;` e conferir `mounts` |
| Provedor de embeddings | `sed -n '1,60p' superfeed/embedding_client.py` |
| Cadência real do agendador em produção | `TOPIC_DEFINITIONS` em `app/scheduler.py` + logs do serviço |
| Vulnerabilidades de dependência | **TENTEI E FUI BLOQUEADO**: o `pip-audit` é barrado pela política de Controle de Aplicativo desta máquina (`os error 4551`). Fecha rodando `pip-audit -r requirements.txt` noutro ambiente, ou pelo Dependabot |
| Quais dos 53 Markdown ainda são verdade | Leitura dirigida; fora do escopo desta passagem |

---

## Anexo — os 13 arquivos que abri

`README.md` · `PROJECT_OVERVIEW.md` (trechos) · `Dockerfile` ·
`requirements.txt` · `pyproject.toml` · `app/server.py` (trechos: rotas,
`require_admin`, `/admin/refresh`) · `app/utils.py` (trechos:
`validate_admin_key`, `parse_query_filter`) · `app/scheduler.py` (trechos MN26) ·
`superfeed/gemini_usage.py` (trechos de cota) · `superfeed/gemini_config.py`
(trecho de cooldown) · env do serviço `feed` no painel (só nomes + hash)

**Não abri:** os ~30 scrapers por veículo em `app/`, os 27 módulos de
`superfeed/` (só os dois de Gemini), os 34 de `tests/` (rodei os 564), os 23 de
`EXPLICACAO/`, os 53 Markdown da raiz, os 181 `.ndjson` e os 55 `.pyc`.

---

## Acréscimo da FASE 3 — o que a revisão cega do Codex achou aqui

**Este é o repositório onde minha auditoria foi mais fraca, e o número diz por
quê: eu abri 13 arquivos (2,4%), o Codex abriu 29 (5,3%).** Eu fiquei no
perímetro — README, CI, dependências, artefatos versionados. Ele entrou no motor.
Os três achados abaixo são dele, verificados por mim; um é **crítico**.
Verificação completa em [`09-confronto.md`](09-confronto.md) §6.3.

### C-08 · A fila marca `PUBLISHED` sem que ninguém tenha publicado — CRÍTICO

`app/scheduler.py:869-875`:

```python
with open(filepath, "w", encoding="utf-8") as fh:
    json.dump(article, fh, ensure_ascii=False, indent=2)
# Mark as PROCESSING (status=PUBLISHED with wp_post_id=0 acts
# as a "claimed" marker until the real publisher picks it up)
mark_published(cluster_id, wp_post_id=0, db_path=self._db_path)
```

Escrever um arquivo JSON num diretório local marca o cluster como publicado. O
Codex apontou a marcação prematura; **as três consequências abaixo são da minha
verificação**, e são o que torna isto crítico:

**1. Ninguém distingue o marcado do publicado.** Varri `app/` e `superfeed/`
inteiros por qualquer comparação de `wp_post_id` contra `0`/NULL. Só existem as
duas linhas que *atribuem* o valor — e um comentário que admite o problema
(`superfeed/cluster_store.py:605`):
*"…so a published row keeps `wp_post_id=0` forever."* O discriminador existe no
dado e **nenhuma consulta o lê**.

**2. A retenção apaga.**
`app/retention.py:50`:
`TERMINAL_CLUSTER_STATUSES = ("PUBLISHED", "EXPIRED", "MERGED")`, com
`DEFAULT_RETENTION_HOURS = 72.0`. O cluster sai do banco quente em 72 h, tenha
sido consumido ou não. O arquivo da fila também.

**3. A dedup bloqueia a segunda tentativa.** `find_published_by_fact_sig` casa em
`status='PUBLISHED'` na janela de 72 h — um fato "publicado" que nunca chegou a
lugar nenhum **suprime** a próxima tentativa do mesmo fato.

E o fecho: **procurei o consumidor da fila neste repositório e ele não existe.**
As únicas coisas que tocam `superfeed_queue/` depois da escrita são
`queue_dir_usage()` (mede) e o podador da retenção (apaga). O consumidor é o
MN26, externo — e o MN26 está, por decisão do dono, fora da arquitetura da
Cinerie.

> Se o consumidor externo não rodar: o artigo é escrito, marcado como publicado,
> apagado do banco em 72 h, o arquivo é apagado em 72 h, e o fato fica bloqueado
> para nova tentativa. **Perda silenciosa e irrecuperável, sem um único sinal de
> erro.**

### C-07 · O timeout do resolver Gemini não limita tempo de parede — ALTO

`superfeed/v2/gemini_resolver.py:272-274`:

```python
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        response = pool.submit(_call).result(timeout=timeout)
except FutureTimeout:
    return _defer("timeout", topic, size)
```

`.result(timeout=…)` levanta no prazo — **mas a exceção sai do bloco `with`, e
`ThreadPoolExecutor.__exit__` chama `shutdown(wait=True)`.** Python bloqueia até
a thread terminar antes de o `except` executar. Se a chamada travar por 300 s, o
ciclo espera 300 s e só então registra "timeout".

**O controle negativo está neste mesmo repositório**, e é o que torna o achado
indiscutível — `superfeed/embedding_client.py:318-322`
faz a mesma coisa do jeito certo:

```python
executor = ThreadPoolExecutor(max_workers=1)        # sem `with`
future = executor.submit(_call_embedding_api, batch)
try:
    vectors, billable_chars = future.result(timeout=EMBED_TIMEOUT_SECONDS)
except FutureTimeout:
    future.cancel()
    executor.shutdown(wait=False, cancel_futures=True)      # não espera
```

| Arquivo | Linha | Padrão |
| --- | ---: | --- |
| `superfeed/embedding_client.py` | 318 | **correto** |
| `superfeed/v2/gemini_resolver.py` | 273 | **bloqueia** |
| `superfeed/ai_validator.py` | 481 | **bloqueia** |

O autor conhecia o padrão certo — escreveu `wait=False, cancel_futures=True` de
propósito num arquivo. Nos outros dois, o `with` reintroduz a espera em silêncio.

### C-09 · Migração de runtime derruba e reconstrói uma tabela — BAIXO

`superfeed/schema.py:206-233`
executa, com `PRAGMA foreign_keys=OFF`: cria tabela nova, copia tudo,
`DROP TABLE sf_raw_items`, renomeia.

**Devo os atenuantes, senão o achado engana.** É o padrão obrigatório do SQLite
(não existe `ALTER TABLE ... DROP CONSTRAINT`), é guardado por
`_needs_url_migration()`, está entre `BEGIN;`/`COMMIT;`, e o `finally` fecha a
conexão. **O risco real que resta** é o que o Codex acertou: roda no caminho de
**boot da aplicação**, não como passo explícito. Uma base legada grande paga a
cópia inteira na subida, com FKs desligadas, sem ninguém pedir. Recomendação:
mover para comando explícito.
