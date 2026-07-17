# RATING_ATTRIBUTION — Governanca de Ratings da Cinerie

> Documento canonico de governanca de ratings. Define como Cinerie
> armazena, atribui e exibe notas de fontes externas (IMDb, Rotten Tomatoes,
> Metacritic, Letterboxd, FilmAffinity e outras). Em caso de conflito entre
> codigo e este documento, **este documento prevalece** e o codigo deve ser
> corrigido.

Este e o documento mais critico de governanca de ratings do projeto. Ele
existe para garantir uma coisa simples e inegociavel: **cada nota pertence a
sua fonte original, com sua propria escala, seu proprio rotulo e sua propria
atribuicao — e nunca, em hipotese alguma, e apresentada como nota da Cinerie
nem misturada com a nota de outra fonte.**

Reforca diretamente os invariantes:

- **Invariante 1** — IMDb != Rotten Tomatoes: nunca misturar fontes, escalas,
  icones ou linguagem.
- **Invariante 2** — `provider_api` != `rating_source`: o fornecedor tecnico
  (ex.: RapidAPI) nunca e a fonte editorial.
- **Invariante 6** — Dados sem licenca clara (`license_status` `unknown`/
  `blocked` ou `display_allowed=false`) nao aparecem em pagina indexavel.

---

## 1. Mantra (decore isto)

> **IMDb e IMDb.**
> **Rotten Tomatoes e Rotten Tomatoes.**
> **Metacritic e Metacritic.**
> **Letterboxd e Letterboxd.**
> **FilmAffinity e FilmAffinity.**
> **`provider_api` NUNCA e a fonte editorial.**

Cada fonte tem:

- sua **propria escala** (10, 100, 5...);
- seu **proprio rotulo** humano (`rating_label`, ex.: "Tomatometer");
- sua **propria metrica** tecnica (`metric`, ex.: `critic_score`);
- sua **propria atribuicao** (`attribution_text`, `attribution_url`);
- sua **propria licenca** (`source_licenses`).

E **proibido**:

- somar, combinar ou tirar media entre fontes diferentes para gerar um numero;
- reutilizar o icone/linguagem de uma fonte para outra (ex.: tomate para IMDb);
- chamar o fornecedor tecnico (`provider_api`) de fonte da nota;
- apresentar qualquer nota externa como se fosse nota propria da Cinerie.

O `provider_api` (ex.: `imdb236`, `rapidapi_xyz`) e apenas o **canal tecnico**
por onde o dado chegou. Ele entra em logs, auditoria e cache — **nunca** vira
a fonte editorial exibida ao leitor.

---

## 2. Tabela de fontes e escalas

Escalas canonicas. Qualquer ingestao que produza valor fora da escala da fonte
deve falhar na validacao, nunca ser "ajustada" para outra escala.

| `rating_source`   | Escala (`rating_scale`) | Dono editorial   | Exemplos de `metric`                         | Exemplos de `rating_label`            |
| ----------------- | ----------------------- | ---------------- | -------------------------------------------- | ------------------------------------- |
| `imdb`            | `10`                    | IMDb             | `imdb_user_rating`                           | "IMDb"                                |
| `rotten_tomatoes` | `100`                   | Rotten Tomatoes  | `critic_score`, `audience_score`             | "Tomatometer", "Popcornmeter"         |
| `metacritic`      | `100`                   | Metacritic       | `metascore`, `user_score`                    | "Metascore", "User Score"             |
| `letterboxd`      | `5`                     | Letterboxd       | `letterboxd_rating`                          | "Letterboxd"                          |
| `filmaffinity`    | `10`                    | FilmAffinity     | `filmaffinity_rating`                        | "FilmAffinity"                        |

Observacoes obrigatorias:

- `rotten_tomatoes` possui **dois meters distintos** que pertencem so ao Rotten
  Tomatoes: **Tomatometer** (criticos, `metric=critic_score`) e **Popcornmeter**
  (audiencia, `metric=audience_score`). Nunca renomear, fundir ou usar esses
  termos para outra fonte.
- O **User Score** do Metacritic e do Metacritic e usa escala `100` na
  modelagem canonica (mesmo quando a UI do Metacritic exibe 0–10); preserve a
  escala registrada em `rating_scale` e nunca converta entre meters.
- A escala vive em `rating_scale` por linha. **Nao** assuma a escala pelo
  `rating_source` no render: leia sempre o campo.

---

## 3. Tabela `external_ratings` (colunas canonicas + exemplos)

Colunas-chave (CANON): `rating_source`, `rating_label`, `metric`,
`rating_value`, `rating_scale`, `rating_count`, `rating_url`, `provider_api`,
`provider_payload_hash`, `fetched_at`, `attribution_text`, `attribution_url`,
`license_status`, `display_allowed`.

