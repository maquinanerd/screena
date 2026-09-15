import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { VerticalBadge } from "../../../../../../src/components/ops/badges";
import { CostBox } from "../../../../../../src/components/ops/cost";
import { ForceTitleConfirmForm } from "../../../../../../src/components/ops/forms";
import { Stamp, Undetermined } from "../../../../../../src/components/ops/measured";
import { estimateTitleAction, FORCE_TITLE_ACTION_LABELS, FORCE_TITLE_ACTIONS, type ForceTitleAction } from "../../../../../../src/lib/ops/estimate";
import { parseEntityId, parseTitleSegment, SEGMENT_BY_KIND, titlePath } from "../../../../../../src/lib/ops/title-routes";
import { newRequestToken, opsActionsEnabled } from "../../../../../../src/server/ops/actions-flag";
import { opsDb } from "../../../../../../src/server/ops/db";
import { readOmdbSpentToday, readTitleIdentity, titleShapeOf } from "../../../../../../src/server/ops/titles";

/**
 * Confirmacao de UMA acao sobre um titulo, com o custo antes.
 *
 * O formulario so carrega qual acao e o nonce. Ao confirmar, o servidor refaz a
 * estimativa com o banco daquele instante, grava a auditoria e enfileira na mesma
 * transacao — ou grava a recusa, se a acao deixou de caber.
 */
export const dynamic = "force-dynamic";

const WHAT_HAPPENS: Readonly<Record<ForceTitleAction, string>> = {
  detalhe:
    "Enfileira um sync_details na prioridade 10 (a de quem espera na tela), pela porta única de cobertura, com escopo próprio desta confirmação: o job não colide com o que o agendador já enfileirou. Os filhos (mídia, temporadas, episódios) herdam o escopo e refazem a cascata. Quem executa é o screen-catalog-worker.",
  midia:
    "Enfileira um sync_media do título (imagens e vídeos) na prioridade 10, com escopo próprio desta confirmação. Quem executa é o screen-catalog-worker.",
  temporadas:
    "Enfileira um sync_seasons na prioridade 10, com escopo próprio: lista as temporadas, enfileira os episódios e a mídia de temporada e de episódio. Quem executa é o screen-catalog-worker.",
  nota:
    "Grava um pedido para o screen-cron rodar a consulta nominal da OMDb para este imdb_id (como leitor: usa a reserva do dia e para no teto). Um pedido aberto por título.",
  score:
    "Grava um pedido para o screen-cron recalcular o Cinerie Score só deste título, sobre as notas já gravadas. Sem rede, sem cota. Um pedido aberto por título.",
};

export default async function ForceTitlePage({
  params,
}: {
  params: Promise<{ tipo: string; id: string; acao: string }>;
}): Promise<ReactNode> {
  const { tipo, id: rawId, acao } = await params;
  const kind = parseTitleSegment(tipo);
  const id = parseEntityId(rawId);
  const action = (FORCE_TITLE_ACTIONS as readonly string[]).includes(acao) ? (acao as ForceTitleAction) : null;
  if (kind === null || id === null || action === null) notFound();

  const now = new Date();
  let identity;
  try {
    identity = await readTitleIdentity(opsDb(), kind, id);
  } catch {
    return (
      <>
        <h1 className="ops-page-title">Confirmar ação</h1>
        <p>
          <Undetermined reason="não foi possível ler o título no banco" />
        </p>
      </>
    );
  }
  if (identity === null) notFound();

  const omdbSpent = action === "nota" ? await readOmdbSpentToday(now) : null;
  const estimate = estimateTitleAction(action, titleShapeOf(identity), {
    spentToday: omdbSpent !== null && omdbSpent.ok ? omdbSpent.value : null,
  });
  const enabled = opsActionsEnabled();
  const token = newRequestToken();

  return (
    <>
      <p className="ops-stamp">
        <a href={titlePath(kind, id)}>← Ficha do título</a>
      </p>
      <h1 className="ops-page-title">
        <VerticalBadge kind={kind} /> {FORCE_TITLE_ACTION_LABELS[action]}
      </h1>
      <p className="ops-lede">
        {identity.ptTitle?.trim() || identity.originalTitle} · tmdb_id {identity.tmdbId}
        {identity.imdbId === null ? " · sem imdb_id" : ` · ${identity.imdbId}`}
      </p>
      <p>{WHAT_HAPPENS[action]}</p>

      <CostBox estimate={estimate} />
      {omdbSpent === null ? null : <Stamp source={omdbSpent.source} measuredAt={omdbSpent.measuredAt} />}

      {!enabled ? (
        <p className="ops-broken">As ações do painel estão desligadas (ADMIN_OPS_ACTIONS_ENABLED=false).</p>
      ) : estimate.refusal !== null ? (
        <p className="ops-muted">Sem botão: a ação não pode ser feita agora (motivo acima).</p>
      ) : (
        <ForceTitleConfirmForm
          segment={SEGMENT_BY_KIND[kind]}
          id={id}
          action={action}
          token={token}
          label={`Confirmar: ${FORCE_TITLE_ACTION_LABELS[action].toLowerCase()}`}
        />
      )}
    </>
  );
}
