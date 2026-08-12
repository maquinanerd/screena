# DESIGN-DELTA — telas 06 (Filme · Detalhe) e 07 (Série · Detalhe)

> Onde a implementação diverge do canônico (`Screen Screens v4.dc.html`, recortes
> `paginas/06-movie-detail.html` e `paginas/07-series-detail.html`), e por quê.
>
> Este documento existe para que uma divergência seja **sabida** em vez de virar
> "erro de implementação" na próxima revisão. Quem abrir o canônico para
> "completar o que falta na página" deve ler isto antes.
>
> Atualizado em 2026-08-12.

---

## 1. Blocos do canônico que NÃO renderizam

Cada ausência abaixo passa por `SectionBoundary`
([`section-absence.ts`](../../apps/web/src/lib/section-absence.ts)), que registra
o motivo em log estruturado (`event=section_absent`). Bloco que some sem dizer
por quê é defeito, não economia.

| Bloco do canônico | Estado | Motivo | O que falta para acender |
| --- | --- | --- | --- |
| **Cinerie Score** (o "82" em 47px/800) | não renderiza | `PRODUCTION_FORMULA_REGISTRY` está **vazio** e não existe decisão `cinerie_score_display` com `derivative_allowed` (`docs/legal/source-operations-inventory.md` §4: "Bloqueado"). O motor devolve `BLOCKED_BY_DECISION`. | Decisão humana de produto + licença. Ver [`docs/product/cinerie-score-decision.md`](../product/cinerie-score-decision.md). **Código novo.** |
| **Onde assistir** (wordmarks NETFLIX/prime/Max/Apple TV+) | não renderiza | **Zero provedores autorizados** no banco. `reason=no_authorized_provider`. | Bloco 2 do runbook de provedores (`register-watch-providers` → `legal sources apply` → `reprocess-watch-providers`). **Só operação** — o bloco acende sozinho. |
| **Faixa de prêmios** (troféu + "2 vitórias · 6 indicações") | componente pronto, **não importado** | Não há fonte. A API da TMDB **não expõe prêmios** (o site tem `/award`; a API v3 não tem endpoint nem chave de `append_to_response`). Raspar aquela página custaria o acesso à TMDB. | Confirmar o campo `Awards` da OMDb no payload real, decidir a licença (`use_case` próprio — **não** cabe em `rating_display`) e persistir. Componente: [`awards-band.tsx`](../../apps/web/app/_components/awards-band.tsx); parser: [`awards-presenter.ts`](../../apps/web/src/lib/awards-presenter.ts). **Código novo + decisão de licença.** |
| **Guia Cinerie · Crítica da redação** | contrato ligado, sem conteúdo | A fonte **existe e está ligada**: um `content_block` de tipo `review_summary` com `review_status` publicável. Ninguém escreveu nenhum ainda. | Redação escrever. **Só conteúdo.** |
| **Nota em estrela (8.2) e assinatura nominal** da faixa de crítica | não renderiza | `content_blocks` guarda **texto**, não veredito numérico nem autoria. Não há coluna para nenhum dos dois. | Modelagem de dados editorial. **Código novo + schema.** |
| **Chips de gênero** ("Drama", "Suspense") | não renderiza | `movies` **não tem relação com `genres`**. A tabela `genres` é a lista canônica por `media_type`, sem junção com o título. | Junção título↔gênero na ingestão. **Código novo.** |
| **"Mais como este"** (rail de 210px com setas) | não renderiza | Não há dataset de recomendação determinístico para a página pública. | Fonte de recomendação. **Código novo.** |
| **Célula de trailer** (play + "02:31 · Trailer" + "6 vídeos · 128 fotos") | renderiza sem play nem contagens | Não há contrato de vídeo/contagem de mídia na página. Botão de play sem vídeo é CTA falso. | Contrato de mídia. **Código novo.** |

---

## 2. Divergências deliberadas (o canônico está errado ou é impossível)

### 2.1 "Original Screen" — não é portado

Os dois recortes canônicos carregam, ao lado do selo Filme/Série:

```html
<span style="...">Original Screen</span>
```

Duas coisas erradas de uma vez:

