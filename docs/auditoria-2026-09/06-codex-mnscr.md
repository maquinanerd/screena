<!-- FASE 2 — REVISAO CEGA do Codex (gpt-5.6-terra, reasoning=high), 2026-09-01 ~05:00.
O Codex NAO teve acesso a nenhum relatorio meu: o screena foi revisado num clone limpo de
origin/main sem docs/auditoria-2026-09; os outros tres nao contem a auditoria.
Comando: codex exec --sandbox read-only --skip-git-repo-check -C <repo> - < <prompt>
Texto integral do modelo, sem edicao de conteudo. -->

Cobertura: abri 24 de 297 arquivos versionados (8,1%).

## 5 achados mais graves

1. **Crítico — SSRF: a defesa existe, mas o caminho real a contorna.** `safe_get()` valida destino, redirects e tamanho; porém o pipeline chama `ContentExtractor._fetch_html()`, que usa `requests.Session.get(..., allow_redirects=True)` diretamente.
2. **Alto — o “limite de 10 requisições de IA” conta artigos, não requisições.** Um artigo pode fazer múltiplas chamadas Gemini e retries; o teto anunciado não controla RPM nem custo.
3. **Alto — fila com starvation determinístico.** A ordem fixa de cinco feeds, com teto global 10 e teto por feed 3, deixa `screenrant_tv` com zero capacidade quando os quatro anteriores têm backlog.
4. **Médio/alto — “orçamento por artigo” não limita o escritor principal.** O orçamento só desconta fases pós-escrita; o teste explicitamente confirma esse bypass.
5. **Médio — configuração e código morto criam uma superfície operacional enganosa.** Há variáveis declaradas sem leitor e uma pipeline de três fases inteira sem chamador.

## D1 — estrutura e build

MNScr é um worker Python 3.11 que lê RSS/sitemaps, extrai conteúdo, usa Gemini para gerar drafts e os persiste localmente em SQLite/JSON; opcionalmente solicita entrega ao CMS Cinerie por HTTP. Não encontrei serviço HTTP próprio nos caminhos abertos: a operação é agendada localmente, coerente com o contexto de execução via `.bat`. O build/CI usa `uv`, `pytest`, `ruff` e gera wheel, inclusive testando-o fora do checkout. [MEDIDO-CÓDIGO: `pyproject.toml`, `.github/workflows/ci.yml`]

Dependências relevantes: `requests`, `feedparser`, `trafilatura`, `google-genai`, `apscheduler`, `jsonschema`, `defusedxml` e SQLite da stdlib. [MEDIDO-CÓDIGO: `pyproject.toml`]

## D2 — persistência

Há SQLite local para artigos, eventos RSS Prime, fila, entregas, gate, avaliação factual e publicação Cinerie; foram observados índices para status, eventos, rascunhos e tentativas. [MEDIDO-CÓDIGO: `app/store.py:431-528`, `app/task_queue.py:33-44`]

As migrações observadas são `ALTER TABLE ... ADD COLUMN`, executadas no runtime e sem uma tabela de versão/migração. Não vi remoção de tabela/coluna nos arquivos abertos, mas isso **não determina** a ausência de migrações destrutivas no repositório inteiro. [MEDIDO-CÓDIGO: `app/store.py:107-160`]

`api_key_status.api_key TEXT NOT NULL` aceita segredo em texto puro. Não encontrei leitor ou escritor dessa tabela fora do DDL; hoje parece morta, mas reativá-la preservaria chaves no banco local sem criptografia. [MEDIDO-CÓDIGO: `app/store.py:499-507`; `git grep` só encontrou referências no DDL e script de teste]

## D3 — APIs externas

Entradas externas: RSS Prime e ScreenRant; saídas: Gemini, Payload/Cinerie e resolvedor de catálogo. Segredos são lidos por nomes de ambiente, incluindo `GEMINI_KEY_*`, `MNSCR_PAYLOAD_API_KEY`, `MNSCR_CINERIE_MEDIA_API_KEY`, `MNSCR_CINERIE_CATALOG_RESOLVE_API_KEY` e `PAYLOAD_CMS_TOKEN`; nenhum valor foi inspecionado. [MEDIDO-CÓDIGO: `.env.example`, `app/config.py`]

