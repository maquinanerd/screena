/**
 * Erro do driver -> conflito tipado (C7B1).
 *
 * O caso que este arquivo existe para travar: `email_normalized` CONTEM a
 * substring `email`. Uma classificacao ingenua (testar `email` primeiro)
 * reportaria toda colisao de e-mail normalizado como colisao de e-mail bruto —
 * dois uniques distintos colapsados num alvo so, e a guarda ficaria verde
 * porque "algum alvo" foi devolvido.
 *
 * Todos os hashes/e-mails aqui sao FICTICIOS.
 */

import { describe, expect, it } from "vitest";
import {
  classifyCredentialUniqueTarget,
  classifyIdentityUniqueTarget,
  isForeignKeyViolation,
  isUniqueViolation,
} from "../error-mapping.js";

/** Erro do Prisma na forma minima que o adapter observa. */
function driverError(code: string, target?: unknown): unknown {
  return target === undefined ? { code } : { code, meta: { target } };
}

describe("reconhecimento do codigo do driver", () => {
  it("(1) P2002 e unique; P2003 e FK", () => {
    expect(isUniqueViolation(driverError("P2002"))).toBe(true);
    expect(isForeignKeyViolation(driverError("P2003"))).toBe(true);
  });

  it("(2) nao confunde os dois codigos entre si", () => {
    expect(isForeignKeyViolation(driverError("P2002"))).toBe(false);
    expect(isUniqueViolation(driverError("P2003"))).toBe(false);
  });

  it("(3) erro sem codigo, nulo ou nao-objeto nunca vira conflito", () => {
    for (const value of [null, undefined, "P2002", 42, new Error("falha de rede"), {}]) {
      expect(isUniqueViolation(value)).toBe(false);
      expect(isForeignKeyViolation(value)).toBe(false);
    }
  });

  it("(4) codigo desconhecido nao e classificado (sobe como erro de verdade)", () => {
    expect(isUniqueViolation(driverError("P1001"))).toBe(false);
    expect(isForeignKeyViolation(driverError("P2025"))).toBe(false);
  });
});

describe("alvo semantico da unique de IDENTIDADE", () => {
  // O driver nao garante UMA forma para `meta.target`: pode vir como campo do
  // modelo, coluna do banco ou nome da constraint. As tres sao exercitadas.
  const shapes = {
    campoDoModelo: (field: string) => [field],
    colunaDoBanco: (column: string) => [column],
    nomeDaConstraint: (name: string) => name,
  };

  it("(1) e-mail BRUTO nas tres formas", () => {
    expect(classifyIdentityUniqueTarget(driverError("P2002", shapes.campoDoModelo("email")))).toBe(
      "identity.email",
    );
    expect(classifyIdentityUniqueTarget(driverError("P2002", shapes.colunaDoBanco("email")))).toBe(
      "identity.email",
    );
    expect(
      classifyIdentityUniqueTarget(driverError("P2002", shapes.nomeDaConstraint("users_email_key"))),
    ).toBe("identity.email");
  });

  it("(2) e-mail NORMALIZADO nas tres formas — e NUNCA classificado como bruto", () => {
    expect(
      classifyIdentityUniqueTarget(driverError("P2002", shapes.campoDoModelo("emailNormalized"))),
    ).toBe("identity.emailNormalized");
    expect(
      classifyIdentityUniqueTarget(driverError("P2002", shapes.colunaDoBanco("email_normalized"))),
    ).toBe("identity.emailNormalized");
    expect(
      classifyIdentityUniqueTarget(
        driverError("P2002", shapes.nomeDaConstraint("users_email_normalized_key")),
      ),
    ).toBe("identity.emailNormalized");
  });

  it("(3) handle nas tres formas", () => {
    expect(classifyIdentityUniqueTarget(driverError("P2002", shapes.campoDoModelo("handle")))).toBe(
      "identity.handle",
    );
    expect(
      classifyIdentityUniqueTarget(
        driverError("P2002", shapes.nomeDaConstraint("users_handle_key")),
      ),
    ).toBe("identity.handle");
  });

  it("(4) alvo irreconhecivel devolve undefined (conflito SEM alvo, nunca chute)", () => {
    expect(classifyIdentityUniqueTarget(driverError("P2002", ["cpf"]))).toBeUndefined();
    expect(classifyIdentityUniqueTarget(driverError("P2002"))).toBeUndefined();
    expect(classifyIdentityUniqueTarget(driverError("P2002", { nao: "esperado" }))).toBeUndefined();
    expect(classifyIdentityUniqueTarget(driverError("P2002", [42, null]))).toBeUndefined();
  });

  it("(5) caixa alta nao muda a classificacao", () => {
    expect(
      classifyIdentityUniqueTarget(driverError("P2002", ["USERS_EMAIL_NORMALIZED_KEY"])),
    ).toBe("identity.emailNormalized");
  });
});

describe("alvo semantico da unique de CREDENCIAL", () => {
  it("(1) reconhece a relacao 1:1 nas tres formas", () => {
    expect(classifyCredentialUniqueTarget(driverError("P2002", ["userId"]))).toBe("credential.user");
    expect(classifyCredentialUniqueTarget(driverError("P2002", ["user_id"]))).toBe(
      "credential.user",
    );
    expect(
      classifyCredentialUniqueTarget(
        driverError("P2002", "user_password_credentials_user_id_key"),
      ),
    ).toBe("credential.user");
  });

  it("(2) alvo irreconhecivel devolve undefined", () => {
    expect(classifyCredentialUniqueTarget(driverError("P2002", ["password_hash"]))).toBeUndefined();
    expect(classifyCredentialUniqueTarget(driverError("P2002"))).toBeUndefined();
  });
});

describe("nada do driver escapa para a saida", () => {
  it("(1) a classificacao devolve SO valores da uniao fechada", () => {
    const permitidos = new Set([
      "identity.email",
      "identity.emailNormalized",
      "identity.handle",
      "credential.user",
      undefined,
    ]);
    const entradas = [
      ["users_email_key"],
      ["users_email_normalized_key"],
      ["users_handle_key"],
      ["user_password_credentials_user_id_key"],
      ["tabela_desconhecida_key"],
    ];
    for (const target of entradas) {
      expect(permitidos.has(classifyIdentityUniqueTarget(driverError("P2002", target)))).toBe(true);
      expect(permitidos.has(classifyCredentialUniqueTarget(driverError("P2002", target)))).toBe(
        true,
      );
    }
  });

  it("(2) nome de constraint/tabela NUNCA aparece no valor devolvido", () => {
    const target = classifyIdentityUniqueTarget(
      driverError("P2002", "users_email_normalized_key"),
    );
    expect(target).not.toMatch(/users_|_key|constraint|pg_|sql/i);
  });
});
