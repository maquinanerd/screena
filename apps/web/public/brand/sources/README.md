# Marcas de fonte (`/brand/sources/`)

Arquivos de **marca de terceiros**, servidos como atribuição e identificação.

> Nada aqui é decorativo. Um arquivo só entra neste diretório quando a licença
> correspondente em [`authorization-spec.ts`](../../../../../services/legal/src/authorization-spec.ts)
> declara `logoAllowed: true` **e** aponta para ele — em `logoAsset.path`
> (logotipo) ou em `RATING_STATE_ICONS` (ícone de estado).

## Regra

1. **O arquivo é o que o detentor publica, ou o que o proprietário entregou** —
   nunca um redesenho ou aproximação. Marca distorcida é violação, não cortesia:
   o render é *fail-closed* — sem arquivo, o crédito sai só em texto e a ausência
   é registrada (`section_absent` / `source_logo_asset_missing`), nunca
   preenchida.
2. **O logo nunca substitui o crédito textual.** O crédito vive no rodapé global,
   sempre em texto; o logo vai ao lado dele.
3. **Nenhum SVG inline em componente.** A página lê o caminho declarado; ela não
   desenha marca de ninguém.

## Estado (2026-09-11)

| Arquivo | Fonte | Tipo | Situação | Onde aparece |
|---|---|---|---|---|
| `tmdb-primary.svg` | TMDB | palavra-marca | **no ar** desde 2026-08-20 (os termos **exigem** o logo) | rodapé |
| `imdb.webp` | IMDb | palavra-marca | **no ar** desde 2026-09-11 | chip da nota, rodapé |
| `metacritic.webp` | Metacritic | palavra-marca | **no ar** desde 2026-09-11 | chip da nota, rodapé |
| `rotten-tomatoes-fresh.webp` | Rotten Tomatoes | **ícone de estado** (*Fresh*) | **no ar** desde 2026-09-11, só com Tomatometer ≥ 60% | chip da nota, à esquerda do número |
| `rotten-tomatoes.svg` | Rotten Tomatoes | palavra-marca | **pendente** — o slot mostra "Rotten Tomatoes" em texto | — |
| `rotten-tomatoes-rotten.webp` | Rotten Tomatoes | ícone de estado (*Rotten Splat*) | **pendente** — nota < 60% sai sem ícone | — |
| `justwatch.svg` | JustWatch | palavra-marca | **pendente** — crédito em texto no rodapé | — |

Os três arquivos de 2026-09-11 foram entregues pelo proprietário (a mesma leva de
2026-08-21, reenviada com ordem expressa de publicar). Os bytes entraram **sem
recodificação**.

## Os arquivos entregues tinham extensão `.svg` e NÃO eram SVG

Cabeçalho `RIFF....WEBPVP8L`: são **WEBP raster** renomeados. Por isso entraram
como `.webp`, com `format: "webp"` na licença.
`tests/governance/brand-asset-format.test.ts` lê o cabeçalho e compara com o
declarado — formato **e** dimensões.

## Por que o tomate não ocupa o lugar do logotipo do Rotten Tomatoes

O arquivo entregue como `rotten-tomatoes.svg` não é a palavra-marca: é o **ícone
do tomate fresco**, o indicador de estado *Fresh* do Tomatometer. Ele **afirma**
que o título é Fresh — ao lado de um Tomatometer de 40%, diria ao leitor o
contrário do número (invariante 1).

> **Regra que entra e fica: ícone de estado nunca é marca.** Fresh, Rotten,
> Certified Fresh e Popcornmeter são indicadores de **resultado**. Eles vivem em
> `RATING_STATE_ICONS`, cada um com a faixa do valor em que é verdadeiro, e só
> aparecem quando o **valor real** cai na faixa — à esquerda do número, como o
> titular exige.

Desde 2026-09-11: nota ≥ 60% mostra o tomate; nota < 60% sai **sem ícone** até o
Rotten Splat oficial entrar — nunca com o tomate no lugar dele. A palavra-marca
do Rotten Tomatoes continua pendente: o slot do chip mostra o nome em texto.

## Condição gravada na licença — IMDb

O IMDb exige, em **qualquer** material que exiba a marca:

> IMDb, IMDb.COM, and the IMDb logo are trademarks of IMDb.com, Inc. or its
> affiliates.

Ela vive em `displayConditions` do asset e sai no **rodapé de toda página**
(`publicTrademarkNotices`), então está presente onde quer que o logo apareça.
**Condição não satisfeita = logo não acende.**

## Regras que valem para qualquer marca de terceiro

- **Nenhum SVG desenhado à mão.** Arquivo oficial/entregue ou palavra-marca em
  texto; nunca aproximação.
- **Altura e proporção respeitadas.** A altura vem da licença
  (`displayHeightPx`); a largura, da proporção do arquivo (`intrinsicSize`).
- **Nunca recolorir.** No rodapé escuro as marcas ficam sobre uma placa clara —
  quem se adapta é o fundo, nunca a marca.
- **O crédito textual permanece.** Logo não substitui atribuição.
