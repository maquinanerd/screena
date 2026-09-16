# Plano: dividir o CSS bloqueante por rota sem mudar quem vence

> **Data:** 15/09/2026. **Estado:** PLANO — nenhuma regra de CSS mudou de lugar ainda.
> **Achado de origem:** auditoria de SEO de 11/09/2026, §7.6 (folha única de 143 KB
> em toda página) — P6 em [`docs/seo/AUDITORIA-SEO-2026-09-11-RESOLVIDA.md`](../seo/AUDITORIA-SEO-2026-09-11-RESOLVIDA.md).
>
> Marcação de evidência: **MEDIDO** (observado), **LI** (lido no código), **INFERIDO**.

---

## 1. Onde estamos

| Fato | Valor | Evidência |
|---|---|---|
| Folhas de estilo do app | **uma**: `apps/web/app/globals.css`, importada só por `apps/web/app/layout.tsx:9` | LI |
| CSS Modules, `<style>`, `@import`, PostCSS/Tailwind próprios | nenhum | LI |
| Tamanho do arquivo | 11.599 linhas; 269.118 B com comentários; **187.925 B de regras** (1.443 regras, 307 blocos de classe) | MEDIDO (`postcss`) |
| CSS do build | **um** chunk, `static/css/*.css`, **145.097 B** (24.893 B gzip), referenciado só por `/layout` — ou seja, bloqueante em **toda** rota | MEDIDO (`.next`) |

### Quanto de cada segmento está nesse chunk

Bytes de texto de regra (sem comentário; o minificado do build é ~0,77 disso), agrupados pelo
bloco de classe (prefixo antes de `__`/`--`) e pelo segmento de rota que importa os componentes
que usam o bloco:

| Segmento | Bytes de regra | % | Onde é usado |
|---|---:|---:|---|
| Detalhe de filme + série (`detail-*`, `rating-chip`, `media-strip`, `critic-band`, `cast-*`, `ficha-*`, `similar-*`, `score-card`, `awards-band`, `mnews-*`, `watch-brands`, `trailer-dialog`, `yt-*`) | 27.537 | 14,7 | `/pt/filmes/[slug]`, `/pt/series/[slug]` (+ `detail-hero` nas galerias e em `/pt/pessoas/…/fotos`) |
| Notícias (`nws-*`, `art-*`, `read-also`, `news-*-card`) | 24.236 | 12,9 | `/pt/noticias/**` (`art-body` também na biografia de pessoa) |
| HomeLike (`hero`, `ticker`, `feat-*`, `pop-*`, `fresh-card`, `glimpse-card`, `hnews-*`, `stats-strip`, `card-bookmark`) | 22.901 | 12,2 | `/pt/`, `/pt/filmes/`, `/pt/series/` |
| Global: layout (`site-header`, `mobile-menu`, `footer*`, tokens `:root`, reset) | 21.106 | 11,2 | toda rota |
| Explorar (`disc-*`, `cw-*`, `explore-result`) | 12.550 | 6,7 | `/pt/explorar/` |
| Importar (`imp-*`) | 9.616 | 5,1 | `/pt/importar/` |
| **Sem uso em rota** (`btn`, `tabs`, `pagination`, `rail`, `topinfo`, `score-box`, `watch-panel`, `cast-card`, `skeleton`, `watch-availability`, `entity-facts`) | 7.728 | 4,1 | nenhum componente importado por rota |
| Conta (`set-*`) | 7.142 | 3,8 | `/pt/conta/**` |
| Pessoas (`person-*`, `known-for`, `filmo`) | 6.641 | 3,5 | `/pt/pessoas/[slug]` |
| Em breve (`ant-*`) | 6.326 | 3,4 | `/pt/em-breve/` |
| Série/temporada/episódio (`season-*`, `episode-*`) | 5.053 | 2,7 | `/pt/series/**` |
| Listas, onde assistir, galerias, auth, institucional, dev | 20.881 | 11,1 | cada um no seu segmento |
| Primitivas `ds` + `ad-slot` | 4.729 | 2,5 | 8 e 14 segmentos |
| A classificar (43 blocos pequenos: `field`, `alert`, `poster-grid`, `watch-offer`…) | 11.479 | 6,1 | levantamento por bloco no PR de ferramenta |

