# FASE 3 — Confronto: a minha auditoria contra a revisão cega do Codex

> Este documento existe para responder a uma pergunta que uma auditoria feita por
> um só agente não consegue responder: **o que eu não vi?**
>
> A resposta, medida: **doze achados**, e dois deles em lugares onde eu tinha
> escrito que estava tudo bem.

---

## 1. Como o Codex foi cegado — e por que isso importa

A ordem do dono foi explícita: *"revisão adversarial cega dos mesmos repositórios,
SEM ler meus relatórios"*, e rodar uma segunda passada minha chamando de "Codex"
seria **fraude de método**.

O que garantiu a cegueira, verificável:

| Garantia | Como foi feita |
| --- | --- |
| Processo separado | `codex exec --sandbox read-only --skip-git-repo-check -C <repo>` — binário externo, sessão própria, modelo `gpt-5.6-terra` |
| Sem acesso aos meus textos | O `-C` apontou para a raiz de **cada repositório auditado**, nunca para o worktree onde `docs/auditoria-2026-09/` vive |
| Sem contaminação pelo enunciado | O prompt entregue ao Codex tinha as 8 dimensões e as regras de honestidade, **e nenhum achado meu** |
| Sem rede | `--sandbox read-only` |
| Ordem invertida | Os relatórios do Codex chegaram ao disco **depois** de `01-` a `04-` estarem escritos e commitados — o histórico do git prova a ordem |

Os quatro relatórios estão em `05-codex-screena.md`, `06-codex-mnscr.md`,
`07-codex-rss-prime.md` e `08-codex-kal-el.md`, como o Codex os escreveu, sem
edição minha de conteúdo.

**Uma correção de método, registrada.** A primeira tentativa das quatro revisões
**queimou 799.324 tokens explorando e não escreveu uma linha de relatório**. A
culpa foi do meu enunciado, que não pôs teto de exploração. Reescrevi os prompts
com *"no máximo ~35 chamadas de ferramenta; depois disso, PARE de explorar e
ESCREVA"*, e a segunda tentativa produziu os quatro relatórios em 25–32 chamadas
cada. O custo do meu erro está declarado porque ele mudou o resultado: um teto de
exploração é o que transformou zero relatórios em quatro.

---

## 2. A assimetria estrutural — o que cada um podia ver

Isto não é desculpa; é o mapa que explica **por que** os baldes ficaram como
ficaram. Sem ele, o leitor não sabe interpretar um achado exclusivo.

| Superfície | Eu | Codex |
| --- | :---: | :---: |
| Código-fonte dos 4 repositórios | sim | sim |
| **PostgreSQL de produção** (28 consultas) | **sim** | não |
| **Site em produção** (navegador, JSON-LD, contraste, sitemap) | **sim** | não |
| **Painel EasyPanel** (8 serviços, logs, variáveis) | **sim** | não |
| Executar a suíte de testes | sim | não (read-only) |
| `pnpm audit` / dependências resolvidas | sim | não |
| **Tempo por repositório** | dividido entre 4 repos + banco + site + concorrência + design | **um repositório inteiro por sessão** |

As duas linhas em negrito de cima explicam **todo** o balde "só Claude": nenhum
achado meu que dependa de número de produção era alcançável pelo Codex. E a
última linha explica **todo** o balde "só Codex": ele leu um repositório por vez,
com atenção inteira, enquanto eu atravessava quatro.

---

## 3. Cobertura declarada — e a correlação que ela denuncia

| Repositório | Eu abri | Codex abriu | Versionados | Achados exclusivos do Codex |
| --- | ---: | ---: | ---: | ---: |
| screena | 33 (1,5%) | 47 (2,2%) | 2.174 | 3 |
| MNScr | 20 (6,7%) | 24 (8,1%) | 297 | 2 |
| **RSS Prime** | **13 (2,4%)** | **29 (5,3%)** | 543 | **3** |
| **kal-el** | **14 (2,6%)** | **50 (9,4%)** | 532 | **4** |
| **Total** | **80** | **150** | **3.546** | **12** |

**O Codex abriu quase o dobro de arquivos que eu.** E a correlação é direta e
desconfortável: **os dois repositórios onde minha cobertura foi mais rasa —
RSS Prime (13 arquivos) e kal-el (14) — são exatamente os que concentram 7 dos
12 achados exclusivos dele.**

