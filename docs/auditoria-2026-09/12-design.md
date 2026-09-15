# FASE 6 — Design e produto

> Olho de produto, não de código. Tudo aqui foi **medido no site em produção**
> (`https://cinerie.com`) em 2026-09-01, entre 01:35 e 02:10, em viewport de
> desktop e de celular (375×812). Onde uso número, ele veio de requisição real,
> do DOM ou do banco — não de leitura de CSS.
>
> A referência competitiva é [`11-concorrencia.md`](11-concorrencia.md).

---

## 1. O diagnóstico em uma frase

O Cinerie **já tem a ficha de dados** que a maioria dos concorrentes brasileiros
não tem — nota atribuída por fonte, score composto, elenco, prêmios, episódios,
notícias relacionadas — e **não tem a primeira coisa que qualquer um deles
entrega: a imagem do filme na primeira tela.**

---

## 2. A ficha de filme

### O que está acima da dobra (medido)

Ordem real na `/pt/filmes/a-odisseia/`:

| Posição | Bloco |
| --- | --- |
| 1 | Breadcrumb `Filmes / Aventura / A Odisseia` |
| 2 | Badge **FILME** (vermelho `#F0443E`) |
| 3 | Título `A Odisseia` |
| 4 | Chips de gênero + `2026 · 2 h 52 min` + classificação `14` |
| 5 | Sinopse truncada com `…` |
| 6 | Botões `Minha lista` e `Avaliar` |
| 7 | **Cinerie Score 86** · "Composto de 3 fontes: Metacritic, IMDb e TMDB" |
| 8 | **AVALIAÇÕES** — IMDb 8,5/10 · Metacritic 88/100 |

Depois da dobra: faixa de imagens, `Prêmios` (OMDb, 2 vitórias), `A obra`,
`Elenco principal`, `Mais como este`. Altura total: **3.124 px**, 18 imagens.

### O problema, com número

**Em celular (375×812), a primeira imagem da página começa em `y = 840 px`.**
Ou seja: **zero pixels de imagem na primeira tela de uma página de filme.** O
usuário rola uma tela inteira de texto antes de ver qualquer coisa do filme.

No desktop é a mesma decisão: a faixa de imagens só aparece depois do bloco de
texto.

Nenhum dos 24 concorrentes analisados na FASE 5 faz isso. IMDb, AdoroCinema,
Letterboxd, Filmow, Papo de Cinema — todos abrem com pôster ou *backdrop*. A
página de filme sem imagem de filme é uma decisão que só se sustenta se ela for
deliberada, e não encontrei nada que a declare.

### O que falta na ficha de filme, comparado a quem ganha a busca

| Bloco | Cinerie | Quem faz |
| --- | --- | --- |
| Pôster acima da dobra | **não** | todos |
| Trailer acessível de cara | **não** | IMDb, AdoroCinema, Omelete |
| **Onde assistir** | **em 147 de 83.314 títulos (0,18%)** | JustWatch, AdoroCinema, Filmow, Papo de Cinema |
| Introdução editorial própria | **em 0 títulos** (`content_blocks = 0`) | AdoroCinema, Papo de Cinema, Omelete |
| Notícias relacionadas | **na série sim, no filme não** | Omelete, Screen Rant |
| Nota atribuída por fonte | **sim, e bem feito** | Metacritic, RT |
| Score composto com fontes declaradas | **sim** | poucos |
| Prêmios | **sim** | IMDb |
| Ficha técnica (direção, elenco) | sim | todos |

O terceiro item dessa tabela é o mais caro. A FASE 5 concluiu que a intenção
**"onde assistir X"** é a mais valiosa e disputada do mercado brasileiro. O
Cinerie tem 70.869 linhas de disponibilidade no banco e mostra o painel em
**147 títulos** — porque 70.036 estão com `display_allowed = false`.

### Uma inconsistência de atribuição

O Score diz "**Composto de 3 fontes: Metacritic, IMDb e TMDB**", mas o painel
`AVALIAÇÕES` logo abaixo mostra **duas**: IMDb e Metacritic. A terceira fonte
que compõe o número exibido é invisível na tela. Ou o TMDB aparece, ou a frase
precisa dizer quantas estão visíveis.

---

## 3. A ficha de série — melhor que a de filme

`/pt/series/lanternas/` tem, medido:

