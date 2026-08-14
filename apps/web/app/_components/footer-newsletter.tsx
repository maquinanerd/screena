"use client";

/**
 * FooterNewsletter — o bloco de captura de e-mail do rodapé.
 *
 * `<form>` REAL (a spec pede, e o canônico é mockup): `<label>` oculto,
 * `type="email"`, `required`, `autocomplete="email"`, e os três estados —
 * enviando / sucesso / erro — numa região `aria-live="polite"`.
 *
 * ============================================================================
 * NÃO EXISTE ARMAZENAMENTO DE INSCRIÇÃO, E O FORMULÁRIO DIZ ISSO
 * ============================================================================
 * Não há tabela de newsletter no schema (`packages/db/prisma`), e criar migration
 * está fora do escopo desta mudança ("NUNCA criar ou alterar schema/migrations
 * fora de tarefa aprovada para banco", CLAUDE.md §10).
 *
 * Então a rota `/api/newsletter` responde a verdade: `503` com "as inscrições
 * ainda não estão abertas". O formulário mostra essa resposta no estado de erro.
 * O que ele NUNCA faz é responder "pronto, você está inscrito" para um e-mail
 * que ninguém guardou — um sucesso falso é a única saída que este componente
 * está proibido de tomar.
 *
 * No dia em que existir armazenamento, só a rota muda: o estado de sucesso já
 * está implementado e coberto por teste.
 */

import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";

type NewsletterStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

/** Mensagem de último recurso quando a rota não devolve uma explicação própria. */
const FALLBACK_ERROR = "Não foi possível concluir agora. Tente novamente mais tarde.";

/** Lê `message` do corpo JSON sem confiar na forma da resposta. */
async function readMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "message" in body) {
      const message = (body as { message: unknown }).message;
      if (typeof message === "string" && message.trim() !== "") return message.trim();
    }
  } catch {
    // Corpo não-JSON ou vazio: cai no fallback. Nunca lança para o usuário.
  }
  return null;
}

export function FooterNewsletter(): ReactNode {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<NewsletterStatus>({ kind: "idle" });

  const submitting = status.kind === "submitting";

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setStatus({ kind: "submitting" });

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const message = await readMessage(response);
      if (response.ok) {
        setStatus({ kind: "success", message: message ?? "Inscrição confirmada." });
        setEmail("");
        return;
      }
      setStatus({ kind: "error", message: message ?? FALLBACK_ERROR });
    } catch {
      setStatus({ kind: "error", message: FALLBACK_ERROR });
    }
  }

  return (
    <div className="footer-newsletter">
      <div className="footer-newsletter__pitch">
        <p className="footer-newsletter__title">Receba a newsletter da Cinerie</p>
        <p className="footer-newsletter__subtitle">
          Sem spam. Só o que importa em cinema e séries.
        </p>
      </div>

      {/* Sucesso SUBSTITUI o campo (spec §3.3): manter um campo editável depois
          de confirmar convida a reenviar o mesmo e-mail. */}
      {status.kind === "success" ? (
        <p className="footer-newsletter__done" aria-live="polite">
          {status.message}
        </p>
      ) : (
        <form className="footer-newsletter__form" noValidate={false} onSubmit={handleSubmit}>
          <label className="footer-newsletter__label" htmlFor={inputId}>
            Seu e-mail para a newsletter
          </label>
          <input
            autoComplete="email"
            className="footer-newsletter__input"
            disabled={submitting}
            id={inputId}
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Seu melhor e-mail"
            required
            type="email"
            value={email}
          />
          <button className="footer-newsletter__submit" disabled={submitting} type="submit">
            {submitting ? "Enviando…" : "Assinar"}
          </button>
        </form>
      )}

      {/* Região de status SEMPRE no DOM: um `aria-live` que só nasce junto da
          mensagem costuma não ser anunciado, porque o leitor de tela não estava
          observando a região quando ela apareceu. */}
      <p aria-live="polite" className="footer-newsletter__status" role="status">
        {status.kind === "error" ? status.message : null}
      </p>
    </div>
  );
}
