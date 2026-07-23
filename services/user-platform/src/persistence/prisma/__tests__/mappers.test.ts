/**
 * Mappers linha -> DTO (C7B1). O que se prova aqui: o DTO e construido CAMPO A
 * CAMPO, entao uma coluna nova no schema nao pode vazar sozinha para o dominio;
 * e um status fora do dominio falha FECHADO em vez de virar `active`.
 */

import type { $Enums } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { USER_STATUSES } from "../../../core/types.js";
import {
  UnmappableRowError,
  toCredentialVerificationMaterial,
  toIdentityRecord,
  type CredentialRow,
} from "../mappers.js";

describe("mapper de status (banco -> dominio)", () => {
  it("(1) traduz os quatro status 1:1", () => {
    for (const status of USER_STATUSES) {
      const record = toIdentityRecord({ id: 1n, status: status as $Enums.UserStatus });
      expect(record.status).toBe(status);
    }
  });

  it("(2) cobre TODO o enum do dominio (guarda nao vacua)", () => {
    // Se `USER_STATUSES` crescer sem o mapa crescer junto, o teste (1) passa a
    // lancar — este aqui garante que a lista varrida nao encolheu.
    expect([...USER_STATUSES].sort()).toEqual([
      "active",
      "deleted",
      "disabled",
      "pending_deletion",
    ]);
  });

  it("(3) status desconhecido LANCA (fail-closed), nunca vira active", () => {
    // Simula um banco a frente do client gerado — o typecheck nao alcanca esse
    // caso, so o runtime.
    const unknownStatus = "banned" as string as $Enums.UserStatus;
    expect(() => toIdentityRecord({ id: 1n, status: unknownStatus })).toThrow(UnmappableRowError);
  });

  it("(3b) chave herdada do prototipo nao vira status (anteparo do includes)", () => {
    // `USER_STATUS_BY_DB["toString"]` NAO e undefined: e a funcao herdada de
    // Object.prototype. So a checagem contra USER_STATUSES barra este caso —
    // sem ela, um valor nao-string atravessaria como se fosse status.
    const chaveDoPrototipo = "toString" as string as $Enums.UserStatus;
    expect(() => toIdentityRecord({ id: 1n, status: chaveDoPrototipo })).toThrow(
      UnmappableRowError,
    );
  });

  it("(4) o erro de mapeamento nao carrega o VALOR recusado", () => {
    // Um status desconhecido chega junto de uma linha inteira; deixar o valor
    // entrar na mensagem transformaria o log de erro em canal de vazamento.
    const unknownStatus = "conta-de-teste@example.test" as string as $Enums.UserStatus;
    try {
      toIdentityRecord({ id: 1n, status: unknownStatus });
      expect.unreachable("deveria ter lancado");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("status");
      expect(message).not.toContain("@");
      expect(message).not.toContain("conta-de-teste");
    }
  });
});

describe("IdentityRecord: minimo estrito", () => {
  it("(1) tem EXATAMENTE id e status", () => {
    const record = toIdentityRecord({ id: 42n, status: "active" });
    expect(Object.keys(record).sort()).toEqual(["id", "status"]);
    expect(record.id).toBe(42n);
  });

  it("(2) nao carrega hash, algoritmo nem e-mail — nem por spread acidental", () => {
    // A linha traz colunas a mais (como traria se alguem ampliasse o `select`);
    // o mapper explicito precisa descarta-las.
    const wideRow = {
      id: 7n,
      status: "active" as $Enums.UserStatus,
      email: "vazamento@example.test",
      emailNormalized: "vazamento@example.test",
      passwordHash: "scrypt$N=1,r=1,p=1$0000$hash-ficticio-de-teste",
    };
    const record = toIdentityRecord(wideRow);
    expect(Object.keys(record).sort()).toEqual(["id", "status"]);
    const serialized = JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? "0" : v));
    expect(serialized).not.toMatch(/hash|scrypt|algorithm|@/i);
  });
});

describe("material de verificacao: unico portador do segredo", () => {
  it("(1) devolve o hash OPACO, byte a byte", () => {
    // Hash FICTICIO (formato PHC-like valido, sem segredo real).
    const passwordHash = "scrypt$N=32768,r=8,p=1$00112233$aaaabbbbccccdddd";
    const material = toCredentialVerificationMaterial({ passwordHash });
    expect(material.passwordHash).toBe(passwordHash);
  });

  it("(2) tem EXATAMENTE passwordHash — `algorithm` nao e transportado", () => {
    const wideRow: CredentialRow & { algorithm: string } = {
      passwordHash: "scrypt$N=1,r=1,p=1$0000$hash-ficticio-de-teste",
      algorithm: "scrypt",
    };
    const material = toCredentialVerificationMaterial(wideRow);
    expect(Object.keys(material)).toEqual(["passwordHash"]);
  });
});
