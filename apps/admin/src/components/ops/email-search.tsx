"use client";

import { useActionState, type ReactNode } from "react";

import { formatDateTimeBrt } from "../../lib/ops/format";
import { searchUserEmailsAction } from "../../server/ops-actions";
import type { EmailSearchResult } from "../../server/ops/users";

/**
 * email-search.tsx — A busca por e-mail. POST por Server Action.
 *
 * O termo nunca vai para a URL (historico, proxy, Referer) nem para log. O
 * resultado e limitado a 20 linhas: e uma busca, nao uma exportacao.
 */
export function EmailSearch(): ReactNode {
  const [state, formAction, pending] = useActionState<EmailSearchResult | null, FormData>(searchUserEmailsAction, null);
  return (
    <div>
      <form className="ops-form" action={formAction}>
        <label className="ops-field">
          Trecho do e-mail (enviado por POST; não vai para a URL)
          <input className="ops-input" type="search" name="termo" minLength={3} maxLength={120} autoComplete="off" />
        </label>
        <button className="ops-button" type="submit" disabled={pending}>
          {pending ? "Buscando…" : "Buscar"}
        </button>
      </form>
      {state === null ? null : state.ok ? (
        <div className="ops-table-wrap">
          <table className="ops-table" data-table="busca-email">
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Handle</th>
                <th>Status</th>
                <th>Verificado</th>
                <th>Cadastro</th>
                <th>Último login</th>
                <th>Última ação</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>nenhum usuário com esse trecho de e-mail</td>
                </tr>
              ) : (
                state.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.email}</td>
                    <td>{row.handle ?? "sem handle"}</td>
                    <td>{row.status}</td>
                    <td>{row.verified ? "sim" : "não"}</td>
                    <td className="nowrap">{formatDateTimeBrt(new Date(row.createdAt))}</td>
                    <td className="nowrap">{row.lastLoginAt === null ? "nenhum registrado" : formatDateTimeBrt(new Date(row.lastLoginAt))}</td>
                    <td className="nowrap">{row.lastActionAt === null ? "nenhuma registrada" : formatDateTimeBrt(new Date(row.lastActionAt))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {state.truncated ? <p className="ops-stamp">Mostrando as 20 mais recentes: refine o trecho.</p> : null}
        </div>
      ) : (
        <p className="ops-undetermined">{state.reason}</p>
      )}
    </div>
  );
}
