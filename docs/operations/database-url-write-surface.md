# Superficie de escrita no banco e protecao da `DATABASE_URL`

> **Documento de RISCO, nao de implementacao.** Levantado em 2026-07-28 por leitura estatica.
> Nenhum banco foi consultado e nenhum valor de `DATABASE_URL` foi lido, impresso ou verificado.
> Nenhuma guarda global foi implementada — este documento existe justamente para que a decisao venha
> **depois** da matriz, e nao antes.

## 1. O problema

Todo script deste repositorio que alcanca o PostgreSQL resolve o alvo por **uma unica variavel de
ambiente**: `DATABASE_URL`. Nao existe distincao estrutural entre "banco descartavel", "banco de
desenvolvimento" e "banco de producao" — existe apenas o valor que estiver no ambiente no momento da
execucao.

Isso significa que a mesma linha de comando que popula um banco local pode reescrever producao se a
variavel estiver apontada para la. O risco nao e hipotetico para este codigo: uma das CLIs ja
implementa uma barreira **por padrao de nome/host** justamente por reconhecer esse cenario
(`services/news-ingestion/bin/editorial.ts`).

## 2. Matriz (levantamento estatico, 2026-07-28)

**37** scripts/CLIs alcancam o banco (importam `getPrismaClient`, `new PrismaClient`, `@screena/db`
ou um modulo de persistencia). Deles:

| Categoria | Qtde | Risco |
| --- | ---: | --- |
| Usam um **PostgreSQL 16 efemero proprio** (embedded-postgres) | 11 | **Baixo** — o alvo e criado e destruido pelo proprio script. |
| Usam a `DATABASE_URL` do ambiente **COM** barreira anti-producao | 2 | **Medio** — protegidos, mas por heuristica de nome. |
| Usam a `DATABASE_URL` do ambiente **SEM** barreira alguma | **24** | **ALTO** — o alvo e o que estiver no ambiente. |

### Com barreira (2)

| Script | Barreira |
| --- | --- |
| `services/news-ingestion/bin/editorial.ts` | `assertNotProduction` + `--force-unsafe-production` |
| `services/news-ingestion/bin/qa-editorial-seed.ts` | idem |

A barreira recusa a execucao quando a `DATABASE_URL` casa com `/rss_prime/i`, `/_prod/i`,
`/production/i`, `/screena-db/i`, `/cinerie-db/i`, **ou** quando `NODE_ENV === "production"`. Ela
**nunca imprime a URL**.

### Sem barreira, alvo = ambiente (24)

| Grupo | Scripts |
| --- | --- |
| Seeds e demos | `packages/db/prisma/seed.ts`, `apps/admin/scripts/public-demo-seed.ts`, `apps/admin/scripts/staging-seed.ts`, `apps/web/scripts/seed-dev-movie.ts` |
| Catalogo / TMDB | `services/ingestion/bin/{catalog,discover-ids,import,ingest-public-catalog,promote-tmdb-raw,sync-tmdb,sync-tmdb-config,sync-tmdb-raw}.ts` |
| Entity Writer | `services/entity-writer/bin/{enqueue,inspect,run,run-offline,smoke-gemini}.ts` |
| Ratings / streaming | `services/ratings/bin/{ratings,sync-film-show-ratings}.ts`, `services/streaming/bin/{promote-watch-availability,review-watch-availability,sync-streaming-availability}.ts` |
| Sync / legal | `services/sync/bin/run.ts`, `services/legal/bin/legal.ts` |

Nem todos escrevem sempre (`inspect` e leitura), mas **todos** resolvem o alvo pela mesma variavel, e
alguns escrevem por delegacao a um store — o que torna a auditoria por "procurar `.update(`" no
proprio arquivo **insuficiente**. A classificacao acima usa "alcanca o banco", nao "contem `.update(`".

## 3. Por que NAO implementamos uma guarda global agora

Os quatro contextos que executam esses scripts tem requisitos **incompativeis entre si**:

| Contexto | O que precisa | Efeito de uma guarda ingenua |
| --- | --- | --- |
| **CI** (17 validadores) | escrever livremente num PostgreSQL 16 efemero | uma guarda que bloqueie por `NODE_ENV` ou por nome quebraria a esteira inteira |
| **Migrations** (`prisma migrate deploy`) | escrever em **producao**, de proposito | a guarda precisa deixar passar exatamente este caso |
| **Testes** | nao tocar banco algum | irrelevante |
| **Operacao** (sync, promocao, backfill) | escrever em producao, de proposito, com decisao humana | a guarda vira ruido se pedir confirmacao a cada ciclo agendado |

Uma guarda que ignore essa diferenca ou trava o CI, ou vira `--force` decorativo em todo comando — que
e o mesmo que nao ter guarda.

## 4. Proposta para uma fase futura (nao implementada)

1. **Classificar o ambiente explicitamente**, em vez de adivinhar pelo nome do host. Uma variavel
   propria (ex.: `CINERIE_DB_ENVIRONMENT` com `ephemeral | development | staging | production`),
   obrigatoria, com **fail-closed**: ausente = tratar como producao.
2. **Uma unica funcao de fronteira** (`assertWritableTarget(intent)`) num pacote compartilhado,
   consumida por **todos** os `bin/` e scripts de seed — nunca reimplementada por script, pelo mesmo
   motivo que a allowlist de transicao editorial passou a ter fonte unica.
3. **Intencao declarada por script**: `seed`, `sync`, `promotion`, `validation`. Cada intencao declara
   em quais ambientes pode rodar; `seed` nunca roda em `production`, `sync` roda.
4. **Manter a heuristica de nome como segunda camada**, nao como primeira — ela protege contra o erro
   de configurar o ambiente errado, mas nao pode ser a unica defesa.
5. **Guarda de governanca em `tests/governance/`**: todo arquivo novo em `services/*/bin/` ou
   `*/scripts/*` que alcance o banco precisa chamar a fronteira — com **controle negativo** provando
   que a guarda falha quando o chamado e removido.
6. **Nunca imprimir a URL**, em nenhum caminho de erro (comportamento ja adotado pelas duas CLIs
   protegidas hoje).

## 5. O que este documento nao afirma

- **Nao** afirma para onde a `DATABASE_URL` aponta em nenhum ambiente. Isso nao foi verificado.
- **Nao** afirma que algum script ja causou dano.
- **Nao** propoe alterar `prisma migrate deploy`, que escreve em producao por design.
