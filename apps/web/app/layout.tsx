import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "./_components/site-header";
import { SiteFooter } from "./_components/site-footer";
import { SITE_URL } from "../src/lib/site";
import "./globals.css";

/**
 * Layout raiz do app publico @screena/web.
 *
 * Define <html>/<body> e o idioma de publicacao do MVP (pt-BR; invariante 7).
 * Importa o estilo global minimo (`globals.css`): tema claro com tokens de cor
 * da cinerie, sem framework de CSS nem fontes externas. Server component puro —
 * nenhum acesso a banco ou rede aqui.
 *
 * Renderiza o `SiteHeader` (navegacao global) acima do conteudo de cada rota,
 * de forma que ele aparece em todas as telas sem alterar as paginas em si.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "cinerie", template: "%s | cinerie" },
  // Marca publica em cartoes sociais. Sem og:image fabricada (nenhum asset
  // raster proprio nesta fase) — nunca inventar dado.
  openGraph: { siteName: "cinerie", locale: "pt_BR", type: "website" },
  twitter: { card: "summary" },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="pt-BR">
      <body>
        <a className="skip-link" href="#main-content">
          Pular para o conteúdo
        </a>
        <SiteHeader />
        <div id="main-content" className="site-content" tabIndex={-1}>
          {children}
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
