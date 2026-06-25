"""Worker de ingestao TMDB (Screena — Fase 0 / esqueleto).

Responsabilidade
----------------
Buscar metadados de filmes, series, temporadas, episodios e pessoas a partir
do TMDB (via fornecedor tecnico, p.ex. RapidAPI/TMDB direto) e persistir no
PostgreSQL para que o Next leia apenas dados locais. NENHUMA chamada externa
acontece no render: este worker roda offline e popula o banco.

Invariantes relevantes
-----------------------
- Zero API externa no render: paginas indexaveis leem apenas PostgreSQL/cache local.
- provider_api != rating_source / fonte editorial: o fornecedor tecnico (RapidAPI/TMDB)
  e apenas o transporte; nunca vira "fonte" editorial nem nota propria.
- API keys so em env vars, nunca no frontend.
- Todo sync externo gera log (api_sync_logs).
- Dados sem licenca clara nao aparecem em pagina indexavel (gate na camada de leitura).

Periodicidades (apenas referencia; agendadas via systemd timers no scheduler):
- Titulos populares: diario.
- Catalogo completo / backfill: a cada 7-14 dias.
- Trending: a cada 6-12 horas.

Nesta fase NAO ha cliente HTTP, nem acesso a banco, nem normalizacao real.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def main() -> None:
    """Ponto de entrada do worker TMDB.

    Fase 0: apenas registra que nao esta implementado. Nao faz rede nem DB.
    """
    logging.basicConfig(level=logging.INFO)
    logger.info("tmdb_worker: Fase 0: nao implementado")


if __name__ == "__main__":
    main()
