/**
 * Testes da politica de indexabilidade de catalogo.
 *
 * Tres eixos: PRECEDENCIA (licenca > idioma > tecnico > tipo), DETERMINISMO
 * (mesmo estado -> mesma decisao, senao o produtor vira churn) e — desde a v2 —
 * REVERSIBILIDADE: cada exclusao por falta de conteudo tem um par que prova que
 * preencher o dado faltante, e SO ele, devolve a pagina ao indice.
 */

import { describe, expect, it } from "vitest";
import {
  CATALOG_POLICY_VERSION,
  decideCatalogIndexability,
  decisionChanged,
  type CatalogDecisionEntityType,
  type CatalogEntityFacts,
} from "./catalog-indexability.js";

const publishableMovie: CatalogEntityFacts = {
  entityType: "movie",
  language: "pt-BR",
  hasCanonicalSlug: true,
  hasTitle: true,
  hasTranslation: true,
  hasSynopsis: true,
  hasImage: true,
};

/** Uma entidade COMPLETA de cada tipo — nenhuma deve ser excluida por ser do tipo. */
const complete: Record<CatalogDecisionEntityType, CatalogEntityFacts> = {
  movie: publishableMovie,
  tv: { ...publishableMovie, entityType: "tv" },
  season: {
    entityType: "season",
    language: "pt-BR",
    hasCanonicalSlug: true,
    hasTitle: true,
    hasTranslation: false, // temporada nao tem linha em entity_translations
    parentPublishable: true,
    hasSynopsis: true,
    hasImage: true,
    listedEpisodeCount: 10,
  },
  episode: {
    entityType: "episode",
    language: "pt-BR",
    hasCanonicalSlug: true,
    hasTitle: true,
    hasTranslation: false, // idem
    parentPublishable: true,
    hasSynopsis: true,
    hasImage: true,
  },
  person: {
    entityType: "person",
    language: "pt-BR",
    hasCanonicalSlug: true,
    hasTitle: true,
    hasTranslation: true,
    publishableCreditCount: 2,
    hasDisplayableBiography: true,
    hasImage: true,
  },
};

describe("decideCatalogIndexability — precedencia", () => {
  it("(1) filme completo em idioma publicado indexa (invariante 5)", () => {
    const d = decideCatalogIndexability(publishableMovie);
    expect(d.decision).toBe("index");
    expect(d.reason).toBe("eligible");
  });

  it("(2) LICENCA bloqueada vence tudo (invariante 6)", () => {
    const d = decideCatalogIndexability({
      ...publishableMovie,
      displayedRatings: [
        { licenseDisplayAllowed: false },
      ],
    });
    expect(d.decision).toBe("blocked");
    expect(d.reason).toBe("blocked_license");
  });

  it("(3) idioma nao publicado vira draft, mesmo com tudo completo (invariante 7)", () => {
    const d = decideCatalogIndexability({ ...publishableMovie, language: "en" });
    expect(d.decision).toBe("draft");
    expect(d.reason).toBe("language_not_published");
  });

  it("(4) licenca vence idioma: bloqueado em idioma nao publicado continua blocked", () => {
    const d = decideCatalogIndexability({
      ...publishableMovie,
      language: "en",
      displayedRatings: [
        { licenseDisplayAllowed: false },
      ],
    });
    expect(d.decision).toBe("blocked");
  });

  it("(5) sem slug -> noindex tecnico", () => {
    const d = decideCatalogIndexability({ ...publishableMovie, hasCanonicalSlug: false });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("missing_slug");
  });

  it("(6) sem titulo -> noindex tecnico", () => {
    const d = decideCatalogIndexability({ ...publishableMovie, hasTitle: false });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("missing_title");
  });

  it("(7) sem traducao -> noindex (nao indexa meia pagina)", () => {
    const d = decideCatalogIndexability({ ...publishableMovie, hasTranslation: false });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("missing_translation");
  });

  it("(7b) falta de traducao vence falta de sinopse: a sinopse MORA na traducao", () => {
    // Sem a linha de traducao, `no_synopsis` seria consequencia e nao causa —
    // o censo apontaria o sintoma errado.
    const d = decideCatalogIndexability({
      ...publishableMovie,
      hasTranslation: false,
      hasSynopsis: false,
    });
    expect(d.reason).toBe("missing_translation");
  });

  it("(7c) traducao NAO e exigida de temporada/episodio (eles nao tem linha)", () => {
    // `upsertEntityTranslation` so roda para movie/tv/person. Exigir traducao de
    // episodio o prenderia em `missing_translation` para sempre, e preencher a
    // sinopse nunca o traria de volta.
    for (const type of ["season", "episode"] as const) {
      const d = decideCatalogIndexability({ ...complete[type], hasTranslation: false });
      expect(d.decision, type).toBe("index");
    }
  });
});

