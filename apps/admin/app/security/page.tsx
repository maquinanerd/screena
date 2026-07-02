import type { ReactNode } from "react";

import type { AdminEnvChecklistItem, AdminSecurityPosture } from "../../src/lib/access-protection";
import { getAdminSecurityDiagnostics } from "../../src/server/security";

/**
 * Pagina interna de SEGURANCA do admin (SOMENTE LEITURA).
 *
 * Mostra o diagnostico da protecao de acesso: ambiente detectado, se e
 * production-like, se a protecao e exigida, se foi explicitamente habilitada, se
 * as credenciais estao configuradas e o status final. Lista as env vars
 * necessarias apenas pelo NOME — nunca por valor.
 *
 * NUNCA exibe usuario, senha, header `Authorization`, tokens, `DATABASE_URL` nem
 * qualquer segredo. A leitura de `process.env` fica no helper server-only
 * `src/server/security`; esta pagina consome so a projecao redigida. Sem
 * formulario, sem login, sem acao de escrita. `force-dynamic`: le o ambiente em
 * cada request, nunca no build.
 */
export const dynamic = "force-dynamic";

function yesNo(value: boolean): string {
  return value ? "Sim" : "Nao";
}

/** Variante de badge da postura (a cor NUNCA e o unico sinal; sempre com rotulo). */
function postureBadgeVariant(posture: AdminSecurityPosture): "ok" | "info" | "blocked" {
  if (posture === "protected") return "ok";
  if (posture === "open") return "info";
  return "blocked";
}

interface DiagnosticRow {
  label: string;
  value: string;
}

function DiagnosticList({ rows }: { rows: DiagnosticRow[] }): ReactNode {
  return (
    <dl className="admin-security-list">
      {rows.map((row) => (
        <div className="admin-security-list__row" key={row.label}>
          <dt className="admin-security-list__term">{row.label}</dt>
          <dd className="admin-security-list__desc">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EnvChecklist({ items }: { items: readonly AdminEnvChecklistItem[] }): ReactNode {
  return (
    <ul className="admin-env-checklist">
      {items.map((item) => (
        <li className="admin-env-item" key={item.key}>
          <code className="admin-env-item__key">{item.key}</code>
          <span
            className={`admin-badge admin-badge--${item.present ? "ok" : "hold"}`}
          >
            {item.present ? "Configurada" : "Ausente"}
          </span>
          {item.sensitive ? (
            <span className="admin-env-item__note">sensivel — so presenca, nunca o valor</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function AdminSecurityPage(): ReactNode {
  const { config, requiredEnvKeys, editorialActions } = getAdminSecurityDiagnostics();

  const rows: DiagnosticRow[] = [
    { label: "Ambiente detectado", value: config.environmentLabel },
    { label: "E production-like?", value: yesNo(config.productionLike) },
    { label: "Protecao exigida?", value: yesNo(config.protectionRequired) },
    { label: "Protecao explicitamente habilitada?", value: yesNo(config.protectionExplicitlyEnabled) },
    { label: "Credenciais configuradas?", value: yesNo(config.credentialsConfigured) },
  ];

  const editorialRows: DiagnosticRow[] = [
    { label: "Acoes editoriais habilitadas?", value: yesNo(editorialActions.enabled) },
    { label: `${editorialActions.envKey} definida?`, value: yesNo(editorialActions.present) },
  ];

  return (
    <>
      <h2 className="admin-section-title">Segurança do Admin</h2>

      <p className="admin-notice">
        <strong>Modo somente leitura.</strong> Diagnostico da protecao de acesso deste admin.
        Nenhum segredo e exibido: nao aparecem usuario, senha, cabecalho de autenticacao,
        segredo de conexao do banco nem tokens — apenas o estado agregado e a presenca
        (nunca o valor) de cada variavel de ambiente.
      </p>

      <div className={`admin-security-status admin-security-status--${config.posture}`}>
        <span className="admin-security-status__caption">Status final</span>
        <span className={`admin-badge admin-badge--${postureBadgeVariant(config.posture)}`}>
          {config.postureLabel}
        </span>
      </div>

      <h3 className="admin-security-heading">Diagnostico de ambiente e protecao</h3>
      <DiagnosticList rows={rows} />
      <p className="admin-meta">
        Em ambiente production-like (producao/preview) a protecao e sempre exigida, mesmo sem
        ADMIN_PROTECTION_ENABLED. Se as credenciais faltarem em production-like, o admin
        responde 401 (nunca sobe aberto).
      </p>

      <h3 className="admin-security-heading">Acoes editoriais (escrita controlada)</h3>
      <p className="admin-meta">
        A escrita editorial (alterar review_status / index_status) so funciona com a flag
        habilitada, alem do Basic Auth em production-like. O valor da flag nunca e exibido — so o
        estado derivado.
      </p>
      <DiagnosticList rows={editorialRows} />

      <h3 className="admin-security-heading">Variaveis de ambiente necessarias</h3>
      <p className="admin-meta">
        Lista pelos NOMES ({requiredEnvKeys.length} variaveis de acesso). Valores nunca sao
        exibidos — apenas se estao configuradas.
      </p>
      <EnvChecklist items={config.envChecklist} />
    </>
  );
}