| Coluna                  | Significado                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `rating_source`         | Fonte editorial. Ex.: `imdb`, `rotten_tomatoes`. **Nunca** o API.  |
| `rating_label`          | Rotulo humano exibido. Ex.: "IMDb", "Tomatometer".                 |
| `metric`                | Metrica tecnica dentro da fonte. Ex.: `imdb_user_rating`.          |
| `rating_value`          | Valor bruto na escala da fonte. Ex.: `8.4`, `92`.                  |
| `rating_scale`          | Escala da fonte. Ex.: `10`, `100`, `5`. Lida no render.            |
| `rating_count`          | Numero de votos/avaliacoes, quando disponivel.                     |
| `rating_url`            | URL canonica da nota na fonte (deep link da obra).                 |
| `provider_api`          | Canal tecnico de ingestao. Ex.: `imdb236`. So auditoria/log.       |
| `provider_payload_hash` | Hash do payload bruto recebido do `provider_api` (rastreio).       |
| `fetched_at`            | Data/hora da coleta. Mostrada como "atualizado em".                |
| `attribution_text`      | Texto de credito exigido. Ex.: "Fonte: IMDb".                      |
| `attribution_url`       | Link de credito/linkback para a fonte.                             |
| `license_status`        | Status de licenca herdado de `source_licenses`.                    |
| `display_allowed`       | Booleano: pode aparecer em pagina indexavel?                       |

### Exemplos preenchidos

**IMDb — nota de usuario 8.4/10**

| Coluna                  | Valor                                            |
| ----------------------- | ------------------------------------------------ |
| `rating_source`         | `imdb`                                           |
| `rating_label`          | `IMDb`                                            |
| `metric`                | `imdb_user_rating`                               |
| `rating_value`          | `8.4`                                            |
| `rating_scale`          | `10`                                             |
| `rating_count`          | `1284530`                                        |
| `rating_url`            | `https://www.imdb.com/title/ttXXXXXXX/`          |
| `provider_api`          | `imdb236`                                        |
| `provider_payload_hash` | `sha256:a1b2c3...`                               |
| `fetched_at`            | `2026-06-25T09:00:00Z`                           |
| `attribution_text`      | `Fonte: IMDb`                                    |
| `attribution_url`       | `https://www.imdb.com/title/ttXXXXXXX/`          |
| `license_status`        | `third_party`                                    |
| `display_allowed`       | `true`                                           |

**Rotten Tomatoes — Tomatometer (criticos) 92/100**

| Coluna                  | Valor                                                   |
| ----------------------- | ------------------------------------------------------- |
| `rating_source`         | `rotten_tomatoes`                                       |
| `rating_label`          | `Tomatometer`                                           |
| `metric`                | `critic_score`                                          |
| `rating_value`          | `92`                                                    |
| `rating_scale`          | `100`                                                   |
| `rating_count`          | `248`                                                   |
| `rating_url`            | `https://www.rottentomatoes.com/m/exemplo`              |
| `provider_api`          | `rapidapi_rt_provider`                                  |
| `provider_payload_hash` | `sha256:d4e5f6...`                                       |
| `fetched_at`            | `2026-06-25T09:00:00Z`                                  |
| `attribution_text`      | `Fonte: Rotten Tomatoes (Tomatometer)`                  |
| `attribution_url`       | `https://www.rottentomatoes.com/m/exemplo`              |
| `license_status`        | `third_party`                                           |
| `display_allowed`       | `true`                                                  |

> Note que `provider_api` difere por linha (`imdb236` vs
> `rapidapi_rt_provider`) e **nunca** aparece no lugar de `rating_source`. O
> leitor ve "IMDb" e "Tomatometer" — jamais "imdb236" ou "RapidAPI".

---

## 4. Tabela `source_licenses`

Toda fonte tem um registro de licenca. As notas so podem ser exibidas conforme
as flags abaixo. A licenca e a **fonte de verdade** para exibicao; `external_
ratings.display_allowed` deriva dela.

### `license_status` (valores canonicos)

| `license_status` | Significado                                                          | Exibir nota em pagina indexavel? |
| ---------------- | ------------------------------------------------------------------- | -------------------------------- |
| `official`       | Acordo/feed oficial da fonte.                                       | Sim, conforme flags.             |
| `licensed`       | Licenca formal de terceiro autorizado.                             | Sim, conforme flags.             |
| `third_party`    | Dado de terceiro; uso condicionado (atribuicao/linkback).         | Sim **se** flags permitirem.     |
| `unknown`        | Sem licenca clara definida.                                        | **Nao.** So auditoria.           |
| `blocked`        | Uso proibido/expirado/bloqueado.                                   | **Nao.** So auditoria.           |

### Flags

| Flag                    | Permite                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `display_allowed`       | Exibir a nota em pagina indexavel.                                |
| `logo_allowed`          | Exibir o logo/icone da fonte.                                     |
| `score_allowed`         | Exibir o valor numerico da nota.                                  |
| `review_quote_allowed`  | Citar trechos de review da fonte.                                 |
| `requires_attribution`  | Exige `attribution_text` visivel ao lado da nota.                 |
| `requires_linkback`     | Exige link (`attribution_url`) de volta para a fonte.            |

Regras de combinacao:

- `display_allowed=false` **vence tudo**: a nota nao aparece, mesmo que
  `score_allowed=true`.
- `score_allowed=false` com `display_allowed=true`: pode-se mencionar a fonte
  e linkar, mas **nao** mostrar o numero.
