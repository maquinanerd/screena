# O recorte de idioma do catalogo — por que a coluna estava vazia, e em que ordem apagar

> Decisao do dono, 2026-08-31: **"pt, en, es, ja, ko — o resto exclua! e proiba do
> tmdb parar de subir essas coisas."** — Pablo Eduardo.
>
> Leia isto antes de mexer em `original_language`, no gate de entrada do
> catalogo ou em qualquer apagamento em massa de titulo.

---

## 1. A coluna nao estava vazia por ausencia. Estava vazia por descarte.

Medido em producao em 31/08/2026: `original_language` **nulo** em 20.825 filmes
(43%) e 20.680 series (60%). A coluna inteira tinha exatamente **tres** valores
possiveis: `en`, `es` e nulo.

O dado correto sempre esteve no banco. Comparando a coluna com o payload
guardado em `api_cache`:

| title_original | na coluna | no payload |
| --- | --- | --- |
| ధృవ | — | `te` |
| 血まみれスケバンチェーンソー | — | `ja` |
| പുലിമുരുഗന്‍ | — | `ml` |
| Забудь меня, мама! | — | `ru` |
| Ruído Húmido | — | `pt` |
| Тараз | — | `kk` |

**Onde estava a lista fechada:**
[`services/ingestion/src/utils/normalize.ts`](../../services/ingestion/src/utils/normalize.ts),
funcao `normalizeOriginalLanguage`.

**Por que ela existia — e a resposta nao e "allowlist":** era um **guarda de
foreign key**. `movies.original_language` e `tv_shows.original_language` tem FK
para `languages.code`, e a tabela `languages` tinha **tres linhas**: `pt-BR`,
`en`, `es`. Gravar `te` estouraria a FK e derrubaria o job, entao o normalizador
descartava. Ele fazia exatamente o que a FK exigia.

**A causa real e uma conflacao.** `languages` acumulava dois papeis:

- **dicionario de idiomas do mundo** (alvo da FK de `original_language`), e
- **politica de autoria** (em que idioma a ingestao cria slug e traducao).

Como o segundo papel so precisava de tres linhas, o primeiro ficou com tres. E
o portugues era o pior caso: o TMDB emite `pt`, a tabela tinha `pt-BR`, e **todo
titulo brasileiro caia para NULL**.

**E o defeito estava travado por dois testes verdes**, que afirmavam o
comportamento errado como se fosse regra:

- `services/ingestion/src/__tests__/movie.test.ts` — `it('idioma fora do seed -> null (R1)')`,
  usando `'ja'` como exemplo;
- `services/ingestion/src/__tests__/normalize.test.ts` — exigia
  `normalizeOriginalLanguage('ja')` e `('pt')` iguais a `null`.

Japones e portugues: dois dos cinco idiomas que a decisao manda **manter**.

### O conserto

| antes | depois |
| --- | --- |
| `languages` com 3 linhas | 187 linhas: o vocabulario ISO 639-1 completo + `cn`, `sh`, `xx` (os tres desvios que o TMDB emite), em [`packages/db/src/language-vocabulary.ts`](../../packages/db/src/language-vocabulary.ts) |
| politica de autoria = conteudo da tabela | `CONTENT_AUTHORING_LOCALES` em `@screena/config` — mesmo conjunto de antes (`pt-BR`, `en`, `es`), agora explicito |
| descarte silencioso | `readOriginalLanguage` devolve o codigo **recusado**; o backfill conta por codigo e imprime |

> **Por que a politica precisou sair da tabela.** O gate de autoria era
> `prisma.language.findUnique` — "existe linha?". Com o dicionario completo,
> `pt` passa a existir; e `CATALOG_WORKER_LOCALE` e variavel de ambiente. Um
> `--locale pt` criaria um **segundo slug** ao lado do `pt-BR` de todo titulo ja
> publicado. Travado por `tests/.../detail-finalize-guards.test.ts`, cujo check
> (4) inverteu de polaridade: agora exige a **ausencia** da consulta.

---

## 2. A ordem nao e sugestao. Ela e o que impede um acidente.

```
A. recuperar o idioma   ->   B. medir   ->   (OK do dono)   ->   D. apagar
```

Antes do backfill, um filme japones e um filme telugo sao **a mesma coisa** na
coluna: ambos `NULL`. `pt`, `ja` e `ko` — tres dos cinco que ficam — estavam
gravados exatamente como os que saem.

Duas protecoes, e elas sao diferentes:

1. **Fail-safe do predicado.** `outsideAllowlistPredicate` exige
   `original_language IS NOT NULL`. Uma linha nula **nunca** e alvo, nem por
   engano, nem forcada. Provado no check 6 do validador.
