# SEO Programático — Screena

> APIs fornecem dados estruturados. **A Screena escreve a camada editorial.**
> Nenhuma página pública indexável é apenas um espelho de TMDB/IMDb/Rotten Tomatoes.

Este documento define como a Screena gera páginas em escala **com valor real**, sem cair em
_thin content_ nem em _index bloat_. Ele complementa:

- [`.claude/rules/seo.md`](../.claude/rules/seo.md) — regras operacionais de SEO;
- [`docs/ENTITY_WRITER.md`](./ENTITY_WRITER.md) — geração dos blocos editoriais;
- [`docs/RATING_ATTRIBUTION.md`](./RATING_ATTRIBUTION.md) — governança de ratings exibidos;
- [`packages/seo`](../packages/seo) — motor puro de indexabilidade e blocos de valor;
- [`seo/`](../seo) — ponte com as rotas Next (sitemap, robots, indexability).

---

## 1. Princípios inegociáveis

1. **Zero API externa no render** (invariante 3). Páginas indexáveis leem **apenas
   PostgreSQL/cache local**. TMDB, IMDb, Rotten, RapidAPI, Streaming Availability, RSSPRIME,
   MN26 e Gemini nunca são chamados em tempo de render.
2. **Zero Gemini no render** (invariante 4). Texto editorial vem de `content_blocks` já
   gerados, validados e versionados — nunca gerado on-the-fly.
3. **Gate anti-thin** (invariante 5). Página fina recebe `noindex`. Só indexa com **≥ 2 blocos
   de valor próprios** além do dado cru de API.
4. **Licença antes de exibir** (invariante 6). Dado com `license_status` `unknown`/`blocked` ou
   `display_allowed=false` não aparece em página indexável.
5. **pt-BR primeiro** (invariante 7). `/pt` publica no MVP; `/en` e `/es` nascem
   `draft`/`noindex` até revisão humana.
6. **Diferenciação nunca só por cor** (invariante 11). Filme/série se distinguem por
   **label + badge + breadcrumb + schema + URL**, além do acento de cor.

---

## 2. Arquitetura de URLs

Slugs são **por idioma**. O prefixo de idioma é sempre explícito.

### Rotas MVP (pt-BR)

```txt
/pt/filmes/
/pt/filmes/{slug}/
/pt/filmes/{slug}/onde-assistir/
/pt/filmes/{slug}/elenco/
/pt/filmes/{slug}/avaliacoes/
/pt/series/
/pt/series/{slug}/
/pt/series/{slug}/temporada-{number}/
/pt/series/{slug}/onde-assistir/
/pt/pessoas/{slug}/
/pt/streaming/netflix/melhores-filmes/
/pt/streaming/prime-video/melhores-filmes/
/pt/onde-assistir/{slug}/
/pt/noticias/{slug}/
```

### Rotas futuras (en) — nascem `draft`/`noindex`

```txt
/en/movies/{slug}/
/en/movies/{slug}/where-to-watch/
/en/movies/{slug}/cast/
/en/movies/{slug}/reviews/
/en/tv/{slug}/
/en/people/{slug}/
/en/streaming/netflix/best-movies/
/en/news/{slug}/
```

Regras de URL:

- um slug canônico por entidade/idioma, registrado em `slugs`;
- mudança de slug gera entrada em `redirects` (301), nunca quebra link;
- nada de parâmetros de tracking em URL canônica;
- vertical embutida na própria URL (`/filmes/` vs `/series/`) — reforça a invariante 11.

---

## 3. Gate anti-thin (o coração do programático)

Uma página de entidade **só pode ser indexável** se tiver dados estruturados confiáveis **e pelo
menos 2 blocos de valor próprios da Screena**. A decisão é calculada por
`evaluateIndexability()` em [`packages/seo/src/indexability.ts`](../packages/seo/src/indexability.ts).

### Blocos de valor aceitos

```txt
 1. introdução editorial própria
 2. onde assistir por país
 3. ratings externos atribuídos
 4. comparação crítica vs audiência
 5. review própria
 6. notícias relacionadas
 7. FAQ útil
 8. trailer incorporado
 9. elenco comentado
10. contexto de franquia
11. ordem cronológica
12. guia de temporadas
13. obras parecidas
14. histórico de atualização
15. análise sem/com spoiler separada
```

### Quando um bloco gerado por IA conta como valor

