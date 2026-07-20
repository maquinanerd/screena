/**
 * review.ts — Reviews de usuario (UGC) da user platform (Backend C).
 *
 * PURO: nao faz rede, DB nem IO; recebe `now: Date` por parametro.
 *
 * Contexto de produto: toda review nasce `pending` (moderacao) e privada;
 * so aparece publicamente quando approved + public + nao deletada.
 *
 * SEGURANCA DE RENDER (documentado aqui como contrato):
 *  - O texto de review e TEXTO PLANO. Este modulo NUNCA interpreta HTML;
 *    o render futuro ESCAPA todo o conteudo antes de exibir.
 *  - Links (https?://) sao renderizados pelo front com rel="ugc nofollow"
 *    — nunca como link "limpo" que passe autoridade de SEO.
 *  - Nada de pirataria: moderacao remove links/conteudo ilegal; o limite
 *    de links reduz spam por construcao.
 */

import { collect, type DomainResult, err, ok, type ValidationResult } from "../core/result.js";
import type { ReviewModerationStatus, Visibility } from "../core/types.js";

/** Limites canonicos de UGC de review (fonte unica; nao redeclarar). */
export const REVIEW_LIMITS = {
  maxTitleLength: 200,
  maxBodyLength: 20000,
  maxLinks: 2,
  maxReviewsPerHour: 5,
} as const;

/**
 * Chars de controle a remover (preserva \n e \t):
 * C0 exceto \t(09)/\n(0A), DEL (7F) e C1 (80..9F). \r nao aparece aqui
 * porque ja foi normalizado para \n antes da remocao.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

const LINK_PATTERN = /https?:\/\//gi;

/**
 * Sanitiza texto de review para texto plano canonico:
 *  1. normaliza quebras: \r\n -> \n (e \r solto -> \n);
 *  2. remove chars de controle (exceto \n e \t);
 *  3. colapsa mais de 2 quebras seguidas em exatamente 2;
 *  4. trim nas pontas.
 *
 * NUNCA interpreta nem remove HTML: tags viram texto literal e o render
 * futuro escapa tudo (ver cabecalho do modulo).
 */
export function sanitizeReviewText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CONTROL_CHARS_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Conta ocorrencias de links (https?://) no texto. */
export function countLinks(text: string): number {
  const matches = text.match(LINK_PATTERN);
  return matches === null ? 0 : matches.length;
}

/**
 * Valida uma submissao de review APOS sanitizacao:
 *  - body nao-vazio (sanitizado);
 *  - body <= maxBodyLength; title (se presente, sanitizado) <= maxTitleLength;
 *  - links no conjunto title+body <= maxLinks.
 *
 * Acumula todas as violacoes (estilo packages/schemas).
 */
export function validateReviewSubmission(input: {
  readonly title?: string;
  readonly body: string;
  readonly containsSpoiler: boolean;
}): ValidationResult {
  const errors: string[] = [];

  const body = sanitizeReviewText(input.body);
  const title = input.title === undefined ? undefined : sanitizeReviewText(input.title);

  if (body.length === 0) {
    errors.push("corpo invalido: a review nao pode ser vazia apos sanitizacao.");
  }

  if (body.length > REVIEW_LIMITS.maxBodyLength) {
    errors.push(
      `corpo invalido: maximo de ${REVIEW_LIMITS.maxBodyLength} caracteres (recebido ${body.length}).`,
    );
  }

  if (title !== undefined && title.length > REVIEW_LIMITS.maxTitleLength) {
    errors.push(
      `titulo invalido: maximo de ${REVIEW_LIMITS.maxTitleLength} caracteres (recebido ${title.length}).`,
    );
  }

  const linkCount = countLinks(body) + (title === undefined ? 0 : countLinks(title));
  if (linkCount > REVIEW_LIMITS.maxLinks) {
    errors.push(
      `links demais: maximo de ${REVIEW_LIMITS.maxLinks} links por review (recebido ${linkCount}).`,
    );
  }

  if (typeof input.containsSpoiler !== "boolean") {
    errors.push("containsSpoiler invalido: deve ser booleano explicito.");
  }

  return collect(errors);
}

/**
 * Avalia rate limit de UGC (anti-spam): bloqueia quando o usuario ja
 * atingiu o limite na janela. Mensagem generica — nunca revela contagens
 * de outros usuarios nem permite enumeracao.
 */
export function evaluateUgcRateLimit(input: {
  readonly recentCount: number;
  readonly limit: number;
}): DomainResult<true> {
  if (
    !Number.isInteger(input.recentCount) ||
    input.recentCount < 0 ||
    !Number.isInteger(input.limit) ||
    input.limit < 1
  ) {
    return err("validation_failed", "parametros de rate limit invalidos.", [
      "recentCount deve ser inteiro >= 0 e limit inteiro >= 1",
    ]);
  }
  if (input.recentCount >= input.limit) {
    return err("rate_limited", "limite de envios atingido. Tente novamente mais tarde.");
  }
  return ok(true);
}

/**
 * Gate de exibicao publica: SOMENTE review approved + public + nao
 * deletada renderiza publicamente. Qualquer outro estado e invisivel
 * fora do dono/moderacao (tudo nasce privado e pending).
 */
export function canRenderPublicly(review: {
  readonly status: ReviewModerationStatus;
  readonly visibility: Visibility;
  readonly deletedAt: Date | null;
}): boolean {
  return review.status === "approved" && review.visibility === "public" && review.deletedAt === null;
}

/**
 * Soft delete de review: marca deletedAt=now e status "removed".
 * Nao ha hard delete no dominio (historico/auditoria preservados).
 */
export function buildReviewSoftDelete(now: Date): { deletedAt: Date; status: "removed" } {
  return { deletedAt: now, status: "removed" };
}
