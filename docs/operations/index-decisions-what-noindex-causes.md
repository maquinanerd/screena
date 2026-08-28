# O que uma decisao `noindex` realmente causa — e o que o `--dry-run` nao pre-checava

> Escrito em 2026-08-27, depois de medir. Este documento existe porque a
> informacao aqui e a que o dono precisa ter na mao **no momento de assinar**
> `catalog index-decisions --apply`, e ela nao estava escrita em lugar nenhum.
>
> Irmaos: [`index-decisions-staged-application.md`](./index-decisions-staged-application.md)
> (o procedimento de aplicacao) e
> [`../backend/catalog-operations.md`](../backend/catalog-operations.md).

---

## 1. A resposta curta

**Uma decisao vigente `noindex` em `page_indexability_decisions` NAO tira a
pagina so do sitemap. Ela faz a pagina EMITIR `<meta name="robots"
content="noindex">`.** Vale para os cinco tipos decidiveis: filme, serie,
temporada, episodio e pessoa.

A diferenca importa e nao e de grau:

| efeito | como se desfaz |
| --- | --- |
| sair do **sitemap** | horas. O sitemap e um convite; o buscador mantem no indice o que ja rastreou. |
| emitir **`noindex`** | semanas. E um pedido de REMOCAO: a pagina sai do indice e so volta depois de recrawl. |

`page_indexability_decisions` faz **as duas coisas**.

## 2. Como isso foi medido (nao lido)

Por RENDERIZACAO, contra PostgreSQL 16 real e efemero:

```
pnpm --filter @screena/web validate:decision-robots
```

[`apps/web/scripts/validate-decision-robots-render-real-postgres.ts`](../../apps/web/scripts/validate-decision-robots-render-real-postgres.ts)
importa as rotas de verdade (`app/pt/.../page.tsx`), chama o `generateMetadata`
que o Next chamaria e le o `robots` que sai. 23/23 checks.

Ler o caminho no codigo nao bastaria: entre a resolucao (`resolveEntityPageSeo`)
e a tag ainda ha `gatePublicRobots`, que pode colapsar tudo conforme o ambiente.
O validador de SEO que ja existia (`validate:seo-runtime`, check 4) prova a
RESOLUCAO, nunca a tag.

### O caminho, em uma linha

`page_indexability_decisions` (linha `is_current`)
→ `getCurrentPageIndexabilityDecision`
→ `mergePersistedDecision` (a persistida vence quando e MAIS restritiva que os fatos vivos)
→ `seo.robots`
→ `gatePublicRobots(seo.robots)` (AND com o kill switch de ambiente)
→ `<meta name="robots">`.

## 3. O que muda, por tipo

Medido com o ambiente reproduzindo a producao de hoje (origem oficial + flag
ligada). "Antes" = sem nenhuma linha na tabela.

| tipo | antes | depois de uma decisao `noindex` |
| --- | --- | --- |
| filme | `index,follow` | `noindex,nofollow` |
| serie | `index,follow` | `noindex,nofollow` |
| pessoa | `index,follow` | `noindex,nofollow` |
| temporada | **`noindex,follow`** | `noindex,nofollow` |
| episodio | **`noindex,follow`** | `noindex,nofollow` |

### Temporada e episodio ja estao fora — e a decisao muda outra coisa neles

