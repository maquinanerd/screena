# Recuperacao de texto: o que medir em producao antes e depois

> Escrito em 2026-08-28, junto do conserto do extrator e do teto do censo.
> Este documento existe porque **o agente nao alcanca o banco de producao**: o
> `DATABASE_URL` resolve `rss_prime_screen-db`, hostname interno do Docker, que
> nao existe fora do host. Toda medicao aqui e um bloco de SQL para o **operador**
> rodar e colar de volta.
>
> Caminho: Painel -> projeto `rss_prime` -> servico `screen-db` -> icone `>_` ->
> aba **Bash** -> `psql -U screena -d screena`. A aba "Postgres Client" **nao
> serve** (tenta conectar como role `postgres`, que nao existe nesse cluster).

---

## 0. A armadilha que este documento existe para desarmar

**"A pagina ainda nao mudou" NAO e prova de que a extracao falhou.**

Desde 28/08 as 10 rotas de ficha tem ISR (`s-maxage=3600`) e uma Cache Rule da
Cloudflare serve essas paginas do edge. Depois de um backfill:

| onde | quanto tempo a versao ANTIGA continua sendo servida |
| --- | --- |
| edge da Cloudflare | ate **1 hora** |
| navegador do visitante | ate **4 horas** |

Recarregar a pagina — mesmo com Ctrl+F5 — pode continuar batendo no edge. Quem
for conferir assim vai concluir que o backfill nao fez nada.

**Confira nesta ordem:**

1. **O banco**, que e a unica fonte que nao tem cache:
   ```sql
   SELECT summary FROM entity_translations
    WHERE entity_type = 'movie' AND entity_id = <id> AND language_code = 'pt-BR';
   ```
2. **O veredito**, que so muda quando o produtor roda de novo:
   ```bash
   pnpm catalog index-decisions --dry-run
   ```
   Preencher a sinopse **nao reescreve** `page_indexability_decisions` sozinho.
3. **A pagina**, por ultimo: purgue o cache da Cloudflare para a URL e abra em
   janela anonima.

E ha um segundo degrau, que vale so para pessoa: **preencher
`people.biography` nao tira a pessoa de `no_biography`.** A politica exige texto
**e** licenca, e `biography_source_status` nasce `unknown`. Ver a secao 4.

---

## 1. O censo, agora sem o teto (Item A.4)

Ate 2026-08-28 o produtor tinha `limit ?? 100_000` como `LIMIT` de SQL **por
tipo**. `season`, `episode` e `person` batiam nele e o censo reportava
exatamente 100.000 avaliadas para cada um. Os tres numeros redondos iguais eram
o teto se apresentando como total — e com o denominador errado o `flipRatio` do
freio tambem estava errado.

O default agora e **sem teto** (leitura paginada por chave). Rode:

```bash
pnpm catalog index-decisions --dry-run --json
```

No JSON, os campos novos:

- `truncatedTypes` — vazio significa que `evaluated` e o **total real**;
- `byEntityType.<tipo>.truncated` — booleano por tipo.

E em texto o comando avisa no topo quando truncou. Se `truncatedTypes` vier
nao-vazio sem voce ter passado `--limit`, isso e bug — reporte.

> **Cuidado com o tempo.** Sem teto, `episode` e `person` passam a ser varridos
> inteiros. A primeira execucao demora muito mais que as anteriores. O ciclo
> horario roda com `--apply` e sem `--confirm-mass-change`: com o catalogo no
> estado atual ele continua **bloqueado pelo freio**, gravando zero linhas — o
> que muda e que agora ele mede o universo certo antes de recusar.

---

## 2. Quantos titulos a extracao recupera (Itens B e D)

O backfill nao chama o TMDB: le o payload que ja esta em `api_cache` /
`tmdb_raw`. O `--dry-run` **executa de verdade** e devolve a medicao:

```bash
pnpm catalog backfill-text --dry-run --json
```

Leia, no JSON:

| campo | o que responde |
| --- | --- |
| `candidates` | quantos titulos/pessoas estao sem texto |
| `recovered` | quantos a extracao consegue preencher |
| `bySource.translations` | quantos vieram do bloco (o conserto desta leva) |
| `bySource.detail` | quantos ja estavam no campo de topo |
| `byPayloadSource` | de qual tabela o payload foi lido |
| `skipped.no_stored_payload` | sem payload guardado — nao ha o que extrair |
| `skipped.no_text_in_payload` | ha payload e ele nao tem o texto em pt-BR |
| `skipped.only_pt_pt` | **Item E**: so pt-PT existe (nao recuperado) |
| `recoverableOnlyWithPtPt` | o mesmo numero, no topo do relatorio |
| `ptPtSamples` | ate 20 sinopses `pt-PT` reais, para o dono julgar |

