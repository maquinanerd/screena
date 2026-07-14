# Sistema de logo da cinerie

Assets oficiais da marca pública **cinerie**, sempre em minúsculas, recebidos no
arquivo `Cinerie logo system SVG.zip`. O Next.js os serve localmente em
`/brand/cinerie/`.

Todos os arquivos são SVGs autocontidos em outline/path. Nenhum logo usa
`<text>`, depende de fonte instalada, importa recurso externo ou contém
`@font-face`. A fonte especial usada na criação do desenho tipográfico existe
somente nas curvas vetoriais do logo.

## Arquivos

- `logo.svg`: wordmark neutro em `currentColor`, usado no JSON-LD da organização.
- `logo-cinema.svg`, `logo-serie.svg`, `logo-pessoas.svg` e
  `logo-noticias.svg`: wordmarks com acento por vertical.
- `favicon-movie.svg` e `favicon-series.svg`: favicons das rotas de filmes e séries.
- `variantes/5a-*.svg` a `variantes/5j-*.svg`: combinações prontas para
  superfícies claras e escuras, usadas pelo componente `CinerieLogo`.

## Tipografia

O logo não define a fonte da interface. Body, navegação, cards e demais textos
continuam usando Montserrat self-hosted por `@font-face`, com o WOFF2 e a OFL
preservados em `public/fonts/`. Gilroy não foi baixada nem adicionada como webfont.

## Regras de uso

- Usar os arquivos oficiais; não recriar o wordmark com `<text>`.
- Fundo claro usa variante preta; fundo escuro usa variante branca.
- A diferenciação por vertical nunca depende apenas da cor: label, badge,
  breadcrumb, schema e URL continuam obrigatórios.
- Não converter para PNG, hospedar externamente ou adicionar dependência de fonte.
