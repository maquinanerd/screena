/**
 * TEMPLATES dos e-mails transacionais de autenticacao (Backend C, C7C).
 *
 * PURO: sem rede, sem DB, sem relogio, sem `process.env`. Assunto, HTML e texto
 * puro sao construidos aqui, EM CODIGO — nao dependem de um `templateId` criado
 * a mao no painel do fornecedor. Um template que so existe no painel nao entra
 * em code review, nao tem teste e muda sem deixar rastro no repositorio.
 *
 * O que estes templates NUNCA dizem (e por que):
 *
 *  - nada sobre o ESTADO da conta ("sua conta esta ativa", "voce ja tinha
 *    cadastro"): o e-mail e uma superficie observavel por quem quer que controle
 *    a caixa, e um texto condicional transformaria a mensagem num oraculo de
 *    existencia — exatamente o que a resposta HTTP generica evita;
 *  - nenhuma senha, hash, `userId`, `tokenHash` ou identificador interno;
 *  - nenhum script, nenhum formulario, nenhum pixel proprio e nenhuma imagem
 *    remota obrigatoria (clientes de e-mail bloqueiam imagem por padrao, e um
 *    pixel seria rastreamento comercial que esta unidade nao faz).
 *
 * O corpo em TEXTO PURO e funcional sozinho: quem le em modo texto recebe a URL
 * completa e o prazo, sem depender do HTML.
 */

/** Saida de um template: exatamente o que o fornecedor precisa receber. */
export interface RenderedTransactionalEmail {
  readonly subject: string;
  readonly htmlContent: string;
  readonly textContent: string;
}

export const EMAIL_VERIFICATION_SUBJECT = "Confirme seu e-mail na Cinerie";
export const PASSWORD_RESET_SUBJECT = "Redefina sua senha da Cinerie";

/** Largura maxima do bloco central (o consenso de compatibilidade em e-mail). */
const CONTENT_WIDTH_PX = 600;

/**
 * Escapa conteudo variavel antes de entrar no HTML.
 *
 * Aplica-se a TUDO que e interpolado, inclusive a URL de acao: ela e montada por
 * `new URL` e ja e segura, mas escapar por politica (e nao por analise caso a
 * caso) e o que impede que a proxima variavel interpolada entre crua porque
 * "aquela ali tambem parecia segura".
 *
 * `&` primeiro, senao as entidades geradas depois seriam escapadas de novo.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Prazo em portugues legivel. Multiplos exatos de 60 viram horas (1440 -> "24
 * horas"); o resto fica em minutos (30 -> "30 minutos"). Deterministico e sem
 * biblioteca de data — o valor ja chega validado como inteiro positivo.
 */
export function formatExpiration(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hora" : `${hours} horas`;
  }
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

interface TemplateContent {
  readonly subject: string;
  readonly heading: string;
  readonly intro: string;
  readonly callToAction: string;
  readonly actionUrl: string;
  readonly expiresInMinutes: number;
}

/**
 * Esqueleto HTML compartilhado: tabela, estilos INLINE, fundo claro, marca em
 * texto (nao ha asset absoluto confiavel a incorporar) e CTA com contraste alto.
 * Sem `<style>`, sem classe e sem media query — o suporte a CSS em cliente de
 * e-mail e irregular demais para depender disso.
 */