Depois, com `--apply`, `written` conta as linhas gravadas e
`refusedExistingText` conta as escritas que o PostgreSQL recusou porque ja havia
texto. Numa segunda execucao, `written` tem de ser **0**.

---

## 3. Quantos dos titulos sem sinopse estao em `dead_letter` (Item A.5)

Ha uma terceira causa possivel, alem de "o TMDB nao tem" e "nos nao extraimos":
**a sincronia nunca completou**. Uma entidade cujo `sync_details` esgotou as
tentativas nao tem dado de detalhe nenhum — e portanto nao tem sinopse por um
motivo que nenhum backfill de extracao resolve.

```sql
-- 3a. Os mortos, por motivo.
SELECT job_type, entity_type, last_error_code, COUNT(*) AS n
  FROM catalog_jobs
 WHERE status = 'dead_letter'
 GROUP BY 1, 2, 3
 ORDER BY n DESC;

-- 3b. Quantos titulos SEM SINOPSE tem um sync_details morto.
--     `external_id` guarda o tmdb_id como texto.
WITH mortos AS (
  SELECT DISTINCT entity_type, external_id
    FROM catalog_jobs
   WHERE status = 'dead_letter' AND job_type = 'sync_details'
     AND external_id ~ '^[0-9]+$'
)
SELECT 'movie' AS tipo,
       COUNT(*) FILTER (WHERE d.external_id IS NOT NULL) AS sem_sinopse_e_morto,
       COUNT(*)                                          AS sem_sinopse_total
  FROM movies m
  LEFT JOIN mortos d ON d.entity_type = 'movie' AND d.external_id = m.tmdb_id::text
 WHERE NOT EXISTS (SELECT 1 FROM entity_translations t
                    WHERE t.entity_type = 'movie' AND t.entity_id = m.id
                      AND BTRIM(COALESCE(t.summary,'')) <> '')
UNION ALL
SELECT 'tv',
       COUNT(*) FILTER (WHERE d.external_id IS NOT NULL),
       COUNT(*)
  FROM tv_shows s
  LEFT JOIN mortos d ON d.entity_type = 'tv' AND d.external_id = s.tmdb_id::text
 WHERE NOT EXISTS (SELECT 1 FROM entity_translations t
                    WHERE t.entity_type = 'tv' AND t.entity_id = s.id
                      AND BTRIM(COALESCE(t.summary,'')) <> '');

-- 3c. E quantos simplesmente NUNCA foram sincronizados (sem payload guardado).
--     Este e o balde que nem extracao nem reprocessamento alcancam sem cota.
SELECT COUNT(*) AS sem_payload_nenhum
  FROM movies m
 WHERE NOT EXISTS (SELECT 1 FROM entity_translations t
                    WHERE t.entity_type = 'movie' AND t.entity_id = m.id
                      AND BTRIM(COALESCE(t.summary,'')) <> '')
   AND NOT EXISTS (SELECT 1 FROM api_cache c
                    WHERE c.provider_api = 'tmdb'
                      AND c.endpoint = '/movie/' || m.tmdb_id::text)
   AND NOT EXISTS (SELECT 1 FROM tmdb_raw r
                    WHERE r.entity_type = 'movie' AND r.tmdb_id = m.tmdb_id);
```

Se 3b for parcela relevante, a recuperacao tem **tres** caminhos e nao dois — e
o terceiro e **reprocessar** (`catalog dead-letter replay`), nao extrair. Isso e
uma leva propria: nao reprocesse junto do backfill.

---

## 4. `no_biography`: por que preencher nao basta

```sql
-- Das pessoas em `no_biography`, quantas ja tem TEXTO e estao presas so na licenca.
SELECT
  COUNT(*)                                                        AS total,
  COUNT(*) FILTER (WHERE BTRIM(COALESCE(biography,'')) <> '')     AS com_texto,
  COUNT(*) FILTER (WHERE BTRIM(COALESCE(biography,'')) = ''
                      OR biography IS NULL)                       AS sem_texto,
  COUNT(*) FILTER (WHERE biography_source_status <> 'unknown')     AS licenca_definida
  FROM people;
```

`biography_source_status` nasce `unknown` e **nada no repositorio o altera** —
nem CLI, nem migration, nem worker (verificado repo-wide em 2026-08-28). Enquanto
ele for `unknown`, `has_biography` e falso mesmo com o texto na coluna.

Liberar a exibicao e **decisao de licenca**, humana por definicao (CLAUDE.md
secao 6, invariante 6). Ou seja: **as 32.087 pessoas em `no_biography` nao saem
de la por extracao.** Extrair enche a coluna; quem acende a pagina e a decisao.

---

## 5. `missing_slug` de pessoa: por que 66.688 (Item C)

O mecanismo esta identificado no codigo, e nao depende de medicao:

