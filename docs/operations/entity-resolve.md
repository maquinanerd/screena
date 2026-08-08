# Resolucao de entidade (`POST /api/internal/entity-resolve`)

> O tradutor entre o mundo do MNScr (NOMES) e o mundo do `screen-db` (IDS).
> Rota do **screen-app**, nao do CMS — o catalogo vive no `screen-db`, e o CMS
> nao alcanca aquele banco (ADR 0015).

## 1. O problema que ela fecha

`entityCard.entityId` e um id **interno** do catalogo — `/^[1-9][0-9]*$/`, em
`apps/cms/src/publication-intake.ts`. O CMS **nao tem como conferir** esse
numero: o catalogo esta no outro banco. Por isso ele aceita qualquer inteiro e
responde `201`.

Quem confere e a **renderizacao**. E quando ela nao acha, ela **descarta em
silencio**:

| Entrada | O que acontece hoje |
| --- | --- |
| id inexistente | o bloco some da materia, e ninguem e avisado |
| id existente e **errado** | a pagina mostra a **obra errada** com cara de certo |

O segundo e o caro. Esta rota existe para que o MNScr nunca precise adivinhar o
numero.

**A regra que organiza a rota inteira: um `null` e inofensivo; um id errado e
uma mentira publicada.** Nada aqui devolve palpite.

## 2. Credencial

```
Authorization: Bearer <chave>
```
`API-Key <chave>` tambem e aceito — e a forma que o MNScr ja usa com o CMS.

**Escopo proprio: `catalog_resolve`.** Ele **nao** reaproveita `draft_ingest`
nem `editorial_media_ingest`, e a razao nao e simetria: aqueles escopos vivem na
collection `service-accounts` do banco do **CMS**, e esta rota esta no
`screen-app`. Reaproveitar uma daquelas chaves faria uma unica credencial vazada
abrir os **dois lados** da fronteira.

Como o `screen-app` nao tem tabela de contas tecnicas, o escopo e declarado pelo
**nome da variavel** (§7). Uma lista de escopos por chave seria cerimonia sobre
um conjunto de um elemento.

**A rota nasce desligada.** Sem chave configurada ela responde `503
resolver_disabled` — nao ha flag `*_ENABLED` separada, porque ela so criaria o
estado "ligada e sem credencial".

## 3. Pedido

```http
POST /api/internal/entity-resolve
Authorization: Bearer <chave>
Content-Type: application/json
```

```jsonc
{
  "items": [
    { "kind": "movie",  "tmdbId": 550 },
    { "kind": "movie",  "title": "Clube da Luta", "year": 1999 },
    { "kind": "tv",     "title": "Ruptura",       "year": 2022 },
    { "kind": "person", "name":  "Morgan Freeman" }
  ]
}
```

| Campo | Obrigatorio | Notas |
| --- | --- | --- |
| `kind` | sim | `movie` \| `tv` \| `person`. Outro valor -> `unsupported_kind` |
| `tmdbId` | — | inteiro positivo. **Caminho preferencial** |
| `title` / `name` | — | o **mesmo campo** com dois nomes; os dois sao aceitos |
| `year` | para `movie`/`tv` sem `tmdbId` | ano de estreia (1870–2200) |

- **Maximo `50` itens por chamada.** Acima disso o pedido **inteiro** e recusado
  (`422 too_many_items`) — nunca truncado: truncar devolveria menos resultados
  do que itens enviados, e o cliente alinharia os resultados errados aos itens
  errados.
- Corpo maximo: **64 KB**.
- `season` e `episode` **nao sao resolviveis** aqui. Eles nao tem titulo proprio
  estavel ("Temporada 2" existe as centenas) e so se identificam pela serie mais
  o numero — outro contrato, com outra chave. Pedir um deles devolve
  `unsupported_kind`, e nao um palpite.

## 4. Resposta

`200`, sempre com **um resultado por item, na mesma ordem** — inclusive para os
itens que nao resolveram.

