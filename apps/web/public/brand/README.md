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

- **WEBP sem perda.** Os pixels visíveis são idênticos aos dos PNG entregues
  (conferido pixel a pixel na conversão); o arquivo cai para ~40%.
- **PNG só onde o formato importa.** `cinerie-logo.png` é a arte neutra preta sem
  recodificação: é ela que o JSON-LD `Organization` e o `publisher` das matérias
  apontam — raster, acima dos 112 px de altura mínima que o Google pede.
- **Onde cada cor aparece.** A "preta" vai na barra sólida e nas páginas claras;
  a "branca", na barra transparente sobre o hero (home, `/pt/filmes`,
  `/pt/series`, capa da matéria) e no rodapé escuro, que usa sempre a marca-mãe.

## A palavra "cinérie" tem o mesmo tamanho em toda área

A palavra ocupa 672 × 163 px em **todas** as artes; as de área têm 181 px de
altura porque a barra "/" passa 2 px acima e 16 px abaixo dela. O header fixa a
altura da **palavra** (`--brand-word-h`: 28 px no desktop, 24 no tablet, 20 no
telefone) e cada arte escala por `altura do arquivo ÷ 163`. A marca não muda de
tamanho ao trocar de seção. Travado por `src/lib/__tests__/brand-logos.test.ts`,
que lê os bytes.

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
