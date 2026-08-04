# 07 — Typography System

Família **única: Montserrat** (`'Montserrat', sans-serif`) — 682 usos, zero outras (DD-07). Pesos reais: 800, 700, 650, 600, 500, 300 (usados) + 750; 900/400 quase sem uso (F-10, candidatos a remoção). Valores completos em `design-tokens.json → typography`.

## Consolidação: 41 tamanhos → 24 estilos nomeados
Meios-pixels (`8.5/9.5/10.5/11.5/12.5/13.5/14.5px`) são near-dupes e foram absorvidos (DD-06). A escala preserva os tamanhos de identidade reais (84 hero, 30 seção, 47 score).

| Estilo | size / weight / line-height | tracking / transform | Uso | Consolida |
|---|---|---|---|---|
| display-xl | 84 / 800 / 0.9 | -0.035em | hero home | — |
| display-lg | 56 / 800 / 1.05 | -0.035em | hero browse/institucional | — |
| display-md | 40 / 800 / 1.0 | -0.03em | destaque secundário | 38, 40 |
| heading-h1 | 34 / 800 / 1.05 | -0.03em | título de página | 32, 34 |
| heading-h2 (seção) | 26 / **1ª palavra 800–900 + resto 300–400** / 1.05 | -0.01em, UPPERCASE | título de seção (padrão real da home) | 30→26 |
| heading-h3 | 24 / 700 / 1.2 | — | subtítulo | 23, 24, 25 |
| heading-h4 | 19 / 800 / 1.25 | 0.18em UPPER | eyebrow de seção de detalhe | 19, 20 |
| title-lg | 22 / 750 / 1.25 | — | card destaque/notícia featured | 21, 22 |
| title-md | 18 / 700 / 1.3 | — | título de card grande | 17, 18 |
| title-sm | 16 / 700 / 1.35 | — | título de card | — |
| body-lg | 17 / 400 / 1.7 | — | corpo de artigo | — |
| body-md | 15 / 400 / 1.55 | — | corpo padrão | 14.5, 15, 16 |
| body-sm | 13 / 400 / 1.5 | — | corpo compacto | 13, 13.5 |
| label-lg | 14 / 700 / 1.2 | — | rótulo forte | 14, 14.5 |
| label-md | 13 / 600 / 1.2 | — | rótulo | — |
| label-sm | 12 / 600 / 1.2 | — | rótulo pequeno | 11.5, 12, 12.5 |
| metadata | 12 / 500 / 1.4 | cor text.secondary | data/autor/meta | — |
| caption | 11 / 500 / 1.5 | — | legenda | 10.5, 11 |
| eyebrow | 11 / 800 | 0.14em UPPER | rótulo de categoria | — |
| navigation | 13 / 700 | — | itens de nav | — |
| button | 14 / 700 | — | texto de botão | 13, 14 |
| badge | 10 / 800 | 0.1em UPPER | badge FILME/SÉRIE/rank | 9, 9.5, 10 |
| numeric-lg | 47 / 800 | -0.045em | Cinerie Score | — |
| numeric-md | 22 / 800 | -0.02em | nota de avaliação | — |

## Cabeçalho de seção (padrão real da home — referência)
A home usa um cabeçalho de seção de **duas pesagens em CAIXA ALTA**: a 1ª palavra em Montserrat 800–900 e o restante em 300–400, `26px`, `-0.01em`, `line-height 1.05`. Ex.: **DESTAQUES** de hoje · **POPULAR** essa semana. Sobre banda escura, a 1ª palavra fica branca sólida e o resto `rgba(255,255,255,0.88)`. É o `heading-h2` canônico (substitui a suposição anterior de 30px/800).

## Fluido vs. discreto (sem `clamp()` indiscriminado)
- **Fluido** (só 2): hero title e corpo de artigo já usam `clamp(18px,2vw,23px)` em um subtítulo — manter só onde o range é grande.
- **Discreto por breakpoint** (regra): todo o resto usa tamanhos fixos; no mobile, `display-xl` 84→ ~44-52, `heading-h2` 30→24, mantendo a hierarquia (definir na unidade de responsividade). Não converter tudo em `clamp`.

## Regras
- Peso: 800 (títulos/números), 700 (subtítulos/botão/rótulo forte), 600/650/750 (títulos de card/apoio), 500 (metadata), 400 (corpo), 300 (raro, texto grande leve).
- **Não** alterar conteúdo para caber na escala.
- Numerais grandes (score/nota) usam tracking negativo e `text.ink-deep`/cor de acento por contexto.
- Uppercase só em eyebrow/badge/heading-h4 (labels de seção), com letter-spacing ≥0.1em.