```jsonc
{
  "results": [
    {
      "index": 0,
      "entityKind": "movie",
      "entityId": "4210",                     // id INTERNO do catalogo
      "matchedBy": "tmdb_id",
      "confidence": 1,
      "canonicalTitle": "Clube da Luta",
      "path": "/pt/filmes/clube-da-luta/",
      "reason": null
    },
    {
      "index": 1,
      "entityKind": "movie",
      "entityId": null,
      "matchedBy": null,
      "confidence": 0,
      "canonicalTitle": null,
      "path": null,
      "reason": "ambiguous_title"
    }
  ]
}
```

**Invariante da resposta**, verificada em teste: `entityId === null` se e somente
se `matchedBy === null` e `reason !== null`. Nao existe resultado meio resolvido.

### Os tres casamentos, e so tres

| `matchedBy` | `confidence` | Regra |
| --- | --- | --- |
| `tmdb_id` | `1` | identificador exato + `kind` batendo |
| `exact_title_year` | `0.9` | titulo **dobrado** (ou alias) + **ano** + `kind`, e **unico** |
| `exact_name` | `0.85` | nome dobrado + `kind`, e **unico**. So `person` |

"Dobrado" = sem acentos, minusculo, espacos colapsados, sem espaco nas pontas.
`"  clube DA   luta "` e `"Clube da Luta"` sao o mesmo termo; `"Clube de Luta"`
**nao** e.

### De onde sai o texto que casa

Cinco origens, **todas no catalogo** (o mesmo banco que o `tmdbId` consulta):

| Origem | Cobre |
| --- | --- |
| `entity_translations` (pt-BR) | o titulo pt-BR — o mesmo que a rota devolve em `canonicalTitle` |
| `movies.title_original` | o titulo original do filme |
| `tv_shows.name_original` | o nome original da serie |
| `people.name` | o nome da pessoa |
| `entity_alternative_titles` | os titulos alternativos (o "alias") |

**Isto mudou desde o PR #140, e a mudanca corrige um defeito medido em
producao.** A versao anterior casava contra `search_documents` — a projecao de
busca, escrita por um worker offline (`catalog search-reindex`). Enquanto a
projecao nao alcanca uma entidade, ela existe no catalogo e nao existe na
projecao: `tmdbId` resolve e titulo devolve `not_found`, sem erro, sem log e sem
teste vermelho. Medido: **3 de 3 por id, 0 de 11 por titulo** — com titulos que a
propria rota tinha acabado de emitir em `canonicalTitle`.

Nenhuma parte desta rota le `search_documents`. Ela nao depende de job nenhum
ter rodado.

### A dobra e aplicada aos DOIS lados

A comparacao acontece dentro de uma consulta so, com a **mesma** funcao
(`immutable_fold`, migration
`20260808120000_entity_resolve_folded_title_indexes`) aplicada ao valor da
coluna **e** ao termo procurado.

Nao e "uma dobra em JS igual a uma dobra em SQL". Duas funcoes equivalentes
divergem no primeiro caractere exotico, e o sintoma e mudo — o casamento exato
deixa de casar. Uma funcao so nao tem como divergir de si mesma. O passo de
corpus da §9 mede exatamente essa propriedade, contra banco real.

**Nao ha fuzzy, nao ha prefixo, nao ha "melhor aproximacao".** A busca do site
tem os tres — e esta certa, porque la existe uma pessoa lendo a lista e
escolhendo. Aqui nao existe ninguem: o que sair daqui vira bloco publicado.

`exact_title_year` nao vale `1` porque titulo nao e identificador: duas obras
podem compartilhar titulo, ano e tipo. Quando compartilham, a resposta e `null`
(`ambiguous_title`) — mas a existencia do caso e o que justifica o desconto.