function renderHtml(content: TemplateContent): string {
  const url = escapeHtml(content.actionUrl);
  const heading = escapeHtml(content.heading);
  const intro = escapeHtml(content.intro);
  const cta = escapeHtml(content.callToAction);
  const prazo = escapeHtml(formatExpiration(content.expiresInMinutes));

  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;margin:0;padding:24px 12px;">`,
    `<tr><td align="center">`,
    `<table role="presentation" width="${CONTENT_WIDTH_PX}" cellpadding="0" cellspacing="0" border="0" style="max-width:${CONTENT_WIDTH_PX}px;width:100%;background-color:#ffffff;border-radius:8px;">`,
    `<tr><td style="padding:28px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:0.04em;color:#111111;">Cinerie</td></tr>`,
    `<tr><td style="padding:0 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;font-size:22px;line-height:30px;font-weight:700;color:#111111;">${heading}</td></tr>`,
    `<tr><td style="padding:0 32px 20px 32px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#333333;">${intro}</td></tr>`,
    `<tr><td style="padding:0 32px 20px 32px;"><a href="${url}" style="display:inline-block;background-color:#111111;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:24px;text-decoration:none;padding:14px 24px;border-radius:6px;">${cta}</a></td></tr>`,
    `<tr><td style="padding:0 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#555555;">Se o botao nao funcionar, copie e cole este endereco no navegador:</td></tr>`,
    `<tr><td style="padding:0 32px 20px 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#1a4fd6;word-break:break-all;">${url}</td></tr>`,
    `<tr><td style="padding:0 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#555555;">Este link vale por ${prazo}.</td></tr>`,
    `<tr><td style="padding:0 32px 28px 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#555555;">Se voce nao pediu este e-mail, pode ignorar esta mensagem.</td></tr>`,
    `</table>`,
    `<table role="presentation" width="${CONTENT_WIDTH_PX}" cellpadding="0" cellspacing="0" border="0" style="max-width:${CONTENT_WIDTH_PX}px;width:100%;">`,
    `<tr><td style="padding:16px 32px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#777777;">Cinerie &mdash; mensagem automatica. Nao responda a este e-mail.</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
  ].join("");
}

/** Corpo em texto puro. Funciona sozinho: contem a URL inteira e o prazo. */
function renderText(content: TemplateContent): string {
  return [
    "Cinerie",
    "",
    content.heading,
    "",
    content.intro,
    "",
    `${content.callToAction}:`,
    content.actionUrl,
    "",
    `Este link vale por ${formatExpiration(content.expiresInMinutes)}.`,
    "Se voce nao pediu este e-mail, pode ignorar esta mensagem.",
    "",
    "Cinerie - mensagem automatica. Nao responda a este e-mail.",
  ].join("\n");
}

function render(content: TemplateContent): RenderedTransactionalEmail {
  return {
    subject: content.subject,
    htmlContent: renderHtml(content),
    textContent: renderText(content),
  };
}

/** E-mail de VERIFICACAO. Nao afirma nem nega que a conta ja existia. */
export function renderEmailVerificationEmail(input: {
  readonly actionUrl: string;
  readonly expiresInMinutes: number;
}): RenderedTransactionalEmail {
  return render({
    subject: EMAIL_VERIFICATION_SUBJECT,
    heading: "Confirme seu e-mail",
    // O texto e IDENTICO em qualquer situacao: nao cita estado de cadastro, nao
    // diz se o endereco ja passou por confirmacao antes e nao promete nada
    // condicional. Qualquer variacao viraria sinal observavel por quem controla
    // a caixa de entrada.
    intro: "Use o botao abaixo para confirmar que este endereco de e-mail e seu.",
    callToAction: "Confirmar meu e-mail",
    actionUrl: input.actionUrl,
    expiresInMinutes: input.expiresInMinutes,
  });
}

/** E-mail de RECUPERACAO. Nao confirma existencia de conta nem cita senha. */
export function renderPasswordResetEmail(input: {
  readonly actionUrl: string;
  readonly expiresInMinutes: number;
}): RenderedTransactionalEmail {
  return render({
    subject: PASSWORD_RESET_SUBJECT,
    heading: "Redefina sua senha",
    intro:
      "Recebemos um pedido de redefinicao para este endereco de e-mail. Use o botao abaixo para escolher uma nova senha.",
    callToAction: "Redefinir minha senha",
    actionUrl: input.actionUrl,
    expiresInMinutes: input.expiresInMinutes,
  });
}
