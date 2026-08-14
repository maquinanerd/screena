/**
 * newsletter.ts — Contrato da inscricao na newsletter. PURO: sem rede, banco ou IO.
 *
 * Mora aqui, e nao no `route.ts`, por uma restricao do Next: um Route Handler so
 * pode exportar os handlers e a config conhecida (`runtime`, `dynamic`, ...).
 * Qualquer export extra reprova o build com "not assignable to type 'never'" —
 * entao a constante que a rota E o teste precisam compartilhar vive fora dela.
 */

/**
 * A resposta honesta enquanto nao existe armazenamento de inscricao.
 *
 * Nao ha tabela de newsletter no schema (`packages/db/prisma`), e criar uma e
 * mudanca de banco (tarefa aprovada, CLAUDE.md §10). Das tres saidas possiveis
 * — responder `200 OK` sem guardar, aceitar e descartar em silencio, ou dizer a
 * verdade — so a terceira e aceitavel. A frase diz as DUAS coisas que a pessoa
 * precisa saber: que nao esta inscrita, e que o e-mail dela nao ficou guardado.
 */
export const NEWSLETTER_UNAVAILABLE_MESSAGE =
  "As inscrições na newsletter ainda não estão abertas. Nenhum e-mail foi guardado.";

/** Mensagem de recusa por forma invalida do endereco. */
export const NEWSLETTER_INVALID_EMAIL_MESSAGE = "Informe um e-mail válido.";

/**
 * Validacao MINIMA de forma. Nao e autoridade sobre a existencia do endereco —
 * so evita gastar o caminho de escrita com algo que nem parece e-mail.
 */
export function isEmailShaped(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
