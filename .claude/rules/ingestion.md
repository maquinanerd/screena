# Regras de Ingestao — Cinerie

Estas sao as regras operacionais da **ingestao de dados externos** da Cinerie. Valem para
**todos** os servicos/processos offline que consomem qualquer API externa: `services/ingestion`,
`services/ratings`, `services/streaming`, `services/news-ingestion` e `services/sync`.

> **Fonte da verdade.** Em caso de conflito, `CLAUDE.md` (as 13 invariantes) prevalece sobre
> este documento. A governanca de cada fonte (papel, periodicidade, atribuicao, licenca)
> esta detalhada em [`docs/API_SOURCES.md`](../../docs/API_SOURCES.md). Este arquivo define o
> **como** tecnico da ingestao; aquele define o **quem** de cada fonte.

---

## Invariante mestra da ingestao

**Toda API externa e consumida apenas por worker offline — NUNCA no render.**

- No estado atual, TMDB, sync/stale policy e Entity Writer rodam em **TypeScript/Node + Prisma**,
  fora do render e com logs quando ha sincronizacao/persistencia.
- Workers Python **3.12** permanecem como roadmap/shim futuro para ratings, streaming, RSS/news
  e orquestracao por systemd. Nao reimplemente TMDB em Python por causa de documentacao antiga.
- Nenhuma rota publica, RSC, handler de revalidacao ou edge function abre conexao com API
  externa. Paginas indexaveis leem **exclusivamente PostgreSQL/cache local** (`api_cache`).
- Isto reforca a **Invariante 3 — Zero API externa no render** e a
  **Invariante 4 — Zero Gemini no render**. Qualquer chamada externa que apareca no caminho
  de render e bug critico, nao otimizacao.

---

## Fluxo canonico: bruto -> normalizado

Toda ingestao segue o mesmo pipeline em duas camadas, sempre nesta ordem:

1. **Cache bruto.** A resposta crua do `provider_api` e gravada em **`api_cache`**, sem
   transformacao, com a chave de requisicao (fonte, endpoint, params) e o `payload_hash`.
   Esta e a camada que o sistema reusa para evitar refetch; o render **so** le daqui ou das
   tabelas finais — nunca da API ao vivo.
2. **Dados normalizados.** A partir do bruto, o worker normaliza e persiste nas **tabelas
   finais** canonicas:
   - Entidades/midia/mapeamento: `movies`, `tv_shows`, `seasons`, `episodes`, `people`,
     `cast_members`, `crew_members`, `franchises`, `images`, `trailers`,
     `entity_external_ids`, `slugs`, `redirects`.
   - Ratings: `external_ratings` (com `rating_source` editorial separado de `provider_api`).
   - Onde assistir: `watch_availability`, `platforms`, `providers`.
   - Noticias: `articles`, `article_translations`, `entity_news_links`, `news_clusters`.

No estado atual, o slice ativo cobre principalmente TMDB/catalogo, sync/stale policy e
Entity Writer offline em TypeScript/Node. Ratings externos, streaming/onde assistir e
RSSPRIME/MN26 continuam como roadmap/produto inativo ate escopo e revisao humana explicitos;
as tabelas/regras acima sao contrato de governanca, nao autorizacao para ativar feature.

Regras do fluxo:

- O bruto **nunca** vai direto para pagina indexavel; so o normalizado e elegivel (e ainda
  assim sujeito a licenca, ao idioma publicado e a validade tecnica — ver invariante 5,
  indexacao total, e invariante 6).
- A normalizacao **nao inventa fatos**: persiste apenas o que o upstream retornou, com origem
  rastreavel (**Invariante 12** em espirito — a ingestao tambem nao cria entidades nem
  fabrica dados).
- `provider_api != rating_source` (**Invariante 2**): quando a resposta tecnica trouxer uma
  nota, reatribua a nota a sua **fonte editorial real** em `rating_source` e grave o
  fornecedor tecnico separadamente em `provider_api` + `provider_payload_hash`. Os dois
  campos **nunca** colapsam.

---

## Log obrigatorio: todo sync gera log

**Todo sync externo gera log em `api_sync_logs`.** Sem excecao — sucesso, falha, vazio ou
abortado pelo circuit breaker, tudo e registrado. Cada log deve conter, no minimo:

- fonte (`provider_api`) e endpoint;
- status (sucesso/falha/parcial) e codigo de erro quando aplicavel;
- contagem de itens processados/criados/atualizados;
- duracao da chamada;
- custo de cota consumido (quando o provider expoe);
- `payload_hash` da resposta;
- timestamp.

Um sync sem log correspondente e considerado falha de auditoria. Logs sao a base para
detectar degradacao de upstream, abuso de cota e regressao de dados.

---

## Resiliencia obrigatoria de todo cliente

Todo cliente de API externa **deve** implementar os cinco mecanismos abaixo. Nenhum e
opcional.

