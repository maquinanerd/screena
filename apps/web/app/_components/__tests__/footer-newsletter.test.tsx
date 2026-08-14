/**
 * footer-newsletter.test.tsx — "O FORMULARIO NUNCA MENTE SOBRE A INSCRICAO."
 *
 * O rodape ganhou um bloco de newsletter, e nao existe tabela para guardar
 * inscricao (`packages/db/prisma` nao tem modelo; criar um e tarefa de banco
 * aprovada). Isso cria uma tentacao especifica: responder `200 OK`, mostrar
 * "pronto!" e descartar o e-mail. Seria a mesma classe de defeito que os
 * placeholders que este projeto ja removeu — affordance que parece funcionar.
 *
 * Estes testes travam o contrario: a rota diz a verdade, e o formulario existe
 * de verdade (label, type, required, aria-live) para o dia em que houver
 * armazenamento — quando so a rota muda.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { POST } from "../../api/newsletter/route";
import { FooterNewsletter } from "../footer-newsletter";
import {
  NEWSLETTER_INVALID_EMAIL_MESSAGE,
  NEWSLETTER_UNAVAILABLE_MESSAGE,
  isEmailShaped,
} from "../../../src/lib/newsletter";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("https://cinerie.test/api/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("isEmailShaped — validacao de FORMA, nao de existencia", () => {
  it("aceita endereco com forma plausivel", () => {
    expect(isEmailShaped("alguem@exemplo.com")).toBe(true);
    expect(isEmailShaped("  alguem@exemplo.com  ")).toBe(true);
  });

  it("recusa o que nem parece e-mail", () => {
    for (const invalido of ["", "   ", "alguem", "alguem@", "@exemplo.com", "a@b", 42, null]) {
      expect(isEmailShaped(invalido)).toBe(false);
    }
  });
});

describe("POST /api/newsletter — responde a VERDADE", () => {
  it("NUNCA responde sucesso: sem armazenamento, nao ha inscricao", async () => {
    const response = await post({ email: "alguem@exemplo.com" });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    // A mensagem diz as DUAS coisas: nao esta inscrita, e o e-mail nao ficou.
    expect(body.message).toBe(NEWSLETTER_UNAVAILABLE_MESSAGE);
    expect(body.message).toContain("Nenhum e-mail foi guardado");
  });

  it("recusa e-mail malformado com 400, antes de qualquer outra coisa", async () => {
    const response = await post({ email: "nao-e-email" });
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(NEWSLETTER_INVALID_EMAIL_MESSAGE);
  });

  it("corpo ausente ou nao-JSON nao derruba a rota", async () => {
    const semCorpo = await POST(
      new Request("https://cinerie.test/api/newsletter", { method: "POST", body: "nao-json" }),
    );
    expect(semCorpo.status).toBe(400);

    const semCampo = await post({ outro: "coisa" });
    expect(semCampo.status).toBe(400);
  });
});

describe("FooterNewsletter — <form> real, nao mockup", () => {
  const markup = renderToStaticMarkup(<FooterNewsletter />);

  it("CONTROLE POSITIVO: o bloco renderiza com o texto do canonico", () => {
    expect(markup).toContain("Receba a newsletter da Cinerie");
    expect(markup).toContain("Sem spam.");
  });

  it("e um <form> com <input type=email> e <button type=submit>", () => {
    expect(markup).toContain("<form");
    expect(markup).toContain('type="email"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain("required");
    // Case-insensitive de proposito: o que importa e o atributo existir com o
    // valor certo. A CAIXA do nome e detalhe do renderizador (o SSR de teste
    // emite `autoComplete`; o navegador recebe `autocomplete`), e travar a caixa
    // faria o teste falhar por um motivo que nao e o dele.
    expect(markup).toMatch(/autocomplete="email"/i);
  });

  it("o campo tem <label> de verdade, ligado por for/id", () => {
    // Placeholder NAO e rotulo: some ao digitar e muitos leitores de tela o
    // ignoram. O label existe e fica visualmente oculto por CSS.
    const forMatch = /<label[^>]*for="([^"]+)"/.exec(markup);
    expect(forMatch).not.toBeNull();
    expect(markup).toContain(`id="${forMatch![1]}"`);
    expect(markup).toContain("Seu e-mail para a newsletter");
  });

  it("a regiao de status existe no DOM desde o inicio, com aria-live", () => {
    // Um `aria-live` que so nasce junto da mensagem costuma nao ser anunciado:
    // o leitor de tela nao estava observando a regiao quando ela apareceu.
    expect(markup).toMatch(/aria-live="polite"/);
    expect(markup).toMatch(/role="status"/);
  });

  it("nao promete inscricao no estado inicial", () => {
    expect(markup).not.toMatch(/inscrito|inscrição confirmada|obrigado/i);
  });
});
