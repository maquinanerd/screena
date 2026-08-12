# Runbook — provedor de ratings

> Operação do worker offline de ratings externos. Idioma: pt-BR.
> **Nenhum valor de chave, token ou senha aparece aqui.**

---

## 1. Quem está ativo

| Provedor | `provider_api` | Estado | Adapter |
| --- | --- | --- | --- |
| **OMDb API** | `omdb` | **ATIVO** | `services/ratings/src/omdb/**` + `bin/sync-omdb-ratings.ts` |
| Film & Show Ratings (RapidAPI) | `rapidapi_film_show_ratings` | **DESLIGADO** desde 2026-08-12 | `services/ratings/src/film-show-ratings/**` + `bin/sync-film-show-ratings.ts` |

**Rodar os dois ao mesmo tempo não é suportado.** Ambos escrevem `metric` no
vocabulário `audience`/`critics`, e o unique de `external_ratings` é
`(entity_type, entity_id, rating_source, metric)` — um sobrescreveria o outro.
Escolha um provedor por eixo.

---

## 2. Por que o provedor anterior está desligado

A Film & Show Ratings API (`film-show-ratings.p.rapidapi.com`) responde
**HTTP 403 — "You are not subscribed to this API"**. A conta não tem assinatura,
e a assinatura não pôde ser feita.

O adapter **não foi apagado**. Ele está correto, testado, e cobre um payload que
a OMDb não entrega: formato por fonte, com um mapa `links` — ou seja, **linkback
para todas as fontes**, não só para o IMDb. Se a assinatura acontecer um dia,
voltar é ligar uma variável, não reescrever nada.

### O que reativá-lo exige, nesta ordem

1. **Assinatura ATIVA** do plano na RapidAPI, para a conta cuja chave está em
   `RAPIDAPI_FILM_SHOW_RATINGS_KEY`. Sem isso o 403 volta na primeira chamada.
2. `CINERIE_RATINGS_FILM_SHOW_RATINGS_ENABLED=true` no ambiente do worker.
3. Em produção, também `CINERIE_RATINGS_PROVIDER_AUTHORIZED=true` — o gate de
   licença, que o passo 2 **não** substitui.
4. **Decidir o que fazer com a colisão de `metric`** (ver seção 1). Provavelmente
   desligar a OMDb primeiro.
5. Reavaliar o linkback: com `links` por fonte, Rotten Tomatoes e Metacritic
   voltam a ter URL — e, pelo gatilho de reversão automática, voltam a exibir
   **com link** sozinhas, sem nova decisão humana. Ver
   [`docs/legal/ratings-streaming-provider-authorization.md`](../legal/ratings-streaming-provider-authorization.md).

O desligamento é **fail-closed por omissão**: a variável ausente significa
desligado. Dry-run puro continua liberado (relatar o plano não gasta cota).

---

## 2.1 Migração das notas do provedor anterior — 15 reescritas, 15 órfãs

Medição em produção (2026-08-12): **30 linhas** de `rapidapi_film_show_ratings`,
5 filmes × 6 pares `(rating_source, metric)`, de **cinco** fontes. A OMDb cobre
só **três** desses pares.

| `(rating_source, metric)` | linhas | a OMDb entrega? | destino |
| --- | ---: | --- | --- |
| `imdb` / `audience` | 5 | sim (`7.6/10`) | **reescrita no lugar** |
| `rotten_tomatoes` / `critics` | 5 | sim (`85%` = Tomatometer) | **reescrita no lugar** |
| `metacritic` / `critics` | 5 | sim (`67/100` = Metascore) | **reescrita no lugar** |
| `rotten_tomatoes` / `audience` | 5 | **não** (Popcornmeter não vem no payload) | **órfã** |
| `letterboxd` / `audience` | 5 | **não** | **órfã** |
| `filmaffinity` / `audience` | 5 | **não** | **órfã** |

A reescrita das 15 primeiras é automática: o unique
`(entity_type, entity_id, rating_source, metric)` faz o upsert cair na mesma
linha, que troca `provider_api` para `omdb` e ganha licença, crédito e revisor
`automation:`.

### Por que as 15 órfãs não acendem — e por que os dois grupos são diferentes

- **`letterboxd` e `filmaffinity` (10 linhas) são estruturalmente inexibíveis**,
  independente de licença: nenhuma das duas tem janela em `RATING_STALE_POLICY`
  (que só declara `imdb`, `rotten_tomatoes` e `metacritic`), então
  `evaluateRatingFreshness` devolve `unknown-policy` e o caminho de leitura as
  descarta **sempre**. Não é falta de licença: é falta de política de frescor, e
  inventar uma seria fabricar uma afirmação de atualidade.
- **`rotten_tomatoes/audience` (5 linhas) é outro caso**: tem política (168h/720h)
  e tem licença. Ela não está morta — está **sem alimentação**, porque nenhum
  provedor ativo entrega o Popcornmeter. Promovida à mão, exibiria; e expiraria
  30 dias depois, sem ninguém para renová-la.

