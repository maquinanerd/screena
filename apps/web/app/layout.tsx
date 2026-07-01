import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "./_components/site-header";
import "./globals.css";

/**
 * Layout raiz do app publico @screena/web.
 *
 * Define <html>/<body> e o idioma de publicacao do MVP (pt-BR; invariante 7).
 * Importa o estilo global minimo (`globals.css`): tema claro com tokens de cor
 * da Screena, sem framework de CSS nem fontes externas. Server component puro —
 * nenhum acesso a banco ou rede aqui.
 *
 * Renderiza o `SiteHeader` (navegacao global) acima do conteudo de cada rota,
 * de forma que ele aparece em todas as telas sem alterar as paginas em si.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://screena.media"),
  title: { default: "Screena", template: "%s | Screena" },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="pt-BR">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