**INFERIDO — o teto do ganho.** Uma ficha de filme precisa de layout global + primitivas +
`ad-slot` + detalhe: ~53–58 KB de regra, contra os 188 KB que carrega hoje. Uma matéria precisa
de ~50 KB. Os números de verdade (minificado, gzip, FCP/LCP) saem do `perf:lab` a cada PR.

---

## 2. Como o Next 15.5.25 carrega CSS (LI, no código instalado)

- CSS importado num **layout ou página** é coletado por entrada de servidor
  (`build/webpack/plugins/flight-client-entry-plugin.js:437-500`) e injetado só no segmento que
  o importou, sem repetir o que um pai já injetou (`server/app-render/get-css-inlined-link-tags.js:16-26`).
- Na primeira carga, o CSS do **layout vem antes** do CSS da **página**
  (`create-component-tree.js:460-464, 561-564`); em produção todo link sai com `precedence="next"`.
- **Na navegação pelo cliente as folhas ACUMULAM:** a folha nova entra depois da última de mesma
  precedência e nunca é removida (`react-dom-client.production.js:14645-14664`, `9120-9124`).
  A folha de uma rota visitada antes continua valendo nas rotas seguintes.
- `experimental.cssChunking` é `true` por padrão (`server/config-shared.js:139`): junta CSS em
  chunks de 30–100 KB. No modo padrão, só junta CSS não-module entre conjuntos de chunks
  idênticos (`css-chunking-plugin.js:194-214`). `'strict'` preserva a ordem de import. O plugin
  não roda em `next dev`: **ordem só se confere com `next build` + `next start`**.

---

## 3. O perigo: aqui, CSS vence por ORDEM DE DOCUMENTO

Mover uma regra de `globals.css` para uma folha de rota **muda a ordem dela em relação a toda
regra global que vinha depois**, porque a folha da rota carrega depois da global. Uma regra que
hoje **perde** para uma regra posterior passa a **vencer**. Não há erro, aviso nem teste de
unidade que acuse.

Casos já identificados no arquivo (LI, `postcss` sobre as 1.443 regras):

| Caso | Onde | Por que trava uma mudança ingênua |
|---|---|---|
| Media query que JÁ perde para regra posterior | `@media (max-width:1023px) .media-strip__stack` (4073) vencida por `.media-strip__stack` (11456) | reordenar ressuscita a regra morta |
| Mesmo seletor em duas seções | `.watch-hero__service` 6480 × 10395; `.ant-card__type/__ribbon/__cta` 7860/7878/8008 × 9829/9834; `.ant-card[data-entity-type] .ant-card__cta` 8033 × 9839; `@767 .cast-strip` 4316/4330 × 9602/9610 | mover só a primeira cópia inverte o vencedor |
| Override longe da base | piso de legibilidade 10113–10134 sobre 20 regras de 3591–4923; "Tela 08" 9575–9664 sobre `.detail-hero__title`, `.detail-actions`, `.cast-tile__photo` — e também `.nws-tabs` (9672) e `.imp-export` (9685) | o override tem de ir JUNTO com a base, para a mesma folha, na mesma ordem |
| Seção que serve outra rota | `.art-body` (5351) estiliza a biografia de pessoa; `detail-hero` é usado em `/pt/pessoas/…/fotos` | não pertence a uma rota só |
| Regra contextual no bloco global | `body:has(.art-hero[data-hero-media='true']) .site-header…` (640–689); `:root[data-poster-size\|data-density]` (10756–10781) | depende de marcação de outra rota, ou tem de valer em toda rota |

O próprio arquivo registra vencedores silenciosos em 703, 2398, 7622, 9630 ("VENCIA em silêncio"),
10143, 10392, 10546, 10686, 10740, 10824, 11176 e 11435.

---

## 4. As regras da divisão

