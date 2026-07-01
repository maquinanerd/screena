# Logos da marca Screen

Assets estáticos da marca pública **Screen** (`https://thescreen.media`), servidos
diretamente de `/brand/` pelo Next.js. São SVGs locais e autocontidos — sem fontes
nem qualquer recurso externo (o `@import` do Google Fonts foi removido das versões
originais para respeitar a regra de "zero rede externa"; o wordmark cai no fallback
`Arial Black`/`Helvetica`/`Montserrat` local).

O wordmark é `SCR` + caixa + `N` = **SCREEN** (a caixa substitui o "EE").

## Arquivos

| Arquivo | Texto | Caixa (acento) | Uso |
| --- | --- | --- | --- |
| `screen-logo-black.svg` | preto | preta (neutra) | **Header e superfícies claras** (padrão em uso) |
| `screen-logo-white.svg` | branco | branca (neutra) | Superfícies escuras |
| `screen-logo-cinema.svg` | preto | vermelha (`--screena-movie-red`) | Vertical Filme, fundo claro — *armazenado* |
| `screen-logo-series.svg` | preto | verde (`--screena-series-green`) | Vertical Série, fundo claro — *armazenado* |
| `screen-logo-cinema-white.svg` | branco | vermelha | Vertical Filme, fundo escuro — *armazenado* |
| `screen-logo-series-white.svg` | branco | verde | Vertical Série, fundo escuro — *armazenado* |

## Regras

- Fundo claro → logo preta; fundo escuro → logo branca.
- As variações cinema (vermelha) e série (verde) estão **armazenadas** para uma fase
  visual posterior. A diferenciação filme/série **nunca** depende só da cor
  (invariante 11): sempre acompanha label + badge + breadcrumb + schema + URL.
- Não converter para PNG nem hospedar externamente.
