import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

/**
 * Layout raiz do painel interno (@screena/admin): operacional + editorial.
 *
 * App SEPARADO do publico @screena/web: nao e superficie publica indexavel.
 * `noindex` em tres camadas — este metadata, o cabecalho `X-Robots-Tag` que o
 * middleware poe em TODA resposta (inclusive o 401) e o `robots.txt` com
 * `Disallow: /`. O painel nao tem sitemap.
 *
 * Robots reforcado: alem de `index: false`/`follow: false`, `noarchive`,
 * `nocache` e `nosnippet` — mesmo se o painel vazar para um crawler, nao ha
 * cache, snapshot nem trecho exibido.
 *
 * PROTECAO DE ACESSO: portao HTTP Basic Auth no middleware
 * (`apps/admin/middleware.ts` + `src/lib/access-protection`), fail-closed em
 * producao. Stateless: sem usuario, login ou permissoes — a credencial e
 * compartilhada, e as acoes do painel registram isso na auditoria.
 *
 * Fundo branco puro em todas as secoes, inclusive o cabecalho (decisao do dono,
 * 2026-09-15). Server component; nenhum acesso a banco ou rede acontece aqui.
 */
export const metadata: Metadata = {
  title: "Painel | Cinerie (interno)",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
    nosnippet: true,
  },
};

const OPS_NAV: ReadonlyArray<readonly [string, string]> = [
  ["/", "Visão geral"],
  ["/filas", "Filas"],
  ["/cotas", "Cotas"],
  ["/servicos", "Serviços"],
  ["/cobertura", "Cobertura"],
  ["/titulos", "Títulos"],
  ["/usuarios", "Usuários"],
  ["/logs", "Logs"],
  ["/acoes", "Ações"],
];

const EDITORIAL_NAV: ReadonlyArray<readonly [string, string]> = [
  ["/editorial", "Painel editorial"],
  ["/staging", "Staging"],
  ["/qa", "QA"],
  ["/workflow", "Workflow"],
  ["/review-queue", "Fila de revisão"],
  ["/articles", "Artigos"],
  ["/content-blocks", "Content blocks"],
  ["/health", "Health"],
  ["/security", "Segurança"],
];

export default function AdminLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="pt-BR">
      <body>
        <header className="admin-header">
          <div className="admin-header__row">
            <h1 className="admin-header__title">Cinerie · Painel interno</h1>
            <span className="admin-header__readonly">Acesso protegido · noindex</span>
          </div>
          <nav className="admin-nav" aria-label="Painel operacional">
            {OPS_NAV.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <nav className="admin-nav admin-nav--secondary" aria-label="Editorial">
            <span className="admin-nav__caption">Editorial:</span>
            {EDITORIAL_NAV.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
        </header>
        <main className="admin-main">{children}</main>
      </body>
    </html>
  );
}