**R1 — Move-se BLOCO inteiro, nunca regra solta.** Todas as regras de um bloco de classe vão
juntas — base, overrides tardios e media queries espalhadas (ex.: `ant-card` de 7828 a 9839) —
para a mesma folha e **na mesma ordem relativa** em que estavam.

**R2 — Só sai de `globals.css` o bloco EXCLUSIVO de um segmento.** Todo nome de bloco numa folha
de rota é usado só por componentes daquele segmento. Isso vale mais do que parece: como as folhas
acumulam na navegação (§2), um seletor compartilhado vazaria para as rotas visitadas depois.
Guarda em teste (PR 1): cada bloco de `app/pt/<segmento>/*.css` só aparece em `.tsx` do grafo de
import daquele segmento.

**R3 — Compartilhado vai para folha compartilhada.** Bloco usado por mais de um segmento (detalhe
em filme+série+galerias; `art-body` em notícia+pessoa; HomeLike em `/pt`, `/pt/filmes`,
`/pt/series`) vai para uma folha própria, importada por cada página que o usa (o Next não repete
a mesma folha).

**R4 — Fica global:** tokens `:root`, reset, header, footer, `ad-slot`, primitivas `ds`, as
preferências `:root[data-*]` e toda regra contextual que toque elemento global. A regra
`body:has(.art-hero…) .site-header` só sai com a paridade provando que nenhuma regra posterior do
header a vencia.

**R5 — Nenhum bloco sai se hoje ele PERDE para uma regra que continua global.** Isso não se decide
lendo: decide-se pela paridade de estilo computado (§5). Diferença na paridade reprova o PR.

**R6 — Continua como está:** tema único claro (`tests/web/tema-unico.test.ts` passa a varrer TODA
folha), tokens `--c-*` só em `globals.css`, nenhum CSS Module (seis contratos canônicos o proíbem),
classes de cache de rota intactas (`src/lib/route-cache-policy.ts` — importar CSS não muda
estático/dinâmico; a prova 7 do `validate:route-cache` confere contra o manifesto do build).

---

## 5. A prova: paridade de estilo computado, antes e depois

`test:styles` com navegador não roda nesta máquina (Playwright recusa o Node 24), e a ordem só
existe no build. A prova usa o mesmo caminho do `perf:lab`: **Chrome headless por DevTools
Protocol** contra `next start`.

- **Captura:** para cada rota da lista, em 412, 700, 900 e 1350 px (os pontos de quebra da
  folha são 599, 767 e 1023), o estilo computado de todo elemento e de `::before`/`::after`
  com conteúdo, com a chave `rota + caminho do elemento`. Rede externa bloqueada e animação
  congelada.
- **Paridade de carga direta:** captura no build ANTES da mudança, captura no build DEPOIS, diff
  — **precisa sair vazio**. O ruído (carrossel, relógio) é medido entre duas capturas do MESMO
  build e descontado.
- **Paridade de navegação, como ACÚMULO:** em vez de clicar de A para B, cada rota é medida de
  novo com TODAS as folhas vistas nas outras rotas acrescentadas, em ordem direta e inversa, e
  comparada com ela mesma. É o superconjunto de qualquer histórico de navegação (§2), e é
  determinístico.
- **Rotas:** 38, da home às páginas de conta, incluindo matérias com e sem capa, a série com
  guia de temporadas, temporada, episódio, pessoa com biografia, galerias e a 404 — os dados que
  o seed do laboratório não traz vêm de `css:parity:seed`.
- **Controle negativo:** CSS injetado depois da carga (`PARITY_INJECT_CSS`) tem de reprovar.
- **O que a paridade não vê** (`:hover`, `:focus`, elemento que só aparece com interação) fica com a
  checagem estática `css:move-check`: nada reescrito, ordem mantida, nenhuma regra que ficou no
  global empatando com uma regra movida que ela vencia por vir depois, exclusividade de bloco.

Como rodar, com o laboratório de pé (`validate:route-cache` com `CINERIE_LAB_HOLD_SECONDS`):

