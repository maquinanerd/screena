# Aplicar `index-decisions` em etapas — procedimento

> Escrito em 2026-08-27. **Nada aqui foi executado**: a assinatura e do dono.
>
> Leia ANTES: [`index-decisions-what-noindex-causes.md`](./index-decisions-what-noindex-causes.md).
> Sem ele este procedimento parece burocracia; com ele fica claro que a
> execucao **remove paginas do indice do Google**, e nao apenas do sitemap.

---

## 0. O que esta em jogo, em numeros

Censo medido em producao por SQL em 2026-08-27 (movie + tv):

| tipo | ELEGIVEL | sem_sinopse | sem_imagem | sem_slug | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| movie | 15.770 | 18.934 | 95 | — | **34.799** |
| tv | 12.582 | 19.679 | 131 | 94 | **32.486** |

Fecha com o sitemap publicado (movies 34.799 · series 32.392 = 32.486 − 94 sem
slug, que nunca teve URL).

**Correcao de numero.** O relatorio de origem falava em "38.613 paginas de
titulo passariam a emitir `noindex`". 38.613 e a soma **so** dos dois baldes
`sem_sinopse` (18.934 + 19.679). O total nao-elegivel do proprio censo e:

- **38.933 linhas** nasceriam `noindex` (19.029 de filme + 19.904 de serie);
- dessas, **38.839 estao no sitemap hoje** e sairiam dele (as 94 sem slug nunca
  tiveram URL, mas ganham linha de decisao do mesmo jeito);
- **28.352** ficariam `index` (15.770 + 12.582).

Diferenca para o numero anterior: **+320**.

### Por que 38.933 e um PISO, e nao o numero final

O SQL do censo **aproxima** a politica; nao e a politica. A politica real
(`decideCatalogIndexability`) avalia, nesta ordem: licenca → idioma →
`missing_slug` → `missing_title` → `missing_translation` → `no_synopsis` →
`no_image` → `eligible`. O censo por SQL nao tinha balde para **`missing_title`**
nem para **`missing_translation`**.

Consequencia: cada titulo classificado como ELEGIVEL que nao tenha
`title_original`/`name_original` ou nao tenha linha em `entity_translations` para
`pt-BR` sera `noindex` na politica real. Logo **28.352 e um TETO para `index`** e
**38.933 e um PISO para `noindex`**. A divisao entre `missing_translation` e
`no_synopsis` tambem nao e derivavel do censo como foi reportado.

O jeito de fechar o numero exato e o `--dry-run` consertado — que e a razao de
ele existir. **Rode-o e use os numeros dele, nao os desta tabela.**

### Tres tipos nunca foram medidos

O censo cobriu movie e tv. Sem `--entity`, o produtor avalia os **cinco** tipos
de `DECIDABLE_ENTITY_TYPES` — `person`, `season` e `episode` inclusive. Pessoa
nao tem shard no sitemap hoje (`people 0`); temporada e episodio ja estao
suspensos, e neles a decisao troca `follow` por `nofollow` (ver o doc irmao,
secao 3). **Nenhum dos tres tem censo.** Nao aplique neles as cegas.

### O freio VAI disparar na primeira execucao

Com a tabela vazia, `null → noindex` conta como flip e `null → index` nao. Entao
a primeira execucao completa mede ~38.933 flips em ~67.285 avaliadas (~57,9%) —
muito acima dos tetos default (500 absoluto / 5% proporcional). Ela sai com
**code 5 e grava ZERO linhas**.

Isso e o comportamento correto e nao e um obstaculo a contornar: e a assinatura
humana que a secao 6 do CLAUDE.md exige. Passar do teto exige
`--confirm-mass-change` — deliberadamente, uma vez por etapa. Vale tambem para
uma etapa de um tipo so (`--entity movie` sozinho ja mede ~54,7%).

---

## 1. Por que em etapas

`catalog index-decisions --entity <tipo> --apply` escreve **somente** decisoes
daquele tipo, e o gate do sitemap arma **por tipo** (a cobertura e contada por
`entity_type`). Cortar por tipo permite aplicar um, observar, e so entao seguir —
em vez de apostar o catalogo inteiro numa execucao.