`exact_name` e uma extensao deliberada ao contrato de dois valores: **pessoa nao
tem ano**. Sem ele, o tradutor so traduziria pessoa quando o emissor ja tivesse
o id do TMDB — que e justamente o caso em que ele nao precisa de tradutor. O que
o mantem honesto e a **unicidade**: dois homonimos derrubam para `null`, e nao
para "o mais popular".

### `tmdbId` vence, e nao ha segunda tentativa

Quando o item traz identificador **e** titulo, o identificador decide. Se o
`tmdbId` nao esta no catalogo, a resposta e `tmdb_id_not_in_catalog` — a rota
**nao** tenta o titulo por baixo. Tentar o outro e exatamente como se publica a
obra errada quando os dois campos divergem.

### Motivos (`reason`)

| `reason` | O que fazer |
| --- | --- |
| `unsupported_kind` | `kind` fora de `movie`/`tv`/`person` |
| `no_input` | nem `tmdbId` nem titulo utilizavel |
| `tmdb_id_not_in_catalog` | o item ainda nao foi ingerido — nao cite a entidade |
| `title_requires_year` | mande o ano; sem ele nao ha casamento exato |
| `not_found` | nada bateu |
| `ambiguous_title` | titulo + ano + tipo bateram em mais de uma obra |
| `ambiguous_name` | o nome bateu em mais de uma pessoa |
| `no_canonical_slug` | **a entidade existe e ainda assim nao serve** — ver abaixo |

**`no_canonical_slug` e o portao que fecha o circuito.** Sem slug canonico pt-BR
a entidade nao tem pagina, e um `entityCard` apontando para ela sumiria do corpo
**exatamente como sumiria um id inexistente**. Devolver o id nesse caso trocaria
um modo de falha silenciosa por outro. E a mesma regra que
`catalog-summary.ts` e `loadEntityCardInput` ja aplicam: entidade sem slug
canonico pt-BR e omitida.

### Recusas do pedido inteiro

| Status | `error` |
| --- | --- |
| `401` | `unauthenticated` — sem chave, ou chave nao reconhecida |
| `400` | `invalid_json` |
| `413` | `payload_too_large` — corpo > 64 KB |
| `422` | `validation_failed` / `too_many_items` |
| `429` | `rate_limited` — com `Retry-After` |
| `503` | `resolver_disabled` — nenhuma chave configurada no servidor |
| `503` | `resolve_failed` (`retryable: true`) — falha de leitura do banco |

`503 resolve_failed` existe para nao virar `not_found`: falha de leitura NAO
pode chegar ao emissor como "nao existe", porque "nao existe" e exatamente a
resposta que ele nao pode receber por engano. **Repita.**

## 5. Teto de chamadas

`60` chamadas por minuto **por credencial**, configuravel (§7). A resposta
carrega `X-RateLimit-Limit` e `X-RateLimit-Remaining`; a recusa carrega
`Retry-After`.

Janela **fixa**, nao deslizante: permite uma rajada do dobro do teto na virada.
O que este teto protege nao e um SLA — e o banco contra um laco descontrolado.

**Limitacao real, registrada:** o contador vive **na memoria do processo**. Com
N instancias do `screen-app` atras de um balanceador, o teto efetivo e N vezes o
configurado. Um teto compartilhado exigiria Redis ou tabela — infra nova para
uma rota que so um cliente conhecido chama.

## 6. Rota interna

- vive sob `/api/`, que o `robots.txt` ja bloqueia com `Disallow: /api/`;
- manda `X-Robots-Tag: noindex, nofollow` mesmo assim — `Disallow` impede
  **rastrear**, nao **indexar** uma URL descoberta por outro caminho;
- `Cache-Control: no-store`, porque a resposta depende da credencial;
- **sem `Access-Control-Allow-Origin`**: navegador nenhum deve conseguir chamar
  esta rota, e a ausencia do cabecalho e o que garante isso;
- nao entra em sitemap (ela nao e pagina);
- `GET` responde `405`.

A rota le **somente PostgreSQL** (invariantes 3 e 4).

