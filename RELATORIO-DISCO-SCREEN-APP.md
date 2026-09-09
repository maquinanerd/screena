# Desempenho e consumo do `screen-app` — o que foi medido, o que mudou, o que sobra

> **Data:** 2026-09-09 · **Servidor:** `161.97.181.82` · **Serviço:** `rss_prime / screen-app`
> **Container medido:** `node@72e45f2112e2`, `next@15.5.25`, `WORKDIR /app`
> **Branch:** `claude/screen-app-cache-diagnosis-b33828` · **Não implantado.**

---

## Nota de método

Este documento separa três origens, porque misturá-las é como uma medição vira promessa.

| Rótulo | O que significa |
| --- | --- |
| **MEDIDO (produção)** | Lido do container, do painel ou de uma requisição real a `cinerie.com` hoje. |
| **MEDIDO (local)** | Executado nesta árvore: testes, simulações contra o pacote `next` instalado, `next build`. |
| **PROJEÇÃO** | Aritmética sobre números medidos. Não é resultado; é previsão, e está marcada como tal. |

A versão do Next foi conferida **no container** (`15.5.25`), não no `node_modules` local — que estava em `15.5.19` e teria enganado a leitura.

---

## 1. O que está acontecendo

### 1.1 O disco cresce ~2 GB por hora, medido ao vivo

**MEDIDO (produção):** no início desta sessão o disco marcava `168.2 GB / 241.1 GB (69,8%)`. Cerca de duas horas depois, no mesmo console:

```
overlay         242G  172G   70G  72% /
```

**~4 GB em ~2 horas.** Não é um acúmulo histórico parado: é uma taxa corrente.

### 1.2 A causa raiz é uma contradição de duas datas

| Data | Decisão | Efeito |
| --- | --- | --- |
| **27/08/2026** | `season` e `episode` **suspensos do índice** — a página de episódio rendia 64 palavras dentro de `<main>` (mediana de 200 amostras: 24). | As duas rotas passam a valer zero para busca. |
| **28/08/2026** | As **mesmas rotas** ganham `generateStaticParams()`, que é o que liga o cache em disco do Next. | Passamos a materializar exatamente o que tínhamos declarado sem valor. |

Um dia entre declarar sem valor e começar a gravar em disco. Confirmei que a contradição continuava de pé em `main` (`876c5c6`) antes desta leva.

**Por que nenhum disco resolve:** o espaço de URL é série × temporada × episódio — não tem fim.

**Por que o cache não comprava nada:** um rastreador que varre 3,9 milhões de URLs visita cada uma praticamente **uma vez**. A taxa de acerto é próxima de zero; o render acontece nos dois cenários, e o cache só acrescenta a escrita.

**Por que ninguém viu:** **MEDIDO (produção)** — a aba *Armazenamento* do EasyPanel para o `screen-app` está **vazia**. Ela lista volumes declarados, e este serviço não tem nenhum: o cache mora na camada gravável do container, invisível para o painel.

### 1.3 Duas consultas varriam a tabela para desenhar uma tela

- **Ficha de episódio** (3.793.672 URLs) trazia **todos** os `episodeNumber` da temporada — `findMany` sem `take` — para descobrir dois números.
- **Ficha de série** (indexada, `force-dynamic`, **sem cache algum**) trazia **todas as temporadas com todos os episódios**, incluindo `overview`, para desenhar a lista de **uma**.

**MEDIDO (produção):** `/pt/series/today/` tem **67 temporadas distintas**; só a temporada 1 tem **506 episódios**. A página respondia **429,3 KB**.

---

## 2. O que foi alterado

