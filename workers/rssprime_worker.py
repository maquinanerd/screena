"""Worker RSSPRIME (Screena — Fase 0 / esqueleto).

Responsabilidade
----------------
Consumir o upstream externo RSSPRIME como fonte de noticias, agrupar itens em
clusters (`news_clusters`) e ligar noticias a entidades existentes via
`entity_news_links`. Persiste em `articles` / `article_translations`. Alimenta
as rotas /pt/noticias/{slug}/.

Invariantes relevantes (NAO violar)
-----------------------------------
- NAO cria entidades: RSSPRIME so produz noticias e clusters; filmes/series/pessoas
  vem dos workers de catalogo (TMDB). Links de noticia apontam para entidades JA
  existentes; itens orfaos ficam sem entity link, nao geram entidade nova.
- Zero API externa no render: a pagina le apenas PostgreSQL/cache local.
- provider_api != fonte editorial: RSSPRIME e o transporte/upstream tecnico, nao a
  fonte editorial da Screena.
- pt-BR publica primeiro; en/es nascem em draft/noindex ate revisao humana.
- Dados sem licenca clara nao aparecem em pagina indexavel.
- API keys so em env vars; todo sync externo gera log (api_sync_logs).

Periodicidades (referencia; agendadas via systemd timers no scheduler):
- Coleta de feed RSSPRIME: a cada 15-30 minutos.
- Re-clusterizacao / deduplicacao: a cada 1-2 horas.

Nesta fase NAO ha cliente HTTP, nem parsing de feed, nem acesso a banco.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def main() -> None:
    """Ponto de entrada do worker RSSPRIME.

    Fase 0: apenas registra que nao esta implementado. Nao faz rede nem DB.
    Reforco: agrupa noticias em clusters e liga a entidades existentes, mas
    NUNCA cria entidades novas.
    """
    logging.basicConfig(level=logging.INFO)
    logger.info("rssprime_worker: Fase 0: nao implementado")


if __name__ == "__main__":
    main()