### Ordem segura para limpar

**Apague depois de rodar o sync, nunca antes.** Depois do `--apply`, as 15
reescritas já carregam `provider_api = 'omdb'` — então
`provider_api = 'rapidapi_film_show_ratings'` passa a selecionar **exatamente** as
15 órfãs, e o filtro vira autoexplicativo em vez de depender de acertar a lista
de pares.

Confirme antes (deve devolver só os três pares órfãos, todos com
`alguma_exibida = false`):

```sql
SELECT rating_source, metric, count(*) AS linhas, bool_or(display_allowed) AS alguma_exibida
  FROM external_ratings
 WHERE provider_api = 'rapidapi_film_show_ratings'
 GROUP BY 1, 2 ORDER BY 1, 2;
```

> **Não há trigger de DELETE em `external_ratings`** (os dois guards são
> `BEFORE INSERT OR UPDATE`) e nenhuma FK aponta para a tabela. Ou seja: a
> remoção é segura do ponto de vista relacional, **e não deixa rastro no banco**.
> A procedência do que foi coletado sobrevive em `api_cache` (payload bruto) e
> `api_sync_logs` (todo sync gera log) — mas o registro de que aquelas linhas
> existiram fica **só aqui**. É por isso que a decisão está escrita abaixo em vez
> de viver numa conversa.

### Decisão registrada — remover as 15 órfãs

| Campo | Valor |
| --- | --- |
| **Quem decidiu** | Pablo Eduardo, dono do projeto |
| **Quando** | 2026-08-12 |
| **O quê** | Remover as **15 linhas órfãs**, os três pares no mesmo tratamento — incluindo `rotten_tomatoes/audience` |
| **Ciência** | Sim — decidido sabendo que a remoção não deixa rastro no banco |

Razão registrada, nas palavras da decisão: linha com licença e política mas
**sem quem alimente** é convite a alguém promover à mão e ver expirar em 30 dias
sem entender; e um Popcornmeter velho ao lado de um Tomatometer fresco é a
confusão crítico/público que a **invariante 1** existe para impedir. Se um dia
houver provedor de Popcornmeter, o sync **recria** a linha — nada se perde.

Execute **depois** do primeiro `--apply` (ver ordem acima). A transação aborta
sozinha se o número não for exatamente 15, ou se sobrar qualquer linha do
provedor morto:

```sql
BEGIN;
DO $$
DECLARE removidas integer; restantes integer;
BEGIN
  DELETE FROM external_ratings
   WHERE provider_api = 'rapidapi_film_show_ratings'
     AND display_allowed = false
     AND (rating_source, metric) IN (
       ('filmaffinity', 'audience'),
       ('letterboxd', 'audience'),
       ('rotten_tomatoes', 'audience'));
  GET DIAGNOSTICS removidas = ROW_COUNT;
  IF removidas <> 15 THEN
    RAISE EXCEPTION 'esperava 15 linhas orfas, encontrou %; NADA foi apagado', removidas;
  END IF;
  SELECT count(*) INTO restantes FROM external_ratings
   WHERE provider_api = 'rapidapi_film_show_ratings';
  IF restantes <> 0 THEN
    RAISE EXCEPTION 'restaram % linhas do provedor morto; NADA foi apagado', restantes;
  END IF;
END $$;
COMMIT;
```

O `display_allowed = false` é a trava que mais importa: se alguma linha tiver
sido promovida entre a conferência e a execução, a transação aborta **inteira**
em vez de apagar algo que já foi público.

---

## 3. Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `OMDB_API_KEY` | **sim** (`--sample`/`--apply`) | chave da OMDb |
| `DATABASE_URL` | **sim** (`--sample`/`--apply`) | todo sync externo grava `api_cache` + `api_sync_logs` |
| `CINERIE_RATINGS_PROVIDER_AUTHORIZED` | só em produção | autorização humana de licença; **só a string exata `true`** |
| `CINERIE_RATINGS_FILM_SHOW_RATINGS_ENABLED` | só p/ reativar o legado | ver seção 2 |
| `OMDB_BASE_URL`, `OMDB_MAX_RPS`, `OMDB_MAX_RETRIES`, `OMDB_BREAKER_THRESHOLD`, `OMDB_BREAKER_COOLDOWN_MS`, `OMDB_TIMEOUT_MS`, `OMDB_CACHE_TTL_MS` | não | ajuste fino |

Chaves vivem **só** em variável de ambiente. A OMDb não aceita header, então a
chave viaja na querystring — e nunca entra em erro, log, relatório, sample ou
`api_cache` (travado por `api-clients/omdb/src/__tests__/secret-handling.test.ts`).

---

## 4. Cota

O plano gratuito da OMDb são **1.000 requisições por dia**. Uma requisição traz
as três notas, então o teto vale em **entidades por dia**, não em notas.

