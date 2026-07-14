# Logos da marca Screen

Assets estáticos da marca pública **Screen** (`https://thescreen.media`), servidos
diretamente de `/brand/` pelo Next.js. A geometria usa o `viewBox 0 0 406 78` e
as coordenadas do HTML canônico 13v. A interface renderiza o wordmark por meio do
componente inline `ScreenLogo`, para que os glifos `<text>` usem a Montserrat
variável auto-hospedada sem qualquer import externo.

O wordmark é `SCR` + caixa + `N` = **SCREEN** (a caixa substitui o "EE").

## Arquivos

| Arquivo                        | Texto  | Caixa (acento)       | Uso                                             |
| ------------------------------ | ------ | -------------------- | ----------------------------------------------- |
| `screen-logo-black.svg`        | preto  | preta (neutra)       | **Header e superfícies claras** (padrão em uso) |
| `screen-logo-white.svg`        | branco | branca (neutra)      | Superfícies escuras                             |
| `screen-logo-cinema.svg`       | preto  | vermelha (`#F0443E`) | Vertical Filme, fundo claro — _armazenado_      |
| `screen-logo-series.svg`       | preto  | verde (`#7FA56F`)    | Vertical Série, fundo claro — _armazenado_      |
| `screen-logo-cinema-white.svg` | branco | vermelha             | Vertical Filme, fundo escuro — _armazenado_     |
| `screen-logo-series-white.svg` | branco | verde                | Vertical Série, fundo escuro — _armazenado_     |

## Regras

- Fundo claro → logo preta; fundo escuro → logo branca.
- Header/footer usam o componente inline; estes arquivos continuam disponíveis
  para metadata e superfícies que exigem URL de imagem.
- As variações cinema (vermelha) e série (verde) estão **armazenadas** para uma fase
  visual posterior. A diferenciação filme/série **nunca** depende só da cor
  (invariante 11): sempre acompanha label + badge + breadcrumb + schema + URL.
- Não converter para PNG nem hospedar externamente.