Gemini identifica 429, penaliza uma chave por 30 segundos e pode tentar até 8 rodadas, percorrendo modelos fallback em erros transitórios. Não há cache de respostas de IA; há cache apenas do template factual e TTL de preflight do Cinerie. [MEDIDO-CÓDIGO: `app/ai_client_gemini.py:306-437`, `app/factual_ai.py:36-38`]

Custo de uma passagem: o modelo principal permite até 32.000 tokens de saída, o validador até 8.192 e a extração factual usa o default de 32.000. Usando a tabela interna de US$1,50/M tokens de saída, somente esses três tetos equivalem a `(32.000 + 8.192 + 32.000) × 1,50 / 1.000.000 = US$0,1083`, **sem** tokens de entrada, expansão, retries ou fallback. É teto teórico parcial, não custo medido. [INFERIDO de `app/ai_processor.py:365-380`, `app/ai_validator.py:395-401`, `app/ai_client_gemini.py:246-255`, `app/policy_engine.py:442-450`]

## D4 — filas e jobs

O scheduler dispara a ingestão a cada 15 minutos. Cada ciclo ingere no máximo 10 itens, no máximo 3 por feed; a fila SQLite usa claim atômico e há recuperação de claims antigos. [MEDIDO-CÓDIGO: `app/entrypoint.py:151-167`, `app/pipeline.py:123-134`, `app/task_queue.py:167-237`]

A volta da fila não é justa: com backlog contínuo, os feeds recebem por ciclo `3 + 3 + 3 + 1 + 0`; logo `screenrant_tv` nunca é alcançado. O tempo para cobrir seu universo é infinito enquanto os anteriores permanecerem cheios. A tabela declara `last_processed_feed_index`, mas o pipeline percorre sempre `PIPELINE_ORDER` desde o início e não lê esse estado. [MEDIDO-CÓDIGO: `app/config.py:25-32`, `app/pipeline.py:3125-3144`, `app/store.py:482-487`, `app/store.py:1022-1040`]

Não encontrei dead-letter queue separada; há estados de falha no artigo. Não há tabela explícita de execuções de ciclo, portanto uma consulta ao SQLite pode provar que artigos foram alterados ontem, mas não provar uma execução vazia do worker ontem. [MEDIDO-CÓDIGO: `app/store.py:461-528`]

## D5 — saída e frontend

Não encontrei rotas ou frontend próprio nos arquivos abertos. A saída local é draft JSON; a saída remota é CMS Cinerie/Payload. Cache de página pública, SEO efetivamente renderizado, estados vazios e acessibilidade pertencem ao CMS remoto e não foram determináveis neste repositório. [MEDIDO-CÓDIGO: `README.md`, `app/pipeline.py:2167-2203`, `app/pipeline.py:2515-2585`]

## D6 — segurança

A maior falha é o bypass de SSRF. `safe_get()` é bem desenhado — bloqueia IP privado, redirects e respostas grandes — e seus testes passam; porém a extração canônica não o chama. O pipeline chama `_fetch_html`; esse método segue redirects com `requests` e não impõe os limites da camada segura. [MEDIDO-CÓDIGO: `app/safe_http.py:108-264`, `app/extractor.py:903-916`, `app/pipeline.py:1326`; [MEDIDO-EXECUÇÃO] `tests/test_safe_http.py` passou]

Isso expõe a máquina do dono a URLs vindas de feeds/fontes e a redirects para loopback, rede privada ou metadata service. O mesmo método também é usado nos caminhos multi-source. [MEDIDO-CÓDIGO: `app/cluster_extractor.py:72`, `app/multi_source_builder.py:200`]

Os clientes Cinerie aceitam qualquer host HTTP/HTTPS configurado e enviam `Authorization`; isso é aceitável somente se o ambiente for integralmente confiável. Não há allowlist nem exigência de HTTPS. [MEDIDO-CÓDIGO: `app/cinerie/client.py:122-151`, `app/cinerie/client.py:169-206`]

