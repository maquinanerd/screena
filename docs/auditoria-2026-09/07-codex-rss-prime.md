<!-- FASE 2 — REVISAO CEGA do Codex (gpt-5.6-terra, reasoning=high), 2026-09-01 ~05:00.
O Codex NAO teve acesso a nenhum relatorio meu: o screena foi revisado num clone limpo de
origin/main sem docs/auditoria-2026-09; os outros tres nao contem a auditoria.
Comando: codex exec --sandbox read-only --skip-git-repo-check -C <repo> - < <prompt>
Texto integral do modelo, sem edicao de conteudo. -->

Cobertura: abri 29 de 543 arquivos versionados (5,3%).

## 5 achados mais graves

1. **Crítico — a fila marca como `PUBLISHED` antes de haver confirmação do consumidor.** Escrever um JSON local é tratado como publicação; falha/perda do consumidor torna a entrega irrecuperável e a retenção a apaga depois. [MEDIDO-CÓDIGO]

2. **Alto — a defesa contra descarte de artigos existe, mas em produção padrão apenas registra o defeito.** Em `SUPERFEED_VALIDATOR=log`, o XML fica idêntico ao modo `off`; artigos elegíveis suprimidos pela deduplicação semântica seguem ausentes. [MEDIDO-CÓDIGO] [DOC]

3. **Alto — o “timeout” do resolver Gemini pode bloquear o ciclo inteiro.** O `FutureTimeout` ocorre dentro de um `with ThreadPoolExecutor`; ao sair do bloco, Python espera a thread terminar. [MEDIDO-CÓDIGO]

4. **Alto — V2 ainda pode consolidar fatos distintos e fixar uma identidade errada.** O resolver só recebe componentes ambíguos; os over-merges conhecidos passam pelo caminho determinístico e o `event_key` persistido não dispõe de split automático. [MEDIDO-CÓDIGO] [DOC]

5. **Médio — uma migração executada em runtime reconstrói e derruba uma tabela.** Ela desliga FKs, cria cópia, executa `DROP TABLE sf_raw_items` e renomeia; é uma operação material em toda base legada que ainda precise da migração. [MEDIDO-CÓDIGO]

## D1 — estrutura e build

RSSPRIME é um agregador Flask que coleta RSS, grava snapshots em SQLite, agrupa eventos e emite feeds RSS enriquecidos. O scheduler executa a coleta e chama o Superfeed; o V2 mantém um ledger persistente e pode usar Gemini para embeddings/resolução. A publicação web é Gunicorn, com um worker e quatro threads.

- Build: `Dockerfile` usa `python:3.11-slim`, instala `requirements.txt` e inicia `gunicorn main:app --workers 1 --threads 4 --bind 0.0.0.0:${PORT}`. [MEDIDO-CÓDIGO] `Dockerfile:1-24`
- Deploy operacional por `git pull origin main` no VPS e botão Deploy do EasyPanel. [DOC] `AGENTS.md`
- Não há arquivos de CI versionados. [MEDIDO-CÓDIGO]
- Dependências não estão alinhadas: `app/store.py` importa `pytz`, mas ele não está declarado diretamente em `requirements.txt` nem em `pyproject.toml`. A imagem pode hoje funcionar por dependência transitiva, mas o build não é reprodutível por contrato. [INFERIDO] `app/store.py:4`
- `pyproject.toml` também omite dependências presentes em `requirements.txt`, incluindo `google-genai`, `thefuzz` e `unidecode`. O Docker usa `requirements.txt`, portanto esse manifesto é o efetivo. [MEDIDO-CÓDIGO] `Dockerfile:12-14`

## D2 — persistência

- Banco: SQLite em `DATABASE_PATH`, com default `/app/data/articles.db`; a função cria o diretório ao resolver o caminho. [MEDIDO-CÓDIGO] `app/db_config.py:6-14`
- Tabelas principais: `articles`, `feeds`, `processed_topics`, `app_metadata`; Superfeed legado: `sf_clusters`, `sf_raw_items`, `sf_embeddings`; V2: `sf_articles`, `sf_events`, `sf_event_members` e telemetria shadow. [MEDIDO-CÓDIGO] `app/store.py:713-743`, `superfeed/schema.py:19-66`, `superfeed/v2/schema.py:47-151`
- Há vários `DEFAULT` que escondem ausência de dado: por exemplo `sf_events.event_type='unknown'`, `source_count=0`, `public_hash=''`; `sf_articles` aceita texto, URL e source vazios. Isso torna dados incompletos sintaticamente válidos. [MEDIDO-CÓDIGO] `superfeed/v2/schema.py:49-88`
- Índices existem para os caminhos V2 mais evidentes, incluindo tópico/data, tópico/status e membros por URL. [MEDIDO-CÓDIGO] `superfeed/v2/schema.py:154-175`
- A migração legada de `sf_raw_items` é destrutiva em forma: desliga FKs e usa `DROP TABLE`, embora esteja dentro de `BEGIN`. Não encontrei backup, checkpoint prévio ou teste contra uma cópia real da produção. [MEDIDO-CÓDIGO] `superfeed/schema.py:185-239`
- **NÃO DETERMINADO:** quais colunas nunca são escritas na base real, pois o banco de produção não está disponível localmente. Fechar com: `python -c "import sqlite3; c=sqlite3.connect('/app/data/articles.db'); print(c.execute(\"SELECT sql FROM sqlite_master WHERE type='table'\").fetchall())"` no container.

