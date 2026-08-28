# Cache de rota do app publico — o que e guardado, onde, e quanto disco custa

> Runbook operacional. Leia antes de mexer em `revalidate`, em
> `generateStaticParams`, ou no disco do container `screen-app`.
>
> A politica por rota, com o motivo de cada uma, vive em
> [`apps/web/src/lib/route-cache-policy.ts`](../../apps/web/src/lib/route-cache-policy.ts)
> e e travada por [`tests/web/route-cache-policy.test.ts`](../../tests/web/route-cache-policy.test.ts).

---

## 1. O `no-store` nunca foi nosso

Medido em producao em 2026-08-28: toda rota publica respondia
`cache-control: private, no-cache, no-store, max-age=0, must-revalidate`.

Nenhuma linha deste repositorio escreve esse cabecalho. Ele e o default do Next
para resposta NAO cacheada — `getCacheControlHeader` em
`next/dist/server/lib/cache-control.js` devolve exatamente essa string quando
`revalidate === 0`, e devolve `s-maxage=<n>` quando ha cache.

A prova nao e leitura de codigo: `validate-route-cache-real-postgres.ts` sobe UM
Next e mede as duas respostas na mesma instalacao —

| rota | modo de render | `Cache-Control` emitido |
| --- | --- | --- |
| `/pt/` | dinamica | `private, no-cache, no-store, max-age=0, must-revalidate` |
| `/pt/termos/` | prerenderizada | `s-maxage=31536000` |
| `/pt/filmes/{slug}/` | ISR | `s-maxage=3600, stale-while-revalidate=31532400` |

**Consequencia pratica:** nao existe "header global para remover". Para uma rota
parar de emitir `no-store`, ela precisa parar de ser dinamica.

---

## 2. O que liga o ISR numa rota de ficha

`export const revalidate = 3600` estava declarado nas fichas desde 2026-07 e era
**INERTE**. Faltava `generateStaticParams`.

Sem essa funcao, o Next nao considera a rota dinamica elegivel a prerender: ela
nao entra em `dynamicRoutes` do `prerender-manifest.json`, `isSSG` fica falso, e
o render sai com `revalidate = 0` — o `no-store` observado.

Experimento controlado (`next build` na mesma arvore, uma linha de diferenca):

| | tabela do build | `prerender-manifest.dynamicRoutes` |
| --- | --- | --- |
| sem `generateStaticParams` | `ƒ /pt/pessoas/[slug]` | `[]` |
| com `generateStaticParams: []` | `● /pt/pessoas/[slug]` | `["/pt/pessoas/[slug]"]` |

A funcao devolve `[]` de proposito: nada e prerenderizado no build (sao ~67 mil
URLs, e o build nao tem banco — ver secao 3). Cada URL nasce na primeira visita
e e guardada pela janela do `revalidate`.

---

## 3. Por que a home e as listagens continuam dinamicas

`/pt`, `/pt/filmes`, `/pt/series`, `/pt/pessoas`, `/pt/em-breve` e
`/pt/onde-assistir` sao caminhos FIXOS. Caminho fixo elegivel a cache de rota e
prerenderizado durante o `next build` — e o release constroi **sem
`DATABASE_URL` e sem env publica**, de proposito (ver o bloco de comentario do
`Dockerfile`: env assada no build ja causou dois furos de fail-open).

Tentado em 2026-08-28:

```
Error occurred prerendering page "/pt/filmes"
PrismaClientInitializationError: Environment variable not found: DATABASE_URL
Export encountered an error on /pt/filmes/page, exiting the build.
```

**O que substituiu o cache de rota nessas seis: consulta menor.** Elas liam o
catalogo inteiro por requisicao para exibir 24 cards. Medido no validador com
12 mil entidades semeadas:

| rota | linhas lidas por requisicao | tempo |
| --- | ---: | ---: |
| `/pt/filmes/` antes | 120.000 (fake de 40 mil) / dezenas de milhares (banco real) | 7,5 s |
| `/pt/filmes/` depois | **289** | **108 ms** |
| `/pt/series/` depois | 289 | 86 ms |
| `/pt/pessoas/` depois | 49 | 73 ms |
| `/pt/` (home) depois | 480 | 95 ms |

> **Para o dono:** dar cache de rota a esses seis caminhos exige um build com
> banco alcancavel, ou um passo de prerender pos-deploy. E decisao de DEPLOY,
> nao de codigo, e nao foi tomada aqui.

---

## 4. Disco do cache de ISR — a conta, e o que ela nao sabe

A pagina gerada sob demanda e gravada **ao lado do build**, em
`.next/server/app/<rota>/<slug>.{html,meta,rsc}` — nao em `.next/cache`.
(Apagar `.next/cache` nao limpa o ISR e ainda quebra a primeira resposta:
medido.)

**Uma entrada medida** (fixture do validador): 31.831 B de `.html` + 16.283 B de
`.rsc` + 198 B de `.meta` = **48 KB**.

A fixture e magra. Usando o tamanho REAL medido em producao em 2026-08-28:

| pagina | HTML medido | `.rsc` estimado (~55% do HTML) | entrada |
| --- | ---: | ---: | ---: |
| `/pt/filmes/a-odisseia/` | 62.772 B | ~34.500 B | **~95 KB** |
| `/pt/pessoas/h/` | 26.708 B | ~14.700 B | **~40 KB** |

