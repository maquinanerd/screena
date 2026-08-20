# Inventário operacional de fontes — Cinerie

> Complementa a [declaração de autorização](./source-replication-authorization.md)
> (o **porquê** jurídico) e a [matriz de autorização](./source-authorization-matrix.md)
> (o **quê** cada licença permite). Este documento é o **como operacional**:
> por onde o dado entra, quais campos alimenta, quanto tempo vale, em que
> território aparece, como é creditado e se participa de obra derivada.
>
> Escopo: apenas fontes com licença registrada. Fonte sem licença não aparece
> aqui porque não aparece em lugar nenhum.

## 1. Ratings (fontes editoriais)

Todas as 5 fontes chegam pela **Film & Show Ratings API (RapidAPI)** —
fornecedor **técnico**, nunca a fonte da nota (invariante 2). O crédito exibido
credita a fonte editorial; a palavra "RapidAPI" nunca aparece em página pública.

| Fonte | Escala | Contrato de entrada | Campos que alimenta | Território de exibição | Atribuição / linkback | Usa em score derivado |
| --- | --- | --- | --- | --- | --- | --- |
| IMDb | **10** | `api-clients/film_show_ratings` → `services/ratings` | `external_ratings.*` | **BR** (decisão `rating_display`) | obrigatórios | **não** |
| Rotten Tomatoes | **100** | idem | idem | **BR** | obrigatórios | **não** |
| Metacritic | **100** | idem | idem | **BR** | obrigatórios | **não** |
| Letterboxd | **5** | idem | idem | **BR** | obrigatórios | **não** |
| FilmAffinity | **10** | idem | idem | **BR** | obrigatórios | **não** |

Escalas nunca são convertidas entre fontes (invariante 1). `8,4/10` do IMDb e
`92/100` do Rotten Tomatoes convivem como medidas diferentes; valor e escala
sempre aparecem juntos na tela.

### Frescor e expiração (`RATING_STALE_POLICY`, `rating-stale/v1`)

Dois relógios distintos — passar do primeiro **não** tira a nota do ar:

| Fonte | `refreshAfterHours` (re-sync) | `expireAfterHours` (sai do ar) |
| --- | --- | --- |
| IMDb | 168 h (7 d) | 720 h (30 d) |
| Rotten Tomatoes | 168 h (7 d) | 720 h (30 d) |
| Metacritic | 336 h (14 d) | 1440 h (60 d) |
| **Letterboxd** | *(sem política)* | **nunca exibível** |
| **FilmAffinity** | *(sem política)* | **nunca exibível** |

> **Letterboxd e FilmAffinity estão licenciadas, mas permanecem INVISÍVEIS.**
> `evaluateRatingFreshness` classifica fonte sem janela declarada como
> `unknown-policy` → não exibível. Isso é deliberado: chutar uma janela seria
> fabricar uma afirmação de frescor. Ativá-las exige adicionar a janela em
> `RATING_STALE_POLICY` (decisão explícita, com bump de versão da política).
>
> Consequência prática: a licença autoriza, mas o produto ainda não exibe. Fonte
> pendente fica invisível **sem** precisar de kill switch — é o default.

### Cache e retenção

- Resposta crua em `api_cache` (worker-only), com `payload_hash`.
- Hash igual ao anterior ⇒ não reescreve a tabela final nem bumpa `updated_at`;
  só atualiza `last_synced_at` (ver `.claude/rules/ingestion.md`).
- `external_ratings.approved_payload_hash` guarda o *fingerprint aprovado*: se a
  nota muda (valor, votos, crédito…), o hash deixa de bater e o trigger derruba
  a exibição. **Mudança revoga aprovação.**

## 2. Onde assistir (streaming)

| Papel | Quem | Observação |
| --- | --- | --- |
| Agregador (fonte do dado) | **Movie of the Night** | crédito obrigatório **junto ao painel** |
| Fornecedor técnico | Streaming Availability API (RapidAPI) | nunca citado como fonte |
| Provedor canônico | linha real em `watch_providers` | uma licença por provedor; `source_key = slug` |

- **Território:** o painel público é **BR**. A leitura filtra `country_code='BR'`
  e exige decisão `watch_offer_display` cujo território cubra BR. Uma oferta
  plenamente licenciada e exibível em **outro país não vaza** para a página BR
  (provado no validador, check 18).
- **Expiração de oferta:** `available_until` no passado ⇒ oferta omitida.
- **Frescor:** carimbo "Atualizado em" derivado do `fetched_at` mais recente das
  ofertas realmente exibidas.
- **Zero pirataria:** só as 4 modalidades legais (assinatura/grátis/aluguel/
  compra) e `deep_link` http/https. `addon` e tipos desconhecidos são descartados.

## 3. Catálogo

| Fonte | Papel | Exibição | Crédito |
| --- | --- | --- | --- |
| TMDB (metadados) | catálogo, API oficial | sim | disclaimer literal no **footer** |
| TMDB (imagens) | catálogo, API oficial | **não** (`display_allowed=false`) | — |

## 4. Obra derivada (Cinerie Score)

**Autorizado pelo proprietário em 20/08/2026**
([`owner-authorization-2026-08-20.md`](./owner-authorization-2026-08-20.md)):
o spec emite a decisão `cinerie_score_display` (sob a licença do IMDb, base
`owner_decision`, fórmula aprovada `cinerie-score/2026-08-v1`). Em produção o
motor devolve `BLOCKED_BY_DECISION` **até o proprietário rodar o
`legal sources apply`** — registrar no spec não é ligar no banco. O piso de
duas fontes contadas continua regendo a exibição do número.

## 5. Onde cada gate mora

O produto tem **dois relógios independentes**, e nenhum substitui o outro:

| Camada | Onde | Dispara quando | Protege de |
| --- | --- | --- | --- |
| **Escrita** | triggers `external_ratings_display_guard_trg`, `watch_availability_display_guard_trg` | alguém escreve a linha | ligar `display_allowed` sem revisor, crédito, licença, decisão ou fingerprint |
| **Leitura** | `apps/web/src/server/entity-ratings.ts`, `entity-watch.ts` | a cada render | o **tempo passar** (decisão expira) e a **licença-mãe ser supersedida depois** — nenhum dos dois gera escrita na linha do dado |
| **Apresentação** | `ratings-presenter.ts`, `watch-availability-presenter.ts` | ao montar a view | exibir dado sem crédito (fail-closed por item) |

O trigger é a tranca da escrita; a leitura é o relógio. Um dado aprovado em
janeiro continua com `display_allowed = true` para sempre, porque o tempo passar
não é um `UPDATE` — só a leitura enxerga isso.