### 1. Retry com backoff exponencial
- Reexecutar apenas falhas **transitorias** (timeouts, 5xx, 429 com `Retry-After`, erros de
  rede). Erros permanentes (4xx de validacao, 401/403) **nao** sao retentados.
- Backoff **exponencial** com teto, mais **jitter** para evitar thundering herd.
- Numero maximo de tentativas finito; ao esgotar, falha e registra em `api_sync_logs` e
  conta para o circuit breaker.

### 2. Rate limit por provider
- Cada `provider_api` tem seu proprio orcamento de requisicoes/cota, **isolado** dos demais.
- O worker respeita o limite do fornecedor tecnico antes de disparar a chamada (throttle
  local), nunca confiando apenas no 429 do upstream.
- Estourar cota de um provider **nao** pode bloquear os outros.

### 3. Circuit breaker por API
- Um breaker **por API/fonte**. Apos N falhas consecutivas, o breaker **abre** e suspende
  novas chamadas aquela fonte por uma janela de cooldown.
- Em estado aberto, o worker **degrada graciosamente**: serve do `api_cache`/tabelas finais
  e marca a fonte como degradada no log; nunca cai para chamada no render.
- Apos o cooldown, entra em **half-open** (uma chamada de prova) antes de fechar de novo.

### 4. Cache local
- Respostas em `api_cache` para evitar refetch desnecessario.
- O render le **so** do cache/tabelas finais; o worker consulta o cache antes de gastar cota.

### 5. Hash de payload (evitar update sem mudanca)
- Calcular o **hash do payload** bruto de cada resposta.
- Se o hash for **igual** ao ultimo armazenado para aquela chave, **nao** reescrever a tabela
  final nem bumpar `updated_at` — apenas atualizar o carimbo de verificacao
  (`last_synced_at`) e logar "sem mudanca".
- Para ratings, esse hash e persistido em `provider_payload_hash` de `external_ratings`,
  garantindo rastreio do byte original e evitando reprocessamento downstream
  (ratings/streaming/entity-writer) quando nada mudou.

---

## Frescor: `last_synced_at` e `stale_after`

Todo registro sincronizado carrega controle de frescor:

- **`last_synced_at`** — timestamp do ultimo sync **confiavel** daquele registro. Atualizado
  mesmo quando o payload nao mudou (so confirma que foi verificado).
- **`stale_after`** — janela apos a qual o dado e considerado **stale** e elegivel para
  re-sync. Derivada das periodicidades abaixo.
- Quando `now > last_synced_at + stale_after`, o agendador prioriza aquele registro para
  refresh. Dados stale podem ser marcados em `page_indexability_decisions` como `stale`
  conforme a regra de SEO.
- Superficies de "onde assistir" exibem sempre um carimbo **"Atualizado em"** com base em
  `last_synced_at` (o usuario ve a data do ultimo sync confiavel).

---

## Periodicidades de sincronizacao

Janelas-alvo por tipo de dado (alimentam `stale_after`). Janelas escalonadas por entidade
para diluir carga e cota:

| Conjunto de dados | Frequencia-alvo |
| --- | --- |
| Detalhe de **filme** / **serie** (metadados estaveis) | a cada **7–14 dias** |
| **Lancamentos** (titulos recem-lancados/em estreia) | **diario** |
| **Ratings populares** (notas de titulos de alta demanda) | a cada **12–24 h** |
| **Onde assistir** (disponibilidade por pais) | **diario** |
| **Trending** (sinal volatil de popularidade) | a cada **6–12 h** |
| **Trailers / imagens** (midia de catalogo) | a cada **7 dias** |

Notas:
- "Populares/lancamentos/trending" tem janela curta por serem volateis; o **catalogo geral**
  segue a janela de 7–14 dias.
- As frequencias sao **alvos**; o circuit breaker e o rate limit podem adiar um ciclo sem
  violar a regra (o atraso e logado, nao mascarado).

---

## Descoberta de IDs: Daily ID Exports + incremental via `/changes`

A **descoberta** (saber o universo de entidades que existem, de forma barata, sem varrer a
API) usa os **Daily ID Exports** do TMDB. Implementacao: core puro em
`services/ingestion/src/discovery/*` + CLI offline `services/ingestion/bin/discover-ids.ts`.

- **Fonte:** `https://files.tmdb.org/p/exports/` — arquivos `[type]_ids_MM_DD_YYYY.json.gz`,
  1 objeto JSON por linha (JSONL gzip). Publicados **diariamente** (job comeca ~07:00 UTC,
  disponiveis ~08:00 UTC) e **retidos ~3 meses**.
- **Periodicidade-alvo da descoberta:** **diaria** (snapshot completo do universo de IDs);
  serve de fila de entrada para o sync raw (P0-00d). Sao arquivos publicos — **sem token
  TMDB e sem custo de cota** —, mas a execucao continua worker-only e **gera log** em
  `api_sync_logs` (regra "todo sync externo gera log").