## 7. Variaveis de ambiente

| Variavel | Obrigatoria | Default | O que faz |
| --- | --- | --- | --- |
| `CINERIE_CATALOG_RESOLVE_API_KEYS` | **sim, para a rota existir** | — | uma ou mais chaves separadas por virgula. Escopo `catalog_resolve` |
| `CINERIE_CATALOG_RESOLVE_RATE_LIMIT_PER_MINUTE` | nao | `60` | teto por credencial. Valor invalido cai no default |

**Duas ou mais chaves existem para ROTACAO:** publica-se a nova, o emissor
troca, remove-se a velha — sem janela em que ninguem consegue chamar.

Chave com menos de **24 caracteres** e ignorada (e contada num aviso no log do
servidor, sem o valor). Gere com algo como:

```bash
openssl rand -hex 32
```

Nenhuma outra variavel. Nenhuma chave nova no CMS.

## 8. O que o MNScr precisa saber, em quatro linhas

1. **Escopo:** `catalog_resolve`, credencial nova, **nao** reaproveite as do CMS.
2. **Endpoint:** `POST https://cinerie.com/api/internal/entity-resolve`.
3. **Nunca publique um `entityId` que veio com `reason` preenchido.** O `null` e
   a resposta correta; o bloco simplesmente nao entra na materia.
4. **Prefira `tmdbId`.** Ele e o unico casamento que nao tem ambiguidade.

## 9. Como isto e verificado

- `apps/web/src/lib/__tests__/entity-resolve.test.ts` — a decisao (27 casos, quase
  todos medindo recusa);
- `apps/web/src/lib/__tests__/entity-resolve-auth.test.ts` — credencial e teto;
- `tests/governance/entity-resolve-fold.test.ts` — **a dobra desta rota e a dobra
  da ingestao sao a mesma funcao**. Este teste passou verde durante todo o
  periodo em que o casamento por titulo estava morto em producao, e a licao vale
  registrar: ele compara **JS com JS**, e a fonte do casamento estava no banco;
- `pnpm --filter @screena/web validate:entity-resolve` — **Next real + PostgreSQL
  16 efemero** (gate de CI, 39 checks). Prova o SQL de casamento, a credencial e
  o teto ligados no handler, os cabecalhos de rota interna — e, no ultimo passo,
  que **o id devolvido pela rota renderiza como ficha na materia**.

Tres passos deste validador existem por causa do defeito de producao, e nenhum
deles passa por leitura de codigo:

1. **ida e volta pelo `canonicalTitle`.** Pergunta por `tmdbId`, pega o rotulo
   que voltou e pergunta de novo POR ESSE ROTULO. Casar por id nao provava nada
   — foi o que mascarou o defeito;
2. **a semente nao grava `search_documents`.** So catalogo: entidade, slug,
   traducao e titulos alternativos. Um passo confere que a tabela ficou com
   **zero linhas** — se a rota voltar a depender da projecao, todo casamento por
   texto fica vermelho;
3. **corpus da dobra, contra o banco.** Confere que dobrar o termo em JS antes
   nao muda o resultado da dobra do PostgreSQL, sobre acento, caixa, espaco
   duplo, espaco inquebravel, ligadura, AE ligado e eszett. Uma funcao SQL nao
   existe em teste puro.

**Controle negativo executado**: rodando este validador contra a versao anterior
de `src/server/entity-resolve.ts` (a que lia `search_documents`), **11 checks
falham, todos com `not_found`** — a mesma assinatura medida em producao.

### Operacao: esta rota exige a migration aplicada

O casamento por titulo chama `immutable_fold`, criada em
`20260808120000_entity_resolve_folded_title_indexes`. Sem `prisma migrate
deploy`, a rota responde `503 resolve_failed` (retentavel) no casamento por
texto — e nao `not_found`. A distincao e deliberada: falha de leitura nunca pode
chegar ao emissor como "nao existe".
