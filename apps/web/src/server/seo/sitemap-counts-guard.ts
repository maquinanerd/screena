/**
 * sitemap-counts-guard — as contagens do sitemap index nunca se EMPILHAM e nunca
 * seguram a resposta alem de um prazo quando ja existe um resultado anterior.
 *
 * ============================================================================
 * POR QUE (medido em producao em 28/09/2026)
 * ============================================================================
 * O `/sitemap.xml` conta, a cada pedido, todos os tipos publicados. A contagem de
 * pessoas levava MINUTOS (4 copias presas havia 16-24 min, todas esperando
 * disco). A Cloudflare desiste em 100 s e devolve 524 — e resposta 524 nao entra
 * no cache de borda. Entao cada novo pedido (Google, Bing, um curl) disparava mais
 * uma contagem de minutos no banco, que continuava rodando depois que o cliente ja
 * tinha ido embora. Um ciclo que se alimenta: quanto mais lento, mais copias;
 * quanto mais copias, mais lento — e a home disputando o mesmo disco.
 *
 * ============================================================================
 * O QUE ESTE GUARDA FAZ
 * ============================================================================
 * 1. SINGLE-FLIGHT: pedidos simultaneos com a mesma chave esperam a MESMA
 *    contagem. Nunca ha duas rodando para o mesmo idioma e cobertura.
 * 2. PRAZO: se ja existe um resultado anterior e a contagem nova passa do prazo,
 *    a resposta usa o anterior (e a contagem nova termina em segundo plano e
 *    substitui o anterior quando acabar). O index responde antes dos 100 s da
 *    borda, a borda o guarda, e os pedidos seguintes nem chegam ao banco.
 * 3. ERRO com resultado anterior: usa o anterior (e registra). Sem anterior, o
 *    erro sobe como sempre subiu.
 *
 * O que ele NAO faz, de proposito: guardar por TEMPO. Com o banco respondendo
 * dentro do prazo, toda resposta e a contagem FRESCA — o mesmo comportamento de
 * antes. O validador real de SEO semeia o banco entre duas chamadas do index e
 * espera o numero novo; um cache com validade quebraria essa prova. So o caso
 * lento (o de producao) passa a usar o resultado anterior.
 *
 * Resultado que o chamador declara nao guardavel (`isStorable`) nunca vira o
 * "anterior": uma contagem com tipo que falhou nao pode esconder o tipo por
 * muito tempo.
 */

/** Guarda de contagem por chave. */
export interface CountsGuard<T> {
  /** A contagem da chave: fresca se chegar no prazo; senao, a anterior. */
  get(key: string, load: () => Promise<T>): Promise<T>;
  /** Esquece anteriores e contagens em voo (so para teste/validador). */
  reset(): void;
}

export interface CountsGuardOptions<T> {
  /** Quanto esperar pela contagem nova quando ja ha uma anterior. */
  readonly deadlineMs: number;
  /** Se o resultado pode virar o "anterior" (default: sempre). */
  readonly isStorable?: (value: T) => boolean;
  /** Chamado quando a resposta usa o anterior por prazo ou erro. */
  readonly onStale?: (event: { readonly key: string; readonly reason: "deadline" | "error"; readonly error?: unknown }) => void;
  /** Relogio injetavel (testes). */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** Prazo do index: bem abaixo dos 100 s da borda, com folga para o resto da resposta. */
export const SITEMAP_COUNTS_DEADLINE_MS = 20_000;

export function createCountsGuard<T>(options: CountsGuardOptions<T>): CountsGuard<T> {
  const isStorable = options.isStorable ?? (() => true);
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const previous = new Map<string, T>();
  const inFlight = new Map<string, Promise<T>>();

  function start(key: string, load: () => Promise<T>): Promise<T> {
    const running = inFlight.get(key);
    if (running !== undefined) return running;
    const fresh = (async () => {
      try {
        const value = await load();
        if (isStorable(value)) previous.set(key, value);
        return value;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, fresh);
    return fresh;
  }

  return {
    async get(key, load) {
      const fresh = start(key, load);
      const before = previous.get(key);
      if (before === undefined) return fresh;

      let handle: unknown;
      const deadline = new Promise<{ readonly kind: "deadline" }>((resolve) => {
        handle = setTimer(() => resolve({ kind: "deadline" }), options.deadlineMs);
      });
      const settled = fresh.then(
        (value) => ({ kind: "value" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
      try {
        const outcome = await Promise.race([settled, deadline]);
        if (outcome.kind === "value") return outcome.value;
        if (outcome.kind === "error") {
          options.onStale?.({ key, reason: "error", error: outcome.error });
          return before;
        }
        options.onStale?.({ key, reason: "deadline" });
        return before;
      } finally {
        clearTimer(handle);
      }
    },
    reset() {
      previous.clear();
      inFlight.clear();
    },
  };
}