| Arquivo | Mudança |
| --- | --- |
| `apps/web/next.config.ts` | `experimental.isrFlushToDisk: false` + `cacheMaxMemorySize: 256 MB`, com o porquê e o **alcance global** declarados. |
| `apps/web/src/server/episode-page.ts` | Varredura da temporada → **dois `LIMIT 1` indexados** (anterior/próximo). `prevNext` removido. |
| `apps/web/src/server/season-page.ts` | Lista aninhada sem limite → **fatia com `skip`/`take` + `COUNT`**. Três esperas serializadas → **uma**. Página fora da faixa vira 404. |
| `apps/web/src/server/series-page.ts` | Episódios de **todas** as temporadas → **só os da temporada ativa**, dentro de um `Promise.all` que já existia (zero viagem extra). Expõe `activeSeasonNumber`. |
| `apps/web/src/lib/season-episode-presenter.ts` | `EPISODES_PER_PAGE = 50`, `SeasonEpisodePaginationView`, `buildSeasonPagination`. |
| `apps/web/app/pt/series/[slug]/temporadas/[season]/page.tsx` | `force-dynamic` + `?pagina=`; navegação reusando `PrevNextNav`. |
| `apps/web/app/pt/series/[slug]/page.tsx` | Passa a temporada pedida ao loader **nos dois pontos de chamada**; lê `activeSeasonNumber`. |
| `apps/web/src/lib/route-cache-policy.ts` | Temporada reclassificada para `public-dynamic`, com o motivo. |
| `apps/web/src/server/__tests__/season-episode-row-budget.test.ts` | **Novo** — 18 testes. |
| `apps/web/src/server/__tests__/series-page-row-budget.test.ts` | **Novo** — 6 testes. |
| `tests/web/series-canonical-port.test.ts` | Guard textual atualizado — passa a travar a invariante de deduplicação. |
| `tests/web/season-episode-presenter.test.ts` | Campos novos no helper (`tsc` pegou o que o vitest não pega). |

### 2.1 A paginação, e por que **não** virou rota nova

O cabeçalho da própria rota diz: *"A ROTA CANONICA é `/pt/series/{slug}/temporadas/{n}/` — e é a única que existe"*, e `SEASONS_SEGMENT` alimenta diretório, canonical e sitemap pelo mesmo valor. Criar `/pagina/[n]/` contrariaria isso e mexeria no acoplamento com o sitemap, que está **fora de escopo**.

O precedente correto já existia: `/pt/series/[slug]` é `public-dynamic` justamente por causa de `?temporada=`. Segui o mesmo idioma — `force-dynamic`, sem `generateStaticParams`. É exatamente a combinação cuja ausência derrubou aquela rota com 500 em 28/08, e o comentário no arquivo registra isso.

**São links reais, não estado de cliente:** o botão Voltar funciona, a URL é compartilhável, e quem está sem JavaScript navega igual. A página 1 **não** leva query — a URL canônica continua sendo a que sempre foi.

**A paginação é invisível no caso normal.** 50 por página; temporada de ficção tem 8–24 episódios e não ganha navegação nenhuma. Ela existe só para novela e programa diário, que é o que produziu o problema. Travado pelo teste (9).

### 2.2 Créditos: nada a fazer

A tarefa pedia para revisar "listagens sem limite, principalmente episódios e créditos". **Créditos já estavam limitados** — `take: CAST_FETCH_LIMIT` / `CREW_FETCH_LIMIT` em `episode-credits.ts` e `entity-cast.ts`, com os slugs já escopados por lista de ids. Não mexi no que estava certo.

---

## 3. Ganhos efetivamente medidos

### 3.1 Linhas lidas por render — **MEDIDO (local)**, com controle negativo

Cada número abaixo foi verificado nos **dois sentidos**: o teste passa com o código novo e **fica vermelho** quando o defeito é reintroduzido. Um guard que passasse nas duas versões não provaria nada.

| Superfície | Antes | Depois | Verificação |
| --- | ---: | ---: | --- |
| Ficha de episódio (temporada de 5.000) | **5.006** | **8** | vermelho com o `findMany` de volta: `episode.findMany=5000` |
| Ficha de série (67 temporadas × 100 ep.) | **6.800** | **≤150** | vermelho com o `select` aninhado de volta |
| Ficha de temporada (5.000 ep.) | **~5.008** | **≤200** | vermelho: "expected 4988 to be less than or equal to 50" |

Propriedade que interessa mais que o número absoluto: **o custo deixou de crescer com o tamanho da temporada**. Testes (5) e (8) comparam episódios distantes e temporadas de tamanhos diferentes e exigem custo igual.

Equivalência de comportamento provada empiricamente: os testes de valor (`prev`/`next` corretos, bordas sem vizinho inventado, lacunas na numeração, temporada de episódio único) passam nas **duas** implementações. Só a contagem de linhas as distingue.