## D3 — APIs externas

- Chave: apenas `GEMINI_API_KEY`. Modelos/configuração: `GEMINI_MODEL`, `EMBED_MODEL`, `EMBED_DIM`, `EMBED_BATCH_SIZE`. [MEDIDO-CÓDIGO] `superfeed/gemini_config.py:92-116`, `superfeed/embedding_client.py:26-30`
- O primeiro erro reconhecido como 429/`RESOURCE_EXHAUSTED` abre breaker global; o cooldown padrão é 1.800 s. Não há retry automático: o sistema cai para clustering lexical/determinístico. [MEDIDO-CÓDIGO] `superfeed/gemini_usage.py:344-410`, `superfeed/embedding_client.py:339-357`
- Há cache por URL canônica/source em `sf_embeddings`; o V2 tenta cache antes de chamar a API. [MEDIDO-CÓDIGO] `app/store.py:231-316`, `superfeed/v2/engine.py:139-192`
- Limites diários são todos opt-in: default `0` significa “sem limite configurado”. [MEDIDO-CÓDIGO] `superfeed/gemini_config.py:127-145`
- Custo de uma passagem, sem volume de entrada não pode ser numérico. A conta implementada é:

  `USD = 0,15 × tokens_embedding/1e6 + 0,10 × tokens_entrada_resolver/1e6 + 0,40 × (tokens_saida + thoughts)/1e6`

  Os preços versionados são projeções, não cobrança observada. [MEDIDO-CÓDIGO] `config/gemini_pricing.json`, `superfeed/gemini_usage.py:442-477`

- **NÃO DETERMINADO:** custo real de produção. Fechar com consulta a `sf_gemini_usage_daily` e `sf_gemini_usage` no banco de produção.

## D4 — filas e jobs

- A coleta é agendada a cada 30 minutos; todos os tópicos são processados serialmente. Há `max_instances=1`, portanto uma execução longa bloqueia a próxima. [MEDIDO-CÓDIGO] `app/scheduler.py:485-493`, `app/scheduler.py:689-731`
- Não existe teto de quantidade/tamanho da fila `superfeed_queue`; só retenção por idade de 72 h. Não há dead-letter, ACK do consumidor, lock de arquivo ou tentativa de reentrega. [MEDIDO-CÓDIGO] `app/scheduler.py:825-886`, `app/retention.py:347-378`
- O fluxo escreve `superfeed_*.json` e imediatamente faz `mark_published(..., wp_post_id=0)`. Esse `0` funciona como claim interno, não confirmação do WordPress/MN. [MEDIDO-CÓDIGO] `app/scheduler.py:868-875`
- A volta completa é **NÃO DETERMINADA**: depende do tempo de scraping e do número efetivo de fontes após cache; não há histórico durável por tópico/ciclo. O código só persiste `last_sync_at` ao fim de uma rodada completa. [MEDIDO-CÓDIGO] `app/scheduler.py:701-719`
- Para provar se rodou ontem, use:

  `python -c "import sqlite3; c=sqlite3.connect('/app/data/articles.db'); print(c.execute(\"SELECT key,value FROM app_metadata WHERE key='last_sync_at'\").fetchall()); print(c.execute('SELECT topic_name,updated_at FROM processed_topics ORDER BY updated_at').fetchall())"`

  Isso prova snapshot atualizado, não que cada fonte foi buscada com sucesso.

## D5 — saída e frontend

- Rotas públicas: homepage, feeds por fonte/tópico, Superfeed por tópico e `/health`; rotas administrativas e logs têm guard de admin. [MEDIDO-CÓDIGO] `app/server.py:237-255`, `app/server.py:298-369`, `app/server.py:1156-1487`
- Cache: feeds comuns têm 15 min; Superfeed tem 5 min. [MEDIDO-CÓDIGO] `app/server.py:334`, `app/server.py:431`, `app/server.py:1143`
- Superfeed desabilitado por escopo devolve RSS vazio e válido; feed de tópico processado ausente devolve 404. [MEDIDO-CÓDIGO] `app/server.py:400-431`, `app/server.py:309-313`
- Há estrutura básica acessível (`lang`, viewport, `main`, `tablist`), mas não há meta description, robots, sitemap, CSP ou SRI nos recursos CDN. [MEDIDO-CÓDIGO] `templates/index.html:2-9`, `templates/index.html:636-721`
- A homepage depende de Bootstrap, Font Awesome e Google Fonts externos. [MEDIDO-CÓDIGO] `templates/index.html:7-9`