2. **Intertravamento.** `runLanguageCutdown` **recusa** rodar enquanto houver
   qualquer titulo com idioma nulo. Nao e aviso — e recusa com exit code. Sem
   isso, apagar so os nao-nulos deixaria 41 mil titulos sem classificacao, a
   medicao da Parte B seria sobre 57% do catalogo, e a "limpeza dos nulos" que
   viria depois mataria o cinema brasileiro.

---

## 3. A cascata REAL — e a armadilha que ninguem preve

**Leia as FKs, nao suponha.** `describeDeleteCascade` consulta `pg_constraint` no
banco vivo e reporta `confdeltype` de cada FK. O que ela mostra:

### Cascateia (o PostgreSQL leva sozinho)

```
tv_shows -> seasons -> episodes
movies/tv_shows -> movie_genres, tv_show_genres,
                   movie_production_companies, tv_production_companies,
                   movie_production_countries, tv_show_production_countries,
                   tv_networks, movie_collection_memberships,
                   entity_detail_facts
```

### Nao cascateia — 24 tabelas polimorficas `(entity_type, entity_id)`

`slugs`, `entity_translations`, `cast_members`, `crew_members`,
`entity_external_ids`, `external_ratings`, `watch_availability`,
`cinerie_score_calculations`, `search_documents`,
`page_indexability_decisions`, `content_blocks`, `entity_alternative_titles`,
`entity_awards`, `entity_keywords`, `entity_news_links`, `entity_writer_jobs`,
`entity_writer_logs`, `hero_curation_decisions`, `user_list_items`,
`user_ratings`, `user_recommendation_feedback`, `user_reviews`,
`user_viewing_events`, `user_watch_states`.

### A ARMADILHA: elas nao sao sem FK

**21 delas apontam para `entities` com `ON DELETE RESTRICT`.** E `entities` e
mantida por **trigger** (`*_entity_registry_ins/del`, migration
`20260715120000_data_governance_hardening`). Consequencia:

```
apagar o filme -> dispara o trigger AFTER DELETE
               -> o trigger apaga a linha de `entities`
               -> o RESTRICT ABORTA se qualquer filha ainda existir
```

Ou seja: um `DELETE` em massa sem limpar as polimorficas antes **nao deixa
orfas — ele falha**. E `entities` nao pode ser apagada a mao antes das filhas:
produz o mesmo RESTRICT ao contrario. (Foi o que a primeira versao deste modulo
fez, e o validador contra PostgreSQL real reprovou antes de qualquer producao
ver.)

### Chaveadas por TMDB ID, nao pelo id interno

`tmdb_images`, `tmdb_videos`, `title_recommendations`, `api_cache`, `tmdb_raw`.
Usar `movies.id` aqui apaga a linha de outro titulo.

### Bloqueia o delete

`user_episode_progress -> episodes`, `ON DELETE RESTRICT`. Se um usuario tem
progresso num episodio de serie que sai, o lote aborta. O `--dry-run` conta essas
linhas em `blockingRows` justamente para descobrir antes.

### Fora do apagamento, com motivo

- `entities` — mantida por trigger (acima).
- `entity_reference_orphans` — tabela de **auditoria**. Ela registra que algo deu
  errado; apagar o registro junto com o dado apagaria a prova.

A lista e **fechada**: o validador compara `POLYMORPHIC_TITLE_TABLES` +
`POLYMORPHIC_TABLES_DELIBERATELY_EXCLUDED` com `information_schema` e falha se
alguma tabela do banco nao estiver em nenhuma das duas.

---

## 4. O bloqueio na entrada

**O filtro nao pode ser antes do detalhe.** A descoberta usa os **Daily ID
Exports**, que trazem `id`, `original_title`/`original_name`, `popularity`,
`adult` e `video` — e **nao trazem idioma**.

| opcao | custo | por que nao |
| --- | --- | --- |
| `/discover` com `with_original_language` | ~5 requisicoes por pagina de 20, por idioma, por vertical | Nao substitui o export: `/discover` **satura em 500 paginas (10.000 resultados)** por consulta. Um catalogo de 5,4 M ids nao cabe. Serviria para *priorizar*, nunca para *enumerar*. |
| **filtrar depois do detalhe, antes de persistir** | **zero requisicoes adicionais** | O detalhe ja e buscado. E o filtro evita o trabalho *seguinte*: uma serie recusada nao dispara `sync_seasons` nem `sync_episodes`. |

**Onde o filtro foi posto:** [`services/ingestion/src/persistence/store.ts`](../../services/ingestion/src/persistence/store.ts),
dentro de `upsertMovie`/`upsertTvShow`. Os **tres** caminhos que criam titulo
(`import/import-*.ts`, `persistence/catalog-services.ts`, `raw-promote/run.ts`)
passam por ali. Um filtro repetido tres vezes e um filtro que um dia sera
esquecido numa delas.