1. **Resíduo do rebrand.** O `MANIFESTO-CANONICO.json` registra a passada
   "The Screen → Cinerie"; o rótulo sobreviveu nos dois arquivos. A marca pública
   é **Cinerie**.
2. **Afirmação falsa** — e este é o motivo mais forte. "Original *marca*"
   significa produção própria (o vocabulário de "Netflix Original"). A Cinerie
   **não produz filme nem série**. Estampar isso sobre "Gladiador" diz ao leitor
   uma coisa que não é verdade. O rebrand não conserta: "Original Cinerie" seria
   igualmente falso.

Travado por
[`tests/governance/original-screen-absent.test.ts`](../../tests/governance/original-screen-absent.test.ts),
que barra **as duas formas**. O guard lê a página **sem comentários** — senão
documentar a decisão seria proibido por ela mesma.

Se um dado real couber naquele espaço (país de origem, estúdio, distribuidora —
tudo vem da TMDB), entra por proposta explícita. Hoje o selo de tipo fica sozinho.

### 2.2 Marca gráfica das fontes de rating — barrada por licença

O canônico desenha o logo de cada fonte: caixa amarela do IMDb (`#F5C518`),
tomate do Rotten Tomatoes (`#FA320A`), azul do TMDB (`#0D253F`/`#01B4E4`).

**Não podemos.** Em
[`services/legal/src/authorization-spec.ts`](../../services/legal/src/authorization-spec.ts)
o campo é o literal `readonly logoAllowed: false` — não é um valor, é o **tipo**;
e a nota das licenças diz "Logo e citacao integral de critica NAO autorizados".
O cabeçalho do arquivo: "Liberar logo ou citação exige decisão humana e mudança
de tipo."

O slot da marca carrega o **nome da fonte em texto**, na tipografia da Cinerie —
nunca a cor, a forma ou o desenho da marca alheia. Travado em
[`ratings-panel.test.tsx`](../../apps/web/app/_components/__tests__/ratings-panel.test.tsx)
("a marca gráfica da fonte NÃO vai ao ar").

### 2.3 Chip do TMDB na fileira de notas — não é exibível como nota

O canônico coloca o TMDB entre IMDb e Rotten Tomatoes, com "7.6/10".

`vote_average_tmdb` existe em `movies`/`tv_shows`, e o próprio schema o declara:
`// dado tecnico TMDB; NUNCA nota editorial (inv. 1/2)`. O TMDB **não está em
`RATING_SOURCES`** (imdb, rotten_tomatoes, metacritic, letterboxd, filmaffinity),
não tem `source_licenses` com `content_type='rating'` e não tem
`rating_source_key`. Exibi-lo naquela fileira o transformaria em fonte editorial
de nota — exatamente o que a invariante 2 proíbe.

A licença do TMDB no inventário é de **catálogo/metadados**, com atribuição por
disclaimer no rodapé, não crédito por nota.

### 2.4 Contagem de "31 críticas" — não existe

O canônico escreve "8,1 mil" sob o IMDb e "31 críticas" sob o Rotten Tomatoes. A
OMDb devolve `imdbVotes`; **Rotten Tomatoes e Metacritic não trazem contagem
nenhuma**. Onde não há contagem, a linha meta carrega só o crédito.

### 2.5 Linkback só onde há URL canônica

IMDb tem `imdbID` no payload → `imdb.com/title/{id}/`. Rotten Tomatoes e
Metacritic **não trazem identificador**; derivar slug do título fabricaria um
link que pode não existir. Para elas o crédito é **textual, sem link** — e é por
isso que existe a dispensa nominal de linkback registrada em
`authorization-spec.ts` (`LINKBACK_DISPENSED_SOURCES`).

### 2.6 Botão "Ver no celular" — não é portado

Ferramenta de protótipo do canônico de série. Não existe em produção.

### 2.7 Tamanhos de texto abaixo de 12px — divergência restrita ao desktop

O contrato de responsividade: *"Texto nunca abaixo de 12px; meta/kickers podem
manter 11px APENAS ≥1024"*. O canônico é pixel-fiel em 1280–1440 e usa **10–11px**
em selo, kicker e meta.

Resolução: o canônico vale **≥1024**; abaixo disso o piso de 12px é aplicado
(bloco no fim de `globals.css`). É leitura em tela pequena — ali o contrato manda.