Provado por execucao, nao por leitura:
`pnpm --filter @screena/ingestion validate:index-decisions-cli` (16/16). Os
checks 13–15 mostram, contra PostgreSQL real: depois de
`--entity movie --apply`, o banco tem `{"movie": 1020}` e **nada mais**; o gate de
filme arma (1020 ≥ 1000) e o de serie continua desarmado (0 < 1000).

---

## 2. Pre-requisito de cada etapa

1. Confirme em que commit producao esta. Mergeado nao e implantado.
2. Todo comando roda no console do painel, no servico
   **`screen-catalog-worker`**, em `/app`.
3. Em producao, `NODE_ENV=production`, entao:
   - **leitura** (`--dry-run`) exige `--confirm-production-read`;
   - **escrita** (`--apply`) exige `--force`.
4. Tenha a contagem de linhas ANTES da etapa (passo 3.1 abaixo). Sem o "antes",
   o "depois" nao mede nada.

---

## 3. O procedimento

### Passo 0 — a foto do antes (SQL, so leitura)

```sql
SELECT entity_type::text, decision::text, COUNT(*)
  FROM page_indexability_decisions
 WHERE is_current AND language_code = 'pt-BR'
 GROUP BY 1, 2 ORDER BY 1, 2;
```

Guarde a saida. Numa tabela ainda nunca escrita, o esperado e **nenhuma linha**.

### Passo 1 — pre-checagem completa, sem cortar por tipo

```
pnpm catalog index-decisions --dry-run --json --confirm-production-read
```

Isto nao escreve nada. Leia, no JSON:

- `evaluated` — o universo real (deve ficar acima dos 67.285 do censo, porque
  inclui person/season/episode);
- `byEntityType.<tipo>.byDecision` — quantas de cada tipo em cada veredito;
- `byEntityType.<tipo>.byReason` — o motivo agregado. **Se `missing_translation`
  ou `missing_title` aparecerem com peso, o censo por SQL subestimou o `noindex`**;
- `writes.created` / `writes.updated` — na primeira execucao, tudo `created`;
- `massChange.flips`, `massChange.limits`, `massChange.blocked`.

Espere `blocked: true` e **exit 5**. Isso e o freio funcionando.

> **Ponto de parada.** Se `evaluated` vier muito abaixo do catalogo, ou se algum
> tipo vier com 0 avaliadas, PARE: o produtor nao esta enxergando o catalogo, e
> aplicar seria escrever sobre uma leitura parcial.

### Passo 2 — pre-checagem do PRIMEIRO tipo, isolada

Comece por **filme**: e o maior shard e o de censo conhecido.

```
pnpm catalog index-decisions --entity movie --dry-run --json --confirm-production-read
```

Confira que `byEntityType` traz **so** `movie`. Anote `writes.created`,
`writes.updated` e `massChange.flips`.

### Passo 3 — aplicar o primeiro tipo

Só depois de ler o passo 2 e decidir que os numeros sao os esperados:

```
pnpm catalog index-decisions --entity movie --apply --force --confirm-mass-change
```

`--confirm-mass-change` e a assinatura. Nao a inclua por reflexo: ela e a
diferenca entre "o freio me protegeu" e "eu autorizei".

### Passo 4 — o que observar ANTES de seguir para o proximo tipo

Nao ha metrica automatica; observe explicitamente:

1. **O banco.** Repita o SQL do passo 0. As contagens tem de bater com
   `writes.created` do passo 2, e **so** deve haver linhas de `movie`.
2. **A pagina.** Abra um filme que o censo pos em `noindex` e leia o
   `<meta name="robots">` no HTML servido. Tem de dizer `noindex`. Abra um que
   ficou `index` e confirme `index,follow`. Se os dois derem a mesma coisa, pare.
3. **O sitemap.** `GET /sitemap.xml`. O gate de filme agora esta ARMADO
   (cobertura ≫ 1000): o shard de filmes deve cair de 34.799 para ~o numero de
   `index` do passo 2. Series, imagens e videos **nao podem** ter mudado.
4. **A janela.** Deixe passar pelo menos um ciclo de recrawl antes do proximo
   tipo. O efeito no indice do Google nao aparece em minutos, e aplicar o
   segundo tipo antes de ver o primeiro anula a razao de ter feito em etapas.