| Seção | Altura |
| --- | ---: |
| A obra | 211 px |
| **Episódios** | **1.765 px** + 1.624 px de continuação |
| Elenco principal | 417 px |
| **Notícias relacionadas** | 264 px |
| Mais como este | 615 px |

**A série tem "Notícias relacionadas" e o filme não.** É o único bloco de valor
editorial que está vivo em alguma ficha, e ele está só em um dos dois verticais.

E os episódios ocupam **3.389 px** para uma série de 8 episódios — mais da metade
da página. Fui medir o que há dentro, e o resultado é mais interessante do que
"é comprido":

| Métrica da seção `Episódios` | Valor |
| --- | ---: |
| Altura | 1.765 px (+1.624 px de continuação) |
| **Links** | **0** |
| **Botões** | **0** |
| `<details>` (acordeão) | **0** |
| Imagens | 3 |

É **texto corrido**: `T1 · E1 · Piloto` + sinopse + `2026 · 57 min`, repetido. O
conteúdo está lá — o usuário lê a sinopse de cada episódio sem sair da página, o
que é bom — mas **não há nada clicável**, nem acordeão, nem âncora por temporada.
Para uma série de 8 episódios é longo; para uma de 200, é intransitável.

### E as rotas de temporada e episódio estão órfãs

Isto fecha um item que eu tinha deixado em aberto. Existem rotas
`/pt/series/{slug}/temporadas/{n}/` e `.../episodios/{m}/`, e há **3.960.233
episódios e 139.977 temporadas** no banco (72% da tabela `entities`). Medi os
links da ficha de série:

```
temTemporadas: false
```

**Zero links para `/temporadas/` ou `/episodios/`** em toda a página. Somando com
o que já estava medido:

1. `noindex, follow` na própria página (válvula de emergência de 2026-08-27) ✔ deliberado
2. Fora do sitemap (`seasons-1` e `episodes-1` respondem **404**) ✔ deliberado
3. **Nenhum link interno apontando para elas** ← isto não estava previsto

As duas primeiras são a válvula funcionando. A terceira torna as rotas
**inalcançáveis por qualquer caminho**: nem buscador, nem usuário. E há uma
consequência fina: o `follow` da válvula foi escolhido de propósito para
*"manter o rastreio dos links internos"* — mas se nada linka para a página, o
rastreador nunca chega nela para ver o `follow`. A metade de dentro do par não
tem como agir.

