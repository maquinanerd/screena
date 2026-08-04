# 23 — Data-Visual Contracts (D3C)

Descreve **necessidades e comportamentos visuais de dado** de cada componente — **não** é contrato de backend/schema. Fonte de verdade em `data-visual-contracts.json` (13 componentes: MovieCard, SeriesCard, PersonCard, NewsCard, Hero, CinerieScore, ExternalRating, StreamingAvailability, SeasonCard, EpisodeCard, ArticleHeader, AdSlot, RecommendationCard).

Cada contrato define: **required · optional · forbidden · fallback · omitWhen · loading · empty · error · partialData · provenance · licensing**.

## Princípios
- **required** mínimo para o componente existir (ex.: MovieCard = title+slug). Sem isso, o item **não entra na lista** (não vira card quebrado).
- **optional** enriquece; ausente → **omitido** (nunca “N/D”/placeholder).
- **forbidden** o que jamais pode ser exibido: nota mock, disponibilidade inventada, nota externa como Cinerie Score, anunciante fictício.
- **fallback** neutro e honesto (placeholder de mídia rotulado; avatar com iniciais; Score textual).
- **omitWhen** condição de não-renderização (Score `omitted`; AdSlot nunca colapsa).
- **provenance/licensing** origem do dado e direitos (posters/logos de terceiros; Cinerie Score é marca própria).

Ver `24-EMPTY-LOADING-ERROR-STATES.md` para os estados de carregamento/vazio/erro por família.
