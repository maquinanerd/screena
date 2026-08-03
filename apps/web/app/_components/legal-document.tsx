import type { ReactNode } from "react";

import {
  LEGAL_DOCUMENT_VERSION,
  LEGAL_DOCUMENTS_REVIEWED,
  LEGAL_LAST_UPDATED_ISO,
  formatLegalDate,
} from "../../src/lib/legal";
import { HOME_PATH } from "../../src/lib/site";

/**
 * Moldura comum dos documentos juridicos publicos.
 *
 * O AVISO DE MINUTA E O PONTO. Enquanto `LEGAL_DOCUMENTS_REVIEWED` for `false`,
 * toda pagina que use esta moldura anuncia, ANTES do texto, que ele nao passou
 * por revisao juridica. Nao e rodape nem letra miuda: quem chega aqui vindo do
 * checkbox do cadastro precisa saber o que esta aceitando antes de ler.
 *
 * Sumir com o aviso e trocar um booleano — de proposito. Um aviso que cada
 * pagina decidisse por conta propria seria esquecido em uma delas.
 */
export function LegalDocument({
  titulo,
  resumo,
  children,
}: {
  readonly titulo: string;
  readonly resumo: string;
  readonly children: ReactNode;
}) {
  return (
    <main data-vertical="institutional">
      <div className="container" style={{ paddingTop: 36, maxWidth: 760 }}>
        <nav aria-label="Trilha de navegação" className="breadcrumb">
          <ol>
            <li>
              <a href={HOME_PATH}>Início</a>
            </li>
            <li aria-current="page">{titulo}</li>
          </ol>
        </nav>

        <h1>{titulo}</h1>
        <p>{resumo}</p>

        <p>
          <small>
            Versão {LEGAL_DOCUMENT_VERSION} · última alteração em{" "}
            {formatLegalDate(LEGAL_LAST_UPDATED_ISO)}
          </small>
        </p>

        {LEGAL_DOCUMENTS_REVIEWED ? null : (
          <aside
            aria-label="Aviso sobre o estágio deste documento"
            role="note"
            style={{
              border: "1px solid var(--screena-movie-red)",
              borderRadius: 8,
              padding: "16px 20px",
              margin: "24px 0",
            }}
          >
            <strong>Minuta — ainda não revisada juridicamente.</strong>
            <p>
              Este texto foi redigido a partir do que a plataforma realmente faz com os
              seus dados, mas <strong>ainda não passou por revisão de um profissional do
              direito</strong> e contém campos por preencher, marcados como{" "}
              <code>{"{{ASSIM}}"}</code>. Ele está publicado para que você possa lê-lo e
              para que os links do cadastro não levem a lugar nenhum — não como versão
              definitiva. Enquanto estiver assim, esta página não é indexada por
              buscadores.
            </p>
          </aside>
        )}

        {children}
      </div>
    </main>
  );
}