- `requires_attribution=true`: nunca exibir a nota sem o credito visivel.
- `requires_linkback=true`: nunca exibir a nota sem o link para a fonte.
- `logo_allowed=false`: usar rotulo textual (`rating_label`), nunca o logo.

---

## 5. Regra de exibicao (gate de indexabilidade)

> **Se `license_status` for `unknown` ou `blocked`, OU se
> `display_allowed=false`, a nota e armazenada para auditoria, mas NAO aparece
> em nenhuma pagina indexavel.** (Invariante 6.)

Fluxo de decisao por nota:

1. `license_status` em (`unknown`, `blocked`)? → **Nao exibe.** Armazena para
   auditoria. Fim.
2. `display_allowed=false`? → **Nao exibe.** Armazena para auditoria. Fim.
3. Caso contrario → exibe **respeitando todas as flags**:
   - `score_allowed` controla mostrar o numero;
   - `logo_allowed` controla logo vs rotulo textual;
   - `requires_attribution` obriga credito visivel;
   - `requires_linkback` obriga link de volta a fonte.

"Armazenar para auditoria" significa: a linha permanece em `external_ratings`
(com `provider_payload_hash`, `fetched_at`, `provider_api`) para rastreio e
historico de sync, mas e filtrada fora de qualquer payload que alimente pagina
publica indexavel. Uma nota nao exibivel **nao conta** como bloco de valor para
o gate anti-thin (Invariante 5).

---

## 6. Politica de AggregateRating

`AggregateRating` (Schema.org) so pode ser usado **quando permitido e
corretamente atribuido**. Ele descreve a nota agregada de **uma** fonte
especifica — nunca uma media inventada pela Cinerie.

Permitido:

- emitir `AggregateRating` **por fonte**, preservando:
  - a **fonte** real (`rating_source` / autor da agregacao);
  - a **escala** (`bestRating` = `rating_scale`, ex.: 10, 100, 5);
  - a **url** canonica (`rating_url` / `attribution_url`);
  - a **atribuicao** (`attribution_text`);
  - a **data de coleta** (`fetched_at`).

Proibido:

- usar `AggregateRating` para **fingir** que uma nota externa e nota propria do
  Cinerie;
- gerar um `AggregateRating` "Cinerie" combinando IMDb + Rotten + Metacritic;
- omitir a fonte, a escala ou a atribuicao no markup;
- exibir `AggregateRating` para nota com `display_allowed=false` ou
  `license_status` `unknown`/`blocked`.

Cinerie so emite `AggregateRating` proprio quando a nota for genuinamente
da Cinerie (ex.: agregacao de avaliacoes da propria comunidade/editorial),
claramente identificada como tal — nunca reembalando nota de terceiro. Esse
recurso ainda **nao** existe no produto atual.

---

## 7. Transformacoes proibidas (lista negra)

Estas conversoes sao **terminantemente proibidas**. Qualquer codigo que as
tente deve falhar em revisao e em validacao automatizada.

- ❌ **IMDb nunca vira Tomatometer.** Uma nota IMDb (escala 10) jamais e
  reescalada/relabelada como Tomatometer (Rotten Tomatoes, escala 100).
- ❌ **Rotten nunca vira nota IMDb.** Tomatometer/Popcornmeter jamais viram um
  numero "IMDb".
- ❌ **`provider_api` nunca substitui `rating_source`.** O canal tecnico
  (`imdb236`, `rapidapi_*`) nunca aparece como fonte editorial nem no banco
  exibivel, nem no schema, nem na UI.
- ❌ Nunca tirar **media entre fontes** para criar um numero unico.
- ❌ Nunca **reescalar** uma nota para a escala de outra fonte (ex.: 8.4/10 →
  84/100 rotulado como Metacritic/Tomatometer).
- ❌ Nunca reutilizar **icone/linguagem** de uma fonte para outra.
- ❌ Nunca tratar **Tomatometer** e **Popcornmeter** como intercambiaveis: sao
  meters distintos de criticos e audiencia, ambos so do Rotten Tomatoes.

Conversao **permitida**: apresentacao **dentro da mesma fonte e escala**
(ex.: formatar `8.4` como "8,4" em pt-BR), preservando `rating_source`,
`rating_label`, `metric` e `rating_scale` intactos.

---

## 8. Checklist de conformidade (revisao)

Antes de exibir qualquer nota, confirme:

- [ ] `rating_source` e a fonte editorial real (nunca `provider_api`).
- [ ] `rating_scale` lido da linha, nao assumido pelo `rating_source`.
- [ ] `license_status` nao e `unknown` nem `blocked`.
- [ ] `display_allowed=true`.
- [ ] Flags respeitadas (`score_allowed`, `logo_allowed`,
      `requires_attribution`, `requires_linkback`).
- [ ] `attribution_text` e `attribution_url` presentes quando exigidos.
- [ ] Nenhuma media/combinacao/reescala entre fontes.
- [ ] `AggregateRating` (se houver) preserva fonte, escala, url, atribuicao e
      `fetched_at`, e nao se passa por nota propria da Cinerie.

Se qualquer item falhar: **nao exibir** — armazenar apenas para auditoria.
