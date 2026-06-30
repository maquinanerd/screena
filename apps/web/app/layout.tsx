import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Layout raiz do app publico @screena/web.
 *
 * Define <html>/<body> e o idioma de publicacao do MVP (pt-BR; invariante 7).
 * Sem CSS pesado nesta fase: apenas o esqueleto necessario para o App Router
 * renderizar. Server component puro — nenhum acesso a banco ou rede aqui.
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
      <body>{children}</body>
    </html>
  );
}
