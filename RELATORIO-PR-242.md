# Relatório — PR #242 · O censo de verdade e o que o interruptor realmente faz

> **Versão definitiva**, escrita depois do merge. O que segue é o desfecho medido,
> não a intenção da leva.

**PR:** https://github.com/maquinanerd/screena/pull/242 · **MERGEADA**
**Em `main`:** `90981ff` (squash) · **Base:** `24530fb` (#241)
**Mergeada em:** 2026-08-28T00:27:16Z · **Branch:** removida
**Diff que entrou em `main`:** 15 arquivos · +2.655 / −7
**Commits da branch:** `67a9d06` (código e provas) · `1028023` (este relatório)

### CI — duas execuções, ambas verdes

| execução | commit | jobs |
| --- | --- | --- |
| `33126314583` | `67a9d06` | 3/3 success |
| `33127909285` | `1028023` | 3/3 success |

Jobs: *Typecheck, lint, test, auditorias e build público* · *Imagem Docker real
(digest, não-root, healthcheck)* · *Backup + restore real (PostgreSQL 16)*.

A CI remota concordou com os dez portões medidos localmente (§9).

### O estado depois desta leva, em três linhas

1. `catalog index-decisions --dry-run` **pré-checa de verdade** e imprime o censo.
   Antes saía `0` sem abrir conexão com o banco.
2. Está **provado por renderização** que popular `page_indexability_decisions`
   remove páginas do índice do Google, não só do sitemap.
3. **Nenhuma decisão foi escrita.** A tabela continua como estava; o procedimento
   de aplicação está pronto e a assinatura é do dono.

---

## Sumário em uma linha

`catalog index-decisions --dry-run` saía **0** contra produção sem nunca abrir
conexão com o banco — imprimia uma frase sobre a *intenção* do comando e era lida
como aprovação de uma mudança de ~67 mil decisões. O defeito era de **roteamento
no `bin/`**, não de cálculo: o produtor já estava certo e nunca era chamado. Três
achados apareceram na medição, e **um número do enunciado foi corrigido**.

---

## 1. O diagnóstico

### 1.1 O sintoma, reproduzido

Rodado em produção, no console do `screen-catalog-worker`, em `/app`:

```
$ pnpm catalog index-decisions --dry-run --json --confirm-production-read
{"dryRun":true,"command":"index-decisions","subcommand":null,
 "plan":["index-decisions: sem efeito colateral"]}
$ echo $?
0
```

Nenhuma contagem. Nenhuma entidade avaliada. Nenhum motivo. Nenhum veredito do
freio de mudança em massa.

Reproduzi localmente com uma agravante que fecha o diagnóstico sozinha: apontei a
CLI para `postgresql://…@127.0.0.1:59999/…` — **uma porta fechada, um banco que
não existe** — e a saída foi byte a byte a mesma, com exit 0.

> Uma pré-checagem que reporta sucesso contra um banco inalcançável não pode ter
> calculado censo nenhum.

### 1.2 A causa

`services/ingestion/bin/catalog.ts`, linha 347 (antes da mudança):

```ts
// Dry-run NAO monta o runtime: nao abre Prisma, nao cria client TMDB, nao
// gasta cota. "Dry-run nao toca nada" e garantido por construcao, nao por
// disciplina espalhada em cada comando.
if (flags.dryRun) {
  const plan = describePlan(command, subcommand, flags, locale)
  emit(flags, { dryRun: true, command, subcommand, plan }, [...])
  return EXIT_CODES.ok
}
```

Esse `if` roda **antes do dispatch**. `describePlan()` tem `case` para nove
comandos — `bootstrap`, `sync`, `changes`, `discovery`, `media`, `episodes`,
`search-reindex`, `enqueue`, `dead-letter`. **`index-decisions` não está entre
eles**, então caía no `default:`:

```ts
default:
  return [`${command}: sem efeito colateral`]
```

O handler `cmdIndexDecisions` — que já recebia `dryRun: !flags.apply`, já
calculava o censo completo, já avaliava o freio e já devolvia o exit code 5
quando bloquearia — **nunca era chamado com a flag `--dry-run`**.

### 1.3 Por que ninguém viu: a assinatura do projeto, de novo

Este é o mesmo defeito de "sucesso medido em proxy" que o enunciado nomeia. Aqui
ele tem quatro camadas, e todas estavam verdes:

| camada | estado | o que provava |
| --- | --- | --- |
| política pura (`decideCatalogIndexability`) | testada | o veredito por entidade |
| produtor (`produceIndexabilityDecisions`) | testado, com Postgres real | que a **função** honra `dryRun: true` |
| ajuda da CLI (`help.ts`) | escrita | que `--dry-run` "calcula e mostra o diff" e sai 5 sob freio |
| **roteamento (`bin/catalog.ts`)** | **sem teste nenhum** | — |

O validador `validate-indexability-producer-real-postgres.ts` chega a afirmar no
próprio docstring:

```
 *   4. `--dry-run` nao escreve nada;
```

…e nunca passou por `--dry-run`. Ele chama a função. A distância entre "a função
honra `dryRun`" e "a flag honra `dryRun`" era exatamente o defeito, e nenhuma das
provas existentes atravessava essa distância.

O `bin/` está **fora do `tsconfig.json` principal** (depende do Prisma Client
gerado; é coberto só por `tsconfig.runtime.json`) e **nenhum teste do repositório
o executava**. Era o único elo sem cobertura, e era ele.

### 1.4 Por que isso é pior do que não ter comando

A frase `"index-decisions: sem efeito colateral"` descreve a **intenção** do
`--dry-run` (não tocar em nada durante a pré-checagem). Lida no contexto em que
aparece — logo antes de assinar um `--apply` — ela se lê como **veredito sobre a
mudança**: "isto seria inofensivo". Somada ao exit 0, dá confiança sem dar
informação.

---

## 2. O que foi feito

### 2.1 A decisão de roteamento saiu do `bin/` e virou regra testável

Novo predicado no núcleo puro, `services/ingestion/src/cli/args.ts`:

```ts
const DRY_RUN_RUNS_REAL_POLICY: ReadonlySet<CatalogCommand> = new Set(['index-decisions'])

export function dryRunExecutesCommand(command: CatalogCommand): boolean {
  return DRY_RUN_RUNS_REAL_POLICY.has(command)
}
```

O critério para entrar na lista está escrito no arquivo e é o que impede a lista
de virar depósito:

> **a pré-checagem do comando é SÓ-LEITURA de PostgreSQL local — sem rede, sem
> cota, sem TMDB.**

Não entram os comandos que consomem TMDB no caminho de planejamento
(`bootstrap`, `sync`, `changes`, `discovery`, `media`, `episodes`,
`search-reindex`): para eles, "dry-run não monta o runtime" continua sendo a
garantia correta por construção.

E no `bin/catalog.ts`, a mudança de uma linha:

```diff
-  if (flags.dryRun) {
+  if (flags.dryRun && !dryRunExecutesCommand(command)) {
```

### 2.2 O `default:` deixou de mentir

```diff
 default:
-  return [`${command}: sem efeito colateral`]
+  return [
+    `${command}: esta CLI nao tem pre-checagem para este comando`,
+    'NENHUM numero foi calculado — o --dry-run apenas confirmou que nada seria tocado',
+    'nao trate esta saida como aprovacao de um --apply',
+  ]
```

Isso importa além do `index-decisions`: `backfill-finalization` também cai nesse
ramo e recebia a mesma frase enganosa.

### 2.3 O censo ganhou o que faltava para assinar

`services/ingestion/src/persistence/indexability-writer.ts` (+102 linhas,
puramente **aditivas** — nenhum campo existente mudou de nome ou semântica):

```ts
export interface DecisionWriteCensus {
  readonly created: number    // sem decisao vigente: INSERE linha nova
  readonly updated: number    // ja havia vigente: despromove a antiga e insere
  readonly unchanged: number  // identica a vigente: nada e gravado
}

export interface EntityTypeCensus {
  readonly evaluated: number
  readonly byDecision: Readonly<Record<string, number>>
  readonly byReason: Readonly<Record<string, number>>
  readonly writes: DecisionWriteCensus
}

export const INDEXABILITY_SUMMARY_SCHEMA_VERSION = 1
```

A distinção **`created` vs `updated`** é o coração da mudança e não é cosmética:

- uma linha que **nasce** `noindex` amplia a cobertura da tabela;
- uma linha que **troca** de `index` para `noindex` **tira do índice uma página
  que o Google já conhece**.

`planned` somava as duas num número só.

O acumulador roda no **mesmo laço** que já visita cada linha. Uma segunda passada
sobre `plan` daria `created`/`updated`, mas **não** daria `byDecision`/`byReason`
por tipo: o plano só contém o que muda, e a pergunta "quantos filmes ficam
`noindex`" inclui os que já estavam.

### 2.4 Os tetos do freio passaram a aparecer sempre

Antes, uma execução com poucos flips imprimia só `flips: nenhum` — o operador não
tinha como saber contra que número estava sendo medido, nem que havia um veredito
de freio. O teto só aparecia quando já era tarde.

```ts
const brakeLine =
  `  freio: ${brake.flips} flip(s) de ${brake.evaluated} avaliadas` +
  ` (${(brake.flipRatio * 100).toFixed(2)}%) · tetos ${brake.limits.maxFlips} absoluto` +
  ` / ${(brake.limits.maxFlipRatio * 100).toFixed(2)}% proporcional` +
  ` · ${brake.blocked ? 'BLOQUEARIA' : brake.exceeded ? 'estourou, mas confirmado' : 'nao bloqueia'}`
```

### 2.5 A ajuda passou a documentar o contrato do JSON e os exit codes

`help.ts` já prometia o comportamento certo; agora descreve também a **forma** do
`--json` (contrato para script de operação) e os quatro exit codes, com a razão de
valerem igual em `--dry-run` e em `--apply`: *o dry-run é a pré-checagem do apply,
então os dois têm de concordar*.

### 2.6 A saída real, hoje

```
decisoes de indexabilidade · pt-BR · DRY-RUN
  avaliadas: 1060 · planejadas: 1060 · gravadas: 0 · inalteradas: 0
  a escrita faria: 1060 criadas · 0 alteradas · 0 iguais

  por tipo de entidade:
    movie — avaliadas 1020 · criaria 1020 · alteraria 0 · iguais 0
      vereditos: noindex=300 · index=720
        no_synopsis                  300
        eligible                     720
    tv — avaliadas 40 · criaria 40 · alteraria 0 · iguais 0
      vereditos: index=40
        eligible                     40

  por decisao:
    noindex    300
    index      760

  freio: 300 flip(s) de 1060 avaliadas (28.30%) · tetos 100000 absoluto / 100.00% proporcional · nao bloqueia
  flips: 300 de 1060 avaliadas · entram 0 · saem 300

  mudancas (amostra):
    movie#1: (nova) -> noindex (no_synopsis)
    ...

Nada foi gravado. Use --apply para persistir.
```

---

## 3. As provas — nenhuma passa por `grep` no fonte

### 3.1 `dry-run-precheck.test.ts` — a observação discriminante, sem banco

O defeito não estava na política nem no produtor (os dois já tinham teste verde —
e é por isso que ninguém viu). Estava no roteamento. Um teste que afirmasse sobre
`dryRunExecutesCommand` provaria o **predicado**, não a fiação; um `grep` no fonte
provaria a **grafia**.

Então o teste **executa o binário** e afirma sobre a saída dele, com a CLI
apontada para um PostgreSQL inalcançável:

| | com o defeito | consertado |
| --- | --- | --- |
| exit code | **0** | ≠ 0 |
| stdout | JSON de plano | erro de conexão |

Cinco checks, incluindo um **controle positivo** (`--help` responde 0 — sem ele,
os dois centrais passariam por vacuidade se o `spawnSync` falhasse em achar o
`tsx`).

**Controle negativo executado, não apenas afirmado.** Restaurei o curto-circuito
(`if (flags.dryRun) {`) no código e rodei:

```
✓ (1) CONTROLE POSITIVO: o binario roda e responde ao --help
× (2) contra um banco INALCANCAVEL, o dry-run NAO reporta sucesso
× (3) o dry-run nunca devolve o plano generico de "sem efeito colateral"
Tests  2 failed | 3 passed (5)
```

Os dois centrais ficam **vermelhos** e o controle positivo segue **verde** — a
falha não é vacuidade.

### 3.2 `validate:index-decisions-cli` — a CLI de verdade contra Postgres real

Novo validador (435 linhas), 16/16. Sobe `embedded-postgres`, semeia 1.020 filmes
(300 sem sinopse) e 40 séries, e roda **o binário com as flags**:

| # | prova |
| --- | --- |
| 2–6 | o `--dry-run --json` devolve censo cujas contagens **batem com o fixture** (`evaluated=1060`, `movie noindex=300`, `created=1020`) — não é censo vazio nem inventado |
| 7 | o `--dry-run` não gravou **nenhuma** linha (verificado no banco, não no contador) |
| 8–9 | exit **0** com tetos folgados, exit **5** quando bloquearia — o code que a ajuda promete |
| 10–11 | o caminho bloqueado **ainda entrega o censo** (o freio não apaga a informação) |
| 13 | `--entity movie --apply` grava **só** filme: banco fica `{"movie":1020}` |
| 14–15 | o gate do sitemap de **filme arma** (1020 ≥ 1000) e o de **série continua desarmado** (0) |
| 16 | reexecutar não cria linha nova (sem churn) |

### 3.3 `validate:decision-robots` — a página, renderizada

Novo validador (569 linhas), 23/23. Importa **as rotas de verdade**
(`app/pt/.../page.tsx`, que abrem fora do Next sob `tsx`), chama o
`generateMetadata` que o Next chamaria e lê o `robots` que sai.

Ler `getMoviePageData().seo` **não bastaria**: entre a resolução e a tag ainda há
`gatePublicRobots`, que pode colapsar tudo conforme o ambiente. Concluir "emite
noindex" lendo o caminho é exatamente o erro que esta tarefa existe para não
repetir.

Três cenários: linha de base por tipo → decisão `noindex` → controle de ambiente
com o kill switch desligado.

---

## 4. Os achados

### 4.1 Uma decisão `noindex` EMITE `noindex` na página — nos cinco tipos

| tipo | antes (sem linha) | depois da decisão `noindex` |
| --- | --- | --- |
| filme | `index,follow` | `noindex,nofollow` |
| série | `index,follow` | `noindex,nofollow` |
| pessoa | `index,follow` | `noindex,nofollow` |
| **temporada** | **`noindex,follow`** | `noindex,nofollow` |
| **episódio** | **`noindex,follow`** | `noindex,nofollow` |

**O canonical não muda** em nenhum dos cinco (checks 14–18). Canonical vem de
`slugs`; indexabilidade vem de `page_indexability_decisions`. Os dois não se
cruzam — e não devem.

O caminho completo:

```
page_indexability_decisions (linha is_current)
  → getCurrentPageIndexabilityDecision
  → mergePersistedDecision   (a persistida vence quando é MAIS restritiva)
  → seo.robots
  → gatePublicRobots(seo.robots)   (AND com o kill switch de ambiente)
  → <meta name="robots">
```

A diferença prática:

| efeito | como se desfaz |
| --- | --- |
| sair do **sitemap** | horas — o buscador mantém no índice o que já rastreou |
| emitir **`noindex`** | semanas — é pedido de REMOÇÃO, volta só após recrawl |

### 4.2 O kill switch de ambiente está **LIGADO** em produção

Medido, não suposto. O `robots.txt` público de `cinerie.com` traz o grupo próprio
do app:

```
User-Agent: *
Allow: /
Disallow: /api/
Disallow: /dev/
Disallow: /admin/

Sitemap: https://cinerie.com/sitemap.xml
```

`apps/web/app/robots.ts` só emite esse ramo quando
`isOfficialIndexableEnvironment(env)` é verdadeiro — o que exige flag ligada +
origem oficial + `NODE_ENV` de produção.

> **Consequência:** comentários no código dizendo *"A indexacao publica CONTINUA
> desligada"* (no produtor e na saída da própria CLI) estão **desatualizados**.
> Não são descrição do ambiente de hoje.

### 4.3 Temporada e episódio: o que muda neles não é o `noindex`

Os dois já saem `noindex, follow` **sem nenhuma linha na tabela**, pela válvula de
emergência da #234 (`apps/web/src/server/seo/suspended-pages.ts`).

A decisão persistida troca **`follow` por `nofollow`**. E a válvula escolheu
`follow` de propósito — o próprio arquivo explica:

> Com `nofollow` o Google pararia de seguir justamente os links que sustentam as
> páginas que queremos manter.

Aplicar `index-decisions` sobre esses dois tipos **desfaz essa escolha em
silêncio**. O validador tem check próprio nomeando isso (12–13).

### 4.4 O número 38.613 está errado

| | valor |
| --- | --- |
| 38.613 (enunciado) | soma **só** dos dois baldes `sem_sinopse` (18.934 + 19.679) |
| **38.933** | total não-elegível do próprio censo (19.029 filme + 19.904 série) |
| **38.839** | destes, os que estão no sitemap hoje e sairiam dele |
| 28.352 | ficariam `index` (15.770 + 12.582) |

Diferença: **+320** (os 95 + 131 `sem_imagem` e os 94 `sem_slug`).

Conferência: `28.352 + 38.933 = 67.285`, que é `34.799 + 32.486` — fecha com o
sitemap publicado.

**E 38.933 é um PISO.** A política real avalia, nesta ordem: licença → idioma →
`missing_slug` → `missing_title` → **`missing_translation`** → `no_synopsis` →
`no_image` → `eligible`. O censo por SQL **não tinha balde** para `missing_title`
nem `missing_translation`. Logo:

- **28.352 é um TETO** para `index`;
- a divisão entre `missing_translation` e `no_synopsis` **não é derivável** do
  censo como foi reportado.

O jeito de fechar o número exato é o `--dry-run` consertado. É para isso que ele
existe.

### 4.5 Três tipos nunca foram medidos, e o freio vai disparar

O censo cobriu movie e tv. Sem `--entity`, o produtor avalia os **cinco** tipos de
`DECIDABLE_ENTITY_TYPES` — `person`, `season` e `episode` inclusive.

E com a tabela vazia, `null → noindex` conta como flip: ~38.933 flips em ~67.285
avaliadas (**~57,9%**), muito acima dos tetos default (500 / 5%). A primeira
execução completa sai com **code 5 e grava ZERO linhas**. Isso é o freio
funcionando, não um obstáculo. Vale até para um tipo só (`--entity movie` sozinho
mede ~54,7%).

### 4.6 De onde vem a falta de sinopse — dado perdido, e nem no fetch

Este é o achado maior e não é sobre indexação.

`MOVIE_APPEND`/`TV_APPEND` (`api-clients/tmdb/src/append-to-response.ts`) **já
pedem `translations`** em toda requisição de detalhe. O bloco com a sinopse de
**todos os idiomas** chega, a cota já foi paga, e `api_cache.payload` /
`tmdb_raw.payload` guardam a resposta inteira.

Mas `readMovieDisplayFields` / `readTvDisplayFields`
(`services/ingestion/src/display-fields.ts`) leem **só o `overview` de topo** — o
do idioma pedido (`TMDB_DEFAULT_LANGUAGE`, default `pt-BR`), que vem `""` quando o
título não tem tradução pt-BR. Daí:

```
""  →  null  →  upsertTranslation(…, null)  →  summary = NULL  →  no_synopsis
```

O **título tem fallback** (`title` → `original_title`). A **sinopse não tem
nenhum**.

`translations` está classificado como **`deferred`** em `append-consumption.ts`
("pedido de propósito, ainda não consumido") — arquivo que existe justamente
porque esse padrão já aconteceu quatro vezes (`watch/providers`, `biography`,
`recommendations`, os appends de temporada).

**Resposta:** o dado **não** se perde no fetch, nem no persistidor, nem na tabela.
**Nunca é extraído.**

Caracterizado por execução em `display-fields-synopsis-loss.test.ts` — que fica
**vermelho de propósito** quando alguém consumir o bloco. **Nada foi consertado**:
Item D era medição.

---

## 5. O que ficou de fora, e por quê

| item | status | motivo |
| --- | --- | --- |
| **D.1** — proporção da amostra de 200 títulos | **não medido** | exige o banco de produção, ao qual não tenho acesso desta sessão |
| **D.3** — perfil (ano/popularidade/idioma) dos títulos sem sinopse | **não medido** | idem |
| `--dry-run` de `backfill-finalization`, `enqueue`, `dead-letter replay` | **listados, não consertados** | escopo — o enunciado pediu só `index-decisions` nesta leva |
| execução de qualquer `--apply` | **não executado** | a assinatura é do dono |

Sobre D.1/D.3, a medição ficou **mais barata** do que a pergunta supunha: como o
bloco `translations` já está em `api_cache`/`tmdb_raw`, a resposta é obtível por
SQL sobre dados que já estão no banco, com **zero chamadas novas ao TMDB**.

---

## 6. Um vermelho pré-existente, encontrado e consertado

`validate:indexability-producer` check 22 falhava:

```
[FAIL] 22. preencher a sinopse devolve o episodio ao indice — gravadas=0 decisao=noindex (no_synopsis)
```

**Confirmei que é pré-existente**: restaurei o `indexability-writer.ts` original
do `24530fb` e o check falhou idêntico. Não foi causado por esta leva.

**Causa:** era o único ponto do arquivo a chamar `produceIndexabilityDecisions`
**sem** `massChangeThresholds: LOOSE_BRAKE` — os outros quatro passam. Com o teto
default, 1 flip num fixture de 11 entidades é **9,09%**, acima dos 5%
proporcionais. O freio bloqueava e `written` vinha 0.

É o efeito colateral que `catalog-mass-change.ts` já documenta: *"num banco pequeno
o teto proporcional dispara com pouquíssimos flips"*. **Bug do teste, não do
produto** — em produção 1 flip em 67 mil é 0,0015%.

25/26 → **26/26**.

---

## 7. O diff, arquivo por arquivo

| arquivo | ± | o quê |
| --- | ---: | --- |
| `services/ingestion/src/cli/args.ts` | +44 | `dryRunExecutesCommand` + `DRY_RUN_RUNS_REAL_POLICY`, com o critério de entrada documentado |
| `services/ingestion/bin/catalog.ts` | +44/−7 | a guarda no curto-circuito; `default:` honesto; censo por tipo e linha do freio na saída humana |
| `services/ingestion/src/persistence/indexability-writer.ts` | +102 | `DecisionWriteCensus`, `EntityTypeCensus`, `schemaVersion`; acumulador por tipo no laço existente |
| `services/ingestion/src/cli/help.ts` | +26/−3 | o que o `--dry-run` faz, a forma do `--json`, os quatro exit codes |
| `services/ingestion/src/cli/__tests__/dry-run-precheck.test.ts` | +153 | **novo** — a CLI contra banco inalcançável, com controle positivo |
| `services/ingestion/src/persistence/__tests__/indexability-mass-change.test.ts` | +117/−4 | 4 testes do censo (created/updated, por tipo, sobrevive ao freio, schemaVersion) |
| `services/ingestion/scripts/validate-index-decisions-cli-real-postgres.ts` | +435 | **novo** — CLI ponta a ponta, Postgres real, 16 checks |
| `apps/web/scripts/validate-decision-robots-render-real-postgres.ts` | +569 | **novo** — renderização das 5 rotas, 23 checks |
| `services/ingestion/scripts/validate-indexability-producer-real-postgres.ts` | +9 | `LOOSE_BRAKE` no check 22 (vermelho pré-existente) |
| `services/ingestion/src/__tests__/display-fields-synopsis-loss.test.ts` | +125 | **novo** — caracterização da perda de sinopse (não conserta) |
| `docs/operations/index-decisions-what-noindex-causes.md` | +194 | **novo** — o achado (B.5) + a lista de comandos afetados (A.5) |
| `docs/operations/index-decisions-staged-application.md` | +257 | **novo** — o procedimento em etapas (C.2), com reversão |
| `apps/web/package.json`, `services/ingestion/package.json` | +2 | registro dos dois validadores novos |

**Nenhum arquivo de política tocado**: `catalog-indexability.ts`,
`CATALOG_POLICY_VERSION` e `catalog-mass-change.ts` estão intactos.

---

## 8. A reversão — e a armadilha dentro dela

Documentada em `index-decisions-staged-application.md` §4. **Não existe
`catalog index-decisions --revert`** (verificado: nenhum comando da CLI despromove
decisões). Os caminhos reais:

1. **Freio de emergência** — `CINERIE_PUBLIC_INDEXING_ENABLED=0`. Segundos, sem
   tocar no banco, mas derruba o site inteiro. Estanca, não é estado final.
2. **`UPDATE … SET is_current = false`** — a única reversão de verdade.

> **A armadilha:** reverta o **tipo inteiro**, nunca em parte.
>
> O gate do sitemap arma quando a cobertura daquele tipo cruza 1.000 linhas, e
> **com o gate armado, ausência de linha significa FORA do sitemap**.
>
> - **Tipo inteiro:** cobertura vai a 0 → gate **desarma** → ausência volta a
>   significar dentro → sitemap volta ao que era. Reversão completa.
> - **Em parte** (500 de 1.020): cobertura segue acima de 1.000 → gate segue
>   **armado** → os 500 revertidos ficam **fora do sitemap** ainda que a página
>   deles volte a dizer `index`. Meta e sitemap passam a discordar — **pior que
>   não ter revertido**.

---

## 9. Portões — todos medidos

| portão | resultado |
| --- | --- |
| `typecheck` (+ `typecheck:catalog-runtime`) | **0** |
| `lint` | **0** |
| `test` | **566 arquivos / 7376 testes · 0 falhas** (baseline `24530fb`: 564 / 7362) |
| `audit:invariants` | 7 ok · **0 violações** |
| `audit:render` | 2 ok · **0 violações** |
| `build` | **0** |
| `validate:seo-runtime` (Postgres real) | **41/41** |
| `validate:decision-robots` (Postgres real) | **23/23** |
| `validate:indexability-producer` (Postgres real) | **26/26** (era 25/26) |
| `validate:index-decisions-cli` (Postgres real) | **16/16** |

O delta de +14 testes fecha exatamente: 5 (`dry-run-precheck`) + 5
(`display-fields-synopsis-loss`) + 4 (censo em `indexability-mass-change`).

> **Nota de método.** Os gates rodaram numa cópia em `C:\Users\pablo\cinerie-wt`
> (a worktree em `E:` inviabiliza `pnpm install`, e o `embedded-postgres` não
> sobe em caminho acentuado). A baseline de 564/7362 foi medida na mesma cópia,
> antes de qualquer mudança, com `git init` feito para que os dois testes de
> governança que chamam `git` não falhassem por artefato do `git archive`.

---

## 10. O que NÃO foi feito

- Nenhum `--apply`. Nenhum `INSERT`/`UPDATE`/`DELETE` em produção.
- Nada submetido ao Search Console.
- Política de indexabilidade, `CATALOG_POLICY_VERSION` e freio de mudança em
  massa: **intactos**.
- Fila, scheduler, home, listagens, galeria, `CastStrip`: **não tocados**.
- A sinopse **não foi consertada** — Item D era medição.

---

## 11. O que fica em aberto — e de quem é cada decisão

Mergeado **não é implantado**. `90981ff` está em `main`; o `screen-catalog-worker`
só passa a ter o `--dry-run` consertado depois do deploy. Até lá, rodar o comando
em produção continua devolvendo a frase antiga.

### 11.1 Decisões que são do dono

| decisão | o que já está pronto | o que falta |
| --- | --- | --- |
| **Aplicar `index-decisions`** | procedimento em etapas por `--entity`, com reversão e a armadilha da reversão parcial (`docs/operations/index-decisions-staged-application.md`) | rodar o `--dry-run` consertado em produção para fechar o número exato, e assinar |
| **Temporada e episódio** | medido que a decisão troca `follow` por `nofollow`, desfazendo a escolha da válvula da #234 | decidir se isso é desejado. Se não for, **não aplicar** nesses dois tipos — a válvula já faz o trabalho |
| **A sinopse de 38.613 títulos** | causa localizada e caracterizada por teste: o bloco `translations` já é baixado e nunca lido | decidir se vira a próxima leva. Se virar, a ordem das etapas de indexação provavelmente muda |
| **`--confirm-mass-change`** | o freio vai bloquear a primeira execução (~57,9% de flips) e sair 5 | é a assinatura humana da secção 6 do `CLAUDE.md`. Não incluir por reflexo |

### 11.2 Dívida técnica registrada, não consertada

- **`--dry-run` decorativo em três comandos** — `backfill-finalization` (o gêmeo
  exato do defeito consertado), `enqueue` e `dead-letter replay`. Os três são
  só-de-banco e poderiam pré-checar de verdade. Lista completa com o motivo de
  cada um em `docs/operations/index-decisions-what-noindex-causes.md` §7.
- **Comentários desatualizados** — o produtor e a saída da CLI ainda dizem *"A
  indexacao publica CONTINUA desligada"*. O `robots.txt` de produção prova o
  contrário. Não corrigi nesta leva para não misturar mudança de texto com o
  conserto; fica anotado.
- **Os validadores `scripts/**` estão fora de todo `tsconfig`** — descobri isso ao
  encontrar erros de tipo reais nos dois validadores que escrevi (corrigidos
  antes do merge). Nenhum validador do repositório é type-checado. Não ampliei o
  escopo para consertar isso.
- **D.1 e D.3 não foram medidos** — exigem o banco de produção. A boa notícia é
  que ficaram mais baratos do que a pergunta supunha: o bloco `translations` já
  está em `api_cache`/`tmdb_raw`, então a resposta sai por SQL, com **zero
  chamadas novas ao TMDB**.

### 11.3 O primeiro comando a rodar depois do deploy

```
pnpm catalog index-decisions --dry-run --json --confirm-production-read
```

Espere `massChange.blocked: true` e **exit 5**. É o freio funcionando. Leia
`byEntityType[*].byReason` antes de qualquer outra coisa: **se
`missing_translation` ou `missing_title` aparecerem com peso, o censo por SQL
subestimou o `noindex`** e os números da §4.4 sobem.
