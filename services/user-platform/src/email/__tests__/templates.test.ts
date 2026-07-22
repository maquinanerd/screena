/**
 * Templates: o que o e-mail DIZ e, principalmente, o que ele NAO diz.
 *
 * As guardas negativas aqui sao o ponto: um template que vaze status de conta,
 * carregue script ou monte HTML sem escapar nao e pego por typecheck nenhum.
 */

import { describe, expect, it } from "vitest";

import {
  EMAIL_VERIFICATION_SUBJECT,
  escapeHtml,
  formatExpiration,
  PASSWORD_RESET_SUBJECT,
  renderEmailVerificationEmail,
  renderPasswordResetEmail,
  type RenderedTransactionalEmail,
} from "../templates.js";

const URL_VERIFICACAO = "https://cinerie.com/pt/verificar-email/?token=" + "a".repeat(64);
const URL_RESET = "https://cinerie.com/pt/redefinir-senha/?token=" + "b".repeat(64);

const AMBOS: readonly RenderedTransactionalEmail[] = [
  renderEmailVerificationEmail({ actionUrl: URL_VERIFICACAO, expiresInMinutes: 1440 }),
  renderPasswordResetEmail({ actionUrl: URL_RESET, expiresInMinutes: 30 }),
];

describe("assuntos exatos", () => {
  it("(1) verificacao e recuperacao usam os assuntos canonicos", () => {
    expect(AMBOS[0]!.subject).toBe(EMAIL_VERIFICATION_SUBJECT);
    expect(AMBOS[0]!.subject).toBe("Confirme seu e-mail na Cinerie");
    expect(AMBOS[1]!.subject).toBe(PASSWORD_RESET_SUBJECT);
    expect(AMBOS[1]!.subject).toBe("Redefina sua senha da Cinerie");
  });
});

describe("estrutura do HTML", () => {
  it("(2) ha HTML e texto puro, e os dois carregam a URL EXATA", () => {
    const [verificacao, reset] = AMBOS;
    expect(verificacao!.htmlContent).toContain(URL_VERIFICACAO);
    expect(verificacao!.textContent).toContain(URL_VERIFICACAO);
    expect(reset!.htmlContent).toContain(URL_RESET);
    expect(reset!.textContent).toContain(URL_RESET);
  });

  it("(3) o HTML tem tags balanceadas e largura de 600px", () => {
    for (const email of AMBOS) {
      const abertas = (email.htmlContent.match(/<table\b/g) ?? []).length;
      const fechadas = (email.htmlContent.match(/<\/table>/g) ?? []).length;
      expect(abertas).toBe(fechadas);
      expect(abertas).toBeGreaterThan(0);
      expect((email.htmlContent.match(/<tr\b/g) ?? []).length).toBe(
        (email.htmlContent.match(/<\/tr>/g) ?? []).length,
      );
      expect(email.htmlContent).toContain("600");
      // Estilo INLINE: clientes de e-mail ignoram <style> de forma irregular.
      expect(email.htmlContent).toContain("style=");
      expect(email.htmlContent).not.toContain("<style");
      expect(email.htmlContent).not.toContain("class=");
    }
  });

  it("(4) o botao aparece com o texto de acao correto", () => {
    expect(AMBOS[0]!.htmlContent).toContain("Confirmar meu e-mail");
    expect(AMBOS[1]!.htmlContent).toContain("Redefinir minha senha");
    expect(AMBOS[0]!.textContent).toContain("Confirmar meu e-mail");
    expect(AMBOS[1]!.textContent).toContain("Redefinir minha senha");
  });

  it("(5) o texto puro funciona sozinho: URL, prazo e aviso de ignorar", () => {
    for (const email of AMBOS) {
      expect(email.textContent).toContain("Cinerie");
      expect(email.textContent).toContain("Este link vale por ");
      expect(email.textContent).toContain("Se voce nao pediu");
      // Sem marcacao: quem le em modo texto recebe conteudo legivel, nao HTML.
      expect(email.textContent).not.toMatch(/<[a-z/!]/i);
    }
  });

  it("(5b) o texto puro NAO escapa entidades (seria ruido para o leitor)", () => {
    // Assercao FALSIFICAVEL: se `renderText` passasse a usar `escapeHtml`, uma
    // URL com `&` viraria `&amp;` no corpo de texto e o link copiado quebraria.
    const comAmpersand = "https://cinerie.com/pt/redefinir-senha/?token=a&b=c";
    const email = renderPasswordResetEmail({ actionUrl: comAmpersand, expiresInMinutes: 30 });
    expect(email.textContent).toContain(comAmpersand);
    expect(email.textContent).not.toContain("&amp;");
    // E no HTML acontece o OPOSTO: ali o escape e obrigatorio.
    expect(email.htmlContent).toContain("&amp;");
    expect(email.htmlContent).not.toContain("?token=a&b=c");
  });

  it("(6) o prazo aparece na unidade correta em HTML e texto", () => {
    expect(AMBOS[0]!.htmlContent).toContain("24 horas");
    expect(AMBOS[0]!.textContent).toContain("24 horas");
    expect(AMBOS[1]!.htmlContent).toContain("30 minutos");
    expect(AMBOS[1]!.textContent).toContain("30 minutos");
  });

  it("(7) a URL aparece uma vez no botao e uma vez como texto alternativo", () => {
    // Duas ocorrencias sao intencionais (href + fallback copiavel). Mais do que
    // isso indicaria repeticao acidental do segredo pelo corpo.
    for (const [email, url] of [
      [AMBOS[0]!, URL_VERIFICACAO],
      [AMBOS[1]!, URL_RESET],
    ] as const) {
      const ocorrencias = email.htmlContent.split(url).length - 1;
      expect(ocorrencias).toBe(2);
    }
  });
});