Os dois nao dependem da tabela para sair do indice: estao suspensos desde
2026-08-27 pela valvula de emergencia
([`apps/web/src/server/seo/suspended-pages.ts`](../../apps/web/src/server/seo/suspended-pages.ts),
PR #234) e ja emitem `noindex, follow` sem nenhuma linha.

O que a decisao persistida muda neles **nao e o `noindex` — e o `follow`, que
vira `nofollow`**. E a valvula escolheu `follow` de proposito: o episodio aponta
para a temporada e para a serie, que SEGUEM indexaveis, e `nofollow` faria o
crawler parar de seguir justamente os links que sustentam as paginas que se quer
manter.

> Consequencia operacional: aplicar `index-decisions` sobre `season`/`episode`
> desfaz essa escolha em silencio. Se a intencao nao for essa, corte o `--entity`
> (ver o procedimento em etapas).

## 4. O canonical NAO muda

Checks 14–18 do validador: `alternates.canonical` e byte a byte o mesmo antes e
depois da decisao, nos cinco tipos. Canonical vem de `slugs`; indexabilidade vem
de `page_indexability_decisions`. Os dois nunca se cruzam — e nao devem: uma
pagina que sai do indice apontando para outro lugar seria duas mudancas quando o
operador autorizou uma.

## 5. O kill switch global continua sendo o freio de cima

`gatePublicRobots` e um AND: `isOfficialIndexableEnvironment` **e** a decisao da
entidade. Com `CINERIE_PUBLIC_INDEXING_ENABLED` desligada, tudo colapsa para
`noindex,nofollow` (checks 19–23) e nenhuma decisao consegue tornar nada
indexavel — a flag so derruba, nunca levanta.

**Medido em 2026-08-27: a flag esta LIGADA em producao.** O `robots.txt` publico
de `cinerie.com` traz o grupo proprio do app (`Allow: /`, `Disallow: /api/`,
`/dev/`, `/admin/`) e anuncia os dois sitemaps — ramo que
[`apps/web/app/robots.ts`](../../apps/web/app/robots.ts) so emite quando
`isOfficialIndexableEnvironment` e verdadeiro.

> Consequencia: comentarios em codigo que dizem "a indexacao publica CONTINUA
> desligada" (no produtor e na saida da CLI) estao **desatualizados**. Nao sao a
> descricao do ambiente de hoje.

## 6. Por que o `--dry-run` nao servia de pre-checagem (consertado nesta leva)

Rodado em producao em 2026-08-27:

```
$ pnpm catalog index-decisions --dry-run --json --confirm-production-read
{"dryRun":true,"command":"index-decisions","subcommand":null,
 "plan":["index-decisions: sem efeito colateral"]}
$ echo $?
0
```

**Causa.** `bin/catalog.ts` tratava `--dry-run` num unico ponto, ANTES do
dispatch: montava frases com `describePlan()` e saia 0, sem abrir Prisma.
`index-decisions` nao tinha `case` nessa funcao e caia no `default:`. O handler
`cmdIndexDecisions` — que ja recebia `dryRun: !apply` e ja calculava o censo
inteiro, com freio e tudo — **nunca era chamado com a flag**.

Nao era um bug de calculo: era um desvio de roteamento. Dois validadores verdes
cobriam o produtor (`produceIndexabilityDecisions({dryRun:true})`), e a ajuda ja
prometia o comportamento certo ("`--dry-run` calcula e mostra o diff", "code 5 em
dry-run tambem"). O unico elo sem teste era o `bin/`, e era exatamente ele.

Pior que ausencia: a frase "sem efeito colateral" descreve a INTENCAO do comando
(nao tocar em nada durante o dry-run) e le-se como veredito sobre a mudanca.

### O que o `--dry-run` faz agora

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
  ...
  freio: 300 flip(s) de 1060 avaliadas (28.30%) · tetos 100000 absoluto / 100.00% proporcional · nao bloqueia
```

`criaria` x `alteraria` e a distincao que faltava: uma linha que **nasce**
`noindex` amplia a cobertura da tabela; uma que **troca** de `index` para
`noindex` tira do indice uma pagina que o buscador ja conhece.

Exit codes (valem em `--dry-run` e em `--apply`, porque o dry-run e a
pre-checagem do apply): `0` ok · `2` uso invalido · `3` gate de producao ·
`5` freio de mudanca em massa.

Provado por execucao em
[`services/ingestion/scripts/validate-index-decisions-cli-real-postgres.ts`](../../services/ingestion/scripts/validate-index-decisions-cli-real-postgres.ts)
(`pnpm --filter @screena/ingestion validate:index-decisions-cli`, 16/16) e por
[`services/ingestion/src/cli/__tests__/dry-run-precheck.test.ts`](../../services/ingestion/src/cli/__tests__/dry-run-precheck.test.ts),
que aponta a CLI para um PostgreSQL inalcancavel: uma pre-checagem que reporta
sucesso contra um banco que nao existe nao calculou censo nenhum.

## 7. Os outros comandos com `--dry-run` decorativo (NAO consertados nesta leva)

O tratador era generico, entao o defeito nao e de um comando so. Levantamento
completo dos comandos que exigem `--dry-run`/`--apply`:

| comando | o que o `--dry-run` faz hoje | pre-checagem real e possivel? |
| --- | --- | --- |
| `index-decisions` | **CONSERTADO** — roda a politica e imprime o censo | — |
| `backfill-finalization` | cai no `default:` — nenhuma contagem | **sim**: e so-leitura de PostgreSQL; `backfillFinalization({dryRun})` ja existe e ja devolve candidatos/elegiveis/ignorados por motivo, e nunca e chamado com a flag. E o gemeo exato do defeito consertado. |
| `enqueue` | frase fixa: "enfileiraria o job X" | **sim**: e so-de-banco; poderia validar o payload e dizer se a chave de idempotencia ja existe (isto e, se o enqueue seria um no-op). |
| `dead-letter replay` | frase fixa com o limite | **sim**: e so-de-banco; poderia contar quantos jobs seriam reprocessados e de que tipo. |
| `bootstrap` | plano escrito a mao | nao sem cota: planejar le listas do TMDB. Use `plan-bootstrap`, que estima o custo de verdade. |
| `sync`, `changes`, `discovery`, `media`, `episodes` | plano escrito a mao | nao sem cota TMDB. "Dry-run nao monta o runtime" continua sendo a garantia certa para estes. |
| `search-reindex` | plano escrito a mao | parcialmente (le do banco), mas monta o runtime completo hoje. |

Os tres primeiros da coluna "sim" sao divida conhecida, nao consertada aqui por
escopo. Enquanto isso, o `default:` de `describePlan` deixou de dizer "sem efeito
colateral" e passa a dizer, explicitamente, que **nenhum numero foi calculado** e
que a saida nao aprova um `--apply`.

A lista de quem executa a politica no dry-run e uma so, no nucleo puro:
`DRY_RUN_RUNS_REAL_POLICY` em
[`services/ingestion/src/cli/args.ts`](../../services/ingestion/src/cli/args.ts).
Criterio para entrar: **a pre-checagem e so-leitura de PostgreSQL local — sem
rede, sem cota, sem TMDB.**