`upsertPeopleStubs` (`services/ingestion/src/persistence/store.ts`) cria uma
linha em `people` para **cada** membro de elenco e equipe de **cada** titulo
ingerido — o `append_to_response=credits` traz o elenco inteiro. Esse caminho
**nunca** chama `createPrismaCatalogFinalize`: nao cria slug, nao cria traducao.

Slug de pessoa nasce em apenas dois lugares:

1. `sync_details` com `kind='person'` (`finalizeDetail` em `catalog-services.ts`);
2. a promocao de `tmdb_raw` (`raw-promote/run.ts`).

Os dois so rodam para pessoas **explicitamente enfileiradas**. Uma pessoa que
entrou como efeito colateral do elenco de um filme nunca passa por nenhum deles.
Dai a proporcao: duas de cada tres pessoas do catalogo.

O reparo ja existe e e operacional, nao de codigo: `catalog backfill-finalization`
cria slug para as pessoas **elegiveis** (com pelo menos um credito em obra
publicavel). A quebra por causa:

```sql
WITH sem_slug AS (
  SELECT p.id, p.tmdb_id, p.name,
         (SELECT COUNT(*) FROM cast_members cm
            JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
             AND ws.language_code = 'pt-BR' AND ws.is_canonical
           WHERE cm.person_id = p.id AND cm.entity_type IN ('movie','tv'))
       + (SELECT COUNT(*) FROM crew_members rm
            JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
             AND ws.language_code = 'pt-BR' AND ws.is_canonical
           WHERE rm.person_id = p.id AND rm.entity_type IN ('movie','tv')) AS creditos_publicaveis,
         EXISTS (SELECT 1 FROM api_cache c
                  WHERE c.provider_api = 'tmdb'
                    AND c.endpoint = '/person/' || p.tmdb_id::text) AS ja_sincronizada
    FROM people p
   WHERE NOT EXISTS (SELECT 1 FROM slugs s
                      WHERE s.entity_type = 'person' AND s.entity_id = p.id
                        AND s.language_code = 'pt-BR' AND s.is_canonical)
)
SELECT COUNT(*)                                                      AS sem_slug_total,
       COUNT(*) FILTER (WHERE BTRIM(COALESCE(name,'')) = '')         AS nome_vazio,
       COUNT(*) FILTER (WHERE name !~ '[A-Za-z0-9]')                 AS sem_caractere_latino,
       COUNT(*) FILTER (WHERE creditos_publicaveis = 0)              AS sem_credito_publicavel,
       COUNT(*) FILTER (WHERE creditos_publicaveis > 0)              AS ELEGIVEIS_A_SLUG,
       COUNT(*) FILTER (WHERE NOT ja_sincronizada)                   AS nunca_sincronizada
  FROM sem_slug;
```

**`ELEGIVEIS_A_SLUG` e a resposta ao C.4**: quantas pessoas voltariam a ter URL
rodando `catalog backfill-finalization --entity person --apply`.

Repare que `sem_credito_publicavel` tende a ser a maioria — e ela **encolhe
sozinha** conforme filmes e series recuperam sinopse e voltam a ser publicaveis.
Medir pessoa **antes** de recuperar filme/serie subestima o resultado.

> Os slugs `tmdb-1465816` / `tmdb-1729257` (titulos em alfabeto grego onde a
> transliteracao caiu no id) sao outro mecanismo: ali o slug **existe**, so e
> feio. Nao confundir com ausencia de slug.

---

## 6. Item E: pt-PT — medicao, nao implementacao

`recoverableOnlyWithPtPt` e `ptPtSamples` do `backfill-text --dry-run --json`
(secao 2) respondem E.1 e E.2 sem consulta extra. O extrator **recusa** `pt-PT`
de proposito, e ha teste travando isso
(`localized-text-extraction.test.ts`, caso 6): se um dia `pt-PT` entrar, aquele
teste fica vermelho — que e como a mudanca se torna visivel em vez de silenciosa.

Aceitar portugues europeu numa pagina pt-BR e **escolha editorial do dono**.

---

## 7. Ordem de execucao recomendada

Cada passo muda o denominador do seguinte; fora de ordem, os numeros mentem.

1. `pnpm catalog index-decisions --dry-run --json` — censo **de verdade**, sem teto.
2. `pnpm catalog backfill-text --dry-run --json` — quanto da para recuperar.
3. secao 3 — quanto esta preso em `dead_letter` (medir; **nao** reprocessar).
4. `pnpm catalog backfill-text --apply` — recupera filme/serie/pessoa.
5. `pnpm catalog backfill-finalization --entity person --apply` — slug de pessoa,
   **depois** do passo 4 (mais titulos publicaveis = mais pessoas elegiveis).
6. `pnpm catalog index-decisions --dry-run --json` — o censo **refeito**, para
   comparar com o passo 1.
7. So entao decidir sobre `--apply` da indexabilidade — que continua sendo
   **decisao humana** e passa pelo freio de mudanca em massa.
