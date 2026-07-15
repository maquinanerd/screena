# Logos da marca Screen

Assets estáticos da marca pública **Screen** (`https://thescreen.media`), servidos
diretamente de `/brand/` pelo Next.js. A geometria usa o `viewBox 0 0 406 78` e
as coordenadas do pacote canônico histórico.

O wordmark é `SCR` + caixa + `N` = **SCREEN** (a caixa substitui o “EE”).

## Estado após o reset visual

O header e o footer públicos usam apenas a marca textual `Screen`. Nenhum desses
SVGs é renderizado pelo chrome atual. `screen-logo-black.svg` continua referenciado
pela URL de logo no JSON-LD `Organization` da home; os demais assets ficam
armazenados enquanto o design final não for fornecido, sem definir por si só a
interface futura.

## Arquivos

| Arquivo                        | Texto  | Caixa                | Estado atual                       |
| ------------------------------ | ------ | -------------------- | ---------------------------------- |
| `screen-logo-black.svg`        | preto  | preta, neutra        | JSON-LD da home e asset disponível |
| `screen-logo-white.svg`        | branco | branca, neutra       | armazenado                         |
| `screen-logo-cinema.svg`       | preto  | vermelha (`#F0443E`) | armazenado                         |
| `screen-logo-series.svg`       | preto  | verde (`#7FA56F`)    | armazenado                         |
| `screen-logo-cinema-white.svg` | branco | vermelha             | armazenado                         |
| `screen-logo-series-white.svg` | branco | verde                | armazenado                         |

## Regras

- Não reintroduzir um logo complexo no shell neutro.
- Qualquer próximo uso visual depende de um design final aprovado e de escopo
  humano explícito; estes assets não autorizam reaproveitamento automático.
- A diferenciação filme/série nunca depende só da cor: deve continuar com label,
  badge, breadcrumb, schema e URL.
- Não converter para PNG nem hospedar externamente.