### 3.2 Disco — **MEDIDO (local)**, contra o pacote real

Instanciando o `FileSystemCache` do `next` instalado e gravando 300 fichas pelo mesmo `set()` do servidor de produção:

| modo | arquivos | disco | tempo | itens em RAM |
| --- | ---: | ---: | ---: | ---: |
| `isrFlushToDisk: true` (default) | 900 | **33,7 MB** | 1.136 ms | 300 |
| `isrFlushToDisk: false` | 0 | **0,0 MB** | 113 ms | 300 |

O cache **continua vivo em RAM** nos dois modos — o ISR não é desligado, só o tier de disco. O harness tem controle negativo: se o modo ligado escrevesse zero, ele aborta como inválido.

### 3.3 O teto de memória segura — **MEDIDO (local)**

5.001 páginas distintas contra o teto de 256 MB:

```
  disco escrito .................. 0.0 MB
  entradas guardadas ............. 1272 de 5001 inseridas
  tamanho contado no LRU ......... 256.0 MB (teto 256.0 MB)
  pagina REACESSADA sobreviveu ... sim
  primeira pagina fria sobreviveu  nao (evicada)
  RSS do processo ................ 65.9 -> 112.3 MB
```

Responde às quatro exigências: **impede acúmulo** (evicção LRU real, `while (totalSize > maxSize)`), **reaproveita o que é acessado** (a página reacessada sobrevive a 5.000 inserções), **tem teto** e **o teto é o configurado**.

> Uma correção que a medição impôs: a primeira versão deste harness reusava **uma** string de HTML para as 5.000 entradas. Teto e evicção mediam certo, mas o RSS não media nada — o processo "crescia" 6 MB guardando 256 MB. Com bytes próprios por página, o número real apareceu.

### 3.4 Build e suíte — **MEDIDO (local)**

- `next build` → **exit 0**. `prerender-manifest` foi de **10 para 9** rotas dinâmicas: a temporada saiu, como o registro passou a declarar. `/pt/termos` e `/pt/privacidade` continuam prerenderizadas em disco **pelo build** — `isrFlushToDisk` afeta só a escrita em **runtime**.
- `pnpm test` → **575 arquivos, 7.345 testes, todos verdes**.
- `pnpm typecheck` (raiz) + `typecheck:apps`, `pnpm lint`, `pnpm audit:invariants` (8 ok, 0 violações), `pnpm audit:render` (2 ok, 0 violações) → todos passam.

### 3.5 Tamanho da resposta — **PROJEÇÃO** sobre medições de produção

**MEDIDO (produção)**, requisições únicas a `cinerie.com`:

| URL | HTML | episódios no HTML | tempo |
| --- | ---: | ---: | ---: |
| `/pt/filmes/a-origem/` | 77,7 KB | 0 | 1.008 ms |
| `/pt/series/ted-lasso/temporadas/1/` | 52,7 KB | 20 | — |
| `/pt/series/today/temporadas/1/` | 426,0 KB | 506 | 932 ms |
| `/pt/series/today/` | 429,3 KB | 506 | 2.322 ms |
| `/pt/series/jornal-nacional/` | 216,8 KB | 210 | 2.733 ms |

Dessas duas páginas de temporada sai o custo marginal: **~0,77 KB por episódio**, base **~37 KB**.

**PROJEÇÃO:** `/pt/series/today/temporadas/1/` com 50 episódios ≈ **76 KB** (contra 426 KB) — **~82% menor**. `ted-lasso/temporadas/1/` fica **idêntica**: 20 < 50.

Isto é aritmética sobre números medidos, **não** um resultado. A medição definitiva exige implantação (§6).

---

## 4. Efeitos e limites da estratégia de cache

**O alcance é GLOBAL, e é preciso dizer isso sem rodeio.** `isrFlushToDisk` e `cacheMaxMemorySize` valem para o aplicativo **inteiro**, não por rota.

- **Afetadas:** toda rota `public-static` do registro — fichas de filme e pessoa, galerias de imagens/vídeos, ficha de episódio. Elas param de gravar HTML em disco e passam a viver só no LRU em processo.
- **Não afetadas:** toda rota `public-dynamic` — home, listagens, busca, notícias, ficha de série e (agora) ficha de temporada. Elas **nunca** foram cacheadas, nem em disco nem em memória.
- O mesmo objeto serve o cache de `fetch` do Next, que neste app está **vazio por construção**: a invariante 3 proíbe chamada externa no render.

