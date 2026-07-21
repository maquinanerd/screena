/**
 * Contrato de IDENTIDADE dos eventos de tracking (evidencia para C7A.1).
 *
 * Este arquivo NAO altera comportamento: ele PROVA, por varredura exaustiva do
 * espaco de comandos, a premissa em que a constraint do banco se apoia —
 *
 *   uma operacao (uma idempotencyKey) pode emitir VARIOS eventos, mas NUNCA
 *   dois eventos do MESMO eventType.
 *
 * Se essa premissa cair, `UNIQUE(user_id, idempotency_key, event_type)` deixa de
 * ser suficiente e a solucao precisa ser redesenhada — por isso a prova mora
 * junto do dominio, e nao dentro do validador de banco.
 */

import { describe, expect, it } from "vitest";
import { WATCH_STATES, type WatchState } from "../../core/types.js";
import { applyEpisodeProgress, type EpisodeProgressSnapshot } from "../episode-progress.js";
import { applyWatchStateChange, buildUndo, type WatchStateSnapshot } from "../watch-state.js";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const KEY = "idem-key-00000001";

function snap(overrides: Partial<WatchStateSnapshot> = {}): WatchStateSnapshot {
  return { status: "planned", startedAt: null, completedAt: null, rewatchCount: 0, version: 1, ...overrides };
}

function epSnap(overrides: Partial<EpisodeProgressSnapshot> = {}): EpisodeProgressSnapshot {
  return { watched: false, watchedAt: null, progressSeconds: null, durationSeconds: null, version: 1, ...overrides };
}

/** Identidade que a UNIQUE do banco enforca (userId e constante por chamada). */
function identity(e: { eventType: string; idempotencyKey: string }): string {
  return `${e.idempotencyKey}|${e.eventType}`;
}

/** Todos os planos de watch state possiveis (current x target), so os que aplicam. */
function allWatchStatePlans(): { label: string; events: readonly { eventType: string; idempotencyKey: string }[] }[] {
  const out: { label: string; events: readonly { eventType: string; idempotencyKey: string }[] }[] = [];
  const currents: (WatchStateSnapshot | null)[] = [
    null,
    ...WATCH_STATES.map((s) => snap({ status: s })),
    // variantes com carimbos ja preenchidos (bloqueiam watch_started/completed)
    ...WATCH_STATES.map((s) => snap({ status: s, startedAt: NOW, completedAt: NOW })),
  ];
  for (const current of currents) {
    for (const target of WATCH_STATES as readonly WatchState[]) {
      const result = applyWatchStateChange({
        current,
        target,
        now: NOW,
        expectedVersion: current === null ? 0 : current.version,
        idempotencyKey: KEY,
        accountStatus: "active",
      });
      if (result.ok) {
        out.push({ label: `${current?.status ?? "null"}->${target}`, events: result.value.events });
      }
    }
  }
  return out;
}

describe("C7A.1 — identidade dos eventos de watch state", () => {
  const plans = allWatchStatePlans();

  it("(1) a varredura produz planos (guarda nao vacua)", () => {
    expect(plans.length).toBeGreaterThan(10);
  });

  it("(2) EXISTE operacao que emite MULTIPLOS eventos com a MESMA idempotencyKey", () => {
    const multi = plans.filter((p) => p.events.length >= 2);
    expect(multi.length).toBeGreaterThan(0);
    for (const p of multi) {
      const keys = new Set(p.events.map((e) => e.idempotencyKey));
      expect(keys, `plano ${p.label} deveria compartilhar 1 chave`).toEqual(new Set([KEY]));
    }
  });

  it("(3) NENHUM plano repete o mesmo eventType (premissa da UNIQUE)", () => {
    for (const p of plans) {
      const types = p.events.map((e) => e.eventType);
      expect(new Set(types).size, `plano ${p.label} repetiu eventType: ${types.join(",")}`).toBe(
        types.length,
      );
    }
  });

  it("(4) NENHUM plano repete a IDENTIDADE (chave + tipo)", () => {
    for (const p of plans) {
      const ids = p.events.map(identity);
      expect(new Set(ids).size, `plano ${p.label} repetiu identidade`).toBe(ids.length);
    }
  });

  it("(5) a ORDEM dos eventos nao altera o conjunto de identidades", () => {
    for (const p of plans) {
      const direct = new Set(p.events.map(identity));
      const reversed = new Set([...p.events].reverse().map(identity));
      expect(reversed).toEqual(direct);
    }
  });

  it("(6) REPLAY do mesmo comando produz exatamente as mesmas identidades", () => {
    const first = allWatchStatePlans();
    const second = allWatchStatePlans();
    expect(second.map((p) => p.events.map(identity))).toEqual(first.map((p) => p.events.map(identity)));
  });

  it("(7) undo emite exatamente UM evento", () => {
    const r = buildUndo({ previous: snap(), now: NOW, idempotencyKey: KEY, accountStatus: "active" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.events.map((e) => e.eventType)).toEqual(["undo"]);
    }
  });
});