Não encontrei listener HTTP próprio, upload recebido, `eval` ou SQL interpolando valores de usuário nos arquivos abertos. Cabeçalhos de segurança de servidor público: **NÃO DETERMINADO**, pois não há servidor público aberto nesta cobertura.

## D7 — testes

Há 139 arquivos sob `tests/` e 1.613 linhas que correspondem a `def test_` ou `class Test`; isso não é contagem exata de casos. [MEDIDO-CÓDIGO: `git ls-files tests`, `git grep`]

Executei `tests/test_safe_http.py`: 30 casos passaram, com exit code 0. [MEDIDO-EXECUÇÃO]

A suíte completa não rodou: `uv` não conseguiu abrir seu cache, e a primeira execução direta de pytest falhou por não haver diretório temporário gravável no sandbox. Ruff com `--no-cache` rodou e reportou dois imports fora de ordem: um em `_debug_gate.py` não versionado e outro em `tests/test_caption_word_glue.py`. [MEDIDO-EXECUÇÃO]

Há um teste que ratifica a falha de orçamento: `test_writer_tokens_do_not_consume_post_writer_budget` afirma que 27.000 tokens do escritor não reduzem o orçamento das fases seguintes. [MEDIDO-CÓDIGO: `tests/test_policy_engine.py:213-221`]

Não determinei cobertura percentual nem se a suíte completa toca produção. Os testes de entrega inspecionados usam servidores loopback, mas isso não prova o restante. [NÃO DETERMINADO]

## D8 — dívida

Comentário mentiroso: `worker_loop()` promete “Max 10 AI requests per cycle”, mas incrementa o contador por `len(articles)`, não por chamadas ao modelo. [MEDIDO-CÓDIGO: `app/pipeline.py:1987-1993`, `app/pipeline.py:2088-2117`]

Código morto: `_run_3phase_batch()` importa e executaria sanitização, rewrite e SEO, mas não tem chamador encontrado; `ai_rewrite.py` e `ai_seo_pack.py` permanecem conectados apenas a essa função morta. [MEDIDO-CÓDIGO: `app/pipeline.py:1051-1103`; `git grep` não encontrou chamada]

Configuração morta ou incompatível: `TMDB_CONFIG`, `pipeline_state.last_processed_feed_index` e o conjunto legado `CINERIE_PUBLICATION_ENABLED`/`CINERIE_BASE_URL`/`CINERIE_API_KEY` estão declarados, mas não têm consumidores no código versionado encontrado. [MEDIDO-CÓDIGO: `app/config.py:663-670`, `app/store.py:482-487`, `.env.example:83-95`]

## Achados por gravidade

| Gravidade | Achado | Arquivo:linha | Evidência | Consequência |
|---|---|---|---|---|
| Crítica | Defesa SSRF não chamada no fluxo real | `app/extractor.py:911`; `app/pipeline.py:1326` | [MEDIDO-CÓDIGO] usa `Session.get(... allow_redirects=True)` | Feed malicioso pode fazer a máquina acessar rede interna/metadata e baixar corpo sem os tetos de `safe_get`. |
| Alta | Limite de IA conta artigos | `app/pipeline.py:2014-2016`, `2088-2115` | [MEDIDO-CÓDIGO] contador sobe por artigo, embora há múltiplos `generate_text` | Estouro de RPM/cota e custo além do teto anunciado. |
| Alta | Starvation do quinto feed | `app/config.py:25-32`; `app/pipeline.py:3125-3144` | [MEDIDO-CÓDIGO] ordem fixa + limites 3/10 | `screenrant_tv` recebe zero slots sob backlog contínuo. |
| Médio/alto | Teste confirma bypass do orçamento principal | `app/policy_engine.py:414-427`; `tests/test_policy_engine.py:213-221` | [MEDIDO-CÓDIGO] escritor não entra em `remaining` | “Orçamento por artigo” não é teto total; custo principal fica fora. |
| Médio | Pipeline de três fases morta | `app/pipeline.py:1051-1103` | [MEDIDO-CÓDIGO] sem chamador encontrado | Código, prompts e manutenção sugerem um comportamento que não ocorre. |
| Médio | Estado de rotação não consumido | `app/store.py:482-487`, `1022-1040` | [MEDIDO-CÓDIGO] DDL/get/set sem uso no pipeline | Indício de justiça planejada, mas inexistente. |
| Médio | Segredo em coluna SQLite | `app/store.py:501-507` | [MEDIDO-CÓDIGO] `api_key TEXT NOT NULL` | Risco latente de segredo em texto claro se a tabela for reativada. |
| Baixa | Lint não está verde no workspace | `tests/test_caption_word_glue.py:17` | [MEDIDO-EXECUÇÃO] Ruff reportou I001 | CI deve falhar enquanto esse arquivo permanecer assim; `_debug_gate.py` é não versionado e fora de escopo. |

