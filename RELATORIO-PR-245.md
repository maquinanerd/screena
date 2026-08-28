# Relatório — PR #245 · O `revalidate` que nunca ligou nada, e as 63 mil linhas para mostrar 24 cards

> **Versão definitiva**, escrita depois do merge. O que segue é o desfecho medido,
> não a intenção da leva.

**PR:** https://github.com/maquinanerd/screena/pull/245 · **MERGEADA**
**Em `main`:** `3f6acd3` (squash) · **Base:** `ae1739e` (#244)
**Mergeada em:** 2026-08-28T05:43:06Z · **Branch:** preservada
**Diff que entrou em `main`:** 40 arquivos · +3.401 / −418
**Commits da branch:** `bc46d9b` (código e provas) · `0e5df43` (conserto do harness de estilo)

### CI — três execuções, e a primeira reprovou

| execução | commit | desfecho |
| --- | --- | --- |
| `33142586008` | `bc46d9b` | **failure** — `test:styles` (§7) |
| `33144165550` | `0e5df43` | 3/3 success |
| `33145607603` | `3f6acd3` (main) | 3/3 success |

### O estado depois desta leva, em quatro linhas

1. As **10 rotas de ficha** (67 mil URLs) passaram a ter cache de rota de verdade:
   `s-maxage=3600, stale-while-revalidate=31532400`, segunda leitura do cache.
2. A **home e as listagens** deixaram de varrer o catálogo: de dezenas de milhares
   de linhas por requisição para **289–480**, e de segundos para **~100 ms**.
3. **Nenhuma rota autenticada mudou de classe.** Um registro fechado agora reprova
   rota nova sem classificação.
4. **Nada disso está em produção.** `autoDeploy:false`; produção segue em
   `01ca048a` (build de 26/08). A medição que decide é humana e ainda não aconteceu.

---

## Sumário em uma linha

O pedido apontava dois defeitos independentes — "rota dinâmica" e "`no-store`" —
e uma hipótese principal ("leitura de sessão no layout raiz"). **A hipótese está
refutada**, o `no-store` **nunca foi código nosso**, e o tempo não estava onde se
supunha: as fichas — 67 mil das 110 mil URLs do sitemap — já respondiam em
**642 ms**, cinco vezes mais rápido que as listagens. O que custava 3–4 segundos
eram quatro páginas, por um motivo que ninguém tinha medido: elas liam o catálogo
inteiro para desenhar 24 cards.

---

## 1. O diagnóstico

### 1.1 A medição de fora, separando rede de servidor

Do navegador contra `cinerie.com`, 2026-08-28, com
`performance.getEntriesByName` (`responseStart - requestStart` isola a espera
pelo servidor da conexão e do download):

| rota | TTFB (servidor) | total | bytes | `cf-cache-status` |
| --- | ---: | ---: | ---: | --- |
| `/pt/` | **3.706 ms** | 3.914 ms | 105.491 | DYNAMIC |
| `/pt/filmes/` | **3.016 ms** | 3.230 ms | 87.446 | DYNAMIC |
| `/pt/series/` | **4.496 ms** | 4.709 ms | 89.435 | DYNAMIC |
| `/pt/pessoas/` | **3.111 ms** | 3.372 ms | 56.977 | DYNAMIC |
| `/pt/explorar/` | 2.748 ms | 2.966 ms | 64.145 | DYNAMIC |
| `/pt/em-breve/` | 715 ms | 931 ms | 277.833 | DYNAMIC |
| `/pt/onde-assistir/` | 482 ms | 688 ms | 80.616 | DYNAMIC |
| `/pt/noticias/` | 320 ms | 521 ms | 64.613 | DYNAMIC |
| **`/pt/filmes/a-odisseia/`** | **642 ms** | 855 ms | 62.772 | DYNAMIC |
| **`/pt/pessoas/h/`** | **308 ms** | 353 ms | 26.708 | DYNAMIC |
| `/api/health/` (`checkDurationMs: 4`) | **336 ms** | — | 212 | DYNAMIC |

`/api/health/` faz 4 ms de trabalho e leva 336 ms: **esse é o piso de rede**. A
home, portanto, gastava ~3,4 s **no servidor**. O tempo não estava no caminho.

**E as fichas nunca tinham sido medidas.** O enunciado dizia que o ganho de
rastreamento estaria nelas, por serem 67 mil URLs. Elas já eram as páginas mais
rápidas do site.

### 1.2 `server-timing` não serve

O cabeçalho existe e ninguém tinha lido o conteúdo. Ele traz `cfExtPri` —
marcador de prioridade da Cloudflare, não tempo de servidor. A separação
rede/servidor foi feita pelo Resource Timing do navegador, com
`/api/health/` como controle.

### 1.3 Correção de premissa (1): o `no-store` nunca foi nosso

Nenhuma linha deste repositório escreve `Cache-Control` de página — conferido em
`next.config.ts`, no `middleware.ts` e em varredura do repo. A string exata sai
de `getCacheControlHeader` (`next/dist/server/lib/cache-control.js`):

```js
if (revalidate === 0) return 'private, no-cache, no-store, max-age=0, must-revalidate'
else if (typeof revalidate === 'number') return `s-maxage=${revalidate}${swrHeader}`
```

**Não existe "ponto exato que estampa" o header, e não existe header global para
remover.** Existe rota dinâmica para deixar de ser dinâmica. Não foi global desde
o começo nem vazamento de escopo de rota autenticada: não foi escrito.

A prova não é leitura de código — `validate:route-cache` mede as duas saídas na
**mesma instalação do Next, no mesmo processo**: `no-store` em `/pt/` e
`s-maxage=31536000` em `/pt/termos/`.

### 1.4 Correção de premissa (2): não há sessão no layout raiz

A hipótese do enunciado era que algum server component no layout raiz lia
cookie/sessão, opondo todas as rotas a dinâmicas.

**Nenhum arquivo de `apps/web` importa `next/headers`.** Sem `cookies()` ou
`headers()`, nenhum server component consegue ler credencial, e nenhum HTML do
servidor carrega estado de usuário. `SiteHeader` é `'use client'` e faz só
navegação; as telas de titular (`/pt/conta`, `/pt/minha-lista`, …) são cascas
cujo dado vem de `/api/me/**` no cliente.

Consequência para a classificação: **a classe 3 do enunciado — pública porém
personalizada no servidor — não existe hoje.** Não era preciso consertar o
layout antes de classificar; e o guard novo trava essa ausência (§4.1, prova 8).

### 1.5 As duas causas reais, que são diferentes entre si

**Fichas:** `export const revalidate = 3600` estava declarado desde 2026-07-01
(commit `0767d25`) e era **inerte**. Faltava `generateStaticParams`. Sem essa
função o Next não considera a rota dinâmica elegível a prerender: ela não entra
em `dynamicRoutes` do `prerender-manifest.json`, `isSSG` fica falso, e o render
sai com `revalidate = 0` — que é exatamente o `no-store` observado.

Experimento controlado, `next build` na mesma árvore, uma linha de diferença:

| | tabela do build | `prerender-manifest.dynamicRoutes` |
| --- | --- | --- |
| sem `generateStaticParams` | `ƒ /pt/pessoas/[slug]` | `[]` |
| com `generateStaticParams: []` | `● /pt/pessoas/[slug]` | `["/pt/pessoas/[slug]"]` |

**Home e listagens:** `force-dynamic` explícito **e** leitura de `searchParams`
(`?ranking=`) no server component. Qualquer uma das duas basta.

### 1.6 O `Vary` de produção

`rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch,
Accept-Encoding`. **Não varia por cookie** — consistente com §1.4.

---

## 2. As três classes, rota a rota

O registro fechado vive em
[`apps/web/src/lib/route-cache-policy.ts`](apps/web/src/lib/route-cache-policy.ts),
com a classe **e o motivo escrito** de cada uma das **84** rotas do `app/`.
Contagem lida do próprio registro: `private` **53** · `public-static` **18** ·
`public-dynamic` **13**.

### Classe 1 — `private` (53 rotas)

São **34** rotas de API de credencial (`/api/auth/**` ×10, `/api/account/**` ×5,
`/api/me/**` ×19), **13** telas de titular, **5** rotas operacionais e **1** de
asset. 34 + 13 + 5 + 1 = 53.

Tudo sob `/api/auth/**`, `/api/account/**`, `/api/me/**`; `/pt/conta`,
`/pt/conta/privacidade`, `/pt/listas`, `/pt/listas/[id]`, `/pt/minha-lista`,
`/pt/historico`, `/pt/tracker`, `/pt/importar`, `/pt/entrar`, `/pt/criar-conta`,
`/pt/recuperar-senha`, `/pt/redefinir-senha`, `/pt/verificar-email`.

Mais quatro operacionais e um de asset, que não são de titular mas também não
podem ser guardados: `/api/health` (resposta guardada mentiria sobre o estado
atual), `/api/catalog/summary` (diagnóstico), `/api/internal/entity-resolve`
(depende da credencial de máquina), `/api/newsletter` (recebe e-mail por POST),
`/api/seo/redirect` (cache congelaria a tabela `redirects`), e
`/media/editorial/[...key]` (a própria rota decide seu header).

### Classe 2 — `public-static` (18 rotas)

**Com ISR (3600 s), geradas na primeira visita:** `/pt/filmes/[slug]`,
`/pt/filmes/[slug]/imagens`, `/pt/filmes/[slug]/videos`, `/pt/series/[slug]`,
`/pt/series/[slug]/imagens`, `/pt/series/[slug]/videos`,
`/pt/series/[slug]/temporadas/[season]`,
`/pt/series/[slug]/temporadas/[season]/episodios/[episode]`,
`/pt/series/[slug]/temporadas/[season]/episodios/[episode]/imagens`,
`/pt/pessoas/[slug]`.

**Prerenderizadas no build (não leem banco):** `/pt/termos`, `/pt/privacidade`,
`/pt/creditos-de-dados`, `/filmes`, `/series`, `/_not-found`, `/dev/ad-preview`,
`/dev/movie-page-preview`.

### Classe 3 — pública porém PERSONALIZADA no servidor: **nenhuma**

Nomeada uma a uma, como o enunciado pediu: **a lista é vazia**, pelo motivo de
§1.4. A personalização real (bookmark do card, "seu mês em números") já é
boundary de cliente. A prova 8 do guard reprova a introdução de `next/headers`
em `apps/web` justamente para forçar a reclassificação **antes** de qualquer
cache.

### Pública, mas não cacheável — três motivos distintos

`public-dynamic` tem **13** rotas: as 9 abaixo, mais as 4 de SEO fora de escopo
(logo adiante).

| rota | motivo |
| --- | --- |
| `/pt/explorar` | a resposta depende de `?q=` — legitimamente por requisição |
| `/pt/noticias`, `/pt/noticias/[slug]` | **despublicação de emergência** depende de leitura por requisição |
| `/pt`, `/pt/filmes`, `/pt/series`, `/pt/pessoas`, `/pt/em-breve`, `/pt/onde-assistir` | **limite de build** (§3) |

As três que o enunciado marcou como incertas foram olhadas: `/pt/explorar` é de
fato `searchParams`; `/pt/em-breve` (`getAnticipatedData`) e `/pt/onde-assistir`
(`getWatchBrowseData`) são catálogo puro, sem card editorial — poderiam ser
cacheáveis, e não são pelo mesmo limite de build.

### Fora de escopo, por decisão

`/sitemap.xml`, `/sitemaps/[shard]`, `/news-sitemap.xml`, `/robots.txt` — não
tocadas. **Não acho que devessem mudar agora**: #241 e #242 acabaram de subir
sobre elas e estão inertes até a aplicação das decisões.

---

## 3. O que NÃO foi possível, e o motivo é do deploy

Trocar `force-dynamic` por `revalidate` na home e nas listagens torna a rota
elegível a prerender — e **o Next prerenderiza caminho FIXO durante o
`next build`**. O release constrói **sem `DATABASE_URL` e sem env pública**, de
propósito. Tentado nesta leva:

```
Error occurred prerendering page "/pt/filmes"
PrismaClientInitializationError: Environment variable not found: DATABASE_URL
Export encountered an error on /pt/filmes/page, exiting the build.
```

Isso não é acidente: o bloco de comentário do `Dockerfile` documenta os **dois
furos de fail-open** que a ausência de env no build fechou — um staging que se
anunciava como produção indexável, e um `robots.txt` cujo kill switch exigia
rebuild. O comentário afirma, em letra, que "todas as páginas públicas são `ƒ`
(dinâmicas), então o build NÃO lê nenhuma env pública". **O estado todo-dinâmico
era load-bearing para o build.**

As fichas escapam porque `generateStaticParams` devolve `[]`: nada é
prerenderizado no build, cada URL nasce na primeira visita.

**Devolvido ao dono:** dar cache de rota a esses seis caminhos exige build com
banco alcançável ou um passo de prerender pós-deploy. É decisão de deploy, não
de código.

O que substituiu o cache de rota ali foi consulta menor — §5.

---

## 4. As provas — nenhuma passa por `grep` no fonte

### 4.1 `tests/web/route-cache-policy.test.ts` — o guard de vazamento

Oito provas. As decisivas:

- **(1)** toda rota do `app/` está classificada. **Rota nova sem classe reprova.**
  Ausência **nunca** significa "pública por omissão" — o padrão que custou duas
  levas (#241, #242) no `NOT EXISTS` do sitemap. Lá o preço era posição no
  Google; aqui seria a página de um usuário logado servida para outro.
- **(3)** nenhuma rota de credencial tem política pública.
- **(7)** **o BUILD concorda com o registro.** A classe efetiva sai de
  `.next/prerender-manifest.json` — a decisão do próprio Next, não o texto do
  nosso código. Isso importa: um guard que procurasse `export const revalidate`
  no fonte ficaria **verde com o defeito de pé**, que é exatamente como aquela
  declaração viveu treze meses sem ligar cache nenhum.
- **(8)** nenhum server component de `apps/web` importa `next/headers`.

O arquivo lê fonte pela porta única (`readSourceWithoutComments`) — obrigatório,
e não burocrático: a prova (8) procura um *import* de `next/headers`, e o próprio
arquivo cita `next/headers` em prosa várias vezes. Lendo cru, ele casaria com a
própria explicação.

### 4.2 `apps/web/scripts/validate-route-cache-real-postgres.ts` — Next real, Postgres real

**14/14 PASS**, na CI (Linux) e localmente (Windows), com os mesmos números.
Sobe PostgreSQL 16 efêmero, semeia **6.000 filmes + 3.000 séries + 3.000
pessoas** com slug e tradução, sobe `next start` sobre o build, e mede:

```
[PASS]  4. rota DINAMICA emite `no-store` sem uma linha nossa de Cache-Control
         /pt/ -> private, no-cache, no-store, max-age=0, must-revalidate
[PASS]  5. rota ESTATICA emite `s-maxage` na MESMA instalacao
         /pt/termos/ -> s-maxage=31536000
[PASS]  6. ficha de filme e CACHEAVEL (o `generateStaticParams` ligou o `revalidate`)
         cache-control=s-maxage=3600, stale-while-revalidate=31532400
[PASS]  7. a SEGUNDA leitura da ficha vem do cache — e nao so 'tem header novo'
         x-nextjs-cache=HIT  1a=87ms  2a=18ms
[PASS]  8. listagem de filmes:  289 linhas (teto 2000)  tempo=106ms
[PASS]  9. listagem de series:  289 linhas (teto 2000)  tempo= 85ms
[PASS] 10. listagem de pessoas:  49 linhas (teto 2000)  tempo= 40ms
[PASS] 11. home:                480 linhas (teto 2000)  tempo= 97ms
[PASS] 12. ficha guardavel responde IDENTICO com e sem cookie
[PASS] 14. `?ranking=` NAO altera a aba ativa do servidor
```

A prova 7 exige **duas coisas juntas** de propósito: header de cache **e** tempo
menor. Header novo não é tempo.

Rodando na CI depois do `pnpm build`, no passo *"Cache de rota + orçamento de
linhas (Next real, PostgreSQL 16 efêmero)"*.

### 4.3 `public-surface-row-budget.test.ts` — o orçamento de linhas, em `pnpm test`

Prisma falso com catálogo de **40.000** entidades, **generoso de propósito**: se
o código pedir tudo, ele dá tudo. Sete provas, incluindo um **controle positivo**
((1): o fake realmente devolve 40.000 quando ninguém limita) e a prova de que
`totalCount` vem do `COUNT` e não do tamanho da página — sem ela, encolher a
consulta faria `hasMore` dizer `false` numa listagem com 40 mil filmes.

### 4.4 `popular-ranking-tabs.test.tsx` — DOM, clique e URL de verdade

Sete provas em jsdom. Duas asserções que viviam em `vertical-scoping.test.tsx`
como markup estático **mudaram de arquivo e ficaram mais fortes**: "trocar a aba
troca a lista" e "'Ver tudo' segue a aba ativa" agora têm clique.

### 4.5 Os controles negativos — executados, um a um

| mutação | o que ficou vermelho | evidência |
| --- | --- | --- |
| `entity-indexes.ts` antigo | orçamento (2)(3)(4) | `120.000 linhas` vs teto 2.000, com a tabela nomeada |
| `home-hero.ts` antigo | orçamento (5) | idem |
| `home-upcoming.ts` antigo | orçamento (6) | idem |
| `totalCount` removido | orçamento (7) | `expected 48 to be 40000` |
| `generateStaticParams` removido | validador (6)(7) + guard (7) | volta `no-store`; `x-nextjs-cache` ausente |
| aba de volta ao servidor | validador (14) | `tab-classicos` vs `tab-em-cartaz` |
| rota nova sem classe | guard (1) | `['/pt/rota-nova']` |
| rota de credencial com política pública | guard (3) | `['/pt/minha-lista', …]` |
| `next/headers` em `apps/web` | guard (8) | `['src\lib\nc-headers.ts']` |

**Nenhum defeito reposto passou despercebido.**

---

## 5. As 62.500 linhas — onde estavam de verdade

O enunciado localizava o problema em `findManyInChunks` na home. **O
`home-catalog.ts` já tinha sido corrigido em 26/08** (a leitura já era escopada
aos ~20 ids do trending, e o comentário do arquivo documenta essa correção).

As leituras de catálogo inteiro que sobravam eram **três**, e a home chamava duas
delas:

| arquivo | o que fazia por requisição |
| --- | --- |
| `entity-indexes.ts` | todos os slugs canônicos → todas as entidades → todas as traduções → todos os cálculos de nota, para exibir **24 cards** |
| `home-hero.ts` | idem, para escolher **5 slides** |
| `home-upcoming.ts` | todos os slugs + todas as traduções, para exibir **6 cards** |

**O que mudou:** seleção e ordenação foram para o banco, com `LIMIT`; o total vem
de um `COUNT` separado. O hero ganhou o portão de qualidade em SQL, com as
**três** fontes de id que ele precisa (topo por votos, trending da semana, e a
curadoria manual — que não passa pelo portão, e sem a qual fixar um título pouco
votado deixaria de funcionar em silêncio).

| rota | antes | depois | tempo depois |
| --- | ---: | ---: | ---: |
| `/pt/filmes/` | 120.000 linhas | **289** | **106 ms** |
| `/pt/series/` | 120.000 | 289 | 85 ms |
| `/pt/pessoas/` | 120.000 | 49 | 40 ms |
| `/pt/` (home) | — | 480 | 97 ms |

**`findManyInChunks` NÃO foi removido.** Ele continua sendo a rede de segurança
do teto de 32.767 bind variables do protocolo do PostgreSQL, e continua em uso
onde a lista de ids é legitimamente grande. O que mudou é a lista não chegar mais
nesse tamanho.

### Divergência declarada

O desempate alfabético das listagens passou a ser a **collation do PostgreSQL**,
não o `localeCompare` do Node. Para o mesmo ano, dois títulos com acento podem
trocar de posição. É consequência inevitável de ordenar no banco: manter o
`localeCompare` como autoridade exigiria carregar o catálogo de novo, que é o
defeito.

### O diagnóstico de hero vazio não podia ficar mudo

Com o pré-filtro em SQL, um catálogo onde nada passa devolve zero linhas — e o
log `hero_empty` deixaria de sair **exatamente quando importa**. Foi acrescentado
um censo em SQL que roda **só** no caminho vazio e conta, sobre o catálogo
inteiro, quantos títulos caem por cada cláusula. É estritamente melhor que o
anterior, que só via a amostra carregada.

---

## 6. O `?ranking=` saiu do servidor

Uma única leitura de `searchParams` num server component torna a rota inteira
dinâmica. A aba nunca dependeu do servidor para funcionar: `PopularThisWeek` já
consultava **todos** os recortes de uma vez e trocava de painel com `useState`,
sem ida ao servidor. O que o servidor fazia era escolher o painel da **primeira
pintura**.

Isso passou para o cliente, na montagem. O HTML guardado é o mesmo para qualquer
`?ranking=`, e o link compartilhado continua abrindo na aba certa — provado por
clique e por URL em `popular-ranking-tabs.test.tsx`, e no HTML servido pelo
validador (prova 14).

---

## 7. Um vermelho que foi meu, e como ele passou pelos portões

A primeira CI (`33142586008`) reprovou em `test:styles`. **Não foi flake.**

`PopularThisWeek` deixou de receber `initialSlug` e passou a derivar a aba de
`vertical`. O harness `qa-default-styles-harness.tsx` continuava passando
`initialSlug` e **nenhuma** `vertical` — `RANKING_TABS[undefined]` virava
`undefined`, e `tabs[0]` estourava, derrubando a geração do harness antes de
qualquer navegador subir.

### Por que nenhum portão local pegou

`apps/web/tsconfig.json` tem `"exclude": ["node_modules", "scripts"]`,
**deliberadamente** (o comentário diz: dev tools descartáveis).

Antes de propor o remendo óbvio, testei-o:

```
tsc -p apps/web/scripts/tsconfig.json --noEmit   →   exit 0   (com o defeito de pé)
```

**Não pega.** Um `React.createElement(Componente, { …sem a prop obrigatória })`
não é reprovado ali. Adicionar esse typecheck como portão seria **placebo**, e
por isso **não foi adicionado**.

### O que pega, medido nos dois sentidos

```
pnpm --filter @screena/web qa:default-styles
   exit 1  com o defeito
   exit 0  com o conserto
```

É o `globalSetup` do `test:styles`: um `tsx` que renderiza os componentes reais
e escreve o harness. **Não sobe navegador nenhum.** E `pnpm test:styles`
completo roda nesta máquina, 9/9 em ~7 s.

**A causa raiz do vermelho foi processual, não técnica:** rodei a lista de
portões do enunciado, não a lista da CI.

### O conserto preserva o que o harness existia para medir

As duas instâncias existiam para pôr no DOM a aba **cheia** e a aba **vazia** ao
mesmo tempo; a segunda é a **única** fonte de `.pop-empty`, e sem ela a asserção
de cor daquele texto passaria por **ausência** — a armadilha que o comentário do
próprio arquivo alerta.

Como a aba inicial agora é sempre a primeira da vertical, o que distingue as
instâncias passou a ser o **dataset**: uma com a primeira aba cheia, outra com
todas vazias. Conferido no HTML gerado: **4** ocorrências de `pop-empty` e **5**
de `pop-rail__item`; e o teste (3b), que é justamente o do texto de aba vazia,
passa.

---

## 8. O instrumento que mentiu

A primeira versão do contador de linhas usava `pg_stat_database` e depois
`pg_stat_user_tables`, lidos antes e depois de uma requisição. **Os números não
se repetiam:**

| execução | `/pt/` | `/pt/series/` |
| --- | ---: | ---: |
| 1 | 45.087.000 | 9.039.000 |
| 2 | **0** | **0** |

Mesma árvore, mesmo banco. E é o pior desfecho possível: **um teto de 2.000
aprova o 0.**

A causa é do PostgreSQL: aquelas visões são alimentadas por um acumulador que
cada backend descarrega no fim de uma transação, com intervalo mínimo de ~1 s — e
um backend ocioso pode segurar o que acumulou por até ~10 s. A conexão que faz o
trabalho é a do processo do Next; ler "antes/depois" pela nossa corre contra esse
relógio.

`pg_stat_statements` não tem esse problema (atualiza no fim de cada statement) e
ainda guarda o texto da consulta. Três armadilhas para ligá-lo no
`embedded-postgres`, todas medidas e documentadas no script.

### E medir sem `ANALYZE` mede o planejador cego

Com o instrumento certo mas sem estatísticas, `/pt/filmes/` marcava **7,5 s** e
uma única consulta aparecia com 7.244 ms no log. Com `ANALYZE` após a semeadura:
**108 ms**, e nenhum statement acima de 400 ms. Produção tem autovacuum; medir
sem `ANALYZE` seria medir um plano que produção nunca usa.

---

## 9. Disco do cache de ISR — a conta, e o que ela não sabe

A página gerada sob demanda é gravada **ao lado do build**, em
`.next/server/app/<rota>/<slug>.{html,meta,rsc}` — **não** em `.next/cache`.
(Apagar `.next/cache` não limpa o ISR e ainda faz a primeira resposta sair sem
`Cache-Control`: medido.)

**Uma entrada medida** (fixture do validador): 31.831 + 16.283 + 198 =
**48 KB**. Com o tamanho real de produção:

| página | HTML medido | `.rsc` estimado | entrada |
| --- | ---: | ---: | ---: |
| `/pt/filmes/a-odisseia/` | 62.772 B | ~34.500 B | **~95 KB** |
| `/pt/pessoas/h/` | 26.708 B | ~14.700 B | **~40 KB** |

Sobre as **110.498 URLs** do sitemap, se o rastreamento materializar todas:
**~8 GB**.

**Duas ressalvas honestas:**

1. **O disco do container não foi medido.** Não há como fazê-lo daqui sem
   escrever em produção. A conta é o insumo da decisão, **não a decisão**.
2. O crescimento é proporcional às URLs **efetivamente visitadas**, e **todo
   deploy zera**.

Três mitigações, em ordem, em
[`docs/operations/route-cache-and-isr-disk.md`](docs/operations/route-cache-and-isr-disk.md).

---

## 10. Cloudflare — o que ela faz, e o que ela não faz

Medido: `/pt/termos/` responde `s-maxage=31536000` da origem e mesmo assim volta
com `cf-cache-status: DYNAMIC`. O CSS estático volta `HIT`.

**A Cloudflare não cacheia HTML por padrão, nem com cabeçalho permissivo.** Isso
exige uma **Cache Rule** no painel — configuração de borda, decisão do dono.
Traria ganho adicional real (a resposta sairia do PoP de GRU em vez de ir à
origem), e **não foi aplicada**. Não deve ser aplicada sem conferir, rota a rota,
a tabela da §2: uma regra larga demais cachearia área logada.

---

## 11. Consequências a declarar

1. **`noindex` demora até uma hora para aparecer numa ficha.** Uma decisão
   aplicada por `catalog index-decisions --apply` antes aparecia na requisição
   seguinte — porque a rota nunca chegava a ser cacheada. Aceitável para SEO (o
   recrawl do Google é muito mais lento que uma hora), mas não é invisível.
2. **Notícias continuam dinâmicas de propósito.** A despublicação de emergência
   depende de leitura por requisição: rebaixou no banco, 404 na requisição
   seguinte. Cache ali seguraria uma matéria retratada no ar.
3. **Ordenação alfabética das listagens mudou de autoridade** — §5.

---

## 12. Os portões

Todos medidos, localmente e na CI:

`typecheck` · `typecheck:apps` · `lint` · **suíte completa: 569 arquivos /
7.399 testes** · `test:styles` (9/9) · `audit:invariants` · `audit:render` ·
`api:coverage` · `build` · `validate:all` · **`validate:route-cache` (14/14)** ·
`validate:seo-runtime` · `validate:season-episode-routes`.

O total da suíte subiu de 7.318 para 7.399 — cobertura cresceu, não encolheu.

---

## 13. O que ficou de fora, e por quê

| item | motivo |
| --- | --- |
| Cache de rota na home e nas listagens | build do release sem `DATABASE_URL` — decisão de deploy (§3) |
| Cache Rule na Cloudflare | painel, decisão do dono (§10) |
| `/sitemap.xml`, `/sitemaps/[shard]`, `/news-sitemap.xml`, `/robots.txt` | fora de escopo por decisão |
| Typecheck de `apps/web/scripts/` | **testado e não pega** — seria placebo (§7) |
| Middleware (`fetch` a `/api/seo/redirect` por requisição) | medido e barato: `/pt/pessoas/h/` responde em 308 ms **incluindo** esse subrequest |
| Medição contra produção | **é humana, e é o que decide** (§14) |

---

## 14. A tarefa NÃO está concluída

**`autoDeploy:false` — merge não implanta.** Medido depois do merge: produção
segue em `01ca048a` (build de 2026-08-26), duas versões atrás.

| rota | tempo (produção, pós-merge) | `cache-control` |
| --- | ---: | --- |
| `/pt/` | 4.836 ms | `private, no-cache, no-store, …` |
| `/pt/filmes/a-odisseia/` | 931 ms | idem |

Faltam dois passos, e os dois são do dono:

**1. Implantar** o `screen-app` no EasyPanel.

**2. Medir**, colando no console em `cinerie.com`:

```js
(async () => {
  const rotas = ['/pt/', '/pt/filmes', '/pt/series', '/pt/pessoas',
                 '/pt/filmes/a-odisseia/', '/pt/series/reacher/'];
  const out = [];
  for (const p of rotas) {
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const r = await fetch(p, { cache: 'reload' });
      await r.text();
      out.push({ p, i, ms: Math.round(performance.now() - t0),
                 cf: r.headers.get('cf-cache-status'),
                 st: r.headers.get('server-timing'),
                 cc: r.headers.get('cache-control') });
    }
  }
  console.table(out);
})();
```

`cache: 'reload'` força o navegador a ir à rede mas deixa CDN e origem servirem
do cache **deles** — que é o que se quer medir.

### O critério, fixado ANTES da medida

- **ficha** (`/pt/filmes/{slug}/`): **< 800 ms**
- **listagens** e **home**: **< 1.500 ms**

Contra o piso de rede de ~336 ms. Não escolhi "50 % mais rápido" porque baseline
ruim vira meta fácil.

### O "antes", com o MESMO script e do mesmo lugar

`/pt/` — 5.343 ms, 4.395 ms, 4.836 ms · `/pt/filmes/` — 3.625 ms, 3.755 ms.

> **Enquanto essa medição não for feita contra produção depois do deploy, a
> tarefa não está concluída** — por mais verde que esteja tudo. Se o número na
> tela não cair, o achado é esse, e ele manda sobre tudo que está escrito aqui.

---

## 15. O diff que entrou em `main`

**40 arquivos · +3.401 / −418**

### Novos (6)

| arquivo | linhas | o que é |
| --- | ---: | --- |
| `apps/web/src/lib/route-cache-policy.ts` | +351 | o registro fechado de política por rota |
| `apps/web/scripts/validate-route-cache-real-postgres.ts` | +620 | Next real + Postgres real, 14 provas |
| `tests/web/route-cache-policy.test.ts` | +267 | o guard de vazamento (8 provas) |
| `apps/web/src/server/__tests__/public-surface-row-budget.test.ts` | +296 | orçamento de linhas (7 provas) |
| `apps/web/app/_components/__tests__/popular-ranking-tabs.test.tsx` | +180 | aba com DOM, clique e URL |
| `docs/operations/route-cache-and-isr-disk.md` | +201 | runbook |

### Camada de dados (3)

`entity-indexes.ts` (±484) · `home-hero.ts` (+255) · `home-upcoming.ts` (±225) —
seleção e ordenação no banco, com `LIMIT`.

### Rotas (13)

10 fichas ganharam `generateStaticParams`; home, `/pt/filmes`, `/pt/series`
perderam `searchParams`; `/pt/pessoas`, `/pt/em-breve`, `/pt/onde-assistir`
ganharam o motivo escrito do `force-dynamic`.

### Componentes (3)

`popular-this-week.tsx`, `home-like.tsx`, `popular-rankings.ts` — a aba virou
controle de cliente.

### Testes existentes adaptados (5)

`catalog-in-clause-fits-postgres` (controle positivo novo, porque o antigo media
um `IN` que deixou de existir) · `home-hero-scope` · `home-hero-selection` ·
`vertical-scoping` · `upcoming-rail-by-route` (duas asserções textuais viraram
observação da consulta emitida).

### Infra (4)

`ci.yml` (+7, o passo novo depois do `pnpm build`) · `package.json` ×2 ·
`CLAUDE.md` (+1, ponteiro para o runbook) · `qa-default-styles-harness.tsx`
(±25, §7).
