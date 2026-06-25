"""Worker de "onde assistir" (Screena — Fase 0 / esqueleto).

Responsabilidade
----------------
Coletar a disponibilidade de cada titulo por pais (plataformas/provedores) e
persistir em `watch_availability`, sempre com data de atualizacao explicita e
apenas para destinos legais. Alimenta as rotas /pt/.../onde-assistir/.

Invariantes relevantes (NAO violar)
-----------------------------------
- Sem pirataria: nada de torrent, IPTV, player ilegal, link de download ou embed
  pirata. So plataformas/provedores oficiais e legais.
- "Atualizado em": toda informacao de disponibilidade carrega fetched_at e deve
  ser exibida com data ("Atualizado em ...") para nao enganar o leitor.
- Zero API externa no render: a pagina le apenas PostgreSQL/cache local.
- provider_api != rating_source: o fornecedor tecnico de dados de streaming e
  apenas transporte; nao e fonte editorial.
- Dados sem licenca clara nao aparecem em pagina indexavel.
- API keys so em env vars; todo sync externo gera log (api_sync_logs).

Periodicidades (referencia; agendadas via systemd timers no scheduler):
- Catalogo por pais: diario a cada 24 horas (disponibilidade muda com frequencia).
- Reconciliacao de plataformas/provedores: a cada 7 dias.

Nesta fase NAO ha cliente HTTP, nem acesso a banco, nem normalizacao por pais.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def main() -> None:
    """Ponto de entrada do worker de streaming/onde-assistir.

    Fase 0: apenas registra que nao esta implementado. Nao faz rede nem DB.
    Reforco: apenas destinos legais; cada registro guarda fetched_at para o
    rotulo "Atualizado em".
    """
    logging.basicConfig(level=logging.INFO)
    logger.info("streaming_worker: Fase 0: nao implementado")


if __name__ == "__main__":
    main()