```text
DATABASE_URL=<postgres do laboratório> pnpm --filter @screena/web css:parity:seed
PARITY_MODE=capture PARITY_BASE=http://127.0.0.1:PORTA PARITY_OUT=antes.json pnpm --filter @screena/web css:parity
PARITY_MODE=compare PARITY_BASELINE=antes.json PARITY_NOISE=antes-ruido.json PARITY_CURRENT=depois.json pnpm --filter @screena/web css:parity
CSS_MOVE_BASE_REF=<ref antes da divisão> pnpm --filter @screena/web css:move-check
```

---

## 6. Os testes que leem `globals.css` pelo caminho

LI: cerca de 15 arquivos. O PR de ferramenta cria `tests/support/app-css.ts` (todas as folhas, na
ordem de carga) e reaponta cada teste pelo que ele mede:

| Teste | O que precisa |
|---|---|
| `tema-unico.test.ts`, `acentos-espelham-o-canonico.test.ts` | TODA folha; o piso de "> 100.000 caracteres" passa a ser da soma |
| `detalhe-contraste.test.ts`, `popular-section-styling.test.ts`, `movie-media-above-fold.test.ts`, `article-hero-fullscreen.test.ts` | a folha onde o bloco mora, com a ordem dentro dela |
| `home-canonical-contract`, `public-shell-reset` (cita o morto `.btn--accent`), `preferencias-de-apresentacao`, `font-preload`, `footer-credit-logo-size` | a folha onde a regra mora |
| `similar-titles-computed`, `watch-ads-modality-computed`, `watch-browse-brand-visible` (jsdom) | as folhas da rota, na ordem |
| harnesses `qa-default-styles-harness.tsx`, `qa-footer-harness.tsx`, `qa-detail-responsive.ts` | injetar as folhas da rota, não só a global |

---

## 7. Sequência de PRs (cada um com build, testes, paridade vazia e `perf:lab`)

| PR | Escopo | Bytes de regra fora do bloqueante global | Risco |
|---|---|---:|---|
| 1 | **Ferramenta, zero CSS movido:** paridade por CDP (§5) com controle negativo, `tests/support/app-css.ts`, guarda R2, baseline de paridade e de `perf:lab` | 0 | nenhum em produção |
| 2 | **CSS sem uso:** os 11 blocos mortos, com a prova de que nenhum `.tsx` os usa | −7.728 | baixo |
| 3 | **Rotas privadas e de ferramenta:** importar, conta, listas, auth, dev (com `.imp-export` do bloco "Tela 08") | −26.600 | baixo (fora do índice) |
| 4 | **Explorar, em breve, onde assistir** (com as cópias tardias de `ant-card` e `watch-hero__service`) | −23.006 | médio |
| 5 | **Notícias**, com `art-body` numa folha compartilhada com pessoa e a regra contextual do header decidida pela paridade | −24.236 | médio (alto tráfego) |
| 6 | **Pessoas, galerias e páginas institucionais** (`legal-*`) | −13.550 | médio |
| 7 | **HomeLike** (`/pt`, `/pt/filmes/`, `/pt/series/`), numa folha compartilhada | −22.901 | alto (home) |
| 8 | **Detalhe de filme + série e temporada/episódio** — o bloco mais tocado pelos patches tardios (9566–11599); por último, com a ferramenta já testada | −32.590 | alto |

Medição em cada PR: bytes de CSS **bloqueante por rota** (soma dos `<link rel=stylesheet>` da
rota, minificado e gzip, lido pelo CDP), FCP e LCP em mobile e desktop no `perf:lab` e o chunk de
CSS do build. Um PR que não baixe o CSS bloqueante das rotas que diz tocar não entra.

---

## 8. O que este plano NÃO faz

- Não reescreve regra, não "limpa" seletor e não muda valor: mover é mover. Consertar um vencedor
  silencioso é outro PR, com o antes e o depois na tela.
- Não troca a arquitetura de estilo (Tailwind, CSS Modules, CSS-in-JS).
- Não usa `next dev` para concluir nada sobre ordem.