describe("decideCatalogIndexability — gates por tipo", () => {
  it("(8) pessoa COM credito em obra publicavel, bio e foto indexa", () => {
    expect(decideCatalogIndexability(complete.person).decision).toBe("index");
  });

  it("(9) pessoa SEM credito publicavel -> noindex (o caso das ~800)", () => {
    const d = decideCatalogIndexability({ ...complete.person, publishableCreditCount: 0 });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("no_eligible_credit");
  });

  it("(10) temporada herda a serie: serie nao publicavel -> temporada noindex", () => {
    const d = decideCatalogIndexability({ ...complete.season, parentPublishable: false });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("parent_not_publishable");
  });

  it("(11) episodio com serie publicavel e sinopse indexa", () => {
    expect(decideCatalogIndexability(complete.episode).decision).toBe("index");
  });

  it("(12) temporada sem informacao do pai NAO indexa (fail-closed)", () => {
    // `parentPublishable` ausente = nao sabemos. Fail-closed: nao indexa.
    const { parentPublishable: _omitted, ...semPai } = complete.season;
    const d = decideCatalogIndexability(semPai);
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("parent_not_publishable");
  });

  it("(12b) temporada sem sinopse MAS com episodios listados indexa", () => {
    const d = decideCatalogIndexability({
      ...complete.season,
      hasSynopsis: false,
      listedEpisodeCount: 8,
    });
    expect(d.decision).toBe("index");
  });

  it("(12c) temporada sem sinopse E sem episodio e casca -> insufficient_data", () => {
    const d = decideCatalogIndexability({
      ...complete.season,
      hasSynopsis: false,
      listedEpisodeCount: 0,
    });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("insufficient_data");
  });
});