## D6 — segurança

- `ADMIN_KEY` é exigida em `/admin/*`, `/debug/superfeed/*` e logs; sem chave configurada, o guard falha fechado com 403. [MEDIDO-CÓDIGO] `app/server.py:180-200`, `app/server.py:1393-1487`
- A chave é aceita por `Authorization: Bearer` ou `X-Admin-Key`, e não por query string. [MEDIDO-CÓDIGO] `app/server.py:148-158`
- `/health` é público e revela contagem de itens, último refresh e estado do scheduler. [MEDIDO-CÓDIGO] `app/server.py:1373-1391`
- Não encontrei `eval`, `exec`, `pickle`, upload, `send_file`, shell execution ou URL diretamente controlada por request na varredura Python. Isso reduz, mas não prova ausência, de RCE/SSRF. [MEDIDO-CÓDIGO]
- Não há cabeçalhos de defesa aplicados pela aplicação (`CSP`, `HSTS`, `X-Content-Type-Options`, `frame-ancestors`). [MEDIDO-CÓDIGO] `app/server.py:1-1634`
- **NÃO DETERMINADO:** proteção provida pelo proxy/EasyPanel. Fechar com `curl -I https://rss.thepeg.site/`.

## D7 — testes

- Encontrei 52 arquivos correspondendo ao padrão amplo de testes/fixtures/scripts; o número exato de casos é **NÃO DETERMINADO**. [MEDIDO-CÓDIGO]
- `pytest -q` não executou: `pytest` não está instalado. `python -m pytest --collect-only -q` também falhou: `No module named pytest`. [MEDIDO-EXECUÇÃO]
- Não há configuração de cobertura em `pyproject.toml`; cobertura percentual não foi determinada. [MEDIDO-CÓDIGO] `pyproject.toml`
- `compileall` não produziu conclusão sobre sintaxe: tentou criar `.pyc` e o ambiente somente leitura negou as escritas. Isso não é falha do código. [MEDIDO-EXECUÇÃO]
- Teste que ratifica o defeito: `test_log_mode_renders_the_same_xml_as_off` afirma explicitamente que `log == off`; assim, o modo default não aplica a defesa que detecta. [MEDIDO-CÓDIGO] `tests/test_superfeed_output_validator.py:803-811`
- Outro teste chama “PUBLISHED” ao estado obtido apenas após gravar a fila JSON, sem simular confirmação do consumidor. [MEDIDO-CÓDIGO] `tests/test_gemini_shadow_pipeline.py:262-266`
- Os testes de retenção usam `tmp_path`, não produção. [MEDIDO-CÓDIGO] `tests/test_retention.py:1-5`

## D8 — dívida

- Comentário mentiroso: a documentação de retenção diz que clusters `READY` “nunca” são apagados automaticamente, mas o código os arquiva e remove após o limite. [MEDIDO-CÓDIGO] `app/retention.py:19-20`, `app/retention.py:514-580`
- Comentário mentiroso: o resolver diz “never blocks a cycle”, mas usa o padrão de executor que aguarda o término da thread ao sair do `with`. [MEDIDO-CÓDIGO] `superfeed/v2/gemini_resolver.py:222-227`, `superfeed/v2/gemini_resolver.py:272-282`
- Comentário condicional apresentado como absoluto: o renderer afirma que o validator “puts back” artigos elegíveis, mas isso só ocorre em `enforce`; em `log` apenas mede. [MEDIDO-CÓDIGO] `app/server.py:597-605`, `app/server.py:925-938`
- Código/configuração morta: `EMBED_BATCH_SIZE` é inicializado no cliente com default 64, porém o batching efetivo consulta `gemini_config.embedding_batch_size()`, cujo default é 32. Alterar a constante em testes não altera o caminho real. [MEDIDO-CÓDIGO] `superfeed/embedding_client.py:29`, `superfeed/embedding_client.py:123-130`, `superfeed/gemini_config.py:108-116`
- Há 55 `.pyc` e 181 `.ndjson` versionados: artefatos binários/logs tornam revisão e diffs menos confiáveis. [MEDIDO-CÓDIGO]

## Tabela de achados