Nos dois, minha auditoria ficou no perímetro: README, CI, manifesto, dependências,
estrutura. O Codex entrou no motor — no laço de publicação, no executor de
timeout, no caminho de exclusão de mídia. **É onde estavam os defeitos.**

Isso não é um empate a ser maquiado. É o achado sobre o meu próprio método, e
está na seção 7.

---

## 4. screena — os três baldes

### 4.1 Confirmado pelos dois

| Tema | Meu id | Codex |
| --- | --- | --- |
| Autopublicação chega a `published` contra o "NUNCA" canônico | **S-04** | Crítico #1 |
| RapidAPI permanece como caminho executável apesar da decisão do dono | **S-13** | Alto #3 |

Nos dois casos chegamos por caminhos diferentes ao mesmo ponto — eu pela máquina
de estados em `apps/cms/src/workflow.ts` e pelas cotas em `env-auto-publish.ts`,
ele pelo enunciado do `CLAUDE.md`. A convergência independente **eleva a
confiança**: não é leitura enviesada de um leitor só.

### 4.2 Só Claude (não alcançável pelo Codex)

Todos dependem de produção, que o Codex não tinha:

- `ratings_omdb` produz em 2 de 10 dias; **0,91% dos títulos com nota**
- `content_blocks = 0` — a camada editorial de IA nunca foi invocada
- "Onde assistir" renderiza em **147 de 83.314** títulos
- `api_cache` com **500.140 linhas expiradas (3,6 GB)** e nenhum comando de purga
- `apps/admin` nunca é construída (nenhum Dockerfile, nenhum serviço no painel)
- `next@15.5.19` com **8 advisories abertas**, 7 citando `apps/web`
- Os shards `people-1`, `seasons-1`, `episodes-1` do sitemap devolvem **404**
- 143 índices nunca usados (122 MB); `pg_stat_statements` não instalado
- Primeira imagem da ficha em **y=840 px** no viewport móvel; 17 falhas de contraste

### 4.3 Só Codex — verificado item a item

#### C-01 · O sinal verde de governança é mais estreito do que parece — **CONFIRMADO** · MÉDIO

> Codex: *"o sinal verde de governança é estreito: ele verifica palavras em documentação e poucos padrões"*

Li [`scripts/audit/check-invariants.mjs`](../../scripts/audit/check-invariants.mjs).
O que `pnpm audit:invariants` de fato faz:

1. Confere a **presença de frases-chave** no `CLAUDE.md` e em 5 arquivos
   `.claude/rules/*.md` (linhas 9–17, 43–80);
2. Varre o código procurando `imdb` **adjacente a** `tomatometer`.

É isso. Ele **não** avalia se o render chama API externa, se uma nota tem licença,
se a autopublicação respeita revisão humana, nem se a escala bate com a fonte.

**Por que este achado é sobre mim, não só sobre o script:** no `01-screena.md` eu
escrevi `audit:invariants` **passou** e usei isso como sinal positivo. Passar
naquele script significa *"as frases certas ainda estão escritas nos documentos
certos"* — e é compatível com **todas as 13 invariantes serem violadas em
produção**. O Codex está certo, e a correção entra no `01-screena.md`.

O contraste que fecha o argumento: o próprio achado S-04 — autopublicação
contrariando o "NUNCA publicar automaticamente" — **passa** por esse validador,
porque a frase proibitiva continua presente no `CLAUDE.md`. **O validador
verifica que a lei está escrita, não que ela é cumprida.**

#### C-02 · O `package.json` do admin afirma que ele nunca escreve — **CONFIRMADO** · BAIXO

[`apps/admin/package.json:6`](../../apps/admin/package.json) descreve o pacote como
*"modo SOMENTE LEITURA... nao publica, nao edita, nao escreve"*.

O `CLAUDE.md` deste repositório, na tabela do mapa do monorepo, diz o oposto e com
todas as letras:

> *"ESCRITA (revisão/publicação de `content_blocks`/`article_translations`) existe
> e é real, gateada pela flag `ADMIN_EDITORIAL_ACTIONS_ENABLED` (default
> desligada) — **não é 'read-only puro'**."*

O metadado do pacote está desatualizado em relação à governança do próprio
repositório. É exatamente a categoria "comentário mentiroso" que o dono autorizou
como ajuste leve — mas mexe em `apps/admin`, então vai por PR, não neste.

#### C-03 · `SCREENA_REDIS_URL` declarada e nunca lida — **CONFIRMADO** · BAIXO

