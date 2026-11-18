/**
 * editorial-context-presenter.test.ts — a resposta do Context Service E o
 * contrato `cinerie-editorial-context-v1`.
 *
 * O presenter espelha os tipos do contrato sem importar o pacote em runtime;
 * este teste e a trava do espelho: toda saida passa pelo parser oficial de
 * `@screena/editorial-contracts`, e os campos que o consumidor usa (papel da
 * imagem, link do player, generos) sobrevivem ao parse.
 */

import { describe, expect, it } from "vitest";

import { isMediaUsableForEditorial, parseCinerieEditorialContextV1 } from "@screena/editorial-contracts";

import {
  buildEditorialContext,
  contractText,
  type ContextBuildOptions,
  type ContextTitleInput,
} from "../editorial-context-presenter";
import type { WatchAvailabilityView } from "../watch-availability-presenter";

const NOW = new Date("2026-11-18T12:00:00.000Z");

const OPTIONS: ContextBuildOptions = {
  requestId: "mn-prime:teste",
  now: NOW,
  siteUrl: "https://cinerie.com",
  mediaForEditorial: true,
  imageCredit: "TMDB",
};

const WATCH: WatchAvailabilityView = {
  groups: [
    {
      offerType: "subscription",
      label: "Assinatura",
      offers: [
        {
          providerName: "Max",
          providerKey: "max",
          providerSlug: "max",
          offerType: "subscription",
          destinationUrl: "https://www.max.com/br/pt/movies/duna",
          destinationKind: "provider",
          quality: null,
          priceLabel: null,
          attribution: { text: "Dados de disponibilidade: JustWatch", url: "https://www.justwatch.com" },
        },
        {
          providerName: "Max",
          providerKey: "max-2",
          providerSlug: "max",
          offerType: "subscription",
          destinationUrl: "https://www.max.com/br/pt/movies/duna?dup=1",
          destinationKind: "provider",
          quality: null,
          priceLabel: null,
          attribution: null,
        },
      ],
      brands: [],
    },
    {
      offerType: "rent",
      label: "Aluguel",
      offers: [
        {
          providerName: "Apple TV",
          providerKey: "apple",
          providerSlug: "apple-tv",
          offerType: "rent",
          destinationUrl: "not a url",
          destinationKind: "aggregator",
          quality: "HD",
          priceLabel: "R$ 14,90",
          attribution: null,
        },
      ],
      brands: [],
    },
  ],
  updatedAtLabel: null,
  attributions: [],
};

function movie(overrides: Partial<ContextTitleInput> = {}): ContextTitleInput {
  return {
    kind: "movie",
    entityId: "4242",
    title: "Duna: Parte Dois",
    originalTitle: "Dune: Part Two",
    slug: "duna-parte-dois",
    canonicalUrl: "https://cinerie.com/pt/filmes/duna-parte-dois/",
    synopsis: { text: "Paul Atreides se une a Chani e aos <i>Fremen</i>.", languageCode: "pt-BR" },
    releaseDateIso: "2024-02-29",
    runtimeMinutes: 166,
    genres: ["Ficção científica", "Aventura"],
    externalIds: [
      { source: "imdb", externalId: "tt15239678" },
      { source: "imdb", externalId: "tt0000000" },
      { source: "facebook", externalId: "dune" },
    ],
    tmdbId: 693134,
    cast: [
      { personId: "1", name: "Timothée Chalamet", slug: "timothee-chalamet", character: "Paul Atreides" },
      { personId: "2", name: "Zendaya", slug: null, character: "Chani" },
    ],
    directors: [{ personId: "9", name: "Denis Villeneuve", slug: "denis-villeneuve", character: null }],
    writers: [{ personId: "10", name: "Jon Spaihts", slug: null, character: null }],
    poster: { url: "https://image.tmdb.org/t/p/w780/poster.jpg", width: 780, height: 1170 },
    backdrop: { url: "https://image.tmdb.org/t/p/w1280/backdrop.jpg", width: 1280, height: 720 },
    scenes: [
      { url: "https://image.tmdb.org/t/p/w1280/cena1.jpg", width: 1280, height: 720 },
      { url: "https://image.tmdb.org/t/p/w1280/backdrop.jpg", width: 1280, height: 720 },
    ],
    imageDeniedReason: null,
    trailer: {
      embedUrl: "https://www.youtube-nocookie.com/embed/Way9Dexny3w",
      watchUrl: "https://www.youtube.com/watch?v=Way9Dexny3w",
      name: "Trailer oficial",
    },
    watch: WATCH,
    series: null,
    ...overrides,
  };
}

