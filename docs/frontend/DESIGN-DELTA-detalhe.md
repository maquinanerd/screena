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
| **Onde assistir** (canônico desenha wordmarks NETFLIX/prime/Max/Apple TV+) | não renderiza | **Zero ofertas exibíveis.** `reason=no_authorized_provider`. A cadeia de código **foi corrigida na PR #164**; o que resta é operação (§5). Os **wordmarks não são portáveis**: a licença dá `logoAllowed: false` — ver §5.4. | Rodar a sequência do [runbook de streaming](../runbooks/streaming-sync.md). **Agora acende com operação** — mas com o nome da plataforma em **texto**, não com a marca gráfica. |
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
nenhuma**. Onde não há contagem, a linha meta **não renderiza** — nunca um número
de críticas fabricado para preencher o desenho.

### 2.5 Linkback só onde há URL canônica

IMDb tem `imdbID` no payload → `imdb.com/title/{id}/`. Rotten Tomatoes e
Metacritic **não trazem identificador**; derivar slug do título fabricaria um
link que pode não existir. Para elas o crédito é **textual, sem link** — e é por
isso que existe a dispensa nominal de linkback registrada em
`authorization-spec.ts` (`LINKBACK_DISPENSED_SOURCES`).

Desde **13/08/2026** essa distinção não aparece mais na ficha: o crédito (com ou
sem link) migrou para o rodapé global — ver §2.7.

### 2.7 Crédito de fonte: saiu do corpo, vive no rodapé _(13/08/2026)_

**Decisão do proprietário (Pablo Eduardo), 13/08/2026:** todo crédito de fonte sai
do corpo das páginas e passa a viver no **rodapé global**.

**Motivo:** o crédito colado ao dado se espalhava por quatro superfícies com
regras próprias — chip da nota, painel de streaming, faixa da home (onde o
crédito trocava a cada slide) e hub de "onde assistir". Consolidá-lo num único
lugar dá uma superfície só para auditar, e ela não pisca.

**O que a decisão NÃO fez:** afrouxar a licença. `requires_attribution` continua
`true` para todas as fontes. Mudou o **endereço** do crédito, não a obrigação.

**A prova mudou junto.** Antes a prova era a proximidade — o presenter recusava a
linha sem crédito. Agora são duas metades, e nenhuma sozinha basta:

1. o rodapé nomeia **toda** fonte autorizada, com o texto verbatim da licença.
   Ele não conhece nome de fonte: lê `publicSourceCredits()`
   (`services/legal/src/public-credits.ts`), derivado de `authorization-spec.ts`.
   Fonte nova registrada lá aparece no rodapé sem editar o rodapé;
2. o rodapé está em toda página que exibe dado licenciado (é o layout raiz), e
   isso é aferido por rota em
   `apps/web/app/_components/__tests__/footer-credits.test.tsx`, medindo **texto
   visível** — nunca `markup.includes(...)`, que aceitaria um `aria-label`.

**O caminho de escrita não foi tocado:** `external_ratings_display_guard` e
`watch_availability_display_guard` continuam recusando linha sem licença e sem
crédito. A procedência segue gravada; mudou só onde ela aparece.

**Sem logo, e agora por dois motivos.** `logoAllowed` é o literal `false` no tipo
de `LicenseTarget`, e os arquivos que a `FOOTER-SPEC.md` §3.4 cita
(`assets/data-credits/*.svg`) não existem no repositório. O bloco "Dados por" do
rodapé carrega **nome de fonte em texto**.

### 2.6 Botão "Ver no celular" — não é portado

Ferramenta de protótipo do canônico de série. Não existe em produção.

### 2.7 Tamanhos de texto abaixo de 12px — divergência restrita ao desktop

O contrato de responsividade: *"Texto nunca abaixo de 12px; meta/kickers podem
manter 11px APENAS ≥1024"*. O canônico é pixel-fiel em 1280–1440 e usa **10–11px**
em selo, kicker e meta.

Resolução: o canônico vale **≥1024**; abaixo disso o piso de 12px é aplicado
(bloco no fim de `globals.css`). É leitura em tela pequena — ali o contrato manda.

### 2.8 A MODALIDADE aparece na fileira "Onde assistir" — o canônico desenha só wordmarks

**Divergência deliberada, decidida pelo dono do projeto (2026-08-13).**

O canônico desenha a fileira "Onde assistir" como uma linha de wordmarks
(NETFLIX / prime / Max / Apple TV+): só a marca, nada sobre o que a oferta
custa. A colheita de produção mediu o corpus real e desfez a premissa:

