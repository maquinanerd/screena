import type { ReactNode } from 'react'

import { HOME_PATH } from '../../src/lib/routes'

/**
 * LegalDoc — casca compartilhada dos documentos legais (/pt/termos, /pt/privacidade).
 *
 * Reusa a linguagem visual JA existente das telas claras de /pt: `container` +
 * `breadcrumb` do padrão de listagem (ver `app/pt/em-breve/page.tsx`) e uma
 * coluna de leitura de 720px equivalente à do corpo de matéria
 * (`.art-body`, globals.css:4040). Base CLARA: nenhum bloco escuro — o
 * `art-hero` da matéria é escuro de propósito e não serve aqui.
 *
 * A DATA DE VIGÊNCIA é campo próprio (`<time>` semântico no cabeçalho), nunca
 * enterrada no corpo do texto: é ela que define qual versão a pessoa aceitou.
 *
 * A VERSÃO exibida tem de ser a MESMA que o servidor grava em
 * `user_consent_records.policy_version` no aceite — senão o registro de
 * consentimento aponta para um texto diferente do que foi exibido, e a prova
 * de aceite perde o sentido. Ver `LEGAL_POLICY_VERSION`.
 *
 * Este arquivo é DECLARATIVO: só texto e marcação. Não importa nada da
 * plataforma de identidade — as referências abaixo são ponteiros de leitura
 * para humanos, nunca dependências (a guarda de render em
 * `tests/governance/user-platform-privacy.test.ts` proíbe o alcance real, e com
 * razão: arrastaria segredo de servidor para o bundle do navegador).
 */

/**
 * Versão dos documentos legais.
 *
 * Espelha `C7D_DEFAULTS.termsPolicyVersion` / `privacyPolicyVersion`
 * (em `auth-runtime/config.ts` do pacote de identidade), que é o valor gravado
 * em `user_consent_records.policy_version` quando as envs
 * `CINERIE_TERMS_POLICY_VERSION` / `CINERIE_PRIVACY_POLICY_VERSION` não estão
 * definidas.
 *
 * MUDOU O TEXTO? Suba esta constante E as duas envs, juntas. Trocar a versão
 * faz o painel de privacidade marcar `needsRenewal` e pedir novo aceite
 * (`auth-runtime/privacy-services.ts`, `currentPolicyVersion`).
 */
export const LEGAL_POLICY_VERSION = '2026-07'

/**
 * Marca um dado que só o controlador pode preencher (razão social, CNPJ,
 * endereço, e-mail do encarregado). Fica VISÍVEL de propósito: um rascunho que
 * esconde a lacuna vai ao ar com "[...]" invisível no meio de uma cláusula.
 */
export function Fill({ children }: { children: string }): ReactNode {
  return (
    <mark className="legal-fill" title="Pendente de preenchimento pelo controlador">
      [[PREENCHER: {children}]]
    </mark>
  )
}

export function LegalDoc({
  title,
  breadcrumbLabel,
  effectiveDate,
  children,
}: {
  readonly title: string
  readonly breadcrumbLabel: string
  /** Texto da data de vigência. `null` enquanto o documento não foi publicado. */
  readonly effectiveDate: string | null
  readonly children: ReactNode
}): ReactNode {
  return (
    <main data-vertical="legal">
      <div className="container" style={{ paddingTop: 36 }}>
        <nav aria-label="Trilha de navegação" className="breadcrumb">
          <ol>
            <li>
              <a href={HOME_PATH}>Início</a>
            </li>
            <li aria-current="page">{breadcrumbLabel}</li>
          </ol>
        </nav>
      </div>

      <article className="legal-body">
        <header className="legal-head">
          <h1 className="legal-title">{title}</h1>
          <dl className="legal-meta">
            <div className="legal-meta__row">
              <dt>Vigente desde</dt>
              <dd>
                {effectiveDate === null ? (
                  <Fill>data de vigência (definir na publicação)</Fill>
                ) : (
                  effectiveDate
                )}
              </dd>
            </div>
            <div className="legal-meta__row">
              <dt>Versão</dt>
              <dd>{LEGAL_POLICY_VERSION}</dd>
            </div>
          </dl>
        </header>
        {children}
      </article>
    </main>
  )
}
