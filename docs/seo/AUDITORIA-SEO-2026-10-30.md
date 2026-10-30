# Auditoria de SEO de 30/10/2026 — com dados do Search Console

> **Fontes:** Google Search Console, propriedade de domínio `sc-domain:cinerie.com`,
> lido na conta do dono pelo Chrome em 30/10/2026 (Desempenho, Indexação,
> Sitemaps, Estatísticas de rastreamento, Inspeção de URL, Ações manuais,
> Segurança); produção (`https://cinerie.com`) medida por `fetch` do navegador
> na mesma data.
>
> **Marcação de evidência**, como nas auditorias anteriores: **MEDIDO**
> (observado), **LI** (lido no código ou no histórico), **INFERIDO** (deduzido).
>
> **Janela de dados do GSC:** 13/09 a 28/10/2026. A propriedade não tem dado
> anterior a 13/09.

---

## 1. Resumo em cinco linhas

1. **O tráfego orgânico caiu 88% em 26–27/09 e não voltou.** Antes,
   eram 450–900 impressões por dia, na posição 12–16. Depois, 15–160 por dia,
   na posição 45–65. Não há ação manual. As páginas continuam indexadas, mas
   perderam posição. A data bate com a **Spam Update de setembro de 2026** do
   Google (24/09 a ~08/10). (§2)
2. **91% do que o sitemap anuncia está fora do índice.** São 213.088 URLs
   enviadas e 19.328 indexadas. Outras 195.503 estão "detectadas, mas não
   indexadas", e dois terços delas são episódios. (§3)
3. **O Google rastreia ~360 URLs por dia, e 70% disso vai para descoberta.** A
   esse ritmo, uma passada no sitemap leva cerca de 590 dias. (§3)
4. **As notícias não existem para o Google.** São 3.956 matérias no sitemap.
   Só 3 tiveram impressão (20 no total), e uma matéria da amostra é
   "URL desconhecido". (§4)
5. **O técnico está certo.** Canonical, robots, JSON-LD por tipo, títulos,
   descrições, `noindex` das galerias e 404 estão corretos. O problema não é
   marcação; é **escala e valor percebido**. (§6)

---

## 2. A queda de 26–27/09

### 2.1 O que se vê

**MEDIDO** — série diária do relatório de Desempenho (cliques / impressões /
posição média):

| Período | Dias | Impressões | Por dia | Posição |
|---|---|---|---|---|
| 13/09 – 25/09 | 13 | 7.680 | ~590 | 11,7 – 16,5 |
| 26/09 | 1 | 173 | — | 13,5 |
| 27/09 – 28/10 | 32 | 2.220 | ~70 | 41 – 67 |

As páginas que lideravam **saíram das 1.000 primeiras** depois de 27/09:

| Página | 13–25/09 | 27/09–28/10 | Estado hoje |
|---|---|---|---|
| `/pt/filmes/possession/` | 420 imp., pos. 11,3 | — | `index` |
| `/pt/filmes/atraidos-pelo-destino/` | 272, pos. 8,6 | — | `index` |
| `/pt/filmes/clube-da-luta/` | 244, pos. 16,1 | — | `index`, **"O URL está no Google"** |
| `/pt/filmes/pendulum/` | 154, pos. 10,5 | — | `index` |
| `/pt/filmes/cegos-por-justica/` | 132, pos. 9,8 | — | `index` |
| `/pt/filmes/o-promotor/` | 99, pos. 10,9 | — | `index` |
| `/pt/filmes/resident-evil/` | 101, pos. 15,5 | 16, pos. 72,6 | `index` |

Das 55 páginas com mais impressões no trimestre, **49 seguem `index`** no site.
Elas foram rebaixadas, não removidas. A Inspeção de URL de
`/pt/filmes/clube-da-luta/` confirma que a página está indexada.

**MEDIDO** — *Ações manuais*: "Nenhum problema foi detectado". *Problemas de
segurança*: "Nenhum problema foi detectado".

### 2.2 O que aconteceu na mesma semana