Não é urgente — é exatamente o que a válvula queria. Mas é preciso saber que a
saída da válvula (*"quando a Fase 3 estiver aplicada […] esta lista volta a ser
vazia"*) **não basta**: reativar o sitemap sem criar os links deixa as páginas
anunciadas e sem navegação interna.

A série também **não mostra o Cinerie Score** (só IMDb 8,4), enquanto o filme
mostra. Duas fichas do mesmo produto com contratos visuais diferentes.

---

## 4. A ficha de pessoa — a mais fraca, e por um motivo rastreável

`/pt/pessoas/tmdb-112013/` mostra: foto circular, sobrancelha
`PESSOA · ATUAÇÃO`, nome, três chips (13 créditos, nascimento, local), um link
"Também em: IMDb", e a grade `CONHECIDO POR`.

**Não há biografia.** E isso não é acaso: `people.biography_source_status` nasce
`unknown` e nada no sistema o altera, então a licença nunca libera a exibição.

**E o nome é `비`.** A URL é `/pt/pessoas/tmdb-112013/`.

### A cadeia que liga três sintomas a uma causa

Medi no banco:

| Tipo | Slugs `tmdb-<id>` | Total | % |
| --- | ---: | ---: | ---: |
| movie | 5.736 | 50.157 | 11,4% |
| **person** | **7.267** | 62.647 | **11,6%** |
| tv | 4.934 | 34.749 | 14,2% |
| **Total** | **17.937** | 147.553 | — |

**17.937 páginas indexáveis têm URL sem uma única palavra-chave.**

A causa está no achado D2 do relatório do `screena`: **`entity_alternative_titles`
tem ZERO linhas.** Sem título alternativo em alfabeto latino, o gerador de slug
não tem de onde tirar um nome legível para `비`, `Астероид-77F` ou `По контуру`,
e cai no `tmdb-<id>`.

A mesma causa produz o terceiro sintoma, visível na home: **o ticker "estreia
hoje" da `/pt/filmes/` lista `Астероид-77F`, `По контуру`, `Of Men and Monsters`
e `Switch Over`** — numa página `lang="pt-BR"`, para o público brasileiro.

Uma tabela vazia, três sintomas: URL sem palavra-chave, título ilegível na tela,
e conteúdo em cirílico apresentado como novidade do dia.

---

## 5. Home e listagens

### A estrutura, medida

| Seção | Topo (px) | Altura | Links | Imagens |
| --- | ---: | ---: | ---: | ---: |
| `hero` — Destaques | 0 | 480 | 2 | 1 |
| *(ticker de novidades)* | 480 | ~378 | — | — |
| Destaques de hoje | 858 | 516 | 3 | 3 |
| Popular essa semana | 1.380 | 291 | 11 | 10 |
| Filmes em alta | 1.727 | 627 | 13 | 6 |
| Séries da semana | 2.736 | 627 | 13 | 6 |
| Em breve | 3.419 | 488 | 13 | 6 |
| **Notícias & entrevistas** | 3.963 | **1.864** | 8 | 4 |

**Altura total 8.124 px, 36 imagens, 63 links.** Sete seções, e — ao contrário
da ficha de filme — **a home abre com imagem** (o hero tem backdrop em `top: 0`,
com `fetchPriority="high"` e `preload`). O contraste é o achado: a home sabe que
precisa de imagem na primeira tela; a ficha, não.

A home entrega, em três segundos: hero com filme em destaque (`A Odisseia`,
★★★★★, classificação), o ticker de novidades, `DESTAQUES DE HOJE` com abas
Filmes/Séries e três cards editoriais reais, e `POPULAR ESSA SEMANA` com abas
Filmes/Séries/Streaming/Cinema.

Isso funciona. O que a enfraquece é o que já está medido em outros relatórios:
o critério de seleção do hero e das listagens é **ano decrescente sem portão de
qualidade**, então um título de 2026 sem nota, sem imagem e sem sinopse compete
em pé de igualdade com `A Odisseia`. O ticker acima é exatamente isso
acontecendo.

---

## 6. Estados vazios

Aqui o produto está **melhor do que aparenta**, e vale registrar porque é raro:
existe `src/lib/section-absence.ts`, e a razão da ausência é **derivada do
estado**, não fixa no código. O comentário de `entity-watch.ts` explica que um
motivo fixo "é uma afirmação que envelhece sozinha".

Mas a decisão de produto atual é **omitir a seção inteira**. Quando não há
trailer, nota ou onde assistir, o bloco simplesmente não existe. Para 99,8% das
fichas, "Onde assistir" nunca aparece — e o usuário não recebe nem um
"ainda não temos essa informação", nem um caminho alternativo.

Um estado vazio bem escrito ("Ainda não confirmamos onde assistir a este título
no Brasil — avise-me quando entrar em algum serviço") converte melhor que a
ausência, e é conteúdo indexável.

---

## 7. Identidade por vertical — **aprovada, com folga**

A regra do projeto proíbe que a diferenciação dependa só da cor. Medi os cinco
sinais na `/pt/series/lanternas/`:

| Sinal | Estado |
| --- | --- |
| **Label** | `SÉRIE` textual ✔ |
| **Badge** | verde `#7fa56f` ✔ |
| **Breadcrumb** | `Séries / Drama / Lanternas` ✔ |
| **Schema** | `["TVSeries","BreadcrumbList"]` ✔ (lido do JSON-LD) |
| **URL** | `/pt/series/lanternas/` ✔ |

E no filme: `FILME` + badge vermelho `#F0443E` + `Filmes / Aventura / …` +
`/pt/filmes/…`. **Cinco de cinco, nos dois verticais.** É o item de governança
mais bem cumprido de toda a auditoria.

---

## 8. Acessibilidade — medida, não estimada

### Contraste: 17 reprovações numa única página

Rodei o cálculo de razão de contraste (WCAG) sobre todo texto de `main` na ficha
de filme. **17 elementos reprovam.** Dois padrões:

**1. `--c-text-muted: #9a958c` — 2,93:1** (mínimo 4,5:1), em **21 elementos**:
ano dos cards, rótulo "Sugestões", metadados de elenco.

O agravante: **o token acessível existe.** `--c-text-muted-aa: #6e6a61`
(5,30:1) está declarado na mesma folha. A governança do projeto registra que a
produção "usa `--c-text-muted-aa`" e que isso está travado por
`tests/web/detalhe-contraste.test.ts`.

O teste guarda **a sobrancelha**. O token reprovado continua vivo em tudo o que
o teste não cita. A correção foi aplicada ao lugar apontado, não à classe do
problema — e é por isso que 21 elementos ainda servem 2,93:1.

**2. Badge de vertical: branco sobre `#F0443E` a 9 px — 3,75:1** (classe
`similar-card__type`). Aqui o acento de filme **é** a cor canônica; o problema é
texto branco de 9 px sobre ele. Fonte pequena exige 4,5:1.

### Alvos de toque

Em celular, **18 elementos clicáveis têm altura menor que 44 px** (mínimo do
WCAG 2.5.5 e da HIG): links de breadcrumb (19 px), "Ver elenco completo →"
(20 px), nomes do elenco (16 px), links do rodapé (16 px).

### O que está certo

- `<a class="skip-link" href="#main-content">Pular para o conteúdo</a>` presente.
- Hero com `role="tablist"`, `aria-selected` e `tabindex` corretos nos dots.
- `aria-label` descritivo nos controles ("Destaque 2: A Odisseia").
- `alt=""` nas imagens decorativas — decisão certa, e documentada.
- Menu responsivo real: `nav` some e o botão de menu aparece (`display: flex`).

---

## 9. Desempenho percebido

| Rota | TTFB | Total | HTML |
| --- | ---: | ---: | ---: |
| `/pt/` | 1,246 s | 1,458 s | 112 KB |
| `/pt/filmes/` | 0,707 s | 0,909 s | 101 KB |
| `/pt/series/` | 1,006 s | 1,204 s | 104 KB |
| `/pt/pessoas/` | **1,369 s** | 1,561 s | 58 KB |
| `/pt/noticias/` | 0,423 s | 0,592 s | 85 KB |

Cabeçalho medido: `cache-control: private, no-cache, no-store, max-age=0,
must-revalidate` e `cf-cache-status: DYNAMIC`. **Nada é cacheado**, nem no
navegador nem na Cloudflare.

O que "pula": as imagens entram com `loading="lazy"` e o hero usa
`fetchPriority="high"` com `preload` — isso está certo. O salto de layout vem da
faixa de mídia, que reserva altura antes de as imagens chegarem.

---

## 10. As quinze sugestões, priorizadas por (impacto ÷ esforço)

| # | Sugestão | Impacto | Esforço | Por quê | Quem faz bem |
| --- | --- | --- | --- | --- | --- |
| **1** | **Pôster/backdrop acima da dobra na ficha de filme e série** | altíssimo | **baixo** | Hoje há 0 px de imagem na primeira tela de celular. E medi: **91,3% dos filmes e 92,9% das séries já têm `poster_path` no banco**. Não é falta de dado — é ordem de blocos | IMDb, AdoroCinema, Letterboxd |
| **2** | **Trocar `--c-text-muted` por `--c-text-muted-aa` em todos os usos** | alto | **baixo** | 21 elementos a 2,93:1; o token acessível já existe. É uma troca de variável | — |
| **3** | **Promover as 70.036 ofertas de `watch_availability`** | altíssimo | médio | "Onde assistir" sai de 147 para dezenas de milhares e ataca a intenção mais valiosa do mercado brasileiro. São **duas** coisas: a decisão humana de licença **e** um seletor em lote na CLI — hoje `--ids` é obrigatório e não há modo em massa | JustWatch, Filmow |
| **4** | **Popular `entity_alternative_titles` e regerar slugs** | alto | médio | Conserta de uma vez 17.937 URLs sem palavra-chave, os títulos em cirílico no ticker e os nomes ilegíveis | IMDb (títulos por região) |
| **5** | **Estado vazio escrito para trailer, nota e onde assistir** | alto | **baixo** | A infraestrutura (`section-absence.ts`) já existe e já sabe o motivo. Falta escrever a frase e renderizar | Letterboxd |
| **6** | **Portão de qualidade no hero e no ticker** | alto | **baixo** | Impede `Астероид-77F` de ser "estreia de hoje". Exigir pôster + sinopse + (nota ou popularidade) | AdoroCinema |
| **7** | **Botão de trailer acima da dobra** | alto | baixo | `tmdb_videos` tem 103.688 linhas; o trailer hoje vive depois de tudo | IMDb, Omelete |
| **8** | **Alvos de toque ≥ 44 px em celular** | médio | **baixo** | 18 elementos abaixo do mínimo; é padding | — |
| **9** | **"Notícias relacionadas" também no filme** | médio | **baixo** | O bloco já existe e funciona na série. É o único bloco editorial vivo | Omelete, Screen Rant |
| **10** | **Navegação por temporada fixa na ficha de série** | médio | médio | 3.389 px de episódios sem âncora; numa série longa é intransitável | TV Guide, Trakt |
| **11** | **Destravar `biography_source_status`** | alto | médio | Medi: **2.152 biografias já estão no banco e 100% das 1,3 M de pessoas estão em `unknown`**, que bloqueia exibição. O texto existe; o gate nunca é alterado por nada. É decisão de licença, não de código | IMDb, AdoroCinema |
| **12** | **Sitemap de pessoas** | alto (SEO) | **nenhum** | Não é shard novo: o shard existe e responde **404** porque o gate exige biografia e 100% das pessoas estão em `unknown`. **Sai de graça junto com a sugestão nº 11** | todos |
| **13** | **Score também na ficha de série** | médio | baixo | O filme mostra, a série não. Contrato visual inconsistente | Metacritic |
| **14** | **Cache de rota nas fichas** | médio | alto | Tudo é `no-store`; 83.347 URLs no sitemap significam 83 mil renderizações por varredura do Googlebot | — |
| **14b** | **Sinopse em português nas fichas** | alto | médio | **62,5% dos filmes e 62,4% das séries não têm `summary` em pt-BR.** A ficha abre com um parágrafo truncado ou com nada. É o texto que descreve a obra | todos |
| **15** | **Corrigir a frase do Score** | baixo | **trivial** | "3 fontes: Metacritic, IMDb e TMDB" com duas visíveis | Metacritic |

---

## 11. As três que eu faria primeiro

**1ª — Pôster acima da dobra (nº 1).**
É a maior distância entre o que o Cinerie é e o que ele parece. A imagem já está
no banco, já é buscada, já é renderizada — 840 px abaixo de onde deveria estar.
É uma mudança de ordem de blocos, não de dados. Nenhuma outra sugestão desta
lista tem essa razão impacto/esforço.

**2ª — O token de contraste (nº 2) junto com os alvos de toque (nº 8).**
São as duas únicas correções desta lista que o produto **deve** por
acessibilidade, não por competitividade. E a nº 2 é literalmente trocar
`--c-text-muted` por `--c-text-muted-aa` nos 21 usos — o valor acessível já
existe, já foi decidido, e só não foi aplicado fora do lugar que o teste guarda.

**3ª — Estado vazio escrito (nº 5) antes de promover as ofertas (nº 3).**
Esta ordem é deliberada e vou defender: promover 70 mil ofertas é a mudança de
maior impacto do documento, e depende de **decisão humana de licença** — que
não é minha nem do agente. Enquanto ela não vem, o estado vazio escrito entrega
metade do valor hoje, sem depender de ninguém: transforma 83 mil páginas que
hoje **escondem** a ausência em 83 mil páginas que a **declaram** — e uma página
que diz "ainda não confirmamos onde assistir no Brasil" responde à intenção de
busca, ainda que para dizer não.

---

## 12. O que NÃO determinei

| Item | Como fecha |
| --- | --- |
| Core Web Vitals reais (LCP, INP, CLS) de campo | CrUX ou RUM; medi TTFB, que não é LCP |
| Leitor de tela em uso real | Teste com NVDA/VoiceOver; verifiquei estrutura, não experiência |
| Se a faixa de mídia causa CLS medível | `PerformanceObserver` com `layout-shift` |
| Taxa de clique das listagens | Search Console / analytics |
| Aparência das fichas de temporada e episódio | Não abri `/pt/series/{slug}/temporadas/{n}/` nesta passagem |
| Se o hero da home tem o mesmo problema de imagem em celular | Medi na ficha; a home tem imagem de hero por construção |