**E gate de CRIACAO, nao de atualizacao.** Titulo que ja existe continua sendo
atualizado — congelar linhas que a Parte D vai apagar so geraria falha em massa
nos jobs de reparo.

**Configuracao, nao literal:** `CINERIE_CATALOG_LANGUAGES` (lista por virgula)
sobrescreve o default. Variavel vazia ou malformada **cai para o default** — um
erro de digitacao no painel nao pode virar "aceite qualquer idioma".

**Sem descarte silencioso.** `EntityUpsertResult` e uma **uniao**: o TypeScript
obriga cada um dos oito pontos de chamada a dizer o que faz com a recusa. E cada
recusa vira uma linha em `api_sync_logs` com `status = 'empty'` e
`error_code = 'language_not_allowed:<codigo>'`. O log de C.4 sai de uma consulta:

```sql
SELECT date_trunc('day', created_at) AS dia, error_code, count(*)
  FROM api_sync_logs
 WHERE status = 'empty' AND starts_with(error_code, 'language_')
 GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;
```

`language_unknown` (payload sem idioma) fica **separado** de
`language_not_allowed:*`. Juntar os dois esconderia um defeito nosso dentro de
uma decisao do dono.

---

## 5. Runbook

Tudo roda no console do painel (`rss_prime` -> `screen-db` -> `>_` -> aba
**Bash**), ou no container do worker para os comandos `catalog`.

### Passo 1 — recuperar o idioma (obrigatorio, primeiro)

```bash
pnpm catalog backfill-language --dry-run --json
pnpm catalog backfill-language --apply
```

Zero chamadas ao TMDB (`externalCallsMade` e sempre 0, e esta no relatorio para
ser conferido). Retomavel por construcao: o conjunto de candidatos e
`original_language IS NULL`, e preencher uma linha a retira do conjunto.

Confira `unknownCodes` no relatorio: cada codigo ali e **uma linha que falta em
`LANGUAGE_VOCABULARY`**, nao um titulo sem idioma.

### Passo 2 — medir (Parte B) e reportar ao dono

```bash
pnpm catalog language-cutdown --dry-run
```

Imprime B.1 (tabela por idioma com FICA/SAI), B.2 (o que sai com cascata,
pessoas orfas, peso em `api_cache`), B.3 (**os que saem tendo oferta no Brasil ou
sinopse pt-BR, com os 30 mais populares**), D.2 (cascata lida do banco) e D.3
(linhas por tabela).

**Pare aqui.** B.3 e a decisao do dono. Abrir excecao para um idioma e
`CINERIE_CATALOG_LANGUAGES`, nao um PR.

### Passo 3 — dump (sem dump nao ha apagamento)

```bash
pg_dump -U screena -d screena -Fc -f /tmp/cinerie-pre-cutdown-$(date +%F).dump
```

Reporte caminho e tamanho antes de seguir.

### Passo 4 — apagar

```bash
pnpm catalog language-cutdown --apply --confirm-mass-change
```

Dois freios (`--apply` **e** `--confirm-mass-change`) mais o intertravamento de
idioma nulo. Lotes de 500 titulos, uma transacao por lote.

### Passo 5 — o disco nao volta sozinho

Apagar marca linhas mortas e reusa paginas; **nao devolve espaco ao sistema
operacional**. Para isso e preciso `VACUUM FULL` (que trava a tabela) ou
`pg_repack`. Decisao de operacao, fora do comando.

---

## 6. Como isto e provado

[`services/ingestion/scripts/validate-language-cutdown-real-postgres.ts`](../../services/ingestion/scripts/validate-language-cutdown-real-postgres.ts)
— **38 checks contra PostgreSQL 16 efemero com o schema de producao**:

```bash
pnpm --filter @screena/ingestion validate:language-cutdown
```

O que so um banco real prova, e que nenhum fake reproduz:

- que a FK aceita o vocabulario inteiro (o defeito era ela);
- que o backfill acha o payload em `api_cache` **e** em `tmdb_raw`;
- que a cascata e a que o banco tem — inclusive o `RESTRICT` sobre `entities`,
  que so apareceu quando o `DELETE` abortou de verdade;
- que as polimorficas somem para o titulo apagado **e ficam intactas para o que
  fica** — este e o "so o que devia";
- que a pessoa que perdeu **todos** os creditos some e a que perdeu **alguns**
  fica;
- que a porta impede o titulo apagado de voltar amanha.

O formato previsivel de fracasso desta leva era reportar "N linhas apagadas" sem
verificar que a cascata levou o que devia e so o que devia. Os checks 28-35 sao
exatamente essa verificacao.