| modalidade | ofertas no corpus |
| --- | --- |
| `buy` (compra) | **18.077** |
| `rent` (aluguel) | **18.330** |
| `subscription` (assinatura) | 10.970 |

**Compra e aluguel são a maioria do dado**, não o caso de borda. E os três
maiores provedores do corpus são lojas transacionais com **zero** oferta por
assinatura: Apple TV Store (10.135 · `buy`+`rent`), Google Play Movies (9.043 ·
`buy`+`rent`) e Amazon Video (5.123 · `buy`+`rent`).

Nesse cenário, exibir só a marca **afirma um fato falso**: "Amazon" num título
que custa R$ 14,90 de aluguel diz ao leitor que já está incluso no Prime que ele
paga. É a mesma família de defeito do "Original Screen" (§2.1) e do Rotten
Tomatoes exibido como `80/100` — com o agravante de custar dinheiro do leitor.

**O que passa a valer:**

1. Toda oferta exibida carrega a modalidade em **texto visível**, junto do nome
   da plataforma. Nunca em `aria-label`, `title` ou `data-*` — mesmo critério
   que §5.3 já fixou para o rótulo de destino.
2. Os rótulos são **Assinatura · Grátis · Grátis com anúncios · Aluguel ·
   Compra**, num vocabulário único
   ([`watch-offer-modality.ts`](../../apps/web/src/lib/watch-offer-modality.ts)),
   compartilhado pelos quatro consumidores de `licensedWatchWhere`.
3. A **ordem** é declarada: *o que está incluso vem antes do que custa*.
4. Nas superfícies compactas (faixa da home, destaque do explorar, hub), uma
   linha por **plataforma** com as modalidades ao lado — "Prime Video ·
   Assinatura · Aluguel", nunca duas entradas da mesma marca.
5. No **painel de detalhe** o agrupamento continua por modalidade (seções
   "Assinatura", "Aluguel", "Compra"), e isso é deliberado: ali a ordem "incluso
   antes do que custa" é **estrutural** — quem varre a página de cima para baixo
   encontra primeiro o que não lhe custa nada — e o preço, que é por modalidade,
   fica sob o cabeçalho que o explica. Cada linha já vive sob um heading que
   nomeia a modalidade, então a ambiguidade que o item 4 corrige não existe ali.

**Consequência que não pode ser esquecida:** os aliases das três lojas
(`apple-tv`, `google-play`, `amazon-video`) só são honestos **enquanto a
modalidade estiver na tela**. Se ela sair, essas três linhas voltam a mentir.

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

## 5. "Onde assistir": a cadeia de código foi corrigida — o que resta é operação

