# Matriz de autorização de fontes — Cinerie

> Operacionaliza a [declaração de autorização](./source-replication-authorization.md).
> Cada linha corresponde a uma licença (`source_licenses`) e às decisões de uso
> (`data_usage_decisions`) que `pnpm legal sources apply` registra. `official` só
> para fonte/API oficial; `licensed` para autorização direta do titular;
> `third_party` para uso via fornecedor intermediário autorizado.
>
> **Responsável (decided_by):** Pablo Eduardo — proprietário da Cinerie
> **Motivo (reason):** Autorização de reprodução, armazenamento e exibição para
> finalidade informativa, editorial e jornalística, condicionada a créditos,
> linkback e disclaimers públicos.
>
> Operação (frescor, cache, retenção, território, por onde o dado entra):
> [`source-operations-inventory.md`](./source-operations-inventory.md).
> Desligar uma fonte: [`source-shutdown-runbook.md`](./source-shutdown-runbook.md).

> **Autorizado ≠ visível.** Uma licença permissiva não coloca dado na tela. A
> exibição ainda depende de decisão de uso vigente, território, frescor, crédito
> presente e promoção humana da linha.

> **REVOGAÇÃO — 13/08/2026 (decisão de Pablo Eduardo).** **Letterboxd e
> FilmAffinity deixaram de ser autorizadas para exibição**: `display_allowed` e
> `score_allowed` passaram a `não`, e a decisão `rating_display` das duas foi
> **removida** (só o armazenamento interno permanece). Elas já eram invisíveis na
> prática — não têm janela de frescor em `RATING_STALE_POLICY`, então
> `evaluateRatingFreshness` devolve `unknown-policy` —, mas a licença ainda
> autorizava o que nunca aconteceria, e isso produzia crédito público no rodapé
> para uma fonte que não aparece em lugar nenhum.
>
> **As linhas continuam na matriz e no `authorization-spec.ts` de propósito.**
> `planAuthorization` só visita o que está no spec: uma licença que some de lá
> nunca é superseder­ida e fica órfã e **vigente** no banco. Revogar é mudar o
> estado, não apagar o registro. A licença de julho foi superseder­ida
> (`is_current = false`), com histórico preservado.

## Licenças

| Fonte | Papel | source_key | content_type | license_status | território | armazenamento | exibição | score externo | atribuição | linkback | logo | review quote | uso derivado | policy version | observações |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TMDB (metadados) | catálogo | `tmdb` | `other` | official | global | sim | sim | n/a | sim | sim | **não** | **não** | **não** | `cinerie-source-auth/tmdb/2026-07-v1` | API oficial do TMDB; disclaimer literal no footer |
| TMDB (imagens) | catálogo | `tmdb` | `image` | official | global | sim | **não** | n/a | sim | sim | **não** | **não** | **não** | `cinerie-source-auth/tmdb/2026-07-v1` | imagens permanecem não exibíveis até decisão específica |
| IMDb | rating | `imdb` | `rating` | third_party | global | sim | sim | sim | sim | sim | **não** | **não** | **não** | `cinerie-source-auth/imdb/2026-07-v1` | via Film & Show Ratings API (RapidAPI) |
| Rotten Tomatoes | rating | `rotten_tomatoes` | `rating` | third_party | global | sim | sim | sim | sim | sim | **não** | **não** | **não** | `cinerie-source-auth/rotten-tomatoes/2026-07-v1` | via Film & Show Ratings API (RapidAPI) |
| Metacritic | rating | `metacritic` | `rating` | third_party | global | sim | sim | sim | sim | sim | **não** | **não** | **não** | `cinerie-source-auth/metacritic/2026-07-v1` | via Film & Show Ratings API (RapidAPI) |
| Letterboxd | rating | `letterboxd` | `rating` | third_party | global | sim | **não** | **não** | sim | sim | **não** | **não** | **não** | `cinerie-source-auth/letterboxd/2026-08-v2-revogada` | **EXIBIÇÃO REVOGADA em 13/08/2026**; sem decisão `rating_display`; atribuição segue obrigatória caso volte |
| FilmAffinity | rating | `filmaffinity` | `rating` | third_party | global | sim | **não** | **não** | sim | sim | **não** | **não** | **não** | `cinerie-source-auth/filmaffinity/2026-08-v2-revogada` | **EXIBIÇÃO REVOGADA em 13/08/2026**; sem decisão `rating_display`; atribuição segue obrigatória caso volte |
| Movie of the Night | streaming (agregador) | `movie-of-the-night` | `other` | third_party | BR | sim | **não** | n/a | sim | sim | **não** | **não** | **não** | `cinerie-source-auth/movie-of-the-night/2026-07-v1` | via Streaming Availability API (RapidAPI); atribuição no rodapé global (13/08/2026; antes junto ao painel) |
| Provedores de streaming | provedor canônico | *(slug real)* | `watch_availability` | third_party | BR | sim | sim | n/a | sim | sim | **não** | **não** | **não** | `cinerie-source-auth/2026-07-v1` | **dinâmico**: uma licença por provedor registrado em `watch_providers`; `source_key = slug`; zero enquanto não houver onboarding |

**Território das licenças de rating:** a licença é global (a autorização não é
territorialmente limitada); o **display** é gated a **BR** pela decisão
`rating_display` (ver abaixo). Uso global de display só quando a decisão for
registrada como global.

## Decisões de uso (`data_usage_decisions`)

| use_case | aplica-se a | stage | display | armazenamento | derivado | atribuição | linkback | território |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rating_display` | 5 fontes de rating | `approved_for_display` | sim | sim | **não** | sim | sim | **BR** |
| `watch_offer_display` | provedores registrados | `approved_for_display` | sim | sim | **não** | sim | sim | **BR** |
| `internal_analytics` | TMDB, ratings, Movie of the Night | `approved_for_internal_use` | não | sim | **não** | sim | sim | global/BR |
| `cinerie_score_display` | — | — | **NUNCA** | — | — | — | — | — |

`cinerie_score_display` **não é registrada por esta matriz**. O Cinerie Score é
obra derivada e permanece `BLOCKED_BY_DECISION` até haver fórmula aprovada +
decisão explícita (fora do escopo desta autorização).

## Garantias que o registro nunca viola

- **Nunca promove dado**: não liga `display_allowed` de nenhum rating ou oferta
  (isso é ato humano separado — `pnpm ratings promote` / `pnpm streaming`).
- **Nunca libera** logo, citação integral de crítica ou obra derivada.
- **Idempotente**: rodar `apply` de novo sem mudança no spec não escreve nada.
- **Histórico preservado**: cada reavaliação insere nova versão com
  `supersedes_id`; a licença-semente conservadora (Fase 1, `unknown`) é
  supersedida, nunca apagada.

Provado em PostgreSQL efêmero por
`validate:source-authorization-and-attribution` (18/18).
