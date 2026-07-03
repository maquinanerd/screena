import type { ReactNode } from "react";

import type {
  StagingCheck,
  StagingCheckStatus,
  StagingSection,
} from "../../src/lib/staging-readiness";
import { stagingStatusLabel } from "../../src/lib/staging-readiness";
import { getStagingReadiness } from "../../src/server/staging-readiness";

/**
 * Pagina interna de PRONTIDAO DE STAGING (/staging). SOMENTE LEITURA.
 *
 * Checklist operacional (pt-BR) para preparar a validacao do fluxo editorial com
 * dados reais controlados em staging: ambiente, protecao do admin, escrita
 * editorial, banco (contagens agregadas), fluxo editorial e seed controlado.
 *
 * NUNCA exibe segredo: sem usuario, senha, cabecalho de autenticacao, segredo de
 * conexao do banco nem tokens — apenas estados agregados e presenca. A leitura de
 * env fica no helper server-only `src/server/staging-readiness`; esta pagina so
 * consome a projecao segura. Sem formulario, sem controle de entrada, sem acao de
 * escrita: o seed NAO roda pela UI. `force-dynamic`: le o ambiente a cada request.
 */
export const dynamic = "force-dynamic";

/** Mapeia o status para a variante de badge existente (cor nunca e o unico sinal). */
function badgeVariant(status: StagingCheckStatus): "ok" | "info" | "hold" | "blocked" {
  switch (status) {
    case "ok":
      return "ok";
    case "info":
      return "info";
    case "warn":
      return "hold";
    case "fail":
      return "blocked";
  }
}

const SECTION_TITLES: Record<Exclude<StagingSection, "flow">, string> = {
  environment: "1. Ambiente",
  protection: "2. Protecao do admin",
  editorial: "3. Escrita editorial",
  database: "4. Banco (somente leitura)",
  seed: "6. Seed controlado",
};

function CheckList({ checks }: { checks: readonly StagingCheck[] }): ReactNode {
  return (
    <dl className="admin-security-list">
      {checks.map((check) => (
        <div className="admin-security-list__row" key={check.id}>
          <dt className="admin-security-list__term">
            <span className={`admin-badge admin-badge--${badgeVariant(check.status)}`}>
              {stagingStatusLabel(check.status)}
            </span>{" "}
            {check.label}
          </dt>
          <dd className="admin-security-list__desc">{check.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionBlock({
  section,
  checks,
}: {
  section: Exclude<StagingSection, "flow">;
  checks: readonly StagingCheck[];
}): ReactNode {
  const rows = checks.filter((c) => c.section === section);
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="admin-security-heading">{SECTION_TITLES[section]}</h3>
      <CheckList checks={rows} />
    </>
  );
}

const FLOW_LINKS: ReadonlyArray<{ href: string; label: string; hint: string }> = [
  { href: "/security", label: "Seguranca", hint: "Ambiente, protecao e credenciais (sem secrets)." },
  { href: "/review-queue", label: "Fila de revisao", hint: "Bloqueados, pendentes e prontos para indexar." },
  { href: "/workflow", label: "Workflow", hint: "Revisar, indexar e aprovar em lote pequeno." },
  { href: "/qa", label: "QA editorial", hint: "Score, criticos, cobertura e slugs duplicados." },
];

export default async function AdminStagingPage(): Promise<ReactNode> {
  const { report, environmentLabel, nodeVersionMajor, database, seed } =
    await getStagingReadiness();

  return (
    <>
      <h2 className="admin-section-title">Prontidao de staging</h2>

      <p className="admin-notice">
        <strong>Modo somente leitura.</strong> Checklist para validar o fluxo editorial com dados
        reais controlados em staging — sem abrir ratings, streaming ou ingestao. Nenhum segredo e
        exibido (nem usuario, senha, cabecalho de acesso, segredo de conexao do banco ou tokens):
        apenas estados agregados e presenca. O seed NAO roda por esta pagina.
      </p>

      <div className={`admin-security-status admin-security-status--${report.overall}`}>
        <span className="admin-security-status__caption">Status geral</span>
        <span className={`admin-badge admin-badge--${badgeVariant(report.overall)}`}>
          {stagingStatusLabel(report.overall)}
        </span>
        <span className="admin-flag__note">{report.summary}</span>
      </div>

      <dl className="admin-security-list">
        <div className="admin-security-list__row">
          <dt className="admin-security-list__term">Fluxo editorial</dt>
          <dd className="admin-security-list__desc">{report.flowLabel}</dd>
        </div>
        <div className="admin-security-list__row">
          <dt className="admin-security-list__term">Postura do seed</dt>
          <dd className="admin-security-list__desc">{report.seedPostureLabel}</dd>
        </div>
        <div className="admin-security-list__row">
          <dt className="admin-security-list__term">Ambiente</dt>
          <dd className="admin-security-list__desc">
            {environmentLabel} · Node {nodeVersionMajor ?? "desconhecido"}
          </dd>
        </div>
      </dl>

      <SectionBlock section="environment" checks={report.checks} />
      <SectionBlock section="protection" checks={report.checks} />
      <SectionBlock section="editorial" checks={report.checks} />
      <SectionBlock section="database" checks={report.checks} />

      {database !== null ? (
        <p className="admin-meta">
          Contagens agregadas (somente numeros, sem corpo/conteudo): artigos {database.articleRecords}
          , traducoes {database.translations}, content blocks {database.contentBlocks}, pendentes{" "}
          {database.pending}, aprovados {database.approved}, bloqueados {database.blocked}, candidatos
          a indexar {database.indexReadyCandidates}.
        </p>
      ) : (
        <p className="admin-meta">
          Banco nao respondeu a leitura agregada agora — confirme a conectividade read-only de
          staging.
        </p>
      )}

      <h3 className="admin-security-heading">5. Fluxo editorial</h3>
      <div className="admin-cards">
        {FLOW_LINKS.map((link) => (
          <a className="admin-card admin-card--link" key={link.href} href={link.href}>
            <div className="admin-card__title">{link.label} →</div>
            <div className="admin-card__label">{link.hint}</div>
          </a>
        ))}
      </div>

      <SectionBlock section="seed" checks={report.checks} />
      <p className="admin-meta">
        O seed e um comando MANUAL, fora da UI. Sem flags, ele roda em dry-run (nunca escreve) e so
        imprime o plano abaixo. Para escrever, exige as duas confirmacoes: a flag <code>--apply</code>{" "}
        mais a variavel <code>{seed.confirmEnv}</code> = <code>{seed.confirmValue}</code>. Em producao
        real o apply e o <code>--cleanup</code> abortam. Todo registro criado leva o marcador{" "}
        <code>{seed.marker}</code> e slug com prefixo <code>{seed.slugPrefix}</code>, para ser
        identificavel e reversivel.
      </p>
      <ul className="admin-env-checklist">
        {seed.planLines.map((line, index) => (
          <li className="admin-env-item" key={index}>
            <code className="admin-env-item__key">{line}</code>
          </li>
        ))}
      </ul>

      <h3 className="admin-security-heading">Acoes recomendadas</h3>
      <ul className="admin-env-checklist">
        {report.recommendedActions.map((action, index) => (
          <li className="admin-env-item" key={index}>
            <span className="admin-env-item__note">{action}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
