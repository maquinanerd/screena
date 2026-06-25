"""Worker do Entity Writer (Screena — Fase 0 / esqueleto).

Responsabilidade
----------------
Motor editorial offline: gera `content_blocks` versionados a partir de um payload
CONTROLADO vindo do PostgreSQL, validados contra esse payload (anti-alucinacao),
nunca publicando sozinho. E o unico componente que aciona o cliente Gemini, e
SEMPRE offline (nunca no render).

Invariantes relevantes (NAO violar)
-----------------------------------
- Zero Gemini no render: a IA so gera content_blocks offline, salvos e validados.
- Entity Writer so escreve com base em payload controlado do PostgreSQL: nao
  inventa fatos, nao cria entidades, nao chama APIs externas, nao publica sozinho.
- content_blocks sao versionados e revisaveis: prompt_version, input_hash,
  output_hash, model_provider, model_name e review_status sao obrigatorios.
- Bloco gerado por IA so conta como valor se: veio de payload controlado; passou
  validacao anti-alucinacao; esta salvo em content_blocks; nao copia sinopse
  externa; review_status permitido.
- pt-BR publica primeiro; en/es nascem em draft/noindex ate revisao humana.

Status de job (entity_writer_jobs): queued, claimed, running, completed, failed,
blocked, cancelled.
Status de bloco (content_blocks.review_status): draft, ai_generated, needs_review,
human_reviewed, published, needs_update, blocked, archived.
Tipos de bloco: editorial_intro, summary_without_spoilers, ratings_explanation,
where_to_watch_text, cast_intro, similar_titles_intro, franchise_context,
season_guide, episode_context, faq, news_context, review_summary.

Periodicidades (referencia; agendadas via systemd timers no scheduler):
- Drenagem da fila de jobs: a cada 5-15 minutos.
- Re-geracao de blocos marcados needs_update: diaria.

LOOP DE PROCESSAMENTO (pseudocodigo — NAO implementado nesta fase)
------------------------------------------------------------------
    # 1. CLAIM: pega 1 job da fila com lock (queued -> claimed -> running).
    #    job = claim_next_job(status_in=["queued"])  # UPDATE ... RETURNING, sem corrida
    #    if job is None: return  # nada a fazer
    #
    # 2. PAYLOAD CONTROLADO: monta o input SOMENTE a partir do PostgreSQL.
    #    payload = build_controlled_payload(job.entity_type, job.entity_id, job.language_code)
    #    # contem apenas fatos ja persistidos (titulo, ano, elenco, ratings atribuidos,
    #    # onde assistir...). Nenhuma chamada externa aqui. Nenhuma sinopse externa copiada.
    #    input_hash = sha256(canonical_json(payload))
    #
    # 3. GERACAO (placeholder Gemini): chama o client de IA OFFLINE.
    #    # client é apenas placeholder na Fase 0 — sem rede.
    #    result = gemini_client.generate(
    #        prompt_version=PROMPT_VERSION,
    #        block_type=job.block_type,
    #        payload=payload,
    #    )
    #    output_hash = sha256(result.text)
    #
    # 4. VALIDACAO ANTI-ALUCINACAO: confere a saida contra o payload.
    #    warnings = validate_against_payload(result.text, payload)
    #    # detecta fatos nao presentes no payload, numeros inventados, entidades novas,
    #    # copia de sinopse externa. Se grave -> bloqueia.
    #    if warnings.is_blocking():
    #        save_block(review_status="blocked", warnings_json=warnings.to_json(), ...)
    #        set_job_status(job, "blocked")
    #        return
    #
    # 5. SALVAR BLOCO VERSIONADO: nunca publica automaticamente.
    #    save_content_block(
    #        entity_type=job.entity_type, entity_id=job.entity_id,
    #        language_code=job.language_code, block_type=job.block_type,
    #        content=result.text, source_type="ai",
    #        model_provider=result.model_provider, model_name=result.model_name,
    #        prompt_version=PROMPT_VERSION, input_hash=input_hash, output_hash=output_hash,
    #        review_status="needs_review",  # pt-BR vai p/ revisao; en/es nascem draft/noindex
    #        warnings_json=warnings.to_json(),
    #    )
    #
    # 6. ATUALIZAR STATUS: fecha o job (running -> completed) e registra log.
    #    set_job_status(job, "completed")
    #    write_log(entity_writer_logs, job_id=job.id, input_hash, output_hash, warnings)
    #    # publicacao e SEMPRE manual/humana — este worker nunca publica sozinho.

Nesta fase NAO ha client Gemini, nem acesso a banco, nem hashing real.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Versao do prompt usada nos blocos gerados (placeholder; versionado de verdade no futuro).
PROMPT_VERSION: str = "v0-fase0"


def main() -> None:
    """Ponto de entrada do Entity Writer.

    Fase 0: apenas registra que nao esta implementado. Nao faz rede, DB nem Gemini.
    Reforco: so escreve a partir de payload controlado do PostgreSQL, valida contra
    alucinacao e NUNCA publica sozinho.
    """
    logging.basicConfig(level=logging.INFO)
    logger.info("entity_writer_worker: Fase 0: nao implementado")


if __name__ == "__main__":
    main()