Um `content_block` produzido pelo Screena Entity Writer **só conta** como bloco de valor se:

- foi gerado a partir de **payload controlado** do PostgreSQL;
- passou pela **validação anti-alucinação**;
- está salvo em `content_blocks`;
- tem `prompt_version` e `input_hash`;
- **não copia literalmente** sinopse externa;
- está com `review_status` permitido.

### Combinações válidas (exemplos de ≥ 2 blocos)

```txt
editorial_intro + where_to_watch_text
editorial_intro + ratings_explanation
editorial_intro + faq
summary_without_spoilers + cast_intro
season_guide + faq
```

> Se a página tiver **apenas** título, pôster, sinopse de API, elenco e nota, ela permanece
> `noindex`.

---

## 4. Motor de indexabilidade

A decisão final é registrada em `page_indexability_decisions` e segue esta precedência
(implementada em `evaluateIndexability`):

| Ordem | Condição                                              | Decisão    | Invariante |
| ----- | ----------------------------------------------------- | ---------- | ---------- |
| 1     | Algum rating exibido com `display_allowed=false`      | `blocked`  | 6          |
| 2     | Idioma ≠ pt-BR/pt (MVP)                               | `draft`    | 7          |
| 3     | Structured data confiável **e** ≥ 2 blocos **e** thin baixo **e** review ok | `index` | 5 |
| 4     | Caso contrário                                        | `noindex`  | 5          |

Decisões possíveis: `index`, `noindex`, `draft`, `stale`, `blocked`.
(`stale` é resultado de invalidação posterior — ex.: dado de "onde assistir" envelheceu.)

Colunas relevantes de `page_indexability_decisions`: `decision`, `reason`,
`value_blocks_count`, `has_unique_intro`, `has_watch_data`, `has_ratings`, `has_news`,
`has_review`, `has_faq`, `has_trailer`, `thin_content_score`, `decided_at`.

---

## 5. Templates por tipo de entidade

Cada template combina dados estruturados + blocos editoriais + schema + sistema visual.
Detalhes de blocos/visual em [`seo/templates/README.md`](../seo/templates/README.md).

### Filme — acento **vermelho**, badge `Filme`, schema `Movie`

```txt
Title: {Movie Title}: onde assistir, elenco, trailer e avaliações
Meta:  Veja onde assistir {Movie Title}, elenco principal, trailer, avaliações
       externas e notícias relacionadas.
H1:    {Movie Title}
Blocos: Resumo · Onde assistir · Avaliações · Trailer · Elenco · Notícias · FAQ · Parecidos
Schema: Movie · BreadcrumbList · FAQPage (se houver FAQ real) · Review (se houver review própria)
```

### Série — acento **verde**, badge `Série`, schema `TVSeries`

```txt
Title: {TV Show}: temporadas, elenco, onde assistir e avaliações
Blocos: Resumo · Temporadas · Onde assistir · Avaliações · Elenco · Episódios recentes · Notícias · FAQ
Schema: TVSeries · BreadcrumbList · FAQPage
```

### Temporada — schema `TVSeason`

```txt
Title: {TV Show} temporada {Season Number}: episódios, elenco e onde assistir
Blocos: Resumo da temporada · Lista de episódios · Onde assistir · Elenco recorrente · Notícias · FAQ
Schema: TVSeason · BreadcrumbList · FAQPage (se houver FAQ real)
```

### Episódio — schema `TVEpisode`

```txt
Title: {Episode Title}: episódio {Episode Number} da temporada {Season Number} de {TV Show}
Blocos: Resumo sem spoiler · Data de exibição · Elenco · Contexto da temporada · Notícias
Schema: TVEpisode · BreadcrumbList
```

### Pessoa — neutro, schema `Person`

```txt
Title: {Person Name}: filmes, séries, carreira e notícias
Blocos: Biografia curta · Conhecido por · Filmografia · Notícias · Pessoas relacionadas
Schema: Person · BreadcrumbList
```

### Onde assistir — neutro

```txt
Title: Onde assistir {Title} online legalmente
Regra: nunca prometer disponibilidade que a API não confirmou. Usar
       "opções encontradas em [país]" + data de atualização ("Atualizado em").
       Apenas links legais — nunca torrent, IPTV, player pirata ou download.
```

---

## 6. Schema markup (JSON-LD)