**O que o teto conta não são bytes de memória.** A função de tamanho devolve `html.length + JSON.stringify(rscData).length`, e `rscData` é um Buffer — `JSON.stringify` o serializa como `{"type":"Buffer","data":[...]}`, então cada byte vira vários caracteres. O número **superestima** o custo real: 256 MB contados deram **~46 MB de RSS** na simulação.

**Por que 256 MB e não 512.** O `screen-app` **não tem limite de memória**: **MEDIDO (produção)** — `resources.memoryLimit` e `resources.cpuLimit` estão em `0` (ilimitado) no painel, e o processo já opera com **12 GB de RSS** num host de 47 GB. Sem cgroup para conter um erro de estimativa, a folga é deliberadamente conservadora. 256 MB contados ≈ 1.272 fichas ≈ 0,4% do que o processo já usa.

**Revalidação, descarte e reinício:** a janela de `revalidate` não muda — `s-maxage`/`stale-while-revalidate` derivam dela, não de onde o cache mora. O descarte é LRU por tamanho, verificado. O cache é um `let` de módulo: **reiniciar o container o zera**, e ele volta a encher pelo uso.

**Nenhum serviço novo foi introduzido.** Redis/cacheHandler externo não se justifica: o gargalo medido é o Postgres (§5), não a ausência de um cache compartilhado, e as consultas caíram uma a duas ordens de grandeza sem ele.

---

## 5. O que continua consumindo recursos

**MEDIDO (produção), painel de monitoramento:**

| serviço | CPU | memória |
| --- | ---: | ---: |
| **`screen-db`** | **308,2%** | 4,3 GB |
| `screen-app` | 69,4% | **12 GB** (sem limite) |
| `screen-catalog-worker` | 89,0% | 335 MB |

Host: **12 cores com load 17,08** — sobrecarregado em 1,42×. RAM 19,7/47,0 GB.

1. **O banco é o gargalo, não o app.** 308% são três núcleos saturados. É exatamente o que as reduções de §3.1 atacam, mas o efeito só é observável em produção.
2. **O rastreamento não foi tocado.** Os 3,9 milhões de URLs `noindex` continuam sendo renderizados. Estas mudanças cortam o custo **por requisição**; não cortam o **número** de requisições. Isso é decisão de SEO, explicitamente fora desta tarefa.
3. **`screen-app` sem teto de memória.** Zero em `memoryLimit` significa que nada impede o app de pressionar o `screen-db` no mesmo host.
4. **`screen-cron` em loop de restart.** **MEDIDO:** cinco containers `screen-cron` distintos aparecem simultaneamente na lista, dois consumindo 13,6% e 11,5% de CPU. É CPU do host, não da aplicação — e não foi investigado aqui.
5. **Volume de log.** O stream de logs do `screen-app` (eventos `section_absent`, um por seção ausente por página) é intenso a ponto de **travar a aba do navegador** que o exibe. Não medi o custo em disco: `/var/lib/docker/containers` não é alcançável de dentro do container.

### 5.1 Imagens e armazenamento real — **MEDIDO, não inferido**

- **`next/image` não é importado em lugar nenhum** de `apps/web`; não há bloco `images` no `next.config.ts`.
- Numa carga real de `cinerie.com/pt/`: **28 imagens de `image.tmdb.org`**, 13 do próprio domínio (marca), **zero de `/_next/image`**.
- No container: **`/app/apps/web/.next/cache/images` não existe** (`No such file or directory`).

Conclusão firme: as imagens são servidas **direto pelo CDN do TMDB**; o otimizador do Next nunca rodou; não há processamento nem armazenamento local de imagem para remover. O efeito colateral de `isrFlushToDisk` sobre o cache do otimizador é **inerte aqui**. Atribuição e licenças permanecem intocadas.

### 5.2 Atribuição do disco — o que é do app e o que não é

Não atribuo os 172 GB ao `screen-app`. O que consegui medir:

