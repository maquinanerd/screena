# ADR 0018 — Vinculo de entidade vindo de maquina nasce NAO verificado

> **EMENDADO pelo [ADR 0019](0019-entity-link-confidence-verification.md) (2026-08-11).** A §3
> abaixo diz "sem excecao, sem caminho que suba para `true`". Isso **nao vale mais**: um vinculo com
> `confidence >= 0.9` (limiar configuravel) de tipo `movie`/`tv`/`person` nasce `verified: true`.
> O que motivou a mudanca foi a criacao da rota `/api/internal/entity-resolve`, que este ADR listou
> em §4 como trabalho ainda nao feito. Todo o resto deste documento continua valendo — inclusive a
> analise da §2, que segue sendo a razao de o limiar **nao** dispensar nenhuma das outras guardas.

- **Status:** aceito, emendado na §3 pelo ADR 0019.
- **Data:** 2026-08-06.
- **Migration:** nenhuma. `articles.entityReferences` e o campo `verified` ja existem desde a FASE 2B.
- **Invariantes tocadas:** 12 (automacao nao afirma o que nao apurou), 6 (dado sem verificacao nao vira pagina publica).
- **Depende de:** [ADR 0015](0015-editorial-boundaries.md) (o CMS tem banco proprio e nao alcanca o catalogo publico).

---

## 1. O problema

O contrato `editorial-publication-request-v1` aceita `entityLinks` desde que existe
(`packages/editorial-contracts/src/editorial-publication-request-v1.ts`). O endpoint de
autopublicacao **nunca copiava o campo**: a whitelist de `persistPublication` ia de `title` a
`automationAttributionMode` e simplesmente pulava os vinculos.

O efeito era um `2xx` mentiroso do tipo mais caro de diagnosticar. O MNScr mandava o filme certo,
com o id certo, com confianca 0.95; o CMS respondia `PUBLISHED`; e o evento de publicacao — que so
le `doc.entityReferences` marcadas como verificadas — saia vazio. A materia chegava ao site sem
nenhuma ligacao com a entidade sobre a qual ela fala, e nao havia um log dizendo que algo se
perdeu.

Corrigir o descarte levanta imediatamente a pergunta que este ADR responde: **com que estado de
verificacao um vinculo vindo de maquina e persistido?**

---

## 2. A armadilha que decide a resposta

`entityLinks[].entityId` e o **id interno do Cinerie** — `BigInt`, sequencial, chave primaria de
`movies`, `tv_shows` e `people`. Mas o mesmo catalogo carrega `tmdbId`, que e `Int @unique` nas
tres tabelas.

Os dois sao numeros inteiros. Um id do TMDB colocado em `entityId` **nao falha em lugar nenhum**:
se aquele numero existir como id interno — e para ids pequenos ele quase sempre existe —, o vinculo
aponta para a entidade **errada** com toda a aparencia de estar certo. Uma materia sobre um filme
passa a linkar outro.

Isso e pior do que perder o vinculo. Vinculo perdido e uma ausencia visivel; vinculo errado e uma
afirmacao falsa que ninguem revisa porque parece bem-formada.

---

## 3. A decisao

**Um vinculo vindo de maquina e sempre persistido com `verified: false`.** Sem excecao, sem
caminho que suba para `true`.

> **Emendado pelo ADR 0019:** ha hoje UM caminho — `confidence >= limiar`, com `movie`/`tv`/`person`
> e id na forma interna. As duas guardas descritas abaixo (forma do id no CMS, existencia e tipo no
> worker) continuam intactas.

Isso e mais conservador do que a alternativa considerada — marcar `verified: true` quando o
endpoint confirmasse que a entidade existe — e a razao e estrutural, nao de gosto:

> **O CMS nao consegue confirmar.** Ele e uma aplicacao separada, com banco proprio
> (`PAYLOAD_DATABASE_URL`), sem Prisma e sem `@screena/db` — a fronteira do ADR 0015, travada por
> `tests/governance/cms-isolation.test.ts`. O catalogo publico esta do outro lado dessa fronteira.

