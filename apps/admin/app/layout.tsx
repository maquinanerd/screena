import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

/**
 * Layout raiz do admin editorial interno (@screena/admin).
 *
 * App SEPARADO do publico @screena/web: nao e uma superficie publica indexavel.
 * Nasce `noindex` (metadata robots) e nao e linkado a partir do site publico.
 * Server component; nenhum acesso a banco/rede acontece aqui — as paginas leem
 * o PostgreSQL local server-side (SOMENTE LEITURA) e renderizam o resultado.
 */
export const metadata: Metadata = {
  title: "Admin Editorial | Screen (interno)",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="pt-BR">
      <body>
        <header className="admin-header">
          <h1 className="admin-header__title">Admin Editorial</h1>
          <span className="admin-header__readonly">Modo somente leitura</span>
          <nav className="admin-nav">
            <a href="/">Dashboard</a>
            <a href="/articles">Artigos</a>
            <a href="/content-blocks">Content blocks</a>
            <a href="/health">Health</a>
          </nav>
        </header>
        <main className="admin-main">{children}</main>
      </body>
    </html>
  );
}
