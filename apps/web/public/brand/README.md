# Marcas da Cinerie (`/brand/`)

Assets estáticos da marca pública **Cinerie** (`https://cinerie.com`), servidos
diretamente de `/brand/` pelo Next.js.

## As artes por área — entregues pelo proprietário em 2026-09-11

> "substitua as logos, para cada área do site" — Pablo Eduardo, proprietário,
> 2026-09-11.

O registro executável é [`apps/web/src/lib/brand-logos.ts`](../../src/lib/brand-logos.ts):
nenhum componente escreve caminho de marca à mão.

| Área | Rotas | Fundo claro ("preta") | Fundo escuro ("branca") | Dimensões |
|---|---|---|---|---|
| neutra | home, pessoas, explorar, onde assistir, legais… | `cinerie-wordmark-black.webp` | `cinerie-wordmark-white.webp` | 672 × 163 |
| filmes | `/pt/filmes/**` | `cinerie-wordmark-black-cinema.webp` | `cinerie-wordmark-white-cinema.webp` | 1376 × 181 |
| séries | `/pt/series/**` | `cinerie-wordmark-black-series.webp` | `cinerie-wordmark-white-series.webp` | 1430 × 181 |
| notícias | `/pt/noticias/**` | `cinerie-wordmark-black-news.webp` | `cinerie-wordmark-white-news.webp` | 1208 × 181 |
| Cinerie Score | cartão do Score, ficha da matéria | `cinerie-score.webp` (degradê, versão única) | — | 1156 × 163 |
| Organization (JSON-LD) | home e `publisher` das matérias | `cinerie-logo.png` | — | 672 × 163 |
| Cartão social (`og:image` de reserva) | página sem arte própria (decisão do dono D4) | `cinerie-social-card.png` | — | 1200 × 630 |

- **WEBP sem perda.** Os pixels visíveis são idênticos aos dos PNG entregues
  (conferido pixel a pixel na conversão); o arquivo cai para ~40%.
- **PNG só onde o formato importa.** `cinerie-logo.png` é a arte neutra preta sem
  recodificação: é ela que o JSON-LD `Organization` e o `publisher` das matérias
  apontam — raster, acima dos 112 px de altura mínima que o Google pede.
- **O cartão social é derivado, não desenhado.** `cinerie-social-card.png` é a
  `cinerie-logo.png` colada, sem escala nem recolor, no centro (x = 264, y = 233)
  de uma tela 1200 × 630 pintada de `#fdfdfd` (`--c-bg-page`, o fundo do site).
  Existe porque a palavra-marca sozinha não serve de `og:image`: 163 px de altura
  ficam abaixo do mínimo de 200 px do Facebook. Para regerar: Pillow,
  `Image.new("RGBA", (1200, 630), (253, 253, 253, 255))`, `alpha_composite` do
  logo nesse ponto, salvo em RGB.
- **Onde cada cor aparece.** A "preta" vai na barra sólida e nas páginas claras;
  a "branca", na barra transparente sobre o hero (home, `/pt/filmes`,
  `/pt/series`, capa da matéria) e no rodapé escuro, que usa sempre a marca-mãe.

## No header: a caixa do canônico (26 px de altura, largura por área)

Desde o handoff de 30/10/2026 o header segue o mapa `LOGO_W` do canônico: a
arte **inteira** mede 26 px de altura no desktop e a caixa tem **108** (neutra),
**200** (filmes), **208** (séries) e **176** px (notícias) de largura, com a
arte em `contain` ancorada à esquerda. Tablet e telefone mantêm a mesma
proporção de caixa a 24 e 22 px de altura (`--brand-h`). A palavra "cinérie"
ocupa 672 × 163 px em todas as artes e as de área têm 181 px de altura (a barra
"/"), então nas áreas a palavra fica ~10% menor — é o desenho aprovado. Até
30/10/2026 a regra era a oposta (altura da palavra fixa). Registro em
`src/lib/brand-logos.ts` (`CINERIE_HEADER_LOGO_BOX`), travado por
`src/lib/__tests__/brand-logos.test.ts`, que lê os bytes.

Os PNGs do handoff de 30/10/2026 (`design/assets/brand/*.png`) foram conferidos
pixel a pixel contra os WEBP desta pasta: **idênticos** (diferença máxima 0 em
RGB e alfa nas 9 artes). Por isso não foram copiados de novo.

## Regras

- A diferenciação filme/série **nunca** depende só da marca: rota, breadcrumb,
  badge, label e schema continuam carregando o sinal (invariante 11).
- Nenhuma arte é redesenhada, recolorida ou esticada: altura fixa, largura
  automática.
- Trocar uma arte = substituir o arquivo **e** as dimensões em `brand-logos.ts`
  na mesma mudança (o teste reprova se divergirem).

## Histórico

Até 2026-09-11 esta pasta tinha um wordmark **textual provisório** (`CINERIE` em
Montserrat 900, SVG), criado no rebranding do Gate 1.5 enquanto não havia arte.
Ele foi removido quando as artes definitivas entraram.

## Marcas de terceiros

Cada uma declarada pela própria licença, em pastas próprias:
[`sources/`](./sources/README.md) (fontes de nota e de catálogo) e
[`providers/`](./providers/README.md) (serviços de streaming).