## O que está morto

- `_run_3phase_batch()` e, por transitividade operacional, a integração de `ai_sanitize`, `ai_rewrite` e `ai_seo_pack`. [MEDIDO-CÓDIGO: `app/pipeline.py:1051-1103`]
- `pipeline_state.last_processed_feed_index`, salvo no schema mas sem leitor/chamador no pipeline. [MEDIDO-CÓDIGO: `app/store.py:482-487`, `1022-1040`]
- `TMDB_CONFIG` no código aberto. [MEDIDO-CÓDIGO: `app/config.py:663-670`]
- Variáveis legadas Cinerie no exemplo de ambiente, sem consumidor encontrado. [MEDIDO-CÓDIGO: `.env.example:83-95`]

## O que mente

- “Max 10 AI requests per cycle”: mede artigos, não requests. [MEDIDO-CÓDIGO: `app/pipeline.py:1987-1993`, `2088-2115`]
- “Orçamento de tokens por artigo”: o principal consumidor, `main_writer`, não é debitado para decidir as fases subsequentes. [MEDIDO-CÓDIGO: `app/policy_engine.py:369-427`]
- A presença de `safe_http.py` e seus testes sugere proteção completa contra SSRF, mas a extração efetiva continua fora dela. [MEDIDO-CÓDIGO: `app/safe_http.py:202-264`, `app/extractor.py:909-916`]

## O que não determinei + comando que fecha

- Suíte completa e regressões integradas: `uv run python -m pytest -q` em ambiente com cache e temporário graváveis.
- Cobertura percentual: `uv run pytest --cov=app --cov-report=term-missing`.
- Estado real de filas, execução de ontem e starvation observado: `sqlite3 data/app.db "SELECT status, COUNT(*) FROM seen_articles GROUP BY status;"`.
- Se há migração destrutiva fora dos arquivos abertos: `git grep -n -E "DROP TABLE|DROP COLUMN|DELETE FROM|VACUUM" -- app`.
- Se há segredos versionados: `git grep -n -I -E "(AIza|Bearer |api[_-]?key\\s*=|token\\s*=)"`.
- Compatibilidade com CMS Cinerie real: canário autorizado contra uma instância real; os testes vistos usam loopback.

## Três perguntas extras

1. **Defeito mais grave:** o extrator acessa URLs de feeds sem a camada SSRF que o repositório diz possuir.

2. **O que parece funcionar e não funciona:** o limitador de “10 requisições de IA” parece proteger cota, mas na prática permite várias chamadas e retries por artigo.

3. **O que um auditor da Anthropic provavelmente não perceberia:** que a implementação e os testes de `safe_http` são bons, porém protegem uma trilha paralela — não o método `_fetch_html()` efetivamente chamado pelo pipeline.

## O que não abri

Não abri 273 arquivos versionados: a maior parte de `app/cinerie/`, `app/editorial_gate/`, `app/factual/`, `app/contracts/`, stores especializados, delivery adapters, documentos, contratos, prompts e praticamente toda a suíte de testes. Também excluí deliberadamente `_debug_gate.py` e `docs/operations/`, pois estão não versionados.
