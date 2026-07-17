# Checklist de revisão de fonte de dados (licença)

> Guia para a **decisão humana** de licença que autoriza exibir dado de terceiro
> (nota, oferta de streaming, e — quando existir — o Cinerie Score). Este
> documento **não** decide nada sozinho, e nenhum agente decide por ele: a
> licença é sempre decisão de uma pessoa. Marca: Cinerie.

O sistema é **fail-closed**: sem uma decisão completa e vigente, o dado fica no
banco (auditável) e **nunca** aparece em página indexável (invariante 6). Este
checklist é o que precisa ser verdadeiro **antes** de registrar a decisão.

## Workflow do dado

```
raw → recognized → normalized → license_pending
    → approved_for_internal_use → approved_for_display → revoked
```

Os quatro primeiros estágios são do **dado** (ainda não há decisão). Os três
últimos são **decisões** registradas em `data_usage_decisions`. `revoked` é
terminal: reavaliar **insere** nova decisão (histórico imutável), nunca reabre a
antiga.

## Antes de aprovar exibição (`approved_for_display`)

Verifique **cada item**. Qualquer "não" bloqueia a exibição.

### Licença da fonte (`source_licenses`)

- [ ] `license_status ∈ {official, licensed, third_party}` (nunca `unknown`/`blocked`).
- [ ] `display_allowed = true`.
- [ ] Se vamos exibir o **número**: `score_allowed = true`.
- [ ] Se vamos exibir o **logo**: `logo_allowed = true` (senão, nome em texto).
- [ ] Se vamos **citar crítica**: `review_quote_allowed = true`.
- [ ] Atribuição: se `requires_attribution`, há `attribution_text`.
- [ ] Linkback: se `requires_linkback`, há `attribution_url` (HTTPS).
- [ ] `decided_by` é uma **pessoa** (nunca "agent"/"system").
- [ ] `policy_version` registrada.

### Decisão de uso (`data_usage_decisions`)

- [ ] `use_case` correto (`rating_display`, `watch_offer_display`,
      `cinerie_score_display`, `internal_analytics`).
- [ ] `stage = approved_for_display` para exibir.
- [ ] A decisão **não concede mais que a licença-mãe** — o trigger
      `data_usage_decisions_guard` recusa conceder `display` além do que
      `source_licenses` permite, extrapolar território ou afrouxar
      atribuição/linkback. Se o trigger recusou, a licença não permite; corrija
      a licença, não a decisão.
- [ ] Território cobre o público-alvo (BR no MVP; `null` = global).
- [ ] Vigência (`valid_from`/`valid_until`) confere.
- [ ] Para **Cinerie Score**: `derivative_allowed = true` (é obra derivada) e a
      decisão de produto existe (ver
      [cinerie-score-decision](../product/cinerie-score-decision.md)).

### Integridade da fonte (invariantes 1 e 2)

- [ ] A escala é a canônica da fonte (nunca reescalada).
- [ ] O rótulo pertence à fonte (nada de Tomatometer no IMDb).
- [ ] `provider_api` (fornecedor técnico) ≠ `rating_source` (fonte editorial).
- [ ] Sem `AggregateRating` fingindo nota própria.

### Anti-pirataria (invariante 8)

- [ ] Nenhum link/embed de torrent, IPTV, player ilegal ou download.
- [ ] "Onde assistir" só lista disponibilidade legal/licenciada.

## Fontes e o estado de cada uma (a preencher pela revisão)

| Fonte | Tipo | `license_status` hoje | Observações |
| --- | --- | --- | --- |
| IMDb | rating | `unknown` (seed seguro) | licença **não confirmada**; nada exibível |
| Rotten Tomatoes | rating | `unknown` | Tomatometer/Popcornmeter só do RT |
| Metacritic | rating | `unknown` | Metascore = crítica; User Score = público |
| Letterboxd | rating | `unknown` | sem política de frescor declarada |
| FilmAffinity | rating | `unknown` | sem política de frescor declarada |
| _(provedores de streaming)_ | watch_availability | `unknown` | licença por provedor + território |

> Todas nascem `unknown` por construção (seed seguro). Mudar qualquer linha para
> um status exibível é **decisão humana registrada** — nunca inferência de
> agente, nunca efeito colateral de sync.

## Registro da decisão

A decisão vive em `data_usage_decisions` (e a licença em `source_licenses`), com
histórico `is_current`/`supersedes_id`. Não editar a linha antiga: **inserir**
uma nova e apontar `supersedes_id` para a anterior (o guard exige mesmo grupo).