// ---------------------------------------------------------------------------
// CONTROLES NEGATIVOS DA v2 — cada exclusao vem com o seu par reversivel.
//
// O par e o teste que importa: ele prova que a regra olha para o DADO. Um
// banimento por tipo passaria no lado "noindex" e reprovaria no lado "index".
// ---------------------------------------------------------------------------
describe("v2 — exclusao por falta de dado, e o par que a desfaz", () => {
  it("(19) pessoa SEM biografia -> noindex/no_biography (as 23.207 de hoje)", () => {
    const { hasDisplayableBiography: _omitted, ...semBio } = complete.person;
    const d = decideCatalogIndexability(semBio);
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("no_biography");
  });

  it("(20) A MESMA pessoa, mudando SO a biografia, volta a indexar", () => {
    const { hasDisplayableBiography: _omitted, ...semBio } = complete.person;
    expect(decideCatalogIndexability(semBio).decision).toBe("noindex");
    // Uma unica chave muda. Nada de tipo, nada de deploy.
    expect(
      decideCatalogIndexability({ ...semBio, hasDisplayableBiography: true }).decision,
    ).toBe("index");
  });

  it("(21) bio ingerida mas NAO liberada nao conta: a tela nao a mostra", () => {
    // `hasDisplayableBiography` = texto + `biography_source_status` liberado.
    // O produtor apura os dois juntos; aqui o que se prova e que o campo e um
    // so e que `false` exclui, venha a falta do texto ou da licenca.
    const d = decideCatalogIndexability({
      ...complete.person,
      hasDisplayableBiography: false,
    });
    expect(d.reason).toBe("no_biography");
  });

  it("(22) pessoa com bio mas SEM foto -> noindex/no_image; com foto, indexa", () => {
    const semFoto = { ...complete.person, hasImage: false };
    expect(decideCatalogIndexability(semFoto).reason).toBe("no_image");
    expect(decideCatalogIndexability({ ...semFoto, hasImage: true }).decision).toBe("index");
  });

  it("(23) episodio SEM sinopse -> noindex/no_synopsis (os ~29.500 de hoje)", () => {
    const d = decideCatalogIndexability({ ...complete.episode, hasSynopsis: false });
    expect(d.decision).toBe("noindex");
    expect(d.reason).toBe("no_synopsis");
  });

  it("(24) O MESMO episodio, mudando SO a sinopse, volta a indexar", () => {
    const semSinopse = { ...complete.episode, hasSynopsis: false };
    expect(decideCatalogIndexability(semSinopse).decision).toBe("noindex");
    expect(decideCatalogIndexability({ ...semSinopse, hasSynopsis: true }).decision).toBe(
      "index",
    );
  });

  it("(25) filme/serie sem sinopse ou sem poster nao indexam, e voltam com o dado", () => {
    for (const type of ["movie", "tv"] as const) {
      const semSinopse = { ...complete[type], hasSynopsis: false };
      expect(decideCatalogIndexability(semSinopse).reason, type).toBe("no_synopsis");
      expect(decideCatalogIndexability({ ...semSinopse, hasSynopsis: true }).decision, type).toBe(
        "index",
      );

      const semPoster = { ...complete[type], hasImage: false };
      expect(decideCatalogIndexability(semPoster).reason, type).toBe("no_image");
      expect(decideCatalogIndexability({ ...semPoster, hasImage: true }).decision, type).toBe(
        "index",
      );
    }
  });

  it("(26) fato de conteudo AUSENTE e fail-closed (nunca index por omissao)", () => {
    // Um produtor que esqueca de ler a coluna produz `noindex` com a razao
    // exata no censo — jamais um `index` acidental.
    const { hasSynopsis: _s, hasImage: _i, ...semConteudo } = complete.movie;
    expect(decideCatalogIndexability(semConteudo).decision).toBe("noindex");
    expect(decideCatalogIndexability(semConteudo).reason).toBe("no_synopsis");
  });
});

// ---------------------------------------------------------------------------
// A TRAVA CONTRA BANIMENTO POR TIPO.
//
// Este bloco falha se alguem trocar um gate dirigido a dado por
// `if (entityType === 'episode') return noindex` — ou por qualquer regra que
// exclua um tipo inteiro independentemente dos fatos.
// ---------------------------------------------------------------------------
describe("a regra e dirigida a DADO, nunca a TIPO", () => {
  const TYPES: readonly CatalogDecisionEntityType[] = [
    "movie",
    "tv",
    "season",
    "episode",
    "person",
  ];

  it("(27) TODO tipo, com os fatos completos, indexa", () => {
    for (const type of TYPES) {
      const d = decideCatalogIndexability(complete[type]);
      expect(d.decision, `${type} deveria indexar com fatos completos`).toBe("index");
      expect(d.reason, type).toBe("eligible");
    }
  });

  it("(28) nenhum tipo tem exclusao incondicional: um so fato separa os dois lados", () => {
    // Para cada tipo com gate de conteudo, o par (excluido, restaurado) difere
    // por UMA chave. Se a exclusao fosse do tipo, o lado "restaurado" falharia.
    const pares: readonly {
      type: CatalogDecisionEntityType;
      quebra: Partial<CatalogEntityFacts>;
      conserto: Partial<CatalogEntityFacts>;
    }[] = [
      { type: "movie", quebra: { hasSynopsis: false }, conserto: { hasSynopsis: true } },
      { type: "tv", quebra: { hasImage: false }, conserto: { hasImage: true } },
      {
        type: "season",
        quebra: { hasSynopsis: false, listedEpisodeCount: 0 },
        conserto: { hasSynopsis: true },
      },
      { type: "episode", quebra: { hasSynopsis: false }, conserto: { hasSynopsis: true } },
      {
        type: "person",
        quebra: { hasDisplayableBiography: false },
        conserto: { hasDisplayableBiography: true },
      },
    ];

    for (const { type, quebra, conserto } of pares) {
      const excluido = { ...complete[type], ...quebra };
      expect(decideCatalogIndexability(excluido).decision, `${type} quebrado`).toBe("noindex");
      expect(
        decideCatalogIndexability({ ...excluido, ...conserto }).decision,
        `${type} consertado deveria voltar a indexar`,
      ).toBe("index");
    }
  });

  it("(29) episodio e pessoa NAO sao excluidos por serem episodio e pessoa", () => {
    // O caso mais direto do requisito: os dois tipos que hoje somam ~52.000 das
    // 53.054 URLs indexam assim que tiverem o dado que lhes falta.
    expect(decideCatalogIndexability(complete.episode).decision).toBe("index");
    expect(decideCatalogIndexability(complete.person).decision).toBe("index");
  });
});