| Data | Evento | Fonte |
|---|---|---|
| 22/09 | #320: temporadas e episódios voltam ao índice e ao sitemap por dado; pessoas com foto voltam ao índice | LI (`git log`) |
| 24/09 | **Google inicia a Spam Update de setembro de 2026**, global e em todos os idiomas | [Search Engine Land](https://searchengineland.com/google-releases-september-2026-spam-update-491267), [SER](https://www.seroundtable.com/google-september-2026-spam-update-42163.html) |
| 24/09 | #326: portão de relevância de filme e série, ligado de nascença | LI |
| 26–27/09 | **Queda** | MEDIDO |
| 28/09 | Site lento: claim da fila, `episodes.air_date` sem índice, contagem do sitemap empilhando (#329–#331) | LI |
| ~08/10 | Fim do rollout da Spam Update (13 dias e 16 h) | [SEO Kreativ](https://www.seo-kreativ.de/en/blog/google-september-2026-spam-update/) |
| 08/10 – 28/10 | Nenhuma recuperação | MEDIDO |

### 2.3 Leitura

**INFERIDO** — a explicação mais provável é um **rebaixamento algorítmico do
site inteiro pelo sistema de spam**. Três motivos:

- a queda atinge **páginas que continuam `index`** e que não mudaram — um ajuste
  nosso de `noindex` não derrubaria a posição delas;
- começa **dois dias depois** do início do rollout e **não volta** quando ele
  termina, o padrão de um classificador, não de uma instabilidade;
- o site tem o perfil que as Spam Updates miram como *scaled content abuse*:
  cerca de 213 mil páginas geradas de dado de terceiro, perto de 130 mil delas
  episódios com 130–145 palavras; e cerca de 25 notícias por dia de um autor
  só, reescritas com IA a partir de veículos estrangeiros. A recusa do AdSense
  por "conteúdo de baixo valor" em 13/10 aponta para o mesmo diagnóstico, por
  outro avaliador.

O que **não** se pode afirmar: que foi a Spam Update, e não a soma de
#320 + #326 + a lentidão de 28/09. O Google não diz qual sistema rebaixou um
site. A lentidão é a explicação mais fraca: durou dias e foi consertada,
enquanto a queda dura cinco semanas.

**O que o Google diz sobre a saída** (documentação de spam updates): a
recuperação vem quando os sistemas automáticos "aprendem, ao longo de meses",
que o site cumpre as políticas. Não há botão nem pedido de reconsideração para
rebaixamento algorítmico.

---

## 3. Indexação e orçamento de rastreamento

### 3.1 Placar do GSC (MEDIDO, 30/10)

| Estado | Páginas |
|---|---|
| **Indexadas** | **19.328** |
| Detectada, mas não indexada no momento | **195.503** |
| Excluída pela tag `noindex` | 15.533 |
| Não encontrado (404) | 817 |
| Rastreada, mas não indexada | 341 |
| Alternativa com canônica adequada | 124 |
| Redirecionamento | 15 |
| Erro no servidor (5xx) | 5 |
| Soft 404 | 1 |
| Cópia, Google escolheu outra canônica | 4 |

Sitemaps: `sitemap.xml` (índice, 26 arquivos) com **213.088** páginas encontradas,
lido em 30/10; `news-sitemap.xml` com 205, lido em 29/10. Os dois estão "Processado".

### 3.2 O que está "detectada, mas não indexada"

**MEDIDO** — amostra de 1.000 URLs que o GSC exibe para esse motivo:

| Tipo | Na amostra |
|---|---|
| Episódio (`…/temporadas/N/episodios/M/`) | **653** |
| Temporada | 55 |
| Ficha (filme, série, pessoa, notícia) | 282 |
| Raiz de seção | 10 |

O índice do sitemap tem **14 arquivos de episódio** (até 10 mil URLs cada),
contra 3 de filmes e 2 de séries.

### 3.3 Por que o Google não chega lá

**MEDIDO** — *Estatísticas de rastreamento* (90 dias):

- **32,5 mil** solicitações (~360 por dia), 459 MB, **779 ms** de resposta média;
- por finalidade: **70% descoberta**, 30% atualização;
- 98% respondem 200; Googlebot Smartphone em 91%.

**INFERIDO** — com ~360 rastreamentos por dia, ler os 213 mil URLs uma vez
leva **~590 dias**. "Detectada, mas não indexada" é o Google dizendo que viu o
link e decidiu não gastar uma visita com ele. Em domínio novo, sem autoridade e
com resposta lenta, a cota não cresce. Cada episódio no sitemap compete com
uma notícia ou uma ficha boa pelo mesmo orçamento.

---

## 4. Notícias

**MEDIDO:**

- `sitemap-pt-BR-news-1.xml`: **3.956** matérias;
- Desempenho (trimestre): **3 matérias** com impressão, **20 impressões** no total;
- Inspeção de `/pt/noticias/dog-fight-filme-ryu-hyunkyung/` (do meio do sitemap):
  **"O Google não reconhece o URL"** — sem rastreamento, sem página de referência;
- produção: a matéria responde 200, `index`, `NewsArticle` + `BreadcrumbList`,
  canonical própria, 920 palavras. Tecnicamente pronta.

**INFERIDO** — a área com mais texto próprio do site é a que o Google menos
vê. Isso vem do orçamento de rastreamento (§3.3) e do sinal de spam (§2.3), não
da marcação.

---

## 5. Portão de relevância × demanda medida

**MEDIDO** — das 55 páginas com mais impressões no trimestre, **6 hoje
respondem `noindex, follow`** pelo portão de 24/09 (316 impressões somadas):

`os-trapaceiros-de-garibaldi` (165, pos. 9,1) · `visoes-de-um-amor` (69, pos. 5,3 —
4 cliques) · `furia-vermelha` · `amor-e-seducao` (filmes) · `marie-antoinette` ·
`coracao-inimigo` (séries).

Fora dessa lista: `/pt/filmes/oeste-noroeste/` também responde `noindex`. Sua
galeria `/videos/`, sozinha, teve 267 impressões na posição 9 antes de 27/09.

**INFERIDO** — o portão mede país, votos e oferta BR, **não demanda de busca**.
É uma troca, não um erro: o portão encolhe a escala, e escala é o que a §2.3
aponta como risco. Uma exceção por demanda medida no GSC mudaria uma decisão
assinada pelo dono, então **fica com o dono**.

---

## 6. SEO técnico — o que está certo (VALIDADO)

**MEDIDO** em 26 URLs de produção (home, 6 filmes, 3 séries, temporada, 2
episódios, 2 pessoas, 2 notícias, 7 listagens/institucionais, 1 galeria, 1 404):

| Item | Resultado |
|---|---|
| Canonical | autorreferente em todas as páginas 200 |
| Meta robots | `index, follow, max-image-preview:large` nas indexáveis; `noindex, follow` na galeria e nas fichas barradas pelo portão |
| JSON-LD | `Movie`, `TVSeries`, `TVSeason`, `TVEpisode`, `Person`, `NewsArticle`, `CollectionPage`, `AboutPage`, `NewsMediaOrganization` + `WebSite` na home; `BreadcrumbList` em todas |
| `<title>` | 31–70 caracteres, com tipo e ano ("Clube da Luta (1999) — Filme \| Cinerie") |
| Meta description | 106–160 caracteres nas indexáveis |
| H1 | exatamente 1 por página |
| Galerias (D1) | `noindex, follow` — no ar e funcionando |
| URL inexistente | 404 com `noindex` |
| hreflang | ausente, correto (só pt-BR publicado) |
| GSC | HTTPS: 31 válidas, 0 inválidas; breadcrumbs: 29 válidos, 0 inválidos |

### 6.1 Ressalvas técnicas

| ID | Achado | Evidência | Peso |
|---|---|---|---|
| T1 | **801 dos 817 erros 404** são `/pt/filmes/<slug-de-série>/` (ex.: `drake-e-josh`, `kenan-e-kel`, `kodocha`). É o resíduo do bug do "Mais como este" consertado na #253 em 28/08: a página de referência citada pelo GSC (`/pt/series/sibling-prank-wars/`) não tem mais o link, mas o Google ainda revisita esses URLs (último rastreio em 23/10). | MEDIDO + LI | baixo |
| T2 | **A ficha de série não tem cache nenhum**: `private, no-store` e `cf-cache-status: BYPASS`. Ela é `force-dynamic` porque lê `?temporada=`. A ficha de filme sai com `s-maxage=300`. | MEDIDO + LI (`series/[slug]/page.tsx`) | médio |
| T3 | **Tempo de resposta (TTFB)**, medido do navegador: home 2,3 s; `/pt/filmes/` 2,4 s; `/pt/series/` 1,9 s; fichas 0,85–1,5 s. O GSC registra 779 ms em média para o Googlebot. | MEDIDO | médio |
| T4 | **Sitemaps-filho lentos quando não estão em cache**: filmes 15–16 s, séries 8 s, notícias 3 s; os **três de pessoas passaram de 60 s** e foram abortados. A medição foi interrompida para não pesar no banco. | MEDIDO | médio |
| T5 | O `robots.txt` agora começa com o bloco gerenciado da Cloudflare: são **dois grupos `User-agent: *`** com `Content-Signal` diferentes (`ai-train=no, use=reference` e `ai-input=yes, ai-train=no`). O Google funde os grupos, então nada útil está bloqueado; o sinal para IA é que fica ambíguo. | MEDIDO | baixo |
| T6 | Core Web Vitals no GSC: **"Nenhum dado"** nos dois dispositivos. O tráfego real é pequeno demais para o CrUX. | MEDIDO | — |

### 6.2 Conteúdo raso onde há demanda

**MEDIDO** — `/pt/filmes/possession/` teve 409 impressões para "possession 2027"
(posição 11), um lançamento de Parker Finn com Margaret Qualley. A página tem
**64 palavras**: nenhuma sinopse, "Ainda não temos notas externas", "Não
encontramos este título nos serviços…", elenco e ficha técnica. Episódios ficam
entre 130 e 145 palavras e pessoas em torno de 146.

---

## 7. Desempenho atual (trimestre, MEDIDO)

- **130 cliques**, 10,1 mil impressões, CTR 1,3%, posição média 23,3;
- Brasil: 7.714 impressões (76%); Portugal: 865; EUA: 201;
- marca: "cinerie" — 15 cliques, 26 impressões, posição 1,5;
- dos 130 cliques, 99 vêm de páginas de filme (fichas e galerias). Notícias: 1 clique;
- as consultas que trazem impressão são cauda longa de títulos ("o promotor",
  "garra de campeões", "visões de um amor elenco"). Há 67 consultas com
  "elenco", que somam 208 impressões.

---

## 8. Analytics

**Estado (LI):** o site não tem nenhuma ferramenta de análise. A Política de
Privacidade publicada afirma isso em três lugares: item 2 ("Não há Google
Analytics, Meta Pixel, Hotjar, Clarity ou qualquer script de rastreamento"),
item 3 ("não há nenhuma ferramenta de análise em funcionamento") e item 6
("Não há cookie de publicidade, de análise ou de rastreamento — e é por isso
que você não vê banner"). Instalar qualquer script sem mudar esse texto torna
a política falsa.

| Opção | O que dá | O que custa |
|---|---|---|
| **A. Analytics da borda da Cloudflare** (já existe) | requisições, visitantes únicos, páginas, países, bots × humanos — sem script e sem cookie | nada no site; exige login no painel (a sessão no Chrome expirou) |
| **B. Cloudflare Web Analytics** (beacon sem cookie) | páginas vistas, referências, **Core Web Vitals de campo** (o que o GSC não tem) | uma linha nova na Política (itens 2 e 3); CSP; decisão legal do dono sobre base legal sem cookie |
| **C. Google Analytics 4** com Consent Mode v2 | aquisição, engajamento, conversões, ligação com o GSC e com o futuro AdSense | reescrever itens 2, 3 e 6 da Política; **banner de cookies LGPD** para anônimos; CSP em `middleware.ts`; a finalidade "Análise de uso" passa a valer para visitante |

O que o GSC já entrega sem nenhuma dessas opções: busca, indexação e
rastreamento. É a fonte deste relatório.

---

## 9. Prioridades

### Com o dono (decisão humana obrigatória: indexação em massa, editorial, legal)

1. **Reduzir a escala para sair do sinal de spam.** Tirar episódios (e
   provavelmente temporadas) do índice e do sitemap pela válvula
   `suspended-pages.ts`. É a "primeira alavanca" que o dono registrou em
   13/10. Também devolve ao resto do site o orçamento de rastreamento que hoje
   vai para ~130 mil episódios (§3.3).
2. **Notícias: menos e mais próprias.** O padrão atual (cerca de 25 por dia, um
   autor, reescrita com IA de Variety e outros) é o alvo descrito das Spam
   Updates. Bio e foto do autor, apuração própria, fonte citada no corpo e
   volume menor pesam mais que quantidade.
3. **Portão de relevância × demanda** (§5): decidir se título com demanda
   medida no GSC ganha exceção ou se a regra fica como está.
4. **Analytics** (§8): escolher A, B ou C.

### Com código (o agente pode fazer em PR pequeno)

5. **T2** — dar a "Especiais" (temporada 0) uma rota própria, como o próprio
   comentário de `series/[slug]/page.tsx` descreve, para a ficha de série
   voltar a ter cache.
6. **T4** — os sitemaps de pessoas passam de 60 s sem cache: medir a consulta
   (`pg_stat_statements`) antes de mexer.
7. **T1** — 301 de `/pt/filmes/<slug>/` para `/pt/series/<slug>/` quando não
   existe filme com esse slug e existe série. Nunca adivinhar quando os dois
   existem (o caso `the-passage` de `routes.ts`).
8. **T5** — alinhar o `Content-Signal` do app com o bloco que a Cloudflare
   injeta, ou desligar o robots gerenciado na borda.

### O que medir para saber se está saindo

- a série diária de impressões e posição no Desempenho do GSC (a linha de
  base é ~590/dia na posição 12–16);
- "Detectada, mas não indexada" caindo e "Indexadas" subindo;
- matérias novas aparecendo na Inspeção de URL em até 48 h.