Três proteções, todas ativas:

1. **Janela de frescor.** A seleção de candidatos pula quem já foi coletado
   dentro de `168h` (7 dias) — o menor `refreshAfterHours` entre as fontes
   servidas, derivado de `RATING_STALE_POLICY`. `--ignore-freshness` desliga o
   filtro; use só depois de mudança de licença/política, porque queima cota.
2. **`--limit`.** Teto explícito de entidades por ciclo (default 20).
3. **Abort por falha.** 3 falhas de rede **consecutivas** (ou circuito aberto)
   interrompem o lote, e o relatório diz quantos ids ficaram sem consulta.

O relatório informa o gasto do ciclo e a sobra do teto diário. `quota_cost` em
`api_sync_logs` é a fonte auditável.

> **`0 consultados` não é falha.** Se tudo estiver dentro da janela de frescor, o
> ciclo reporta `0 consultados` e `N pulados por frescor` — que é o resultado
> saudável. O número de pulados existe justamente para distinguir isso de
> "a seleção quebrou".

---

## 5. Comandos

Todos a partir da raiz do repositório.

**Dry-run (default) — zero rede, zero DB, zero cota. Só o plano:**

```bash
corepack pnpm --filter @screena/ratings ratings:omdb -- --type=movie --limit=20
```

**Sample — busca o payload real, grava `api_cache` + `api_sync_logs`, escreve um sample sanitizado. NÃO grava notas:**

```bash
corepack pnpm --filter @screena/ratings ratings:omdb -- --id=tt3896198 --sample
```

**Apply — grava `external_ratings` (as notas nascem fail-closed; a licença decide se acendem):**

```bash
corepack pnpm --filter @screena/ratings ratings:omdb -- --type=movie --limit=20 --apply
```

**Séries:**

```bash
corepack pnpm --filter @screena/ratings ratings:omdb -- --type=tv --limit=20 --apply
```

**Reprocessar ignorando o frescor (após mudança de licença/política):**

```bash
corepack pnpm --filter @screena/ratings ratings:omdb -- --type=movie --limit=50 --apply --ignore-freshness
```

**Validar o adapter contra PostgreSQL real, com os triggers ativos:**

```bash
corepack pnpm --filter @screena/ratings validate:omdb
```

Flags aceitam `--flag=valor` e `--flag valor`. Valor ausente, flag desconhecida
ou valor inválido **falham** com erro claro — nunca default silencioso.

---

## 6. Diagnóstico

| Sintoma | Causa provável |
| --- | --- |
| `Bloqueado: ... exigem OMDB_API_KEY` | chave ausente no ambiente do worker |
| `Bloqueado: ... exigem DATABASE_URL` | sem banco; um sync sem log seria ingestão silenciosa |
| `Bloqueado: consultar a OMDb em producao exige CINERIE_RATINGS_PROVIDER_AUTHORIZED=true` | falta a autorização humana de licença |
| `Bloqueado: o provedor Film & Show Ratings esta DESLIGADO` | rodou o worker errado; use `sync-omdb-ratings.ts` |
| Recusa `omdb-error-response` | a OMDb respondeu `Response: "False"` **com HTTP 200**. O campo `Error` está no detalhe: id inexistente, chave inválida ou cota estourada |
| Recusa `unrecognized-source` | a OMDb passou a publicar uma fonte nova. O valor bruto está no detalhe; estenda `services/ratings/src/omdb/sources.ts` |
| Recusa `scale-mismatch` | a escala do payload divergiu da canônica da fonte. **Nunca converta** — investigue o upstream |
| Recusa `redundant-field-divergence` | `imdbRating`/`Metascore` divergiram do array. O array prevalece; a divergência fica registrada |
| Nota gravada mas `display_allowed=false` | o console traz o motivo exato (`missing-attribution`, `no-license`, `no-usage-decision`, `unclassified`...). Nenhuma recusa é silenciosa |
| `0 consultados`, `N pulados por frescor` | **saudável** — ver seção 4 |

---

## 7. As três fontes, e por que elas nunca colapsam

Um payload da OMDb carrega **três fontes editoriais distintas**:

| `Ratings[].Source` | `rating_source` | `metric` | formato | escala |
| --- | --- | --- | --- | --- |
| `Internet Movie Database` | `imdb` | `audience` | `7.6/10` | 10 |
| `Rotten Tomatoes` | `rotten_tomatoes` | `critics` | `85%` | 100 |
| `Metacritic` | `metacritic` | `critics` | `67/100` | 100 |

`provider_api = "omdb"` é o fornecedor **técnico** e nunca a fonte de nota
nenhuma (**invariante 2**). Cada nota fica na escala da **sua** fonte — nada é
reescalado, e `85%` do Rotten Tomatoes não é `8,5` de coisa nenhuma
(**invariante 1**).

Uma `Source` fora dessa tabela **não vira nota**: é recusada como
`unrecognized-source` com o valor bruto no log.