describe("buildEditorialContext", () => {
  it("produz um contrato v1 valido, com os campos que o consumidor usa", () => {
    const context = buildEditorialContext([movie()], OPTIONS);
    const parsed = parseCinerieEditorialContextV1(context);
    expect(parsed.ok, JSON.stringify(parsed.ok ? null : parsed.issues)).toBe(true);
    if (!parsed.ok) return;

    const entity = parsed.value.entities[0];
    expect(entity?.title).toBe("Duna: Parte Dois");
    expect(entity?.originalTitle).toBe("Dune: Part Two");
    expect(entity?.genres).toEqual(["Ficção científica", "Aventura"]);
    // Marcacao da sinopse sai (o contrato recusaria a resposta inteira).
    expect(entity?.overview).toBe("Paul Atreides se une a Chani e aos Fremen.");
    expect(entity?.externalIds.map((id) => id.provider)).toEqual(["tmdb", "imdb"]);
    expect(entity?.cast[0]).toMatchObject({
      entityId: "1",
      name: "Timothée Chalamet",
      character: "Paul Atreides",
      canonicalUrl: "https://cinerie.com/pt/pessoas/timothee-chalamet/",
    });
    expect(entity?.crew.map((person) => person.role)).toEqual(["direção", "roteiro"]);

    const roles = parsed.value.media.map((media) => media.role);
    // A cena repetida do backdrop nao entra duas vezes.
    expect(roles).toEqual(["backdrop", "scene", "poster", "trailer"]);
    const trailer = parsed.value.media.find((media) => media.role === "trailer");
    expect(trailer?.embedUrl).toBe("https://www.youtube-nocookie.com/embed/Way9Dexny3w");
    // O tipo vai junto do id em toda peca (filme e serie tem sequencias proprias).
    expect(parsed.value.media.every((media) => media.entityKind === "movie")).toBe(true);
  });

  it("pôster nunca e capa; backdrop e cena podem ser, e todos exigem credito", () => {
    const context = buildEditorialContext([movie()], OPTIONS);
    const poster = context.media.find((media) => media.role === "poster");
    const backdrop = context.media.find((media) => media.role === "backdrop");
    expect(poster?.allowedForHero).toBe(false);
    expect(backdrop?.allowedForHero).toBe(true);
    for (const media of context.media.filter((item) => item.kind === "image")) {
      expect(media.requiresAttribution).toBe(true);
      expect(media.credit).toBe("TMDB");
      const parsed = parseCinerieEditorialContextV1(buildEditorialContext([movie()], OPTIONS));
      if (parsed.ok) {
        const same = parsed.value.media.find((item) => item.mediaId === media.mediaId);
        expect(same && isMediaUsableForEditorial(same)).toBe(true);
      }
    }
  });

  it("com a chave de midia desligada, nenhuma imagem sai e a lacuna e nomeada", () => {
    const context = buildEditorialContext([movie()], { ...OPTIONS, mediaForEditorial: false });
    expect(context.media.filter((media) => media.kind === "image")).toHaveLength(0);
    expect(context.omissions).toContainEqual({ scope: "media", ref: "4242", reason: "license_blocked" });
    // O trailer segue o portao proprio (linha de video), nao a chave de imagem.
    expect(context.media.some((media) => media.role === "trailer")).toBe(true);
    expect(parseCinerieEditorialContextV1(context).ok).toBe(true);
  });

  it("licenca de imagem negada vira omissao, nunca imagem", () => {
    const context = buildEditorialContext(
      [movie({ poster: null, backdrop: null, scenes: [], imageDeniedReason: "sem licenca" })],
      OPTIONS,
    );
    expect(context.media.filter((media) => media.kind === "image")).toHaveLength(0);
    expect(context.omissions).toContainEqual({ scope: "media", ref: "4242", reason: "license_blocked" });
  });

  it("ofertas: uma por plataforma e modalidade, sem URL invalida, com credito", () => {
    const context = buildEditorialContext([movie()], OPTIONS);
    expect(context.availability).toEqual([
      {
        entityKind: "movie",
        entityId: "4242",
        country: "BR",
        providerName: "Max",
        offerType: "flatrate",
        url: "https://www.max.com/br/pt/movies/duna",
        displayAllowed: true,
        attributionText: "Dados de disponibilidade: JustWatch",
      },
      {
        entityKind: "movie",
        entityId: "4242",
        country: "BR",
        providerName: "Apple TV",
        offerType: "rent",
        displayAllowed: true,
      },
    ]);
  });

  it("serie leva temporadas e sem sinopse pt-BR declara a lacuna", () => {
    const series = movie({
      kind: "tv",
      entityId: "77",
      title: "A Casa do Dragão",
      originalTitle: "House of the Dragon",
      slug: "a-casa-do-dragao",
      canonicalUrl: "https://cinerie.com/pt/series/a-casa-do-dragao/",
      synopsis: { text: "The Targaryen civil war.", languageCode: "en-US" },
      runtimeMinutes: null,
      watch: null,
      trailer: null,
      series: { seasons: 3, episodes: 26, lastAirDateIso: "2026-08-02", ended: false },
    });
    const context = buildEditorialContext([series], OPTIONS);
    const parsed = parseCinerieEditorialContextV1(context);
    expect(parsed.ok, JSON.stringify(parsed.ok ? null : parsed.issues)).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entities[0]).toMatchObject({
      entityKind: "tv",
      seasonCount: 3,
      episodeCount: 26,
      lastAirDate: "2026-08-02",
      ended: false,
    });
    expect(context.omissions).toEqual(
      expect.arrayContaining([
        { scope: "entity", ref: "77", reason: "not_translated" },
        { scope: "availability", ref: "77", reason: "license_unknown" },
      ]),
    );
  });

  it("contexto vazio (nenhuma obra resolvida) ainda e um contrato valido", () => {
    expect(parseCinerieEditorialContextV1(buildEditorialContext([], OPTIONS)).ok).toBe(true);
  });
});

describe("contractText", () => {
  it("tira marcacao, comprime espaco e corta no limite sem quebrar palavra", () => {
    expect(contractText("  <b>Oi</b>   mundo<br/>novo ", 100)).toBe("Oi mundo novo");
    expect(contractText("", 10)).toBeUndefined();
    expect(contractText(null, 10)).toBeUndefined();
    const cut = contractText("palavra ".repeat(50), 40) ?? "";
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut.endsWith("…")).toBe(true);
  });
});
