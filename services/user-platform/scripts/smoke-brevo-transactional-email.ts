/**
 * SMOKE TEST MANUAL da integracao transacional com a Brevo.
 *
 * ENVIA UM E-MAIL DE VERDADE. Por isso e explicitamente opt-in: so roda quando
 * TODAS as variaveis abaixo estao presentes, incluindo uma confirmacao humana
 * literal. Sem qualquer uma delas, o script imprime o que falta e sai com 0 —
 * nunca envia por engano.
 *
 *   BREVO_API_KEY
 *   BREVO_SENDER_NAME
 *   BREVO_SENDER_EMAIL
 *   BREVO_TEST_RECIPIENT
 *   BREVO_SMOKE_CONFIRM=yes
 *
 * NAO roda no CI, NAO roda em `pnpm test` (nao termina em `.test.ts` e
 * `services/**\/scripts/**` esta fora do typecheck e da suite), NAO roda no
 * build e NAO tem destinatario embutido no codigo.
 *
 * NENHUM TOKEN REAL e usado: o link e um marcador inofensivo. O objetivo e
 * provar credencial, remetente e entrega — nao exercitar o fluxo de seguranca.
 *
 * Uso:
 *   corepack pnpm --filter @screena/user-platform smoke:brevo
 */

import { createBrevoTransactionalEmailProvider } from "../src/providers/brevo/index.js";
import { isTransactionalEmailError } from "../src/email/types.js";

const OBRIGATORIAS = [
  "BREVO_API_KEY",
  "BREVO_SENDER_NAME",
  "BREVO_SENDER_EMAIL",
  "BREVO_TEST_RECIPIENT",
] as const;

async function main(): Promise<void> {
  const faltando = OBRIGATORIAS.filter((nome) => (process.env[nome] ?? "").trim().length === 0);
  if (process.env["BREVO_SMOKE_CONFIRM"] !== "yes") {
    faltando.push("BREVO_SMOKE_CONFIRM=yes" as (typeof OBRIGATORIAS)[number]);
  }
  if (faltando.length > 0) {
    // So NOMES de variavel — nunca valores.
    console.log("[smoke] nao executado. Ausentes:", faltando.join(", "));
    console.log("[smoke] este script envia um e-mail REAL; a confirmacao e obrigatoria.");
    return;
  }

  const provider = createBrevoTransactionalEmailProvider({
    apiKey: process.env["BREVO_API_KEY"] as string,
    senderName: process.env["BREVO_SENDER_NAME"] as string,
    senderEmail: process.env["BREVO_SENDER_EMAIL"] as string,
    replyToEmail: (process.env["BREVO_REPLY_TO_EMAIL"] ?? "").trim() || null,
  });

  const destinatario = (process.env["BREVO_TEST_RECIPIENT"] as string).trim();

  try {
    // Link INOFENSIVO: nenhum token real e emitido nem consumido aqui.
    const delivery = await provider.sendEmailVerification({
      to: destinatario,
      actionUrl: "https://cinerie.com/pt/verificar-email/?token=teste-de-integracao-sem-valor",
      expiresInMinutes: 1440,
    });
    // So o recibo tecnico. Nem o destinatario, nem o corpo, nem a chave.
    console.log("[smoke] Teste de integracao transacional da Cinerie");
    console.log("[smoke] aceito pelo fornecedor. messageId:", delivery.providerMessageId);
  } catch (error) {
    // So a CATEGORIA. O corpo da resposta do fornecedor nunca e impresso.
    const categoria = isTransactionalEmailError(error) ? error.category : "erro_desconhecido";
    console.error("[smoke] envio nao concluido. Categoria:", categoria);
    process.exitCode = 1;
  }
}

main().catch(() => {
  // Falha inesperada: nada do erro e impresso, para nao arriscar vazar a
  // requisicao (que carrega a chave nos cabecalhos).
  console.error("[smoke] falha inesperada ao executar o smoke test.");
  process.exitCode = 1;
});
