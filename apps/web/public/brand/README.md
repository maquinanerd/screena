# Logos da marca Cinerie

Assets estáticos da marca pública **Cinerie** (`https://cinerie.com`), servidos
diretamente de `/brand/` pelo Next.js.

## ⚠️ Wordmark PROVISÓRIO — precisa de design

Os SVGs atuais são um wordmark **textual puro**: `CINERIE` em Montserrat 900,
sem nenhum dispositivo visual. Isso é deliberado.

O logo anterior era `SCR` + caixa + `N` = **SCREEN**, onde a caixa substituía o
“EE” e representava uma tela. Esse trocadilho **era a palavra “Screen”**: não
existe equivalente para “Cinerie”, e inventar um novo símbolo é trabalho de
design, não de rebranding. O Gate 1.5 renomeia a marca; ele não desenha uma.

Portanto: **estes arquivos são um substituto honesto e temporário**, não a
identidade final. Qualquer uso visual destacado depende de um logo aprovado por
um designer e de escopo humano explícito.

Robustez: o texto usa `textLength` + `lengthAdjust="spacing"`, então o wordmark
ocupa exatamente o `viewBox` mesmo quando a Montserrat não carrega — sem quebra
de layout por fallback de fonte.

## Estado após o reset visual

O header e o footer públicos usam apenas a marca textual `Cinerie`. Nenhum
desses SVGs é renderizado pelo chrome atual. `cinerie-logo-black.svg` continua
referenciado pela URL de logo no JSON-LD `Organization` da home; os demais ficam
armazenados enquanto o design final não for fornecido.

## Arquivos

| Arquivo                   | Cor do wordmark      | Estado atual                       |
| ------------------------- | -------------------- | ---------------------------------- |
| `cinerie-logo-black.svg`  | `#111111`            | JSON-LD da home e asset disponível |
| `cinerie-logo-white.svg`  | `#ffffff`            | armazenado (fundos escuros)        |
| `cinerie-logo-cinema.svg` | vermelho (`#F0443E`) | armazenado (acento filme)          |
| `cinerie-logo-series.svg` | verde (`#7FA56F`)    | armazenado (acento série)          |

As variantes `-cinema-white` / `-series-white` **deixaram de existir**: elas só
faziam sentido no logo antigo, onde o texto ficava branco e a COR vivia na
caixa. Sem a caixa, elas seriam idênticas às variantes de acento — dois arquivos
distintos com o mesmo conteúdo. O acento agora colore o próprio wordmark.

## Regras

- Não reintroduzir um logo complexo no shell neutro.
- Qualquer próximo uso visual depende de um design final aprovado e de escopo
  humano explícito; estes assets não autorizam reaproveitamento automático.
- A diferenciação filme/série nunca depende só da cor: deve continuar com label,
  badge, breadcrumb, schema e URL.
- Não converter para PNG nem hospedar externamente.