- `/app/apps/web/.next/cache` → **171 MB** (pequeno).
- `/app/apps/web/.next/server/app/pt/series` → **25.920 diretórios**.
- `/app/apps/web/.next/server/app/pt/filmes` → **50.465 entradas**.
- Amostra de **60 diretórios de série** (1 a cada 432, espalhada pela listagem): média **3,86 MB**, mediana 1,29 MB, mín. 0,05 MB, máx. 32,2 MB.

**ESTIMATIVA da árvore `/pt/series`: ~98 GB** (IC 95% sobre a média: **55–140 GB**). É amostragem, não `du` — um `du -sh` sobre `.next/server` **não retornou em 12 minutos** e foi abandonado; não é disco lento, é o número de arquivos.

O restante dos 172 GB inclui imagens Docker, dados do PostgreSQL, logs de container e **outros projetos do mesmo host** (`fabrica-de-conteudo` aparece no painel com 4,4 GB de RAM própria). Não foi decomposto.

**Nenhuma limpeza destrutiva foi executada.** O que é descartável está identificado: a árvore `.next/server/app/pt/**` do container em execução — e ela é **zerada por um redeploy**, sem comando de remoção.

---

## 6. O que falta verificar após a implantação

Nada abaixo é opcional: são as medições que esta tarefa **não** pôde fazer sem implantar.

1. **A taxa de crescimento do disco vai a zero.** `df -h /` no console do serviço, duas leituras espaçadas. Hoje a linha de base é **~2 GB/hora**.
2. **`.next/server/app` para de ganhar arquivos em runtime.** `ls /app/apps/web/.next/server/app/pt/series | wc -l` — hoje **25.920**; depois do redeploy deve nascer pequeno e **parar de crescer**.
3. **O tamanho real da resposta** — confirmar a projeção de §3.5:
   ```bash
   curl -s -o /dev/null -w '%{size_download} %{time_total}\n' https://cinerie.com/pt/series/today/temporadas/1/
   ```
   Comparar com **426,0 KB**. E `?pagina=2`, `?pagina=11` e a volta para a página 1.
4. **A CPU do `screen-db`.** Hoje **308,2%**. É a métrica que diz se a redução de linhas virou alívio real — e é a única que transforma "linhas lidas" em desempenho.
5. **A memória do `screen-app`.** Hoje **12 GB**. Vale medir se cai (menos episódios renderizados por request) e vigiar o LRU de 256 MB.
6. **`pg_stat_statements` ordenado por `total_exec_time`.** Já está montado em `apps/web/scripts/validate-route-cache-real-postgres.ts`. Diz se episódio/temporada eram mesmo o topo, ou se falta índice em outro lugar. Melhor que adivinhar.
7. **A ficha de série de uma novela.** `/pt/series/today/` era 429,3 KB em 2.322 ms — a mudança de §2 (só a temporada ativa) é a de maior impacto e a única numa página **indexada**.

### Lacunas que assumo, sem inventar resultado

- **Nenhum número de "depois" é de produção.** Nada foi implantado; toda comparação depois/antes aqui é local ou projeção.
- **A decomposição do disco por serviço é estimativa amostrada**, não `du`.
- **O custo em disco dos logs de container não foi medido** (fora do alcance do console).
- **O loop do `screen-cron` foi observado, não diagnosticado.**

---

## 7. Como implantar e revisar

**O deploy automático está DESLIGADO** — o botão no painel diz *"Ativar Deploy Automático"*. Merge não implanta.

1. Revisar e mergear o PR.
2. Clicar em **Implantar** no `screen-app`. O redeploy zera a camada gravável: **o disco cai de uma vez**, sem comando destrutivo.
3. Rodar as verificações de §6, em ordem — a (1) e a (2) primeiro, que são as baratas.
4. **Recomendado, fora deste PR:** definir `resources.memoryLimit` para o `screen-app`. Hoje é `0`. É o teto que falta, e ele é configuração de plataforma, não de código.

Nem merge nem implantação foram executados nesta tarefa.

---

*Medições de produção: console do `screen-app`, painel de monitoramento do EasyPanel e requisições únicas a `cinerie.com` em 2026-09-09. Medições locais: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm audit:*`, `next build`, e duas simulações contra o `next@15.5.19` desta árvore — com a versão do container (`15.5.25`) conferida em separado.*
