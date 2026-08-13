/**
 * watch-offer-modality.test.ts — O vocabulario UNICO de modalidade.
 *
 * Trava as tres propriedades que os quatro consumidores dependem: o conjunto
 * fechado (nada de rotulo inventado), a ORDEM declarada (incluso antes do que
 * custa) e a mensagem de descarte com o VALOR CRU.
 */

import { describe, expect, it } from "vitest";

import {
  PRICED_WATCH_MODALITIES,
  WATCH_MODALITIES,
  WATCH_MODALITY_LABELS,
  WATCH_MODALITY_ORDER,
  describeUnsupportedWatchModality,
  resolveWatchModality,
  sortWatchModalities,
  watchModalityLabel,
  watchModalityLabels,
} from "../../apps/web/src/lib/watch-offer-modality";

describe("conjunto fechado", () => {
  it("CONTROLE POSITIVO: as cinco modalidades legais sao reconhecidas", () => {
    for (const modality of WATCH_MODALITIES) {
      expect(resolveWatchModality(modality)).toBe(modality);
    }
    expect(resolveWatchModality("  rent  ")).toBe("rent");
  });

  it("CONTROLE NEGATIVO: valor fora do conjunto vira null, nunca aproximacao", () => {
    // `addon` (camada paga dentro de outro servico), `cinema` (existe no enum
    // `OfferType` mas nao e streaming) e qualquer coisa nova do upstream.
    for (const raw of ["addon", "cinema", "torrent", "flatrate", "SUBSCRIPTION", "", "  ", null]) {
      expect(resolveWatchModality(raw)).toBeNull();
    }
  });

  it("toda modalidade tem rotulo, e nenhum rotulo e jargao de API", () => {
    for (const modality of WATCH_MODALITIES) {
      const label = watchModalityLabel(modality);
      expect(label.trim()).not.toBe("");
      // O rotulo nunca pode ser o proprio identificador tecnico.
      expect(label).not.toBe(modality);
    }
    expect(WATCH_MODALITY_LABELS).toEqual({
      subscription: "Assinatura",
      free: "Grátis",
      ads: "Grátis com anúncios",
      rent: "Aluguel",
      buy: "Compra",
    });
  });
});

describe("ordem declarada: o que esta incluso vem antes do que custa", () => {
  it("a ordem cobre o conjunto inteiro, sem sobra nem falta", () => {
    expect([...WATCH_MODALITY_ORDER].sort()).toEqual([...WATCH_MODALITIES].sort());
  });

  it("o transacional fica DEPOIS de tudo que nao custa", () => {
    const posicao = (m: string): number => WATCH_MODALITY_ORDER.indexOf(m as never);
    for (const gratuito of ["subscription", "free", "ads"]) {
      expect(posicao(gratuito)).toBeLessThan(posicao("rent"));
      expect(posicao(gratuito)).toBeLessThan(posicao("buy"));
    }
    // Alugar custa menos que comprar.
    expect(posicao("rent")).toBeLessThan(posicao("buy"));
  });

  it("sortWatchModalities nao depende da ordem de chegada", () => {
    expect(sortWatchModalities(["buy", "subscription", "rent"])).toEqual([
      "subscription",
      "rent",
      "buy",
    ]);
    expect(sortWatchModalities(["rent", "buy", "subscription"])).toEqual([
      "subscription",
      "rent",
      "buy",
    ]);
  });

  it("watchModalityLabels deduplica e ordena — uma linha por plataforma", () => {
    // "Prime Video · Assinatura · Aluguel", nunca "Aluguel · Assinatura ·
    // Aluguel" (que e o que uma lista crua de ofertas produziria).
    expect(watchModalityLabels(["rent", "subscription", "rent"])).toEqual([
      "Assinatura",
      "Aluguel",
    ]);
    expect(watchModalityLabels([])).toEqual([]);
  });
});

describe("preco so onde o preco existe", () => {
  it("aluguel e compra sao as modalidades com preco; as outras nao", () => {
    expect(PRICED_WATCH_MODALITIES.has("rent")).toBe(true);
    expect(PRICED_WATCH_MODALITIES.has("buy")).toBe(true);
    for (const gratuito of ["subscription", "free", "ads"] as const) {
      expect(PRICED_WATCH_MODALITIES.has(gratuito)).toBe(false);
    }
  });
});

describe("descarte nunca silencioso", () => {
  it("a mensagem carrega o VALOR CRU e nao sugere rotulo nenhum", () => {
    const message = describeUnsupportedWatchModality("addon");
    expect(message).toContain('"addon"');
    expect(message).toContain("descartada");
    for (const label of Object.values(WATCH_MODALITY_LABELS)) {
      expect(message).not.toContain(label);
    }
  });

  it("valor vazio/nulo tambem produz mensagem — nunca string vazia", () => {
    expect(describeUnsupportedWatchModality(null)).toContain("(vazio)");
    expect(describeUnsupportedWatchModality("   ")).toContain("(vazio)");
  });
});
