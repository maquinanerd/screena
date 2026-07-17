# database/seeds

Seeds de dados de referencia da Cinerie. Este diretorio e historico; os seeds
reais atuais vivem em `packages/db/prisma/seed.ts` e `packages/db/src/seed-data.ts`
junto do schema Prisma e das migrations.

## Seeds atuais/planejados
- **languages** — idiomas suportados (pt-BR primeiro; en/es nascem em `draft`/`noindex`).
- **countries** — paises usados em disponibilidade (onde assistir) e i18n.
- **rating_sources** — fontes editoriais com escala canonica:
  imdb=10, rotten_tomatoes=100, metacritic=100, letterboxd=5, filmaffinity=10.
- **source_licenses** — estado de licenca por fonte (`license_status` e flags:
  `display_allowed`, `logo_allowed`, `score_allowed`, `review_quote_allowed`,
  `requires_attribution`, `requires_linkback`).

## Invariantes aplicaveis
- **IMDb != Rotten Tomatoes** — escalas e rotulos separados desde o seed.
- **provider_api != rating_source** — fornecedores tecnicos nao entram como fontes
  editoriais.
- **pt-BR primeiro** — `languages`/`countries` refletem a prioridade de publicacao.
- **Sem licenca clara, nao exibe** — `source_licenses` e a base do gate de exibicao.