| Gravidade | Achado | Arquivo:linha | Evidência | Consequência |
|---|---|---|---|---|
| Crítica | Estado publicado sem ACK | `app/scheduler.py:868-875` | [MEDIDO-CÓDIGO] JSON local → `mark_published(..., 0)` | Perda silenciosa e não reentrega |
| Alta | Defesa de perda em modo observação | `app/server.py:927-938`; `tests/test_superfeed_output_validator.py:803-811` | [MEDIDO-CÓDIGO] `log` não altera XML; teste afirma igualdade com `off` | Artigo elegível pode sumir |
| Alta | Timeout que espera a chamada | `superfeed/v2/gemini_resolver.py:272-282` | [MEDIDO-CÓDIGO] executor context manager | Ciclo/scheduler pode travar |
| Alta | Over-merge sem split | `superfeed/v2/engine.py:377-402` | [MEDIDO-CÓDIGO] resolver só recebe ambíguos; [DOC] casos reais não são ambíguos | Evento/GUID errado se perpetua |
| Média | Migração runtime destrutiva | `superfeed/schema.py:199-239` | [MEDIDO-CÓDIGO] FKs off e `DROP TABLE` | Risco operacional durante upgrade |
| Média | Segurança de browser ausente | `templates/index.html:7-9`; `app/server.py:1-1634` | [MEDIDO-CÓDIGO] CDN sem SRI; sem headers defensivos | Maior superfície para injeção/embedding |
| Média | Dependência direta não declarada | `app/store.py:4` | [INFERIDO] `pytz` não está nos manifestos | Build dependente de transitividade |
| Baixa | Constante de batch inoperante | `superfeed/embedding_client.py:29,123` | [MEDIDO-CÓDIGO] valor não é consultado | Operação/configuração enganosa |

## O que está morto

- A constante `superfeed.embedding_client.EMBED_BATCH_SIZE` não governa lotes reais.
- `app/main.py` é uma entrada alternativa que não é usada por Dockerfile nem Procfile; pode ser útil manualmente, mas não pertence ao caminho de deploy. [INFERIDO] `app/main.py:8-21`
- Os 55 `.pyc` e 181 logs versionados não participam do build fonte e são dívida de repositório. [MEDIDO-CÓDIGO]

## O que mente

- “READY nunca apagado automaticamente”: falso. `app/retention.py:19-20`
- “Resolver nunca bloqueia ciclo”: falso em caso de chamada pendurada. `superfeed/v2/gemini_resolver.py:227,272-274`
- “Validator põe de volta artigo elegível”: falso em `log`, que é o modo documentado como atual em produção. `app/server.py:597-605,925-938`
- “PUBLISHED” no teste de pipeline significa somente “arquivo local escrito e registro claimed”, não publicação confirmada. `tests/test_gemini_shadow_pipeline.py:262-266`

## O que não determinei

- Resultado da suíte, quantidade exata de testes e cobertura: o ambiente não possui pytest.  
  Comando: `python -m pip install -r requirements.txt pytest && python -m pytest -q`

- Custo Gemini real e uso de cota: requer o banco de produção.  
  Comando: `python -c "import sqlite3; c=sqlite3.connect('/app/data/articles.db'); print(c.execute('SELECT * FROM sf_gemini_usage_daily ORDER BY day DESC LIMIT 7').fetchall())"`

- Quantas entregas ficaram falsamente `PUBLISHED` com `wp_post_id=0`: requer produção.  
  Comando: `python -c "import sqlite3; c=sqlite3.connect('/app/data/articles.db'); print(c.execute(\"SELECT status,wp_post_id,COUNT(*) FROM sf_clusters GROUP BY status,wp_post_id\").fetchall())"`

- Tempo real de uma volta completa e cobertura efetiva de fontes: requer logs/produção.  
  Comando: `rg 'Feed aggregation completed|SUPERFEED_ENGINE_START' logs/`

- Cabeçalhos realmente aplicados pelo proxy.  
  Comando: `curl -I https://rss.thepeg.site/`

## Três perguntas extras

1. **Defeito mais grave:** o sistema registra uma notícia como publicada ao apenas gravá-la em disco local, portanto uma entrega pode desaparecer definitivamente sem jamais ter sido consumida.

2. **O que parece funcionar e não funciona?** O output validator parece garantir que “nada se perde”, mas no modo `log` ele deliberadamente não repara o feed; o teste confirma que seu resultado é o mesmo de desligá-lo.

3. **O que um auditor da Anthropic provavelmente não perceberia?** Que `wp_post_id=0` é semanticamente um “claim de arquivo”, mas o código, logs e testes o chamam de `PUBLISHED`; isso mascara a ausência de um protocolo de entrega com ACK.

## O que não abri

Não abri integralmente os scrapers individuais, os 181 logs versionados, os 55 `.pyc`, fixtures de produção antigas, relatórios históricos, configurações completas de todas as fontes, ferramentas de manutenção e a maior parte dos testes.