Marcar `verified: true` no endpoint seria afirmar uma verificacao que **ninguem fez**. Atravessar a
fronteira para poder fazê-la trocaria uma correcao de tres campos por uma mudanca de arquitetura,
e desfaria o isolamento que existe justamente para o CMS nao virar dependencia do render.

### O que o CMS PODE checar, e checa

A **forma** do id (`apps/cms/src/publication-intake.ts`, `INTERNAL_ENTITY_ID`): um id interno e
`/^[1-9][0-9]*$/`. Isso recusa `tt0111161`, `tmdb:550`, slugs e ids com zero a esquerda — todos
aceitos pelo `stableId` do contrato, que e propositalmente largo. Vinculo fora da forma e
**recusado**, com o aviso `ENTITY_LINK_ID_NOT_INTERNAL` na resposta.

O que a forma **nao** pega e o caso central: um `tmdbId` de valor pequeno e indistinguivel de um id
interno. Por isso a forma e a primeira guarda, nunca a unica.

### Quem faz a verificacao de verdade

Duas camadas, nesta ordem:

1. **O humano no admin.** O vinculo aparece em `entityReferences` para curadoria, com
   `confidence` a vista. So um humano marca `verified` (e o proprio campo diz isso:
   *"So um humano marca. A automacao envia sempre false."*).
   > **Emendado pelo ADR 0019.** A frase citada nao esta mais no campo: com `confidence` acima do
   > limiar, a automacao marca. O que segue valendo e o resto — o humano continua sendo quem decide
   > tudo o que fica abaixo do limiar, e a marcacao dele **nunca** e rebaixada nem reescrita por
   > maquina. A coluna `verificationSource` diz qual das duas afirmou.
2. **O worker de projecao.** Mesmo depois de confirmado, `reconcileEntityLinks`
   (`services/news-ingestion/src/persistence/editorial-projection-store.ts`) consulta o registro
   `entities` do banco publico pela chave **composta** `(entityType, entityId)`. Um id que nao
   existe, ou que existe com **outro tipo**, nao casa: o vinculo nao e criado e a materia e
   publicada sem ele, com aviso. E ali que "o tipo declarado bate com a linha encontrada" e de fato
   verificado, porque e o unico processo que enxerga as duas pontas.

O evento de publicacao (`apps/cms/src/publication.ts`) continua filtrando por
`verified === true`. A regra nao foi afrouxada em ponto nenhum: o que mudou e que o vinculo agora
**existe** para ser confirmado, em vez de desaparecer no salto.

---

## 4. O que NAO foi decidido aqui

- **Resolucao por `tmdbId` ou por nome.** Traduzir id externo para id interno e trabalho com
  contrato proprio: precisa dizer o que acontece com ambiguidade, com entidade ausente e com
  colisao. Recusar a forma errada, como esta PR faz, e o degrau anterior — nao o substituto.
- **Reaplicar vinculos em `update`.** Um pedido de atualizacao **nao** reescreve
  `entityReferences`: o array carrega `verified`, que e decisao humana, e reescrevê-lo devolveria
  tudo a `false` a cada revisao do pipeline. O endpoint diz isso ao emissor pelo aviso
  `ENTITY_LINK_NOT_REAPPLIED`, em vez de fazer o descarte em silencio — que era exatamente o
  defeito de origem, so que com outra roupa.

---

## 5. Consequencias

- Um vinculo correto vindo do MNScr passa a **existir** no CMS, e o caminho ate o site e uma
  confirmacao humana de um clique — nao mais um recadastro manual.
- Um vinculo com id externo e recusado na entrada, com codigo proprio: o pipeline corrige o
  emissor em vez de descobrir semanas depois que a materia linka o filme errado.
- Nenhum vinculo automatico chega ao site sem passar por humano **e** pela checagem de existencia
  e tipo no lado publico. A automacao ganhou voz; nao ganhou fe publica.