describe("o que o e-mail NUNCA carrega", () => {
  it("(8) nenhum JavaScript, formulario, pixel proprio ou imagem remota", () => {
    for (const email of AMBOS) {
      expect(email.htmlContent).not.toMatch(/<script/i);
      expect(email.htmlContent).not.toMatch(/javascript:/i);
      // Nenhum manipulador inline (`onclick=`, `onload=`, ...).
      expect(email.htmlContent).not.toMatch(/\son[a-z]+\s*=/i);
      expect(email.htmlContent).not.toMatch(/<form/i);
      expect(email.htmlContent).not.toMatch(/<img/i);
      expect(email.htmlContent).not.toMatch(/<iframe/i);
    }
  });

  it("(9) nenhum status de conta, senha, hash, chave ou identificador interno", () => {
    const proibidos = [
      /\bsenha atual\b/i,
      /\bpasswordHash\b/i,
      /\btokenHash\b/i,
      /\buserId\b/i,
      /\bapi-key\b/i,
      /\bxkeysib\b/i,
      /\bconta (ativa|desativada|existente|inexistente)\b/i,
      /\bja (tem|possui) (uma )?conta\b/i,
      /\bverificad[ao]\b/i,
    ];
    for (const email of AMBOS) {
      const corpo = `${email.subject}\n${email.htmlContent}\n${email.textContent}`;
      for (const padrao of proibidos) {
        expect(padrao.test(corpo), `${padrao} em ${email.subject}`).toBe(false);
      }
    }
  });

  it("(10) os dois templates sao INDISTINGUIVEIS quanto a existencia da conta", () => {
    // Nenhum dos dois condiciona texto a estado de conta: o corpo e o mesmo
    // esqueleto, mudando so titulo, chamada e prazo.
    for (const email of AMBOS) {
      expect(email.htmlContent).toContain("Se voce nao pediu este e-mail");
    }
  });
});

describe("escaping", () => {
  it("(11) escapeHtml neutraliza os cinco metacaracteres, `&` primeiro", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
    // `&` antes dos demais: senao `&lt;` viraria `&amp;lt;`.
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("(12) conteudo hostil na URL NAO escapa do atributo (controle negativo)", () => {
    const hostil = `https://cinerie.com/pt/redefinir-senha/?token="><script>alert(1)</script>`;
    const email = renderPasswordResetEmail({ actionUrl: hostil, expiresInMinutes: 30 });
    expect(email.htmlContent).not.toContain("<script>");
    expect(email.htmlContent).toContain("&lt;script&gt;");
    // O atributo continua fechado: nao ha `"` cru vindo do valor.
    expect(email.htmlContent).toContain("&quot;&gt;");
  });
});

describe("formatacao do prazo", () => {
  it("(13) horas exatas viram horas; o resto fica em minutos", () => {
    expect(formatExpiration(60)).toBe("1 hora");
    expect(formatExpiration(120)).toBe("2 horas");
    expect(formatExpiration(1440)).toBe("24 horas");
    expect(formatExpiration(1)).toBe("1 minuto");
    expect(formatExpiration(30)).toBe("30 minutos");
    expect(formatExpiration(90)).toBe("90 minutos");
    expect(formatExpiration(59)).toBe("59 minutos");
  });
});
