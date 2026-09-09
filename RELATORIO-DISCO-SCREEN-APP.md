# Disco e trabalho desnecessário do `screen-app` — entrega final

> **Data:** 2026-09-09 · **Servidor:** `161.97.181.82` · **Serviço:** `rss_prime / screen-app`
> **Container medido:** `node@72e45f2112e2`, `next@15.5.25`, `WORKDIR /app`
> **PR:** [#276](https://github.com/maquinanerd/screena/pull/276) · **Não implantado. Sem merge.**

> ## O front-end não muda
>
> Esta entrega **não altera conteúdo exibido, layout, navegação nem
> comportamento**. A paginação de temporada que uma versão anterior deste PR
> havia introduzido **foi removida por completo**, e não foi substituída por
> "carregar mais", carregamento progressivo nem qualquer corte de conteúdo.
>
> Restaram apenas mudanças **internas**: quais linhas são pedidas ao PostgreSQL,
> em que ordem, e onde o cache do Next é gravado.

---

## Nota de método

| Rótulo | O que significa |
| --- | --- |
| **MEDIDO (produção)** | Lido do container, do painel ou de uma requisição real a `cinerie.com` hoje. |
| **MEDIDO (local)** | Executado nesta árvore: testes, simulações contra o pacote `next` instalado, `next build`. |
| **SIMULAÇÃO** | Harness sintético. Autoriza afirmar a **propriedade**, não a grandeza em produção. |

A versão do Next foi conferida **no container** (`15.5.25`), não no `node_modules` local — que está em `15.5.19` e teria enganado a leitura. As chaves usadas existem e se comportam igual nas duas.

---

## 1. Alterações finais

| Arquivo | Mudança | Efeito na tela |
| --- | --- | --- |
| `apps/web/next.config.ts` | `experimental.isrFlushToDisk: false` + `cacheMaxMemorySize: 256 MB` | nenhum |
| `apps/web/src/server/episode-page.ts` | varredura da temporada → **dois `LIMIT 1` indexados** | nenhum |
| `apps/web/src/server/series-page.ts` | episódios de **todas** as temporadas → **só os da temporada selecionada, exibida por inteiro** | nenhum |
| `apps/web/app/pt/series/[slug]/page.tsx` | passa a temporada pedida ao loader **nos dois pontos de chamada**; lê `activeSeasonNumber` | nenhum |
| `apps/web/src/server/season-page.ts` | lista sai do `select` aninhado e vira consulta própria **com as mesmas linhas**, em paralelo com trailer e SEO | nenhum |
| `apps/web/src/server/__tests__/season-episode-row-budget.test.ts` | **novo** — 14 testes | — |
| `apps/web/src/server/__tests__/series-page-row-budget.test.ts` | **novo** — 7 testes | — |
| `tests/web/series-canonical-port.test.ts` | guard textual passa a travar a invariante de deduplicação | — |

**Revertidos ao estado de `main`, byte a byte:** `season-episode-presenter.ts`, `route-cache-policy.ts`, a rota `temporadas/[season]/page.tsx` e `tests/web/season-episode-presenter.test.ts`. A rota de temporada volta a ser `public-static` com `revalidate = 3600` e `generateStaticParams` — confirmado no build: o `prerender-manifest` tem de novo **10** rotas dinâmicas, com a temporada entre elas.

### 1.1 O que **não** foi limitado, de propósito

A ficha de temporada e a ficha de série **carregam e exibem a temporada inteira**. Numa novela isso são centenas ou milhares de linhas com `overview` por requisição.

**Esse custo é consequência declarada do comportamento preservado, não um descuido.** Está escrito no código (`season-page.ts`) e travado por teste: `(2) a temporada INTEIRA continua na tela` reprova qualquer `take` reintroduzido ali.

Créditos já estavam limitados antes deste PR (`take: CAST_FETCH_LIMIT` / `CREW_FETCH_LIMIT`) e não foram tocados.

---

## 2. Confirmação de que a interface foi preservada

| Verificação | Como |
| --- | --- |
| Nenhum resíduo de paginação | `grep` por `EPISODES_PER_PAGE`, `pagina=`, `SeasonEpisodePagination`, `buildSeasonPagination`, `pageFromQuery`, `seasonPageHref` em `apps/web` e `tests` → **nenhum** |
| Presenter, política de cache, rota de temporada e seu teste | `git diff origin/main` → **vazio** |
| Classificação de renderização restaurada | `prerender-manifest` com **10** rotas; `/pt/series/[slug]/temporadas/[season]` presente como SSG |
| A temporada continua inteira na tela | teste: 5.000 entram, **5.000 saem**, na ordem |
| A temporada selecionada da ficha de série continua inteira | teste: `episodes.length === 5.000`, último episódio `#5000` |
| A tira de temporadas não sumiu | teste: as 67 continuam listadas; só as **não desenhadas** ficam sem episódios |
| Sem `searchParams` novo em rota estática | a rota voltou a `main`; não lê query |

---

## 3. Ganhos medidos

Cada guard novo foi verificado nos **dois sentidos**: passa com o código atual e **fica vermelho** quando o defeito é reintroduzido. Guard que passa nas duas versões não prova nada.

### 3.1 Linhas lidas — **MEDIDO (local)**

| Superfície | Antes | Depois | Controle negativo |
| --- | ---: | ---: | --- |
| Ficha de episódio (temporada de 5.000) | **5.006** | **8** | vermelho: `episode.findMany=5000` |
| Ficha de série (67 temporadas) | episódios de **67** temporadas | episódios de **1** | vermelho ao devolver o `select` aninhado |

Na ficha de episódio, o custo deixou de crescer com o tamanho da temporada — testes comparam episódios distantes e exigem custo igual. A equivalência de comportamento está provada: `prev`/`next` corretos, bordas sem vizinho inventado, **lacunas na numeração** e temporada de episódio único passam nas **duas** implementações; só a contagem de linhas as distingue.

> **Correção em relação à versão anterior deste relatório:** o limite "≤150 linhas" para a ficha de série **não era universal** — ele só fazia sentido porque o harness usava temporadas de 100 episódios. A afirmação certa não é sobre quantidade, é sobre **escopo**: consulta-se a temporada selecionada e **somente ela**. O teste agora registra quais `seasonId` foram perguntados e compara com a temporada desenhada — o que vale igual para uma temporada de 12 e para uma de 5.000. Numa temporada de 5.000 episódios, ler as 5.000 é o comportamento **correto**.

### 3.2 Idas ao banco por render — **MEDIDO (local)**

Na ficha de temporada, três esperas em série (lista de episódios → trailer → resolução de SEO) viraram **duas**: as três leituras são independentes e agora viajam juntas. **Mesmas linhas, mesmo resultado.** Travado pelo teste `(6)`, que reprova se a lista voltar para dentro do `select` aninhado — o que desfaria o paralelismo em silêncio.

Na ficha de série, `generateMetadata` e o componente passam **o mesmo argumento** ao loader. Como ele é memoizado por `cache()` do React, que compara argumentos, divergir faria a mesma requisição carregar a série **duas vezes**. Travado textualmente em `series-canonical-port.test.ts`.

### 3.3 Disco — **SIMULAÇÃO** contra o pacote real

Instanciando o `FileSystemCache` do `next` instalado e gravando 300 fichas pelo mesmo `set()` do servidor de produção:

| modo | arquivos | disco | itens em RAM |
| --- | ---: | ---: | ---: |
| `isrFlushToDisk: true` (default) | 900 | **33,7 MB** | 300 |
| `isrFlushToDisk: false` | 0 | **0,0 MB** | 300 |

O cache **continua vivo em RAM** nos dois modos: o ISR não é desligado, só o tier de disco. O harness tem controle negativo — se o modo ligado escrevesse zero, ele aborta como inválido.

### 3.4 O teto de memória segura — **SIMULAÇÃO**

5.001 páginas sintéticas contra o teto de 256 MB: o LRU estabiliza em **255,9 MB contados / 1.272 entradas**, a página reacessada **sobrevive**, a fria é **evicada**, e o disco fica em **0 MB**.

Isto autoriza afirmar a **propriedade** — o cache para de crescer no teto e reaproveita o que é acessado —, **não** uma grandeza de produção. Ver §4.

### 3.5 Verificações de repositório — **MEDIDO (local)**

- `pnpm test` → **575 arquivos, 7.342 testes, verdes**
- `pnpm typecheck` (raiz) + `pnpm typecheck:apps` → limpos
- `pnpm lint` → limpo
- `pnpm audit:invariants` → 8 ok, **0 violações**
- `pnpm audit:render` → 2 ok, **0 violações**
- `next build` → **exit 0**; `/pt/termos` e `/pt/privacidade` continuam prerenderizadas em disco **pelo build** (`isrFlushToDisk` afeta só a escrita em **runtime**)

### 3.6 O que **não** é ganho desta entrega

A projeção de redução de HTML de 426 KB para ~76 KB dependia da paginação e **foi retirada**. Com a lista completa preservada, **o tamanho da resposta da página de temporada não muda**.

---

## 4. Alcance e limites da estratégia de cache

**O alcance é GLOBAL.** `isrFlushToDisk` e `cacheMaxMemorySize` valem para o aplicativo **inteiro**, não por rota.

- **Afetadas:** toda rota `public-static` do registro — fichas de filme e pessoa, galerias, ficha de temporada e de episódio. Param de gravar HTML em disco e passam a viver só no LRU em processo.
- **Não afetadas:** toda rota `public-dynamic` — home, listagens, busca, notícias, ficha de série. Nunca foram cacheadas.
- O mesmo objeto serve o cache de `fetch` do Next, **vazio por construção**: a invariante 3 proíbe chamada externa no render.

**A revalidação não muda.** `s-maxage` e `stale-while-revalidate` derivam do `revalidate` de cada rota, não de onde o cache mora. A janela de 1 h da ficha de temporada continua valendo.

**Duas coisas que estes números NÃO significam:**

1. **256 MB não é o limite de memória do aplicativo.** É o teto de **um** cache. O processo continua alocando renderização, Prisma e buffers de resposta fora dessa conta — e hoje opera com **12 GB de RSS**. Quem limitaria o aplicativo é `resources.memoryLimit` do serviço, que está em **`0`** (ilimitado).
2. **Os ~46 MB de RSS da simulação não são consumo garantido em produção.** Aquele número vem de HTML sintético e de um mix artificial de páginas. O que a simulação prova é a propriedade (o cache para no teto; a memória real fica **abaixo** do número contado, porque o contador infla o Buffer do RSC via `JSON.stringify`). A grandeza real depende do tamanho das páginas e do tráfego, e **só a implantação mede**.

**Compatibilidade com produção verificada:** `isrFlushToDisk` é chave do schema (`config-schema.js`), default `true` (`config-shared.js`), consumida pelo servidor de produção (`next-server.js:680`), e a guarda `if (!this.flushToDisk || !data) return` fica **abaixo** do `memoryCache.set` — tudo lido no pacote `15.5.25` do container.

**Nenhum serviço novo.** Redis/`cacheHandler` externo não se justifica: o gargalo medido é o PostgreSQL, e as consultas caíram sem ele.

---

## 5. O que continua consumindo recursos

**MEDIDO (produção):**

| serviço | CPU | memória |
| --- | ---: | ---: |
| **`screen-db`** | **308,2%** | 4,3 GB |
| `screen-app` | 69,4% | **12 GB** (sem limite) |
| `screen-catalog-worker` | 89,0% | 335 MB |

Host: **12 cores com load 17,08** (sobrecarregado 1,42×), RAM 19,7/47,0 GB, disco **172 GB / 241 GB**.

1. **O banco é o gargalo.** 308% são três núcleos saturados.
2. **A temporada inteira continua sendo carregada** — decisão de produto, §1.1.
3. **O rastreamento não foi tocado.** Os 3,9 M de URLs `noindex` continuam sendo renderizados; isto corta o custo **por requisição**, não o **número** de requisições.
4. **`screen-app` sem teto de memória** (`memoryLimit = 0`).
5. **`screen-cron` em loop de restart** — cinco containers simultâneos no painel. Observado, não diagnosticado.
6. **Volume de log** intenso o bastante para travar a aba do painel que o exibe. Custo em disco não medido (`/var/lib/docker/containers` fora do alcance).

### 5.1 Imagens — **MEDIDO, não inferido**

`next/image` **não é importado** em lugar nenhum de `apps/web`; não há bloco `images` no `next.config.ts`; numa carga real de `cinerie.com/pt/` há **28 imagens de `image.tmdb.org`**, 13 do próprio domínio e **zero de `/_next/image`**; e no container **`/app/apps/web/.next/cache/images` não existe**.

As imagens vêm **direto do CDN do TMDB**. O otimizador nunca rodou; não há processamento nem armazenamento local a remover. O efeito colateral de `isrFlushToDisk` sobre o cache do otimizador é **inerte aqui**. Atribuição e licenças intocadas.

### 5.2 Atribuição do disco

Não atribuo os 172 GB ao `screen-app`. Medido: `.next/cache` = **171 MB**; `.next/server/app/pt/series` = **25.920 diretórios**; `/pt/filmes` = **50.465 entradas**. Amostra de **60 diretórios de série** (1 a cada 432): média **3,86 MB**, mediana 1,29 MB.

**ESTIMATIVA da árvore `/pt/series`: ~98 GB** (IC 95%: **55–140 GB**). É amostragem, não `du` — um `du -sh` sobre `.next/server` **não retornou em 12 minutos**.

O restante inclui imagens Docker, dados do PostgreSQL, logs de container e **outros projetos do mesmo host**. Não foi decomposto.

---

## 6. Implantação, verificação e reversão

**Nada foi implantado, reiniciado ou apagado. O deploy automático está desligado** — merge não implanta.

### 6.1 Implantação

1. Revisar e mergear a PR #276.
2. Clicar em **Implantar** no `screen-app`.

### 6.2 Como o disco antigo é liberado — e do que isso depende

O cache já gravado vive na **camada gravável do container em execução**. Ele **não** é apagado por esta mudança e **não** deve ser apagado à mão.

Ele é liberado quando o **container antigo é removido**, o que o redeploy faz ao substituí-lo. Duas condições, ambas verificadas hoje:

- **Não há armazenamento persistente nesse caminho.** A aba *Armazenamento* do serviço está **vazia** — nenhum volume ou bind mount em `/app`. Se houvesse, o conteúdo sobreviveria ao redeploy e precisaria de tratamento próprio.
- **O container antigo precisa sumir de fato.** Enquanto o Docker mantiver o container parado (e não removido), a camada continua ocupando disco.

### 6.3 Verificação depois do deploy

> **`df` total não precisa zerar nem cair.** Banco, logs, imagens Docker e outros projetos do mesmo host continuam crescendo. Usar o total como critério dá falso negativo.

**A verificação que vale — não há gravação nova deste cache**, inclusive **dentro de diretórios que já existiam**:

```bash
find /app/apps/web/.next/server/app/pt -type f -mmin -30
```

Saída **vazia** = nenhum arquivo do cache de rota foi escrito nos últimos 30 minutos. Contar diretórios de séries **não** serve: uma gravação nova dentro de um diretório existente não muda a contagem.

**O comando foi testado no container e tem linha de base "antes" — MEDIDO (produção), hoje:** `find (GNU findutils) 4.9.0`, e a mesma consulta com janela de 60 minutos devolveu, agora:

```
/app/apps/web/.next/server/app/pt/filmes/homem-aranha-um-novo-dia.html
/app/apps/web/.next/server/app/pt/filmes/homem-aranha-um-novo-dia.rsc
/app/apps/web/.next/server/app/pt/filmes/homem-aranha-um-novo-dia.meta
```

Ou seja: **hoje ela grava, e a checagem enxerga isso** — três arquivos por página. É o que torna o "vazio" de depois uma prova, e não um silêncio ambíguo.

Rodar **depois** de o container estar no ar há mais de 30 minutos (senão a saída pega os arquivos que o próprio build gravou) e **depois** de exercitar algumas fichas, para que a ausência signifique "não grava" e não "ninguém acessou":

```bash
# 1. exercitar algumas fichas que ANTES seriam materializadas
for s in a-origem interestelar duna; do curl -s -o /dev/null https://cinerie.com/pt/filmes/$s/; done

# 2. minutos depois, a prova
find /app/apps/web/.next/server/app/pt -type f -mmin -10 | head -20   # esperado: vazio
```

Complementos:

```bash
# contagem RECURSIVA de arquivos, duas leituras espacadas: nao pode subir
find /app/apps/web/.next/server/app/pt -type f | wc -l

# a pagina continua sendo servida com cache (a revalidacao nao mudou)
curl -sI https://cinerie.com/pt/filmes/a-origem/ | grep -i cache-control
```

E as medições que só produção dá:

| O quê | Linha de base de hoje |
| --- | --- |
| CPU do `screen-db` | **308,2%** — a métrica que diz se a redução de linhas virou alívio real |
| Memória do `screen-app` | **12 GB** |
| `pg_stat_statements` por `total_exec_time` | já montado em `apps/web/scripts/validate-route-cache-real-postgres.ts` |

### 6.4 Reversão

- **Reverter tudo:** `git revert` do commit e novo deploy. O comportamento volta ao de hoje, inclusive a gravação em disco.
- **Reverter só o cache, mantendo as consultas:** remover `experimental.isrFlushToDisk` e `cacheMaxMemorySize` do `next.config.ts`. O default (`true` / 50 MB) volta na próxima implantação.
- **Reverter só uma consulta:** os três arquivos de dados são independentes entre si.
- Nenhuma migração de banco, nenhuma alteração de dado: **a reversão é só um deploy.**

---

## 7. Fora de escopo, intocado

Catálogo, indexação, `noindex`, sitemap, robots, licenças e regras editoriais. Nenhuma série, episódio ou pessoa excluída. Nenhuma configuração de servidor alterada, nenhum serviço reiniciado, nenhum arquivo de produção apagado.

---

*Medições de produção: console do `screen-app`, painel do EasyPanel e requisições únicas a `cinerie.com` em 2026-09-09. Medições locais: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm audit:*`, `next build`, e duas simulações contra o `next@15.5.19` desta árvore — com a versão do container (`15.5.25`) conferida em separado.*
