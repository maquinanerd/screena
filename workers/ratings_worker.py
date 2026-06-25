"""Worker de ratings externos (Screena — Fase 0 / esqueleto).

Responsabilidade
----------------
Coletar avaliacoes externas (IMDb, Rotten Tomatoes, Metacritic, Letterboxd,
FilmAffinity, etc.) por fornecedor tecnico e persistir em `external_ratings`,
sempre com atribuicao correta e respeitando licenca de exibicao.

Invariantes relevantes (NAO violar)
-----------------------------------
- IMDb != Rotten Tomatoes: nunca misturar fontes, escalas, icones ou linguagem.
  Nota IMDb nunca vira Tomatometer; Tomatometer/Popcornmeter pertencem so ao
  Rotten Tomatoes.
- provider_api != rating_source: o fornecedor tecnico (ex.: RapidAPI) NUNCA e a
  fonte editorial. `provider_api` registra o transporte; `rating_source` registra
  a fonte real (imdb, rotten_tomatoes, ...).
- display_allowed: rating com license_status unknown/blocked ou display_allowed=false
  NAO pode aparecer em pagina indexavel (decisao reforcada na leitura via source_licenses).
- Nada de AggregateRating fingindo nota propria; cada nota carrega attribution_text
  e attribution_url.
- API keys so em env vars; todo sync externo gera log (api_sync_logs).

Escalas canonicas (rating_scale):
- imdb=10, rotten_tomatoes=100, metacritic=100, letterboxd=5, filmaffinity=10.

Colunas-chave alvo em external_ratings:
- rating_source, rating_label, metric, rating_value, rating_scale, rating_count,
  rating_url, provider_api, provider_payload_hash, fetched_at, attribution_text,
  attribution_url, license_status, display_allowed.

Periodicidades (referencia; agendadas via systemd timers no scheduler):
- Titulos populares/quentes: a cada 12-24 horas.
- Catalogo geral: a cada 7 dias.

Nesta fase NAO ha cliente HTTP, nem acesso a banco, nem hashing real de payload.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def main() -> None:
    """Ponto de entrada do worker de ratings.

    Fase 0: apenas registra que nao esta implementado. Nao faz rede nem DB.
    Reforco: provider_api (transporte) jamais e tratado como rating_source (fonte),
    e nada e exibido sem display_allowed=true.
    """
    logging.basicConfig(level=logging.INFO)
    logger.info("ratings_worker: Fase 0: nao implementado")


if __name__ == "__main__":
    main()
