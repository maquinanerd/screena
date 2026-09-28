/**
 * sitemap-counts-guard — as contagens do sitemap nao se empilham e, com um
 * resultado anterior, nao seguram a resposta alem do prazo.
 *
 * Medido em producao em 28/09/2026: a contagem de pessoas levava minutos, a borda
 * devolvia 524 (que nao guarda) e cada novo pedido disparava mais uma contagem —
 * 4 copias presas havia 16-24 min. O guarda trava as duas coisas; o que se prova
 * aqui e a regra, sem banco e sem esperar tempo de verdade.
 */

import { describe, expect, it, vi } from "vitest";

import { createCountsGuard, SITEMAP_COUNTS_DEADLINE_MS } from "../sitemap-counts-guard";

/** Relogio manual: o teste decide quando o prazo vence. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    setTimer: (fn: () => void) => {
      next += 1;
      pending.set(next, fn);
      return next;
    },
    clearTimer: (handle: unknown) => {
      pending.delete(handle as number);
    },
    fireAll: () => {
      for (const [id, fn] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
    size: () => pending.size,
  };
}

/** Uma contagem que so termina quando o teste manda. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("sitemap-counts-guard", () => {
  it("o prazo fica bem abaixo dos 100 s da borda (a borda nao guarda 524)", () => {
    expect(SITEMAP_COUNTS_DEADLINE_MS).toBeLessThan(100_000 / 2);
  });

  it("sem contagem anterior: espera a fresca e a guarda", async () => {
    const guard = createCountsGuard<number>({ deadlineMs: 1_000, ...manualTimers() });
    await expect(guard.get("pessoas", async () => 42)).resolves.toBe(42);
  });

  it("pedidos simultaneos esperam a MESMA contagem (nunca duas em voo)", async () => {
    const timers = manualTimers();
    const guard = createCountsGuard<number>({ deadlineMs: 1_000, ...timers });
    const slow = deferred<number>();
    const load = vi.fn(() => slow.promise);
    const a = guard.get("pessoas", load);
    const b = guard.get("pessoas", load);
    const c = guard.get("pessoas", load);
    slow.resolve(7);
    await expect(Promise.all([a, b, c])).resolves.toEqual([7, 7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("com anterior e a nova DENTRO do prazo: a resposta e a nova (o comportamento de sempre)", async () => {
    const guard = createCountsGuard<number>({ deadlineMs: 1_000, ...manualTimers() });
    await guard.get("pessoas", async () => 1);
    await expect(guard.get("pessoas", async () => 2)).resolves.toBe(2);
  });

  it("com anterior e a nova ATRASADA: responde a anterior no prazo, e a nova a substitui quando termina", async () => {
    const timers = manualTimers();
    const onStale = vi.fn();
    const guard = createCountsGuard<number>({ deadlineMs: 1_000, onStale, ...timers });
    await guard.get("pessoas", async () => 100);

    const slow = deferred<number>();
    const load = vi.fn(() => slow.promise);
    const resposta = guard.get("pessoas", load);
    timers.fireAll(); // o prazo vence antes da contagem
    await expect(resposta).resolves.toBe(100);
    expect(onStale).toHaveBeenCalledWith({ key: "pessoas", reason: "deadline" });

    // Enquanto a contagem segue, um novo pedido NAO dispara outra.
    const outra = guard.get("pessoas", load);
    expect(load).toHaveBeenCalledTimes(1);
    slow.resolve(250);
    await expect(outra).resolves.toBe(250);
  });

  it("a contagem que terminou em segundo plano vira a resposta seguinte mesmo se a proxima atrasar", async () => {
    const timers = manualTimers();
    const guard = createCountsGuard<number>({ deadlineMs: 1_000, ...timers });
    await guard.get("pessoas", async () => 1);

    const slow = deferred<number>();
    const primeira = guard.get("pessoas", () => slow.promise);
    timers.fireAll();
    await expect(primeira).resolves.toBe(1);
    slow.resolve(2);
    await slow.promise;
    await Promise.resolve();

    const nunca = guard.get("pessoas", () => new Promise<number>(() => {}));
    timers.fireAll();
    await expect(nunca).resolves.toBe(2);
  });

  it("com anterior e a nova FALHANDO: responde a anterior e avisa; sem anterior, o erro sobe", async () => {
    const onStale = vi.fn();
    const guard = createCountsGuard<number>({ deadlineMs: 1_000, onStale, ...manualTimers() });
    await expect(guard.get("series", () => Promise.reject(new Error("banco fora")))).rejects.toThrow(
      "banco fora",
    );

    await guard.get("pessoas", async () => 9);
    const erro = new Error("timeout");
    await expect(guard.get("pessoas", () => Promise.reject(erro))).resolves.toBe(9);
    expect(onStale).toHaveBeenCalledWith({ key: "pessoas", reason: "error", error: erro });
  });

  it("resultado declarado nao guardavel nunca vira a anterior", async () => {
    const timers = manualTimers();
    const guard = createCountsGuard<number>({
      deadlineMs: 1_000,
      isStorable: (value) => value >= 0,
      ...timers,
    });
    await guard.get("pessoas", async () => -1);
    // Sem anterior guardada: a proxima espera a propria contagem, sem prazo.
    const slow = deferred<number>();
    const resposta = guard.get("pessoas", () => slow.promise);
    expect(timers.size()).toBe(0);
    slow.resolve(5);
    await expect(resposta).resolves.toBe(5);
  });

  it("chaves diferentes (idioma, tipo, cobertura, chave de emergencia) nao se misturam", async () => {
    const guard = createCountsGuard<number>({ deadlineMs: 1_000, ...manualTimers() });
    await guard.get("pt-BR|people|relevance:on", async () => 10);
    await guard.get("pt-BR|people|relevance:off", async () => 20);
    await expect(guard.get("pt-BR|people|relevance:on", async () => 11)).resolves.toBe(11);
    await expect(guard.get("pt-BR|people|relevance:off", async () => 21)).resolves.toBe(21);
  });

  it("reset esquece anteriores (o validador precisa de rodada sem historico)", async () => {
    const timers = manualTimers();
    const guard = createCountsGuard<number>({ deadlineMs: 1_000, ...timers });
    await guard.get("pessoas", async () => 3);
    guard.reset();
    const slow = deferred<number>();
    const resposta = guard.get("pessoas", () => slow.promise);
    expect(timers.size()).toBe(0); // sem anterior, nao ha prazo a armar
    slow.resolve(4);
    await expect(resposta).resolves.toBe(4);
  });
});