### Passo 5 — repetir para os demais tipos, um por vez

Ordem sugerida, do mais medido para o menos:

1. `movie` (censo conhecido)
2. `tv` (censo conhecido)
3. `person` (sem censo — rode o `--dry-run` do passo 2 e leia com atencao; hoje o
   sitemap tem `people 0`)
4. `season` e `episode` — **so se a intencao for trocar `follow` por `nofollow`**
   nesses dois tipos, que ja estao suspensos do indice. Se nao for, nao aplique:
   a valvula ja faz o trabalho e preserva o `follow` de proposito.

---

## 4. Reverter

**Nao existe `catalog index-decisions --revert`.** Verificado: nenhum comando da
CLI despromove decisoes. Os caminhos reais, do mais rapido ao mais preciso:

### 4.1 Freio de emergencia (segundos, sem tocar no banco)

```
CINERIE_PUBLIC_INDEXING_ENABLED=0
```

`gatePublicRobots` colapsa **todas** as paginas para `noindex,nofollow`
imediatamente. E o martelo: derruba o site inteiro, nao so o que voce aplicou.
Serve para estancar enquanto se decide, nunca como estado final.

### 4.2 Desfazer a etapa (SQL, e a unica reversao de verdade)

Despromova as decisoes vigentes **do tipo inteiro** que voce aplicou:

```sql
BEGIN;
SELECT COUNT(*) FROM page_indexability_decisions
 WHERE entity_type = 'movie' AND language_code = 'pt-BR' AND is_current;

UPDATE page_indexability_decisions
   SET is_current = false
 WHERE entity_type = 'movie' AND language_code = 'pt-BR' AND is_current;
-- confira o numero de linhas afetadas contra o SELECT acima antes de COMMIT
COMMIT;
```

Sem linha vigente, `mergePersistedDecision` devolve a resolucao viva e a pagina
volta a `index,follow`.

> **A ARMADILHA: reverta o TIPO INTEIRO, nunca em parte.**
>
> O gate do sitemap arma quando a cobertura daquele tipo cruza
> `SITEMAP_DECISION_GATE_MIN_ROWS` (1.000). Com o gate ARMADO, **ausencia de
> linha significa FORA do sitemap**.
>
> - Revertendo o tipo inteiro: a cobertura vai a 0, o gate DESARMA, ausencia
>   volta a significar DENTRO, e o sitemap volta ao que era. Reversao completa.
> - Revertendo em parte (digamos 500 filmes): a cobertura continua acima de
>   1.000, o gate segue ARMADO, e os 500 revertidos ficam **fora do sitemap**
>   ainda que a pagina deles volte a dizer `index`. Meta e sitemap passam a
>   discordar — pior que antes de reverter.

### 4.3 Reaplicar depois de corrigir o dado

O caminho normal nao e reverter, e **corrigir a causa**: o gate pergunta pelo
DADO. Preenchida a sinopse que faltava, a proxima execucao decide `index`
sozinha, sem deploy — e ai `writes.updated` (nao `created`) sera o numero a
observar.

---

## 5. O que este procedimento NAO cobre

- **Search Console.** Nao submeta nada. Remover pagina do indice via decisao ja e
  um pedido; um pedido de remocao manual por cima e outra coisa, com outro prazo.
- **`en`/`es`.** Tudo aqui e `pt-BR` (o `--locale` default). Outros idiomas
  seguem `PUBLISHED_LOCALES` e revisao humana (invariante 7).
- **A falta de sinopse.** 38.613 titulos sem sinopse e o maior balde do censo, e
  ele **nao e um problema de indexacao** — e de ingestao. Medido nesta mesma leva:
  o bloco `translations` do TMDB (que traz a sinopse de todos os idiomas) **ja e
  baixado** em toda requisicao de detalhe e nunca e lido. Ver a secao "de onde vem
  a falta de sinopse" no relatorio da leva e
  [`services/ingestion/src/__tests__/display-fields-synopsis-loss.test.ts`](../../services/ingestion/src/__tests__/display-fields-synopsis-loss.test.ts).
  Se metade do catalogo esta a um campo de ser publicavel, a ordem das etapas
  acima pode mudar — e isso e decisao do dono, nao efeito colateral desta leva.
