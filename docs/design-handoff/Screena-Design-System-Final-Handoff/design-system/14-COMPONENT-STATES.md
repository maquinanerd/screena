# 14 — Component States

Estados canônicos por componente (D3B). Provados em `Components-Primitives-Navigation.dc.html`. Movimento por `21-MOTION.md` (`duration-fast` hover/pressed).

## Button (todos os estados)
| Estado | Tratamento |
|---|---|
| default | cor da variante |
| hover | escurecer ~8–10% (`accent.*-hover`); `duration-fast` |
| pressed | escurecer mais + `scale(0.99)`; `accent.*-pressed` |
| focus-visible | `outline 2px #101010 + offset 2px` |
| disabled | fundo `#E3DED6`, texto `#B7B0A5`, `cursor:not-allowed`, `aria-disabled` |
| loading | spinner à esquerda, largura estável, `aria-busy` |
| success (quando aplicável) | ícone check temporário, sem mudar largura |

## Link
default (cor da variante) · hover (`link-hover #F0443E` / sublinhado) · focus-visible (ring) · visited (só onde apropriado) · disabled (raro, semântico).

## IconButton
default · hover (fundo sutil) · pressed · **selected** (favorite/bookmark — cor de acento + `aria-pressed`) · focus · disabled.

## Toggle/Tabs
default · hover · **selected** (fundo+peso+indicador, não só cor; `aria-selected`/`aria-checked`) · focus (roving) · disabled.

## Header / Navigation
top (transparente sobre hero) · scrolled (sólida + `shadow-sticky-header`, `duration-slow`) · menu-open · search-open · account-open · **current** (`aria-current`) · mobile.

## MobileNavigation
closed · open (drawer + overlay) · focus-trapped · Escape→closed · reduced-motion (sem slide, fade curto).

## Search
empty · typing · loading · results · **zero-results** (estado digno, sem fabricar) · error.

## Cross-cutting (todo componente relevante)
long label · short label · icon-only · mobile · high zoom (200%) · reduced motion. **Não desenhar só o happy path.**

## Lacunas herdadas (P1 do D2, a resolver na migração/D3C)
- Cinerie Score sem estado vazio/indisponível (F-02) — pertence a D3C (conteúdo).
- Estados de dado (empty/partial/error) de cards/listas — D3C.


---

# Content States (D3C)

## Cards (Movie/Series/Person/Season/Episode)
default · hover · focus-within · **título longo** (clamp 2) · **metadata parcial** (omite ausentes) · **sem imagem** (fallback) · **skeleton**. Episode: + spoiler-hidden · future · watched (editorial vs. autenticado).

## CinerieScore (6)
available · insufficient_data · not_calculated · unavailable · blocked · **omitted (não renderiza)**. Proibido: mock · valor fixo · zero=ausência · “em breve” sem contrato.

## Streaming
available · region-unavailable · no-data. Sem inventar/inferir; disclaimer + data.

## Hero
default · **sem imagem (neutro claro, não escuro)** · parcial · loading.

## Formulários
default · hover · focus · filled · disabled · readonly · invalid · success · loading · autofill. Erro em texto (não só cor).

## Feedback / Overlays
Alert: info/success/warning/error(+dismissible). Modal/Drawer: open · closing · **focus-trapped** · Escape · retorno de foco. Toast: enter/visible/leaving. Empty/Error/Loading/Skeleton/Offline. Reduced-motion desativa shimmer/slide.

## Estados de produto (15)
unauthenticated · private · no-permission · spoiler-hidden · review pending/rejected/removed · content-moderated · license-blocked · region-blocked · partial-data · stale-data · item-removed · account-deactivated · email-unverified. Copy honesta, sem dado inventado.