- **7 exports padrao consumidos:** `movie_ids`, `tv_series_ids`, `person_ids`,
  `collection_ids`, `tv_network_ids`, `keyword_ids`, `production_company_ids`.
- **Incremental via `/changes`:** para manter a fila fresca sem rebaixar o export inteiro,
  o TMDB expoe `/movie/changes`, `/tv/changes` e `/person/changes` (janela default ~24h,
  **maximo 14 dias**). No P0-00c isso e apenas **contrato** (`planChangesRequests`), nao
  executado; o sync raw incremental e P0-00d.

### Exclusao de conteudo adulto (2 camadas, obrigatoria)

A descoberta **nunca** enfileira conteudo adulto:

1. **Arquivos `adult_*` nunca sao baixados.** O TMDB publica `adult_movie_ids`,
   `adult_tv_series_ids` e `adult_person_ids` — a descoberta ignora esses arquivos por
   completo (so os 7 padrao entram).
2. **Campo `adult` classificado FAIL-CLOSED por linha, por tipo.** `adult === false` e seguro.
   `adult === true` e descartado como adulto. Qualquer valor presente porem **malformado**
   (`"true"`, `1`, `null`, objeto...) e descartado como **unsafe** — nunca presumido seguro. A
   **ausencia** do campo depende do tipo: em exports que NAO trazem `adult`
   (collection/network/company/keyword) e segura; em exports que DEVERIAM traze-lo
   (**movie/person**) a ausencia e tratada como **unsafe** (anomalia, ex.: linha truncada) —
   `hasAdultField` no catalogo de exports controla isso. So confiamos num booleano de verdade
   quando o export o fornece.

Falhar em qualquer uma das camadas deixa conteudo adulto entrar no catalogo — e o ponto mais
sensivel da descoberta e deve ser coberto por teste.

---

## Seguranca de chaves

- **API keys e segredos so em variaveis de ambiente.** Nunca no frontend, nunca no bundle,
  nunca commitados, nunca em codigo cliente.
- Para TMDB, use `TMDB_READ_ACCESS_TOKEN` (v4) como credencial preferencial e
  `TMDB_API_KEY` (v3) apenas quando o cliente suportar fallback. `SCREENA_TMDB_API_KEY`
  e nome legado e nao deve ser apresentado como variavel canonica nova.
- Como toda chamada externa e **worker-only**, a chave nunca precisa atravessar para o
  ambiente de render. Se uma chave aparecer no caminho do frontend, e vazamento — bloquear.

---

## Higiene legal e anti-pirataria

- **Sem pirataria, sem excecao.** Nenhuma fonte que retorne **torrent, IPTV, player ilegal,
  link de download ou embed pirata** entra na ingestao. Detectou? Descarte imediato e
  definitivo da fonte; apenas metadados e ofertas/links **legais** sao ingeridos.
- **Sem licenca clara, nao aparece** (**Invariante 6**). Dados com
  `source_licenses.license_status` em `unknown`/`blocked`, ou com `display_allowed=false`,
  sao persistidos para auditoria mas **nunca** promovidos a pagina indexavel.
- **pt-BR primeiro** (**Invariante 7**). Conteudo derivado em en/es nasce em
  `draft`/`noindex` ate revisao humana.
- Fontes recusadas/adiadas devem ser registradas com o motivo (ver "APIs a descartar/adiar"
  em `docs/API_SOURCES.md`), para evitar retrabalho de avaliacao.

---

## Checklist operacional de ingestao

Antes de promover qualquer dado externo a tabela final / pagina indexavel, o worker garante:

1. Consumo **offline** por servico/processo fora do render — hoje TS/Node + Prisma para TMDB/sync/Entity Writer; Python 3.12 apenas roadmap/shim (Invariantes 3 e 4).
2. **API key so em env var**; nenhum segredo no frontend.
3. Resposta crua em **`api_cache`**; dados normalizados nas **tabelas finais**.
4. **Log** da chamada em **`api_sync_logs`** (status, contagem, duracao, cota, hash).
5. **Retry com backoff exponencial + jitter**, **rate limit por provider** e
   **circuit breaker por API** ativos.
6. **Hash de payload** comparado: sem mudanca, nao reescreve nem bumpa `updated_at` — so
   atualiza `last_synced_at`.
7. `last_synced_at` e `stale_after` preenchidos conforme as periodicidades.
8. `provider_api` e `rating_source` gravados **separados** (Invariante 2); nota reatribuida a
   fonte editorial real na escala correta (imdb=10, rotten_tomatoes=100, metacritic=100,
   letterboxd=5, filmaffinity=10) — Invariante 1.
9. `source_licenses` checada (Invariante 6); atribuicao/linkback quando exigido.
10. **Zero** conteudo pirata; "onde assistir" com carimbo **"Atualizado em"**.