> **Histórico desta seção, porque ele é o valor dela.**
>
> 1. A primeira versão dizia que o bloco "acende sozinho depois do Bloco 2 do
>    runbook". **Errado**, e não verificado: repetido do enunciado como se fosse
>    achado.
> 2. A segunda versão (2026-08-12) leu a cadeia linha a linha e listou as
>    paradas de código. **Correta na época.**
> 3. Esta versão: a [PR #164](https://github.com/maquinanerd/screena/pull/164)
>    **corrigiu todas elas**. O que sobrou é operação — e duas divergências
>    novas, registradas em §5.4 e §5.5, que não são bloqueio de acendimento mas
>    mudam o que aparece na tela.

### 5.1 O que estava quebrado e como foi fechado

| Parada | Estado antes | Como foi fechada na #164 |
| --- | --- | --- |
| O render filtrava `providerApi = "streaming_availability"`, valor que o reprocessamento nunca grava | zero linhas, sempre | `licensedWatchWhere` deixou de filtrar por fornecedor técnico. Quem autoriza é a **cadeia de licença**, nunca o nome de quem transportou o dado ([`entity-watch.ts`](../../apps/web/src/server/entity-watch.ts)) |
| `deep_link` NULL e o presenter exigia deep link | oferta descartada em silêncio | O presenter resolve `deep_link ?? web_url` e carrega `destinationKind`. O `link` por país **já era gravado** em `web_url` desde sempre — só nunca era lido |
| Sem `attribution_text`, e o texto existente creditava Movie of the Night | oferta sem crédito → descartada; com o crédito errado → proveniência falsa | Licença **por fornecedor técnico**: `tmdb` credita **JustWatch**, `streaming_availability` credita Movie of the Night. O reprocessamento hidrata o crédito da licença vigente **daquela origem** |
| `promote-watch-availability` recusava `provider_api='tmdb'` com `wrong-provider` | impossível promover | Conjunto autorizado ampliado; nenhuma verificação removida, e um motivo novo (`missing-attribution`) recusa oferta sem crédito em **qualquer** origem |

`display_allowed` continua nascendo `false`. **Acender segue sendo decisão humana**, pelo passo de promoção.

### 5.2 A sequência que acende (nunca use `--`)

Está inteira em [`docs/runbooks/streaming-sync.md`](../runbooks/streaming-sync.md).
A ordem importa: o registro de provedores vem antes da licença, e a licença
antes do reprocessamento — é dela que o crédito é hidratado.

### 5.3 O que passou a valer para TODO consumidor de `licensedWatchWhere`

A cláusula é compartilhada por **quatro** leitores: o painel de detalhe, a faixa
da home, [`discover.ts`](../../apps/web/src/server/discover.ts) e o hub
[`watch-browse.ts`](../../apps/web/src/server/watch-browse.ts). Abrir o portão
abriu para os quatro ao mesmo tempo. Ver §5.5.

### 5.4 Os wordmarks do canônico NÃO são portáveis

O canônico desenha a fileira com as marcas gráficas — `NETFLIX` em `#E50914`,
`prime video` em `#1399FF`, `Max` em `#002BE7`. **Não podemos usá-las**, pela
mesma razão que os chips de nota saíram com o nome da fonte em texto:

Em [`services/legal/src/authorization-spec.ts`](../../services/legal/src/authorization-spec.ts)
o campo é o literal `readonly logoAllowed: false` — **é o tipo, não um valor** —
e vale para toda licença que o spec emite, inclusive as de
`content_type='watch_availability'` geradas por `streamingProviderEntries`.

O painel hoje está **correto**: renderiza `{offer.providerName}` em texto e o
comentário de cabeçalho declara que nunca renderiza logo de provedor. Portar o
wordmark seria violação — não é escolha de front.

### 5.5 Duas divergências abertas (não impedem acender; mudam o que se vê)

**(a) O hub `/pt/onde-assistir` agrupa por `provider_key`, e as duas origens
usam chaves diferentes para a mesma plataforma.** Em
[`watch-browse.ts`](../../apps/web/src/server/watch-browse.ts) o balde é
`row.providerKey`: a RapidAPI grava `"netflix"`, o TMDB grava `"8"` (o
`provider_id` numérico). Com as duas origens ativas o hub lista **"Netflix"
duas vezes**, como se fossem dois serviços. É o mesmo defeito que o painel de
detalhe resolveu com `providerSlug` (a identidade canônica **entre**
fornecedores); o hub não recebeu o campo. Enquanto só uma origem estiver
promovida, é latente.

**(b) O motivo da ausência fica falso no instante em que a operação der certo.**
As duas páginas de detalhe fixam `reason: 'no_authorized_provider'`, com o
comentário dizendo "enquanto for assim" — isto é, enquanto houver zero
provedores autorizados. Depois do runbook a causa comum vira a outra: há
provedor autorizado e **este título** não tem oferta. O enum já tem
`no_offer_for_entity` (`actionable: false`) para exatamente isso, e ele não é
usado em lugar nenhum de produção. Sem a distinção, todo título sem oferta passa
a emitir um evento `actionable: true` — o ruído que
[`section-absence.ts`](../../apps/web/src/lib/section-absence.ts) descreve como
o que "afogaria o único evento que importa".

**(c) O destino do clique é o agregador, e só o leitor de tela sabe.** Pelo
caminho TMDB o destino é o `link` por país — uma página da própria TMDB, não a
Netflix. O painel carrega `destinationKind` e diferencia no `aria-label` ("abrir
página de disponibilidade" vs "abrir no serviço") e num `data-destination-kind`,
mas **não há nada visível**: não existe regra de CSS para esse atributo, e o
texto do link é o nome da plataforma nos dois casos. É a mesma distinção que o
crédito de fonte resolveu ao exigir **texto visível** — atributo de
acessibilidade não é divulgação para quem enxerga. Como resolver (rótulo,
alvo do clique, ou não linkar) é decisão de produto, não de front.

> Nota (13/08/2026): o crédito saiu da fileira de notas e foi para o rodapé
> (§2.7). A regra "texto visível, nunca só atributo" **viajou junto** — é ela que
> `footer-credits.test.tsx` afere, tirando as tags antes de medir.

---

## 6. Como auditar

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