| Página     | Schema principal                 |
| ---------- | -------------------------------- |
| Filme      | `Movie`                          |
| Série      | `TVSeries`                       |
| Temporada  | `TVSeason`                       |
| Episódio   | `TVEpisode`                      |
| Pessoa     | `Person`                         |
| Notícia    | `NewsArticle`                    |
| Todas      | `BreadcrumbList`                 |
| FAQ        | `FAQPage` **só se FAQ visível**  |
| Review     | `Review` (review própria)        |
| Home/Org   | `WebSite` / `Organization`       |

`AggregateRating`: **apenas quando permitido e corretamente atribuído**. Nunca usar para fingir
que uma nota externa (IMDb, Rotten, Metacritic) é nota própria da Screena. Preservar sempre
fonte, escala, URL, atribuição e data de coleta (ver `RATING_ATTRIBUTION.md`).

---

## 7. Sitemap, robots e canonical

- **Sitemap segmentado por idioma**, gerado **apenas do PostgreSQL/cache local**
  (`seo/sitemap.ts`). Regenerar após cada mudança de publicação.
- Incluir no sitemap **somente** URLs com decisão `index`. Páginas `draft`/`noindex`/`blocked`
  ficam de fora.
- **robots** (`seo/robots.ts`): bloqueia rotas de admin e parâmetros; nunca bloqueia recursos
  necessários ao render.
- **canonical**: uma URL canônica por entidade/idioma. Variações (`?sort=`, paginação) apontam
  para a canônica quando aplicável.
- **noindex** explícito em páginas finas, `draft` e listas de baixo valor.

---

## 8. Internacionalização e hreflang

- `hreflang` **apenas** quando a versão de destino estiver **publicada e revisada**.
- Não emitir `hreflang` para versões `draft`/`noindex`.
- **Sem redirect automático** de idioma em URL indexável: se a tradução não existe, retornar
  404 (ou exibir draft só no admin) — nunca redirecionar `/en/...` para `/pt/...` numa URL
  que o Google possa indexar.
- Cada idioma tem seu próprio `slug`, `meta_title`, `meta_description`, blocos e `index_status`.

Ver [`.claude/rules/i18n.md`](../.claude/rules/i18n.md).

---

## 9. Estratégia de rollout (evitar index bloat)

Publicação **gradual e monitorada**, nunca em massa:

```txt
50 entidades revisadas  →  100  →  300  →  escala
```

- Cada lote passa pelo gate anti-thin antes de entrar no sitemap.
- Acompanhar no **Google Search Console**: cobertura, páginas indexadas vs enviadas, _thin
  content_, canibalização e Core Web Vitals.
- Se um padrão de página gera muitas URLs finas, **pausar o padrão** e reforçar blocos de valor
  antes de continuar.
- Decisões de **indexação em massa exigem revisão humana** (ver `CLAUDE.md`/`AGENTS.md`).

---

## 10. Performance (impacta ranking e Discover)

Metas: **LCP < 2.5s · CLS < 0.1 · INP bom**.

- HTML renderizado no servidor (RSC) + ISR/`revalidate`; mínimo de JS no cliente.
- Imagem _hero_ com prioridade; lazy loading nas secundárias.
- Slots de anúncio com **altura reservada** (sem CLS); scripts de ads adiados.
- Sitemap e listas paginados; sem query pesada no render; sem dado externo no cliente para
  conteúdo essencial.

Ver [`docs/SPEC.md`](./SPEC.md) §Performance.

---

## 11. Checklist de indexabilidade (por página)

- [ ] Lê **apenas** PostgreSQL/cache local (zero API/Gemini no render).
- [ ] Tem **≥ 2 blocos de valor** próprios e válidos.
- [ ] Todo rating exibido tem `display_allowed=true` e atribuição correta.
- [ ] IMDb e Rotten **não** estão misturados; escalas e labels coerentes.
- [ ] Schema correto para o tipo; `FAQPage` só se FAQ visível; sem `AggregateRating` falso.
- [ ] Idioma pt-BR (ou versão revisada) para indexar; demais ficam `draft`.
- [ ] Diferenciação filme/série por label + badge + breadcrumb + schema + URL (não só cor).
- [ ] `canonical` correto; `hreflang` só para versões publicadas.
- [ ] Decisão registrada em `page_indexability_decisions` com motivo.
- [ ] Sem link de pirataria, torrent, IPTV ou player ilegal.