describe("determinismo e churn", () => {
  it("(13) mesma entrada -> mesma saida, sempre", () => {
    const a = decideCatalogIndexability(publishableMovie);
    const b = decideCatalogIndexability({ ...publishableMovie });
    expect(a).toEqual(b);
  });

  it("(14) decisao inalterada NAO gera linha nova (sem churn)", () => {
    const next = decideCatalogIndexability(publishableMovie);
    const persisted = {
      decision: next.decision,
      reason: next.reason,
      policyVersion: next.policyVersion,
    };
    expect(decisionChanged(next, persisted)).toBe(false);
  });

  it("(15) sem decisao anterior, sempre grava", () => {
    expect(decisionChanged(decideCatalogIndexability(publishableMovie), null)).toBe(true);
  });

  it("(16) mudou a RAZAO com o mesmo veredito -> grava (auditabilidade)", () => {
    const next = decideCatalogIndexability({ ...publishableMovie, hasTitle: false });
    const persisted = {
      decision: "noindex",
      reason: "missing_slug", // veredito igual, razao diferente
      policyVersion: CATALOG_POLICY_VERSION,
    };
    expect(decisionChanged(next, persisted)).toBe(true);
  });

  it("(17) mudou so a VERSAO DA POLITICA -> grava (distingue regra de entidade)", () => {
    const next = decideCatalogIndexability(publishableMovie);
    const persisted = {
      decision: next.decision,
      reason: next.reason,
      policyVersion: "catalog-indexability-v0",
    };
    expect(decisionChanged(next, persisted)).toBe(true);
  });

  it("(18) toda decisao carrega versao e origem (rastreabilidade)", () => {
    for (const facts of [publishableMovie, { ...publishableMovie, hasCanonicalSlug: false }]) {
      const d = decideCatalogIndexability(facts);
      expect(d.policyVersion).toBe(CATALOG_POLICY_VERSION);
      expect(d.origin).toBe("catalog_policy_engine");
      expect(d.explanation.trim()).not.toBe("");
    }
  });

  it("(30) a v2 e uma VERSAO NOVA: decisao v1 persistida precisa ser reemitida", () => {
    // O gate mudou; sem o bump, a auditoria nao distinguiria "a entidade mudou"
    // de "a regra mudou".
    expect(CATALOG_POLICY_VERSION).toBe("catalog-indexability-v2");
    const next = decideCatalogIndexability(publishableMovie);
    expect(
      decisionChanged(next, {
        decision: next.decision,
        reason: next.reason,
        policyVersion: "catalog-indexability-v1",
      }),
    ).toBe(true);
  });
});
