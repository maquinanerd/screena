# ADR 0019 — Vinculo de entidade nasce verificado quando a confianca alcanca o limiar

- **Status:** aceito.
- **Data:** 2026-08-11.
- **Emenda o [ADR 0018](0018-machine-entity-links-verification-state.md)** numa unica linha: a de
  que "nao existe caminho que suba `verified` para `true`". Todo o resto daquele ADR continua
  valendo, inclusive a analise que o motivou.
- **Migration:** `apps/cms/src/migrations/20260811_184943_entity_link_verification_source.ts` —
  coluna `verification_source` em `articles_entity_references` (e na tabela de versoes). Sem
  backfill: ver §5.
- **Invariantes tocadas:** 12 (automacao nao afirma o que nao apurou), 6 (dado sem verificacao nao
  vira pagina publica).
- **Depende de:** [ADR 0015](0015-editorial-boundaries.md) (o CMS tem banco proprio e nao alcanca o
  catalogo publico) e da rota `/api/internal/entity-resolve`
  ([operacao](../operations/entity-resolve.md)), que **nao existia** quando o 0018 foi escrito.

---

## 1. O que o 0018 decidiu, e por que estava certo

Um vinculo vindo de maquina era sempre persistido com `verified: false`. A razao era estrutural:
**o CMS nao consegue confirmar**. `entityLinks[].entityId` e o id interno do catalogo, e um
`tmdbId` colocado ali e um inteiro perfeitamente valido — se aquele numero existir como id interno,
o vinculo aponta para a **obra errada com toda a aparencia de estar certo**. O CMS nao tem como
saber: o catalogo esta do outro lado da fronteira do ADR 0015.

Essa analise nao mudou. Vinculo errado continua sendo pior do que vinculo ausente, porque e uma
afirmacao falsa que ninguem revisa — ela parece bem-formada.

## 2. O que mudou no mundo

O 0018 e de **2026-08-06**. Ele registra, em "o que NAO foi decidido aqui":

> **Resolucao por `tmdbId` ou por nome.** Traduzir id externo para id interno e trabalho com
> contrato proprio: precisa dizer o que acontece com ambiguidade, com entidade ausente e com
> colisao.