O sitemap tem **110.498 URLs** (6 shards). Se o rastreamento materializar todas:

- ~67.000 fichas de filme/serie x 95 KB ≈ **6,4 GB**
- ~43.000 fichas de pessoa/episodio x 40 KB ≈ **1,7 GB**
- **total ≈ 8 GB**

Duas ressalvas honestas:

1. **O disco do container nao foi medido.** Nao ha como faze-lo daqui sem
   escrever em producao. **A conta acima e o insumo da decisao, nao a decisao.**
2. O crescimento e proporcional as URLs **efetivamente visitadas**, nao a 110
   mil de saida, e **todo deploy zera** (imagem nova, `.next` novo).

### Se 8 GB nao couber

Em ordem de preferencia, tudo aplicavel sem tocar em arquitetura:

1. **Tirar o ISR das galerias** (`/imagens`, `/videos`): sao as rotas de menor
   valor de rastreamento e as que mais multiplicam entradas por entidade. Basta
   remover o `generateStaticParams` daquelas rotas e reclassifica-las em
   `route-cache-policy.ts`.
2. **Encurtar `CATALOG_SURFACE_REVALIDATE_SECONDS`**: nao reduz o pico de disco
   (a entrada e sobrescrita, nao duplicada), mas reduz o tempo em que uma
   entrada fria continua ocupando espaco antes do proximo deploy.
3. **Montar um volume dedicado** para o `.next` do `screen-app`, ou aumentar o
   disco. E a unica opcao que preserva o ganho inteiro.

**Como medir depois do deploy:** o tamanho de
`.next/server/app/pt/filmes` dentro do container, comparado com o disco livre.

---

## 5. Janelas, e por que cada uma

| superficie | janela | por que |
| --- | ---: | --- |
| fichas de filme/serie/pessoa, temporada, episodio, galerias | 3600 s | catalogo se move em ciclos de horas/dias (`.claude/rules/ingestion.md`); e a janela que a rota ja declarava desde 2026-07 |
| documentos legais, aliases `/filmes` e `/series` | build | nao leem banco; quem revalida e o deploy |

**Consequencia a declarar:** uma decisao `noindex` aplicada por
`catalog index-decisions --apply` passa a levar ate uma hora para aparecer no
`<meta robots>` da ficha. Antes aparecia na requisicao seguinte — porque a rota
nunca chegou a ser cacheada. E aceitavel para SEO (o recrawl do Google e muito
mais lento que uma hora), mas nao e invisivel.

---

## 6. O que NUNCA pode ganhar cache de rota

- **Rota de credencial** (`/api/auth/**`, `/api/account/**`, `/api/me/**`, e as
  telas de titular). HTML guardado de uma pessoa servido para outra e vazamento
  de dado pessoal — incomparavelmente pior que lentidao.
- **`/pt/noticias/` e `/pt/noticias/{slug}/`.** A despublicacao de emergencia
  ([`editorial-unpublish-emergency.md`](editorial-unpublish-emergency.md))
  depende de leitura por requisicao: rebaixou no banco, 404 na requisicao
  seguinte. Cache ali seguraria uma materia retratada no ar.
- **`/pt/explorar/`.** A resposta depende de `?q=`.
- **`/sitemap.xml`, `/sitemaps/[shard]`, `/news-sitemap.xml`, `/robots.txt`.**
  Fora de escopo por decisao (#241 e #242 acabaram de subir sobre elas).

Hoje **nao existe** rota publica personalizada no servidor: nenhum arquivo de
`apps/web` importa `next/headers`, entao nenhum server component consegue ler
cookie. A personalizacao real (bookmark do card, "seu mes em numeros") ja e
boundary de cliente. `route-cache-policy.test.ts` (prova 8) reprova a
introducao de `next/headers` justamente para forcar a reclassificacao antes de
qualquer cache.

---

## 7. Cloudflare — o que ela faz, e o que ela NAO faz

Medido em 2026-08-28: `/pt/termos/` responde `s-maxage=31536000` da origem e
mesmo assim volta com `cf-cache-status: DYNAMIC`. O CSS estatico volta `HIT`.

**A Cloudflare nao cacheia HTML por padrao, nem com cabecalho permissivo.** Fazer
isso exige uma **Cache Rule** no painel — que e configuracao de borda e decisao
do dono. Ela traria ganho adicional real (a resposta passaria a sair do PoP de
GRU em vez de ir a origem), mas **nao foi aplicada nesta leva** e nao deve ser
aplicada sem antes conferir, rota a rota, a tabela da secao 6: uma Cache Rule
larga demais cachearia area logada.

---

## 8. Como rodar as provas

```bash
pnpm build && pnpm --filter @screena/web validate:route-cache
```

Sobe PostgreSQL 16 efemero, semeia 12 mil entidades, sobe o Next real sobre o
build, e verifica: cabecalho por classe de render, ISR de verdade (segunda
leitura vem do cache), orcamento de linhas por rota (via `pg_stat_statements`),
ausencia de variacao por cookie e ausencia de variacao por `?ranking=`.