describe("C7A.1 — identidade dos eventos de episode progress", () => {
  /**
   * Varredura COMBINATORIA (produto cartesiano), nao amostragem: todo estado
   * inicial plausivel x todo patch plausivel. Combinacoes invalidas (regressao
   * de progresso sem `allowRegression`, por exemplo) sao rejeitadas pelo dominio
   * e simplesmente nao entram na lista de planos.
   */
  const currents: (EpisodeProgressSnapshot | null)[] = [
    null,
    epSnap(),
    epSnap({ watched: true, watchedAt: NOW }),
    epSnap({ progressSeconds: 500, durationSeconds: 1000 }),
    epSnap({ watched: true, watchedAt: NOW, progressSeconds: 900, durationSeconds: 1000 }),
  ];
  const watchedPatches: (boolean | undefined)[] = [undefined, true, false];
  const progressPatches: (number | undefined)[] = [undefined, 0, 100, 900];
  const durationPatches: (number | undefined)[] = [undefined, 1000];

  const cases: { label: string; current: EpisodeProgressSnapshot | null; patch: Record<string, unknown> }[] = [];
  for (let ci = 0; ci < currents.length; ci += 1) {
    for (const watched of watchedPatches) {
      for (const progressSeconds of progressPatches) {
        for (const durationSeconds of durationPatches) {
          const patch: Record<string, unknown> = {};
          if (watched !== undefined) patch.watched = watched;
          if (progressSeconds !== undefined) patch.progressSeconds = progressSeconds;
          if (durationSeconds !== undefined) patch.durationSeconds = durationSeconds;
          cases.push({
            label: `current#${ci} w=${String(watched)} p=${String(progressSeconds)} d=${String(durationSeconds)}`,
            current: currents[ci]!,
            patch,
          });
        }
      }
    }
  }

  const plans: { label: string; events: readonly { eventType: string; idempotencyKey: string }[] }[] = [];
  for (const c of cases) {
    const r = applyEpisodeProgress({
      current: c.current,
      patch: c.patch as never,
      now: NOW,
      expectedVersion: c.current === null ? 0 : c.current.version,
      idempotencyKey: KEY,
      accountStatus: "active",
    });
    if (r.ok) {
      plans.push({ label: c.label, events: r.value.events });
    }
  }

  it("(1) a varredura combinatoria produz muitos planos (guarda nao vacua)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    expect(plans.length).toBeGreaterThan(20);
  });

  it("(2) EXISTE patch que emite 2 eventos com a MESMA idempotencyKey", () => {
    const multi = plans.filter((p) => p.events.length >= 2);
    expect(multi.length).toBeGreaterThan(0);
    for (const p of multi) {
      expect(new Set(p.events.map((e) => e.idempotencyKey))).toEqual(new Set([KEY]));
    }
  });

  it("(3) NENHUM patch repete o mesmo eventType nem a identidade", () => {
    for (const p of plans) {
      const types = p.events.map((e) => e.eventType);
      expect(new Set(types).size, `patch ${p.label} repetiu eventType: ${types.join(",")}`).toBe(types.length);
      const ids = p.events.map(identity);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