Varri `*.ts` (excluindo testes e markdown) por `SCREENA_REDIS_URL|REDIS_URL|redis`.
Os únicos resultados foram a palavra "redistribuir" e um comentário sobre URLs que
carregam credencial. **Nenhum leitor em produção.**

Configuração declarada sem leitor é superfície operacional enganosa: quem opera
supõe que existe um Redis no caminho, e não existe.

#### C-04 · O `CLAUDE.md` se contradiz sozinho — **CONFIRMADO** · reforça S-04

Este não entra como achado novo; ele **afia** o S-04. Eu tinha enunciado o
conflito como *`CLAUDE.md` contra o ADR 0017*. O Codex mostrou que é pior: a
contradição está **dentro do mesmo arquivo**, a 44 linhas de distância.

| Linha | Texto |
| --- | --- |
| [`CLAUDE.md:157`](../../CLAUDE.md) | *"`editorial_auto_publish` **sobe até `published`** sem atravessar estados que afirmam revisão humana"* |
| [`CLAUDE.md:201`](../../CLAUDE.md) | *"**NUNCA** publicar conteúdo automaticamente — publicação passa por humano"* |

O documento que se declara autoritativo **afirma e proíbe a mesma coisa**. Isso
muda a recomendação: não basta alinhar o `CLAUDE.md` com o ADR; é preciso
resolver a contradição interna primeiro, porque hoje qualquer decisão pode citar
o `CLAUDE.md` a favor de si.

### 4.4 Discordância sobre um fato — e o veredito

#### O Codex disse que os testes "ratificam a violação". **DISCORDO, com evidência.**

