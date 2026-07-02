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
 *
 * Robots reforcado: alem de `index: false`/`follow: false`, declaramos
 * `noarchive`, `nocache` e `nosnippet` para que, mesmo se o admin vazar para um
 * crawler, nao haja cache, snapshot ou trecho exibido. Todos sao campos
 * suportados pelo tipo `Robots` do Next (Metadata API) — sem cast nem hack.
 *
 * PROTECAO DE ACESSO (Fase 6B): o acesso ao admin passa por um portao HTTP Basic
 * Auth no middleware (`apps/admin/middleware.ts` + `src/lib/access-protection`),
 * ligado por variavel de ambiente. E protecao operacional MINIMA e stateless:
 * NAO ha usuario, sessao, cookie, login, JWT, OAuth nem permissoes — isso e fase
 * futura. O `noindex` abaixo protege contra indexacao; o Basic Auth protege
 * contra acesso. Nenhum dos dois substitui o outro.
 */
export const metadata: Metadata = {
  title: "Admin Editorial | Screen (interno)",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
    nosnippet: true,
  },
};

export default function AdminLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="pt-BR">
      <body>
        <header className="admin-header">
          <h1 className="admin-header__title">Admin Editorial</h1>
          <span className="admin-header__readonly">Modo somente leitura</span>
          <p className="admin-header__access">Admin protegido por camada de acesso operacional.</p>
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