---

## 3. Derivações (o contrato não cobre; foram derivadas de forma conservadora)

### 3.1 Faixa de mídia full-bleed (grid `1fr 3fr 2fr`, 472px)

**O contrato de responsividade não cobre esta faixa.** Ele descreve grids de
pôster, rails, elenco, episódios e ficha — não um full-bleed de altura fixa.

Derivação, e a regra que ela respeita: **nenhuma célula desaparece.** As três da
direita são atalhos de navegação (Notícias, Onde assistir, Em breve); escondê-las
abaixo de 1024px não simplifica o layout — apaga três links exatamente nas
larguras em que a navegação lateral já não existe. **A altura fixa é que cede**,
porque ela é a parte decorativa.

| Faixa | Comportamento |
| --- | --- |
| ≥1024 | canônico: `1fr 3fr 2fr`, 472px de altura |
| ≤1023 | pôster + destaque lado a lado em cima (`1fr 2fr`, 360px); os três atalhos **empilham abaixo** numa linha de 3 colunas, 132px |
| ≤767 | mesma estrutura, primeira faixa a 240px e atalhos a 104px; legenda a 12px |

O estado anterior (`display: none` no stack) **removia** os três atalhos.

### 3.2 Fileira de chips abaixo de 480px

Quatro chips lado a lado esmagariam o número e o crédito. Vira grade de 2
colunas; a divisória vertical some e o espaçamento da grade faz o papel de
separação — um filete horizontal seria um separador **novo**, não previsto.

### 3.3 Escada de padding do container de detalhe

O container saltava de 64px direto para 20px em 767px. Preenchidos os degraus do
contrato: 64 → 48 (≤1279) → 32 (≤1023) → 20 (≤767).

---

## 4. Conflitos entre fontes canônicas, e como foram resolvidos

### 4.1 Episódios no mobile: contrato × tela 08

- **Contrato de responsividade:** "Episódios: lista mantém; thumb 16:9 fixa
  **128px** de largura no mobile."
- **Tela 08 (`08-series-mobile`):** card vertical com o still ocupando a largura
  toda.

Havia, em `globals.css`, uma regra derivada da tela 08 que **vencia em silêncio**
(mesma especificidade, ~4.500 linhas depois) o `grid-template-columns: 128px 1fr`
do bloco de episódios.

**Resolvido a favor do contrato**, porque ele próprio define a hierarquia: *"a
tela 08-series-mobile é referência de LINGUAGEM mobile para páginas de detalhe,
**não o contrato completo**"*. Onde o contrato enuncia uma regra específica, ele
governa.

Consequência prática, e o motivo de a regra existir: com o still em cima, cada
episódio ocupa ~190px de altura e uma temporada de 16 vira uma rolagem de três
metros. Com 128px ao lado, a lista continua uma lista.

### 4.2 Seletor de temporada aparece duas vezes no canônico

No canônico o seletor está no bloco da crítica **e** no cabeçalho de episódios, e
os dois trocam o mesmo estado — porque lá a crítica é **por temporada**
(`seasonInfo.critica`).

Aqui a crítica vem de `content_blocks` com `block_type = 'review_summary'`, que é
**por entidade**, não por temporada. Um seletor no bloco da crítica não teria
estado para trocar, e sugeriria que existem críticas por temporada. **Só o
seletor do cabeçalho de episódios é portado.**

Se a crítica por temporada existir um dia, o segundo seletor volta junto com ela.

---

## 5. Como auditar

```bash
pnpm --filter @screena/web qa:detail-responsive
```

Renderiza o esqueleto das duas telas com o **CSS real** (lido do disco) e a
**fileira de notas real** (componente + presenter), em 1440/1024/768/375/320, e
mede overflow horizontal, alvo de toque (44×44) e piso de fonte com o motor de
layout do Chromium. Capturas em `apps/web/.qa-detail-responsive/`.

**O que ele não prova:** a cadeia de dados (banco → loader → presenter → página).
Isso é dos `validate:*-real-postgres` e dos testes de wiring. Harness estático
nunca é evidência final de que a página funciona; é evidência de como o CSS se
comporta.