Esse trabalho foi feito. A rota `POST /api/internal/entity-resolve` existe desde esta semana
(PRs #137–#140, corrigida no #142), e ela e **mais conservadora do que qualquer coisa que existia
antes**:

- **recusa ambiguidade** — `ambiguous_title`, `ambiguous_name`. Dois homonimos derrubam para `null`,
  e nao para "o mais popular";
- **recusa entidade sem pagina canonica** — `no_canonical_slug`. Entidade sem slug pt-BR nao serve,
  mesmo existindo;
- **nao tenta o titulo quando o `tmdbId` falha** — `tmdb_id_not_in_catalog` e ponto final; tentar o
  outro campo e exatamente como se publica a obra errada;
- **nao tem fuzzy, nem prefixo, nem "melhor aproximacao"** — a busca do site tem os tres, e esta
  certa, porque la existe uma pessoa lendo a lista;
- **informa COMO casou** — `matchedBy` + `confidence`, na resposta.

O ultimo item e o que destrava esta decisao. A confianca deixou de ser uma opiniao do emissor sobre
si mesmo e passou a ser o **rotulo de um casamento reproduzivel**, emitido por codigo nosso.

## 3. O custo de manter o 0018 como estava

Medido, nao suposto: `entity_news_links` fica **vazio**, e a secao "Destaques de hoje" nunca
aparece — mesmo com o emissor mandando os vinculos certos, com os ids certos.

A cadeia inteira e fail-closed em cascata: o vinculo nasce `verified: false`; o
`editorial-event-mapper` (`apps/cms/src/publication.ts`) filtra `doc.entityReferences` por
`verified === true` antes de montar o evento; o worker so projeta o que chega no evento. Cada linha
esperaria um clique humano no admin, uma a uma, para sempre.

Uma confirmacao humana que precisa acontecer em **toda** materia de pipeline nao e curadoria: e uma
fila que ninguem drena. E uma fila que ninguem drena vira, na pratica, a decisao de nao ter
vinculo nenhum — que e o estado que o site esta hoje.

## 4. A decisao

> **`confidence >= limiar` nasce `verified: true`. Abaixo do limiar, `verified: false`, como antes.**

O limiar padrao e **0.9**, configuravel por `EDITORIAL_ENTITY_LINK_AUTO_VERIFY_MIN_CONFIDENCE`.

O corte cai exatamente entre dois casamentos da entity-resolve, e e ai que esta o argumento:

| `matchedBy` | `confidence` | O que confirma a identidade | Desfecho |
| --- | --- | --- | --- |
| `tmdb_id` | `1.00` | identificador exato + tipo | **verificado** |
| `exact_title_year` | `0.90` | titulo dobrado + **ano** + tipo, e unico | **verificado** |
| `exact_name` | `0.85` | nome dobrado + tipo, e unico | **humano** |

**`exact_name` fica de fora de proposito.** Ele e o unico casamento sem um **segundo campo**
confirmando identidade — e e ele que confunde homonimos. A unicidade que o sustenta e unicidade no
**nosso** catalogo, num instante: um segundo "Chris Evans" ingerido amanha torna ambiguo um vinculo
que hoje resolve, e o vinculo ja gravado nao volta atras sozinho. Filme e serie nao tem esse
problema com a mesma forca, porque o ano ja e o segundo campo.

O corte e `>=`, nao `>`: `exact_title_year` vale exatamente `0.90`, e um `>` deixaria de fora
justamente o casamento que esta decisao quer incluir.

### Duas guardas que o limiar NAO substitui

1. **Forma do id.** `ENTITY_LINK_ID_NOT_INTERNAL` continua recusando `tt0111161`, `tmdb:550`, `0` e
   `007` — com confianca `1.0` inclusive. Confianca alta sobre id de forma errada e uma afirmacao
   confiante sobre a coisa errada.
2. **Existencia e tipo, no lado publico.** `reconcileEntityLinks` continua consultando o registro
   `entities` pela chave composta `(entityType, entityId)`. Id inexistente, ou existente com
   **outro tipo**, nao vira vinculo: a materia publica sem ele, com aviso. Essa e a unica checagem
   que enxerga as duas pontas, e ela nao foi tocada.

O limiar decide **se o vinculo espera um humano**. Ele nao afirma que a entidade existe.

### So tipos que o resolvedor traduz

`movie`, `tv` e `person` podem nascer verificados. `season`, `episode`, `character` e `franchise`
nao: para eles **nao existe** resolvedor atras do numero, entao a confianca vem de um julgamento que
ninguem consegue reproduzir. Um `1.0` ali seria so uma afirmacao mais enfatica.

### Limiar invalido nao auto-verifica nada

Fora de `(0, 1]` — inclusive `NaN` — o limiar cai no default na leitura da env, e o mapeador
recusa auto-verificar de qualquer forma. Os dois lados existem porque `parseFloat("0,9")` devolve
**`0`**, e um `0` aceito como limiar faria **todo** vinculo nascer verificado. A virgula decimal e o
erro de digitacao mais provavel desta variavel; ele nao pode ser o que abre tudo.

## 5. Curadoria humana: intocada, e distinguivel

- **Um vinculo confirmado por gente nunca e rebaixado nem reescrito por maquina.**
  `ENTITY_LINK_NOT_REAPPLIED` continua valendo: um pedido de `update` **nao** reescreve
  `entityReferences`. A auto-verificacao decide com que estado o vinculo **nasce**, e ele nasce uma
  vez so.
- **A origem fica registrada.** A coluna nova `verificationSource` recebe `automation_confidence`
  quando — e somente quando — foi a maquina que verificou. Ela e **proveniencia**, nao estado.

A leitura da dupla e:

| `verified` | `verificationSource` | Significa |
| --- | --- | --- |
| `false` | vazio | nao verificado |
| `true` | `automation_confidence` | a maquina verificou por confianca |
| `true` | vazio | **um humano marcou** |

**Nao ha backfill, e a ausencia dele e o ponto.** Toda linha anterior a este ADR com `verified =
true` foi marcada por um humano — sob o 0018 a automacao **nao tinha como** marcar. Entao `NULL`
com `verified = true` ja significa "humano", inclusive retroativamente. Preencher a coluna a mao
inventaria um registro de origem para decisoes que ninguem registrou.

Isso responde a pergunta de auditoria: reverter em massa **so** o que a automacao afirmou e
`entityReferences.verificationSource = 'automation_confidence'`, sem tocar em uma unica marcacao
humana.

## 6. Toda auto-verificacao vai para o log

Uma linha por vinculo, **depois do commit** (um log emitido antes descreveria uma afirmacao que o
rollback pode nunca ter gravado):

```
vinculo de entidade auto-verificado por confianca
  requestId, articleId, entityKind, entityId, confidence, threshold, verificationSource
```

Nada de conteudo da materia. O **limiar aplicado** vai junto de proposito: um operador que digitou
`0,9` ve `threshold=0.9` ao lado do valor que ele achou ter configurado — e essa e a unica forma de
descobrir o erro sem ler codigo.

O emissor tambem recebe a informacao na resposta, com codigo proprio:
`ENTITY_LINK_AUTO_VERIFIED` (quantos, com que confianca, sob que limiar) ao lado de
`ENTITY_LINK_UNVERIFIED` (quantos ficaram esperando humano).

## 7. O que NAO foi decidido aqui

- **Levar a proveniencia ao banco publico.** `entity_news_links` nao ganha coluna de origem: o lado
  publico so recebe vinculo confirmado, e a auditoria de "quem confirmou" pertence ao lado onde a
  confirmacao acontece. Levar o dado para la exigiria migration no `screen-db` e um campo novo no
  `publication-event-v1` — outra PR, com outra pergunta.
- **Reaplicar vinculos em `update`.** Segue proibido, pelo motivo do 0018: o array carrega decisao
  humana, e reescreve-lo devolveria tudo a `false` a cada revisao do pipeline.
- **Auto-verificar no caminho de RASCUNHO.** `editorial-draft-v1` declara
  `verified: z.literal(false)` no proprio contrato — ali a proibicao e da forma do dado, nao desta
  politica. Mudar isso exigiria mexer no contrato de entrada, cujo hash e comparado com igualdade
  estrita a cada pedido do MNScr.

## 8. Consequencias

- Um vinculo por `tmdbId` ou por titulo+ano+tipo unico chega ao site **sem intervencao**;
  `entity_news_links` deixa de nascer vazio e "Destaques de hoje" passa a ter do que se alimentar.
- Um vinculo por nome de pessoa continua esperando um humano — que e exatamente onde o risco de
  homonimo mora.
- O corte e uma **variavel de ambiente**: apertar para `0.95` (so `tmdb_id`) ou afrouxar nao exige
  deploy de codigo. E o limiar aplicado aparece no preflight e em todo log de auto-verificacao.
- A automacao ganhou fe publica **nos dois casamentos que ela sabe reproduzir** — e so neles.