> Codex (Alto #2): *"testes ratificam explicitamente a violação, e a auditoria de
> invariantes passa mesmo assim"* — apontando
> `apps/cms/src/__tests__/auto-publication.test.ts:79`

Abri o teste. Ele se chama **`CONTROLE POSITIVO: pedido completo PUBLICA`** e
espera `PUBLISHED`/201.

**O que o teste faz não é ratificar um defeito — é codificar uma decisão aceita.**
O ADR 0017 (`docs/adr/0017-automation-publisher-actor.md`) decidiu, com revisão
humana registrada, que `editorial_auto_publish` é um ator distinto de
`draft_ingest` e pode publicar. O teste trava essa decisão. Um teste que trava uma
decisão aprovada é o comportamento correto de uma suíte.

**O defeito real está no documento, não no teste** — e é o C-04 acima. Se
amanhã a decisão for revertida, esse teste deve mudar junto; hoje ele está
coerente com o ADR vigente.

**Veredito:** o fato apontado pelo Codex é verdadeiro (o teste existe e espera
publicação), a interpretação não se sustenta. Reclassificado como **reforço do
S-04**, não como achado autônomo.

---

## 5. MNScr — os três baldes

### 5.1 Confirmado pelos dois

| Tema | Meu id | Codex |
| --- | --- | --- |
| SSRF: `safe_get()` existe e o caminho real a contorna | **M-01** | Crítico #1 |
| Código e configuração sem chamador/leitor | **M-03** | Médio #5 |

O SSRF é a convergência mais valiosa da auditoria inteira: dois revisores
independentes, partindo de pontos diferentes, chegaram ao mesmo
`app/extractor.py:909` — `self.session.get(url, timeout=20.0, allow_redirects=True)`,
que **passa ao largo** de toda a validação de destino e de redirect que
`safe_get()` implementa.

### 5.2 Só Claude

- A cadeia de publicação medida ponta a ponta contra o CMS em produção
- O contrato `rss-prime-event-v1` conferido contra o consumidor real
- A suíte executada: **3.521 testes verdes**
- `pip-audit` **bloqueado** pela política de Application Control da máquina
  (`os error 4551`) — registrado como tentativa impedida, não como "não verifiquei"

### 5.3 Só Codex — verificado item a item

#### C-05 · O "orçamento por artigo" não limita o escritor principal — **CONFIRMADO** · ALTO

`app/policy_engine.py:405-415`:

```python
def consume(self, tokens: int, stage: str) -> None:
    if stage == "main_writer":
        self.writer_tokens += token_count        # acumula aqui...
    else:
        self.post_writer_tokens += token_count

def has_budget(self, stage: str, estimated_tokens: int = 1000) -> bool:
    remaining = self.budget - self.post_writer_tokens    # ...e nunca é subtraído aqui
```

O escritor principal consome, é contabilizado em `writer_tokens`, é logado e entra
no relatório — e fica **fora do único portão que decide se ainda se pode gastar**.
`budget` limita apenas as fases pós-escrita.

Consequência prática: se o escritor principal queimar três vezes o orçamento
inteiro, `has_budget()` continua devolvendo `True` para todas as etapas seguintes.
O nome diz "orçamento por artigo"; o que é imposto é "orçamento pós-escrita".

**A separação é deliberada** — o `if stage == "main_writer"` é explícito, não
acidente. O defeito não é a lógica, é o **nome e o relatório afirmarem um controle
mais amplo do que o que existe**. É a categoria "o que mente".

#### C-06 · Inanição determinística do quinto feed — **CONFIRMADO** · ALTO

O Codex nomeou o feed exato. Confirmei a aritmética inteira:

`app/config.py:26-32` — ordem **fixa**, cinco feeds:

```python
PIPELINE_ORDER: List[str] = [
    'rssprime_movies', 'rssprime_tv', 'screenrant_movie_lists',
    'screenrant_movie_news', 'screenrant_tv',        # <- o quinto
]
```

`app/pipeline.py:126-127,3125,3143`:

```python
MAX_PER_FEED_CYCLE = int(os.getenv('MAX_PER_FEED_CYCLE', 3))
MAX_PER_CYCLE      = int(os.getenv('MAX_PER_CYCLE', 10))
...
for source_id in PIPELINE_ORDER:                                  # sem rotação
    limit = min(MAX_PER_FEED_CYCLE, MAX_PER_CYCLE - processed_total_in_cycle)
    if limit <= 0:
        break                                                     # e é break, não continue
```

Com os cinco feeds tendo pelo menos 3 pendentes cada:

| Ordem | Feed | Recebe | Acumulado |
| ---: | --- | ---: | ---: |
| 1 | `rssprime_movies` | 3 | 3 |
| 2 | `rssprime_tv` | 3 | 6 |
| 3 | `screenrant_movie_lists` | 3 | 9 |
| 4 | `screenrant_movie_news` | **1** | 10 |
| 5 | **`screenrant_tv`** | **0** | 10 |

Confirmei também que **não há rotação nem cursor entre ciclos** (varri
`rotate|cursor|round_robin|last_source|shuffle` em `pipeline.py`: só um cursor de
SQLite, sem relação). A ordem é a mesma toda vez.

**`screenrant_tv` recebe capacidade estruturalmente zero em todo ciclo saturado** —
e, por ser `break` e não `continue`, nem chega a ser avaliado. Os valores batem
com a documentação do próprio repositório (`MAX_PER_FEED_CYCLE` 3,
`MAX_PER_CYCLE` 10), então isto não é desvio de configuração: é o projeto.

---

## 6. RSS Prime — os três baldes

Aqui minha cobertura foi a mais rasa de todas (13 arquivos, 2,4%) e o resultado
aparece: **os três achados do balde "só Codex" são melhores que os meus doze.**

### 6.1 Confirmado pelos dois

| Tema | Meu id | Codex |
| --- | --- | --- |
| Deduplicação semântica pode suprimir artigo elegível | **R-05** | Alto #2 |

### 6.2 Só Claude

- README descrevia **outro sistema** e mandava pôr a chave de admin na URL —
  **corrigido por PR** ([maquinanerd/RSSPRIME#8](https://github.com/maquinanerd/RSSPRIME/pull/8))
- Suíte executada: **564 testes verdes**, após instalar 3 dependências não
  declaradas e isolar 2 arquivos que abortam a coleta
- `pip-audit` bloqueado pela política da máquina

### 6.3 Só Codex — verificado item a item

#### C-07 · O timeout do resolver Gemini não limita nada — **CONFIRMADO** · ALTO

Este é o melhor achado técnico da auditoria inteira, e eu não cheguei perto dele.

`superfeed/v2/gemini_resolver.py:272-274`:

```python
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        response = pool.submit(_call).result(timeout=timeout)
except FutureTimeout:
    ...
    return _defer("timeout", topic, size)
```

`.result(timeout=…)` levanta `FutureTimeout` no prazo — **mas a exceção sai do
bloco `with`, e `ThreadPoolExecutor.__exit__` chama `shutdown(wait=True)`.**
Python então **bloqueia até a thread terminar** antes de o `except` sequer
executar.

O timeout não limita tempo de parede. Ele só decide quando a variável de resultado
é abandonada. Se a chamada ao Gemini travar por 300 s, o ciclo inteiro espera
300 s — e só então registra "timeout".

**O controle negativo está no próprio repositório**, e é o que torna este achado
indiscutível. `superfeed/embedding_client.py:318-322`
faz a **mesma coisa, do jeito certo**:

```python
executor = ThreadPoolExecutor(max_workers=1)        # sem `with`
future = executor.submit(_call_embedding_api, batch)
try:
    vectors, billable_chars = future.result(timeout=EMBED_TIMEOUT_SECONDS)
except FutureTimeout:
    future.cancel()
    executor.shutdown(wait=False, cancel_futures=True)      # não espera
```

O autor **conhecia** o padrão correto — escreveu `wait=False, cancel_futures=True`
de propósito num arquivo. Nos outros dois pontos, o `with` reintroduz a espera em
silêncio:

| Arquivo | Linha | Padrão |
| --- | ---: | --- |
| `superfeed/embedding_client.py` | 318 | **correto** (`shutdown(wait=False, cancel_futures=True)`) |
| `superfeed/v2/gemini_resolver.py` | 273 | **bloqueia** (`with`) |
| `superfeed/ai_validator.py` | 481 | **bloqueia** (`with`) |

Dois de três lugares com o defeito, e a correção já escrita no terceiro.

#### C-08 · A fila marca `PUBLISHED` sem que ninguém tenha publicado — **CONFIRMADO, e pior do que o enunciado** · CRÍTICO

`app/scheduler.py:869-875`:

```python
with open(filepath, "w", encoding="utf-8") as fh:
    json.dump(article, fh, ensure_ascii=False, indent=2)
# Mark as PROCESSING (status=PUBLISHED with wp_post_id=0 acts
# as a "claimed" marker until the real publisher picks it up)
mark_published(cluster_id, wp_post_id=0, db_path=self._db_path)
```

**Escrever um arquivo JSON num diretório local marca o cluster como publicado.**
Fui atrás das consequências, e são três — cada uma verificada:

**1. Ninguém distingue o "marcado" do publicado de verdade.** Varri `app/` e
`superfeed/` inteiros por qualquer comparação de `wp_post_id` contra `0`/NULL. Os
únicos resultados são as duas linhas que *atribuem* o valor e um comentário que
admite o problema — `superfeed/cluster_store.py:605`:

> *"…so a published row keeps `wp_post_id=0` forever."*

O discriminador existe no dado e **não é lido por nenhuma consulta do sistema**.

**2. A retenção apaga.** `app/retention.py:50`:
`TERMINAL_CLUSTER_STATUSES = ("PUBLISHED", "EXPIRED", "MERGED")`, com
`DEFAULT_RETENTION_HOURS = 72.0`. O cluster marcado é tratado como *"já cumpriu
seu papel"* e sai do banco quente em 72 h — tenha sido consumido ou não.

**3. A deduplicação bloqueia a segunda tentativa.** `find_published_by_fact_sig`
casa em `status='PUBLISHED'` na janela de 72 h. Um fato "publicado" que nunca
chegou a lugar nenhum **suprime** a próxima tentativa de publicar o mesmo fato.

E o fecho: **procurei o consumidor da fila neste repositório e ele não existe.**
As únicas coisas que tocam `superfeed_queue/` depois da escrita são
`queue_dir_usage()` (mede o tamanho) e o podador da retenção (apaga em 72 h). O
consumidor é o MN26, externo — e o MN26 está, por decisão do dono, **fora da
arquitetura da Cinerie**.

> **Portanto:** se o consumidor externo não rodar, o artigo é escrito, marcado
> como publicado, apagado do banco em 72 h, o arquivo é apagado em 72 h, e o fato
> fica bloqueado para nova tentativa durante a janela. **Perda silenciosa e
> irrecuperável, sem nenhum sinal de erro.**

O Codex classificou como crítico. **Concordo, e acrescento as três consequências
acima, que ele não enumerou.**

#### C-09 · Migração em runtime derruba e reconstrói uma tabela — **CONFIRMADO, com atenuantes** · BAIXO

`superfeed/schema.py:206-233` executa,
com `PRAGMA foreign_keys=OFF`: cria `sf_raw_items_new`, copia tudo,
`DROP TABLE sf_raw_items`, renomeia.

O fato é verdadeiro. Mas devo os atenuantes, senão o achado engana:

- **É o único jeito de fazer isso em SQLite.** Não existe
  `ALTER TABLE ... DROP CONSTRAINT`; trocar um `UNIQUE` exige reconstruir a tabela.
  Este é o padrão recomendado pela própria documentação do SQLite.
- É guardado por `_needs_url_migration(conn)` — não roda quando já migrado.
- Está entre `BEGIN;`/`COMMIT;`, e o `finally` fecha a conexão (o que reverte
  transação aberta).

**O que resta de risco real** é o que o Codex acertou: isto roda **no caminho de
boot da aplicação**, não como passo explícito de migração. Uma base legada grande
paga a cópia inteira na subida, com as FKs desligadas, sem ninguém ter pedido.
Mantenho como **BAIXO**, com a recomendação de mover para um comando explícito.

---

## 7. kal-el — os três baldes

Maior gap de cobertura da auditoria: eu abri 14 arquivos, o Codex abriu 50.

### 7.1 Confirmado pelos dois

| Tema | Meu id | Codex |
| --- | --- | --- |
| `public/` não era copiado no Dockerfile do CMS | **K-02** | (parcial, na 1ª tentativa) |
| Máquina de estados permite `published` por caminhos múltiplos | **K-05** | D4 |

O `public/` foi **corrigido por PR** ([maquinanerd/kal-el#5](https://github.com/maquinanerd/kal-el/pull/5)) — o comentário no Dockerfile
afirmava que o diretório não existia, e ele existia desde 2026-08-20.

### 7.2 Só Claude

- Suíte executada: **244 testes verdes** (38 unitários + 206 de integração) —
  eu havia escrito que a cobertura era rasa e a **medição me desmentiu**
- `pnpm audit`: 29 vulnerabilidades, 12 altas, com destaque para
  `apps/api > image-size` (DoS em ICNS/JXL/HEIF) **no caminho de upload de mídia**

### 7.3 Só Codex — verificado item a item

#### C-10 · Apagar mídia não apaga o binário — **CONFIRMADO, e mais preciso do que o enunciado** · ALTO

O Codex disse *"`StorageProvider.delete()` existe, mas tem zero chamadas"*.
Confirmei — e a forma exata é pior:

`apps/api/src/services/media.ts:222`:

```ts
export async function deleteMedia(db: Db, storage: StorageProvider, siteId: string,
                                  mediaId: string, actor: ActorRef) {
```

**A função recebe `storage` como parâmetro — e o corpo inteiro nunca o usa.** O
que ela faz: confere referências (com uma correção de bug muito bem documentada
sobre reserialização de `jsonb`), apaga a linha, escreve auditoria e retorna
`{ deleted: true }`.

E o detalhe que fecha: a auditoria **registra a `storageKey`** —

```ts
details: { storageKey: existing.storageKey },
```

— ou seja, o sistema anota exatamente o identificador necessário para apagar o
binário, e não o apaga.

Verificação de ausência: `delete` está definido na interface
(`apps/api/src/storage/provider.ts:5`), implementado
(`apps/api/src/storage/local.ts:42`) e **não é chamado em nenhum lugar de
`apps/` ou `packages/`**.

**Consequência:** conteúdo "removido" — inclusive por pedido de privacidade —
permanece no volume, e o CMS apaga com um clique, sem confirmação (é o que o
próprio comentário do arquivo diz sobre a grade).

#### C-11 · Segredo de webhook em texto recuperável — **CONFIRMADO no fato, CORRIJO o enquadramento** · MÉDIO

O fato: `apps/api/src/services/webhooks.ts:120-123`
grava o segredo direto na coluna:

```ts
const secret = body.secret ?? randomBytes(32).toString("hex");
... .values({ siteId, url: body.url, events: body.events, secret, ... })
```

E o contraste com os service tokens é real —
`apps/api/src/services/tokens.ts:22`
grava `tokenHash: hashToken(token)`.

**Mas o Codex enquadrou como contradição, e não é.** A assimetria é *necessária*:

| | Service token | Segredo de webhook |
| --- | --- | --- |
| Como é usado | **verificado** (compara hash) | **assina** (HMAC) |
| Pode ser hasheado? | sim | **não** — o emissor precisa do valor cru |

Um segredo de HMAC é simétrico por construção. Stripe e GitHub têm exatamente a
mesma propriedade. Guardar hash tornaria a assinatura impossível.

**O achado legítimo, reformulado:** o segredo está **sem cifragem de envelope em
repouso**. Quem lê o banco forja callbacks. A mitigação real não é hash — é
cifrar a coluna com uma chave que não vive no banco. Mantenho **MÉDIO**, com o
enunciado corrigido.

O código, aliás, já faz a parte difícil certa: o segredo é devolvido **uma única
vez**, na criação (`linha 126: "The only time the secret is ever returned"`), e
está deliberadamente ausente do DTO (`linha 12`).

#### C-12 · Não existe API pública de entrega — **CONFIRMADO no fato, MODERO a conclusão** · MÉDIO

O que o produto promete:

- `README.md:3`: *"Kal El is an **API-first** editorial CMS designed to power multiple independent portals"*
- `README.md:7`: *"A Next.js portal, a Lovable application, or another HTTP-capable client should consume the same stable Editorial API."*
- `docs/01-ARCHITECTURE.md:23-27`: um diagrama com uma caixa chamada **`Delivery API`** alimentando "Next portal / Lovable app / other clients"

O que existe: enumerei as rotas `GET` registradas. **Toda rota de conteúdo está
atrás de `guard(...)`** — `articles.read`, `media.read`, `taxonomy.*.manage`,
`seo.manage`. As únicas `GET` sem autenticação são `/health`, `/v1/health`,
`/ready`, `/v1/ready` e `/v1/preview/:token` (token assinado, de uso interno).

**A caixa `Delivery API` do diagrama não corresponde a nenhum componente.**

**Onde modero:** o Codex escreveu que um portal externo *"não consegue ler artigo
publicado pelo contrato REST"*. Isso é forte demais — um portal que porte um
service token com escopo `articles.read` **consegue**, pelas rotas de site. O
enunciado exato é: **não há superfície de entrega não autenticada, otimizada para
leitura e cacheável; a leitura pública passa pela API editorial autenticada.**
Isso é uma lacuna de arquitetura em relação ao que os documentos desenham, não
uma impossibilidade.

#### C-13 · O teste de reversibilidade não testa reversibilidade — **CONFIRMADO** · MÉDIO

`packages/db/tests/migration.test.ts:36-65`:

```ts
// Reverse of every applied migration: reversibility is a stated engineering rule.
DROP TABLE IF EXISTS "article_entities" CASCADE;
DROP TABLE IF EXISTS "article_tags" CASCADE;
...                                     // 27 tabelas
DROP SCHEMA IF EXISTS drizzle CASCADE;
```

O comentário afirma ser *"o inverso de cada migração aplicada"* e invoca a
*"regra de engenharia declarada"* de reversibilidade. O que o bloco é: **um
`DROP TABLE ... CASCADE` em todas as 27 tabelas, mais o schema de controle do
drizzle.**

O que ele prova e o que não prova:

| Afirmação | Provado? |
| --- | :---: |
| As migrações rodam a partir do vazio | **sim** |
| A migração 0005 pode ser desfeita deixando o estado de 0004 | não |
| Dado sobrevive a um downgrade | **não** — tudo é destruído |

Confirmei também que **não existem arquivos de `down`** nas migrações. Ou seja: a
"regra de engenharia declarada" não tem implementação em lugar nenhum, e o único
artefato que diz prová-la é um script de demolição.

É a categoria "nome de teste que mente", que o dono listou como ajuste leve
aceitável. **A correção barata é o comentário**; a correção real (escrever
downgrades por migração) é trabalho de verdade e fica como recomendação.

---

## 8. Placar honesto

### Onde nós dois chegamos ao mesmo lugar

**5 temas**, por caminhos independentes: SSRF do MNScr, autopublicação do screena,
RapidAPI remanescente, `public/` do kal-el, dedup semântica do RSS Prime. Em todos,
a convergência independente eleva a confiança do achado.

### O que só eu vi — e por quê

**Tudo que depende de produção.** 28 medições no PostgreSQL, o site em navegador,
o painel, as suítes executadas, as dependências resolvidas. O Codex rodou
read-only, sem rede, sem banco: **nenhum desses achados era alcançável por ele**.
São a maioria dos meus 64, e incluem os cinco primeiros do documento final.

### O que só o Codex viu — e por quê

**12 achados**, dos quais 1 crítico e 4 altos. Nenhum deles precisava de produção:
**todos os doze estavam no código que eu tinha ao alcance e não abri**, ou abri e
li rápido demais.

| # | Repo | Achado | Gravidade |
| --- | --- | --- | --- |
| C-01 | screena | `audit:invariants` só confere frases em documento | MÉDIO |
| C-02 | screena | `apps/admin/package.json` afirma que nunca escreve | BAIXO |
| C-03 | screena | `SCREENA_REDIS_URL` sem leitor | BAIXO |
| C-05 | MNScr | orçamento não limita o escritor principal | ALTO |
| C-06 | MNScr | `screenrant_tv` com capacidade zero estrutural | ALTO |
| C-07 | RSS Prime | timeout do resolver não limita tempo de parede | ALTO |
| **C-08** | **RSS Prime** | **`PUBLISHED` sem publicação; perda silenciosa em 72 h** | **CRÍTICO** |
| C-09 | RSS Prime | migração de runtime derruba tabela | BAIXO |
| C-10 | kal-el | apagar mídia não apaga o binário | ALTO |
| C-11 | kal-el | segredo de webhook sem cifragem em repouso | MÉDIO |
| C-12 | kal-el | a `Delivery API` do diagrama não existe | MÉDIO |
| C-13 | kal-el | o teste de "reversibilidade" é uma demolição | MÉDIO |

*(C-04 não entra na contagem: foi absorvido como reforço do S-04.)*

### Onde discordamos, e o que a verificação disse

**Três vezes**, e em nenhuma eu aceitei o enunciado do Codex como veio:

| Alegação do Codex | Veredito | Base |
| --- | --- | --- |
| "os testes ratificam a violação" (screena) | **Rejeitado como achado autônomo** | O teste codifica o ADR 0017, aprovado; o defeito é a contradição interna do `CLAUDE.md` |
| "contrariando o contrato" — segredo de webhook (kal-el) | **Fato mantido, enquadramento corrigido** | Segredo de HMAC é simétrico por construção; a falta é cifragem em repouso, não hash |
| "não consegue ler pelo contrato REST" (kal-el) | **Fato mantido, conclusão moderada** | Um portal com service token consegue; falta a superfície não autenticada que o diagrama desenha |

---

## 9. O que este confronto diz sobre o meu método

Três coisas, e nenhuma é confortável.

**1. Cobertura rasa produz achado raso, e a correlação é medível.** Nos dois
repositórios onde abri menos (RSS Prime, 13 arquivos; kal-el, 14), meus achados
foram de perímetro — README, CI, manifesto, dependência — enquanto os defeitos
estavam no motor. O Codex, com o dobro de arquivos, achou 7 dos 12. **Declarar a
cobertura não conserta a cobertura**; a linha honesta no topo de cada relatório
serviu para o leitor calibrar, não para me eximir.

**2. Eu tratei um sinal verde como garantia sem ler o que ele garante.** Escrevi
`audit:invariants` **passou** como ponto positivo do screena. O script confere se
certas frases continuam escritas em certos documentos. **Passar nele é compatível
com as 13 invariantes sendo violadas em produção** — e, de fato, o S-04 viola uma
delas e passa. Este é o erro de método mais grave que o confronto expôs, e é
exatamente a armadilha que este relatório existe para evitar: *validador que não
mede o que o nome promete*.

**3. O melhor achado técnico da auditoria não foi meu.** O `with
ThreadPoolExecutor` do `gemini_resolver.py` é sutil, tem controle negativo dentro
do próprio repositório e derruba um mecanismo de segurança inteiro sem emitir um
único erro. Eu passei ao lado. Registro isso não como autocrítica decorativa, mas
porque é a justificativa empírica da ordem do dono: **a revisão cega paralela não
foi cerimônia — ela achou um crítico e quatro altos que eu não achei.**

E a contrapartida, para não inverter o exagero: o Codex não tinha banco, site nem
painel. Ele não podia saber que 0,91% dos títulos têm nota, que `content_blocks`
é zero, que o `apps/admin` nunca foi construído. **Nenhum dos dois, sozinho,
teria produzido este documento.**

---

## 10. Onde estes 12 achados entram

Todos foram incorporados:

- `01-screena.md` — C-01, C-02, C-03; S-04 reescrito com a contradição interna
- `02-mnscr.md` — C-05, C-06
- `03-rss-prime.md` — C-07, C-08, C-09
- `04-kal-el.md` — C-10, C-11, C-12, C-13
- `13-DOCUMENTO-FINAL.md` — tabela mestra e contagem atualizadas; **C-08 entra
  entre os críticos**

Nenhum deles foi corrigido em código nesta sessão. Dois são ajuste leve elegível
(o comentário do `migration.test.ts` e a descrição do `apps/admin/package.json`),
e ambos ficam como recomendação porque vivem em repositórios que já receberam a
PR desta auditoria e uma segunda alteração cosmética não vale o ruído.
