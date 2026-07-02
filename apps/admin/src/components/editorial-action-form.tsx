import type { ReactNode } from "react";

import type { ActionFeedback } from "../lib/editorial-action-policy";

/**
 * editorial-action-form.tsx — Componentes de UI das acoes editoriais (Fase 7A).
 *
 * Server Components puros de apresentacao (SEM `"use server"`, SEM acesso a banco,
 * SEM leitura de env, SEM rede). Recebem uma Server Action ja LIGADA ao id
 * (`updateArticleReviewStatus.bind(null, id)`) e a repassam a `<form action>`. A
 * escrita, a validacao e o gate da feature flag acontecem no servidor
 * (`editorial-actions.ts` + `editorial-action-policy.ts`).
 *
 * Ficam sob `apps/admin/src/components` (nao sob `apps/admin/app`) de proposito:
 * as PAGINAS permanecem declarativas (sem `<form>`/`<select>`/`<button>` cru), e a
 * unica superficie interativa fica isolada e revisavel aqui. Nao ha `<input>` nem
 * `<textarea>`: o id vai ligado por `.bind` e o valor vem de um `<select>` restrito
 * aos enums reais — logo nao existe edicao de titulo/slug/corpo/conteudo.
 */

/** Assinatura de uma Server Action ja ligada ao id do registro. */
export type BoundEditorialAction = (formData: FormData) => void | Promise<void>;

interface EditorialActionFormProps {
  /** Server Action ligada ao id (via `.bind(null, id)`). */
  readonly action: BoundEditorialAction;
  /** Nome do campo/`<select>` (ex.: `reviewStatus`, `indexStatus`). */
  readonly fieldName: string;
  /** Titulo do fieldset. */
  readonly legend: string;
  /** Valor atual (pre-seleciona a opcao). */
  readonly current: string;
  /** Valores permitidos (enum real do Prisma). */
  readonly options: readonly string[];
  /** Desabilita o controle (flag de acoes desligada). */
  readonly disabled: boolean;
  /** Texto de ajuda opcional. */
  readonly help?: string;
}

/**
 * Formulario minimo de UMA acao editorial: um `<select>` restrito aos enums reais
 * + botao "Aplicar". `disabled` desativa o fieldset inteiro (o servidor tambem
 * nega, defesa em profundidade). Sem `<input>`/`<textarea>` — nenhuma edicao de
 * texto livre e possivel.
 */
export function EditorialActionForm({
  action,
  fieldName,
  legend,
  current,
  options,
  disabled,
  help,
}: EditorialActionFormProps): ReactNode {
  const selectId = `field-${fieldName}`;
  return (
    <form action={action} className="admin-action-form">
      <fieldset className="admin-action-fieldset" disabled={disabled}>
        <legend className="admin-action-legend">{legend}</legend>
        <div className="admin-action-row">
          <label className="admin-action-label" htmlFor={selectId}>
            Novo valor
          </label>
          <select
            id={selectId}
            name={fieldName}
            className="admin-select"
            defaultValue={current}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button type="submit" className="admin-btn admin-btn--primary">
            Aplicar
          </button>
        </div>
        {help !== undefined ? <p className="admin-action-help">{help}</p> : null}
      </fieldset>
    </form>
  );
}

/**
 * Banner de feedback pos-acao (sucesso/erro). Recebe a projecao ja segura
 * (`ActionFeedback` — mensagem fixa em pt-BR), nunca payload cru. `null` -> nada.
 */
export function EditorialFeedbackBanner({
  feedback,
}: {
  readonly feedback: ActionFeedback | null;
}): ReactNode {
  if (feedback === null) return null;
  return (
    <p className={`admin-feedback admin-feedback--${feedback.tone}`} role="status">
      {feedback.message}
    </p>
  );
}

/**
 * Aviso persistente quando as acoes editoriais estao desativadas por ambiente.
 * Mostrado no topo das paginas de detalhe quando a flag nao esta `"true"`.
 */
export function EditorialActionsDisabledNotice(): ReactNode {
  return (
    <p className="admin-actions-disabled" role="note">
      <strong>Acoes editoriais desativadas por ambiente.</strong> Defina{" "}
      <code>ADMIN_EDITORIAL_ACTIONS_ENABLED=true</code> para habilitar a escrita editorial. Sem
      ela, o admin permanece navegavel em modo somente leitura.
    </p>
  );
}
