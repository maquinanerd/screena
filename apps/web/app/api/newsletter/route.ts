/**
 * POST /api/newsletter — inscrição na newsletter da Cinerie.
 *
 * ============================================================================
 * ESTA ROTA NÃO GUARDA NADA, E RESPONDE ISSO EXPLICITAMENTE
 * ============================================================================
 * Não existe tabela de inscrição no schema (`packages/db/prisma`). Criar uma é
 * mudança de banco e exige tarefa aprovada (CLAUDE.md §10) — está fora do escopo
 * da migração de créditos para o rodapé.
 *
 * As saídas possíveis eram três, e duas são inaceitáveis:
 *   - responder `200 OK` sem guardar → mentira direta ao usuário;
 *   - aceitar e descartar em silêncio → pior: parece funcionar e não funciona;
 *   - responder que ainda não está aberto → é o que esta rota faz.
 *
 * O e-mail recebido é validado e DESCARTADO sem ser gravado nem logado. Não
 * reter dado pessoal que não se pode tratar é a leitura correta da LGPD aqui,
 * não um efeito colateral da falta de tabela.
 *
 * PARA LIGAR: criar o armazenamento (tarefa de banco aprovada) e trocar o corpo
 * de `POST`. O formulário do rodapé já implementa o estado de sucesso.
 *
 * As constantes e a validação vivem em `src/lib/newsletter.ts`: um Route Handler
 * do Next só pode exportar handlers e config conhecida — qualquer export extra
 * reprova o `next build`.
 */

import {
  NEWSLETTER_INVALID_EMAIL_MESSAGE,
  NEWSLETTER_UNAVAILABLE_MESSAGE,
  isEmailShaped,
} from "../../../src/lib/newsletter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let email: unknown = null;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "email" in body) {
      email = (body as { email: unknown }).email;
    }
  } catch {
    email = null;
  }

  if (!isEmailShaped(email)) {
    return Response.json(
      { ok: false, message: NEWSLETTER_INVALID_EMAIL_MESSAGE },
      { status: 400 },
    );
  }

  // O endereço é validado e sai de escopo aqui. Nada é gravado nem logado.
  return Response.json(
    { ok: false, message: NEWSLETTER_UNAVAILABLE_MESSAGE },
    { status: 503 },
  );
}
