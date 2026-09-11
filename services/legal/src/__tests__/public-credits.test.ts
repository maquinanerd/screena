/**
 * public-credits.test.ts — "FONTE NOVA APARECE NO RODAPE SOZINHA."
 *
 * Depois que o credito saiu do corpo das paginas (decisao do proprietario,
 * 2026-08-13), o rodape virou o UNICO lugar onde a atribuicao acontece. O modo
 * de falha novo — o que esta mudanca criou e que nao existia antes — e este:
 *
 *   alguem registra uma fonte em `authorization-spec.ts`, o dado entra no ar, e
 *   o credito nao aparece em lugar nenhum, porque o rodape carregava strings
 *   literais e ninguem lembrou de edita-lo.
 *
 * O teste central deste arquivo e o que injeta uma fonte FICTICIA no spec e
 * exige que ela apareca na projecao sem que uma linha do rodape mude. Se esse
 * teste for deletado ou afrouxado, o credito da proxima fonte some em silencio.
 */

import { describe, expect, it } from "vitest";

import {
  PROVIDER_LOGO_FILES,
  STATIC_AUTHORIZATION,
  STREAMING_ORIGIN_CREDITS,
  TMDB_LOGO_ASSET,
  type AuthorizationEntry,
} from "../authorization-spec.js";
import {
  publicRatingSourceMark,
  publicRatingStateIcon,
  publicSourceCredits,
  publicTrademarkNotices,
  publicWatchProviderLogo,
  tmdbNonEndorsementDisclaimer,
} from "../public-credits.js";

/** Textos da projecao real, para assercoes de conteudo. */
const textsOf = (credits: readonly { text: string }[]): string[] =>
  credits.map((credit) => credit.text);

describe("publicSourceCredits — a projecao publica do registro de licencas", () => {
  it("CONTROLE POSITIVO: nomeia as fontes que hoje alimentam a tela, com o texto VERBATIM da licenca", () => {
    const texts = textsOf(publicSourceCredits());

    // As tres fontes editoriais servidas pela OMDb.
    expect(texts).toContain("Nota fornecida por IMDb");
    expect(texts).toContain("Nota fornecida por Rotten Tomatoes");
    expect(texts).toContain("Nota fornecida por Metacritic");
    // Catalogo.
    expect(texts).toContain(
      "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
    );
    // As DUAS origens de oferta. O JustWatch so existe aqui porque as licencas
    // de streaming nascem por provedor canonico, dinamicamente — ver
    // STREAMING_ORIGIN_CREDITS.
    expect(texts).toContain("Disponibilidade fornecida por Movie of the Night");
    expect(texts).toContain("Disponibilidade fornecida por JustWatch");
  });

  it("nao deduz nem reescreve: todo texto sai identico a alguma licenca do spec", () => {
    const permitidos = new Set<string>([
      ...STATIC_AUTHORIZATION.map((entry) => entry.license.attributionText),
      ...STREAMING_ORIGIN_CREDITS.map((origin) => origin.attributionText),
    ]);

    for (const credit of publicSourceCredits()) {
      expect(permitidos.has(credit.text)).toBe(true);
    }
  });

  it("TMDB aparece UMA vez, apesar de ter VARIAS licencas (metadados, imagens, video)", () => {
    // As licencas do TMDB compartilham o mesmo `attributionText`. Sem
    // deduplicacao por texto, o rodape repetiria o disclaimer — e um credito
    // repetido nao e "mais credito", e ruido que faz o leitor parar de ler.
    // Eram duas ate 13/08/2026; a de video entrou e o rodape nao pode mudar.
    const disclaimer = tmdbNonEndorsementDisclaimer();
    const ocorrencias = textsOf(publicSourceCredits()).filter((t) => t === disclaimer);
    expect(ocorrencias).toHaveLength(1);

    const licencasTmdb = STATIC_AUTHORIZATION.filter(
      (entry) => entry.license.sourceKey === "tmdb",
    );
    expect(licencasTmdb.length).toBeGreaterThan(1);
  });

  it("Movie of the Night aparece UMA vez, e chega pelas ORIGENS", () => {
    const ocorrencias = textsOf(publicSourceCredits()).filter(
      (t) => t === "Disponibilidade fornecida por Movie of the Night",
    );
    expect(ocorrencias).toHaveLength(1);

    // A entrada estatica dele NAO passa no filtro de exibicao (a exibicao de
    // oferta e gated por provedor canonico). Quem o traz ao rodape sao as
    // origens — e este assert existe para que estreitar o filtro sem olhar as
    // origens reprove aqui, e nao em producao.
    const estatica = STATIC_AUTHORIZATION.find(
      (e) => e.license.sourceKey === "movie-of-the-night",
    )!;
    expect(estatica.license.displayAllowed).toBe(false);
    expect(textsOf(publicSourceCredits(STATIC_AUTHORIZATION, []))).not.toContain(
      "Disponibilidade fornecida por Movie of the Night",
    );
  });

  it("fonte com EXIBICAO REVOGADA nao e creditada (Letterboxd e FilmAffinity)", () => {
    // Decisao do proprietario, 2026-08-13. Creditar publicamente uma fonte que
    // nao pode aparecer e afirmacao sem lastro.
    const texts = textsOf(publicSourceCredits());
    expect(texts).not.toContain("Nota fornecida por Letterboxd");
    expect(texts).not.toContain("Nota fornecida por FilmAffinity");

    // CONTROLE POSITIVO do proprio negativo: as licencas CONTINUAM no spec (nao
    // foram apagadas — apagar deixaria a licenca orfa e vigente no banco, ver o
    // cabecalho de DISPLAY_REVOKED_SOURCES). O que as tira do rodape e o
    // `displayAllowed: false`, nao a ausencia.
    for (const source of ["letterboxd", "filmaffinity"]) {
      const entry = STATIC_AUTHORIZATION.find((e) => e.license.ratingSourceKey === source);
      expect(entry, `licenca de ${source} sumiu do spec`).toBeDefined();
      expect(entry!.license.displayAllowed).toBe(false);
      expect(entry!.license.scoreAllowed).toBe(false);
      // Sem decisao de exibicao, o trigger nao tem o que aprovar.
      expect(entry!.decisions.some((d) => d.useCase === "rating_display")).toBe(false);
    }
  });

  it("revogar a exibicao NAO dispensa o credito, caso ela volte", () => {
    // `requiresAttribution` continua `true`: a obrigacao de creditar nao some
    // porque a exibicao parou. Religar `displayAllowed` devolve o credito ao
    // rodape sozinho — sem ninguem lembrar de reativar a atribuicao.
    for (const source of ["letterboxd", "filmaffinity"]) {
      const entry = STATIC_AUTHORIZATION.find((e) => e.license.ratingSourceKey === source)!;
      expect(entry.license.requiresAttribution).toBe(true);

      const religada = {
        ...entry,
        license: { ...entry.license, displayAllowed: true },
      };
      expect(textsOf(publicSourceCredits([religada], []))).toEqual([
        entry.license.attributionText,
      ]);
    }
  });

  it("A TRAVA: fonte NOVA registrada no spec entra na projecao sem editar o rodape", () => {
    // Este e o teste que substitui a proximidade fisica entre credito e dado.
    // A fonte abaixo nao existe; ela representa a PROXIMA licenca que alguem vai
    // registrar. Se este teste falhar, o credito dela nao vai ao ar.
    const fonteFicticia: AuthorizationEntry = {
      label: "fonte-ficticia-de-teste",
      role: "editorial-rating-source",
      license: {
        sourceKey: "fonte_ficticia",
        contentType: "rating",
        ratingSourceKey: "fonte_ficticia",
        providerKey: null,
        territory: null,
        licenseStatus: "third_party",
        displayAllowed: true,
        logoAllowed: false,
        logoBasis: null,
        logoRationale: "fixture de teste: sem marca declarada",
        logoAsset: null,
        scoreAllowed: true,
        reviewQuoteAllowed: false,
        requiresAttribution: true,
        requiresLinkback: false,
        attributionText: "Nota fornecida por Fonte Ficticia",
        policyVersion: "teste/ficticia/v1",
        notes: "Fonte inexistente, usada so para provar a derivacao automatica.",
      },
      decisions: [],
    };

    const comFonteNova = publicSourceCredits([...STATIC_AUTHORIZATION, fonteFicticia]);

    expect(textsOf(comFonteNova)).toContain("Nota fornecida por Fonte Ficticia");
    // E ela chega COM papel descrito — nao como uma linha solta sem contexto.
    const nova = comFonteNova.find((c) => c.text === "Nota fornecida por Fonte Ficticia");
    expect(nova?.roleLabel).toBe("Notas");
    // CONTROLE NEGATIVO do proprio teste: a fonte ficticia NAO esta na projecao
    // real. Sem esta linha, um bug que fizesse `publicSourceCredits` devolver
    // tudo o que existe passaria pelo motivo errado.
    expect(textsOf(publicSourceCredits())).not.toContain("Nota fornecida por Fonte Ficticia");
  });

  it("ordem e estavel entre chamadas (duas replicas do site mostram o mesmo rodape)", () => {
    expect(textsOf(publicSourceCredits())).toEqual(textsOf(publicSourceCredits()));
  });

  it("licenca com texto de atribuicao VAZIO nao vira credito em branco", () => {
    // Uma linha vazia no rodape pareceria um credito e nao seria um. Melhor
    // ausente e detectavel do que presente e mudo.
    const vazia: AuthorizationEntry = {
      ...STATIC_AUTHORIZATION[0]!,
      license: { ...STATIC_AUTHORIZATION[0]!.license, attributionText: "   " },
    };
    const credits = publicSourceCredits([vazia], []);
    expect(credits).toHaveLength(0);
  });

  /**
   * Ate 20/08/2026 este teste dizia "a projecao nao tem sequer o campo de logo".
   * Ele agora tem — porque os termos do TMDB EXIGEM a marca. O que NAO mudou, e
   * o que este bloco protege, e que a projecao nao DECIDE nada: ela so repassa o
   * que a licenca declarou.
   */
  it("a forma do credito e fechada: nada alem dos campos declarados", () => {
    for (const credit of publicSourceCredits()) {
      expect(Object.keys(credit).sort()).toEqual([
        "creditKey",
        "logo",
        "logoPending",
        "role",
        "roleLabel",
        "text",
      ]);
    }
  });

  it("NEGATIVO: licenca sem logo autorizado nao projeta logo NEM pendencia", () => {
    // A fonte que nao deve marca nenhuma nao pode gerar evento de ausencia:
    // seria ruido de log afirmando uma obrigacao que nao existe.
    const semLogo: AuthorizationEntry = {
      label: "sem-logo",
      role: "editorial-rating-source",
      license: {
        sourceKey: "sem_logo",
        contentType: "rating",
        ratingSourceKey: "sem_logo",
        providerKey: null,
        territory: null,
        licenseStatus: "third_party",
        displayAllowed: true,
        logoAllowed: false,
        logoBasis: null,
        logoRationale: "fixture: fonte que nao concede marca",
        logoAsset: null,
        scoreAllowed: true,
        reviewQuoteAllowed: false,
        requiresAttribution: true,
        requiresLinkback: false,
        attributionText: "Nota fornecida por Sem Logo",
        policyVersion: "teste/sem-logo/v1",
        notes: "fixture",
      },
      decisions: [],
    };
    const [credito] = publicSourceCredits([semLogo], []);
    expect(credito!.logo).toBeNull();
    expect(credito!.logoPending).toBe(false);
  });

  it("TMDB com o arquivo oficial PRESENTE: logo sobe e o texto continua", () => {
    // Desde 2026-08-20 o arquivo oficial (Primary long, baixado da pagina de
    // logos do TMDB) esta no repositorio e a licenca declara `present`. O
    // credito TEXTUAL continua — os termos pedem os DOIS.
    //
    // A ALTURA VEM DA LICENCA, e nao de um literal aqui. Este assert ja ficou
    // desatualizado uma vez: a PR #203 baixou o logo do TMDB de 18 para 13 px
    // (o wordmark e LONGO — 489x35 no viewBox — e a altura e o unico controle de
    // largura), o spec mudou e o teste continuou exigindo 18, deixando a suite
    // vermelha por uma discordancia que nao era defeito de codigo. Lendo de
    // `TMDB_LOGO_ASSET`, o teste passa a provar o que importa (o logo sobe com o
    // arquivo e a medida DECLARADOS) e nunca mais discorda da decisao.
    const tmdb = publicSourceCredits().find((c) => c.text.includes("TMDB"));
    expect(tmdb, "o credito do TMDB tem de existir").toBeDefined();
    expect(tmdb!.text.length).toBeGreaterThan(0);
    const size = TMDB_LOGO_ASSET.intrinsicSize!;
    expect(tmdb!.logo).toEqual({
      src: TMDB_LOGO_ASSET.path,
      alt: TMDB_LOGO_ASSET.alt,
      heightPx: TMDB_LOGO_ASSET.displayHeightPx,
      // A largura sai da PROPORCAO do arquivo na altura declarada — e ela que o
      // <img> leva no atributo `width` para nao haver salto de layout.
      widthPx: Math.round((TMDB_LOGO_ASSET.displayHeightPx * size.width) / size.height),
    });
    // O controle que impede o assert de virar tautologia: se alguem rebaixar o
    // arquivo para pendente, este teste tem de reprovar em vez de se adaptar.
    expect(TMDB_LOGO_ASSET.status).toBe("present");
    expect(tmdb!.logoPending).toBe(false);
  });

  it("fonte de nota com logo autorizado e arquivo AUSENTE: textual + pendencia declarada", () => {
    // O estado real do Rotten Tomatoes hoje (decisao do dono; a palavra-marca
    // ainda fora do repositorio — o que entrou foi o icone de ESTADO, que nunca
    // ocupa este slot). O credito textual sai; o logo nao; e `logoPending` e a
    // unica coisa que separa isto de "nada e devido".
    const rt = publicSourceCredits().find((c) => c.text.includes("Rotten Tomatoes"));
    expect(rt, "o credito do Rotten Tomatoes tem de existir").toBeDefined();
    expect(rt!.logo).toBeNull();
    expect(rt!.logoPending).toBe(true);
  });

  it("IMDb e Metacritic com arquivo PRESENTE (2026-09-11): logo sobe e o texto continua", () => {
    for (const nome of ["IMDb", "Metacritic"]) {
      const credito = publicSourceCredits().find((c) => c.text === `Nota fornecida por ${nome}`);
      expect(credito, `o credito de ${nome} tem de existir`).toBeDefined();
      expect(credito!.logo?.alt).toBe(nome);
      expect(credito!.logo?.src).toMatch(/^\/brand\/sources\/.+\.webp$/);
      expect(credito!.logoPending).toBe(false);
      expect(credito!.text).toContain(nome);
    }
  });

  it("com o arquivo OFICIAL presente, o logo sobe — e o texto CONTINUA", () => {
    // Prova a outra direçao sem esperar o arquivo real: o dia em que o status
    // virar `present`, isto e o que acontece. Se o texto sumisse junto, reprova.
    const comArquivo: AuthorizationEntry = {
      ...STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "tmdb")!,
      license: {
        ...STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "tmdb")!.license,
        logoAsset: {
          path: "/brand/sources/tmdb-primary.svg",
          officialSourceUrl: "https://www.themoviedb.org/about/logos-attribution",
          alt: "TMDB",
          displayHeightPx: 18,
          format: "svg",
          intrinsicSize: null,
          kind: "wordmark",
          displayConditions: [],
          status: "present",
        },
      },
    };
    const [credito] = publicSourceCredits([comArquivo], []);
    expect(credito!.logo).toEqual({
      src: "/brand/sources/tmdb-primary.svg",
      alt: "TMDB",
      heightPx: 18,
      // Sem dimensoes declaradas, sem largura inventada.
      widthPx: null,
    });
    expect(credito!.logoPending).toBe(false);
    expect(credito!.text).toContain("TMDB");
  });
});

describe("tmdbNonEndorsementDisclaimer — exigencia dos termos da API", () => {
  it("devolve a frase exata da licenca do TMDB", () => {
    expect(tmdbNonEndorsementDisclaimer()).toBe(
      "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
    );
  });

  it("FAIL-CLOSED: sem a licenca do TMDB no spec, LANCA em vez de renderizar sem o disclaimer", () => {
    const semTmdb = STATIC_AUTHORIZATION.filter(
      (entry) => entry.license.sourceKey !== "tmdb",
    );
    expect(() => tmdbNonEndorsementDisclaimer(semTmdb)).toThrow(/licenca do TMDB ausente/i);
  });
});

describe("publicTrademarkNotices — condicoes de marca das fontes com logo no ar", () => {
  it("o IMDb, com logo presente, exige a declaracao de marca registrada", () => {
    expect(publicTrademarkNotices()).toContain(
      "IMDb, IMDb.COM, and the IMDb logo are trademarks of IMDb.com, Inc. or its affiliates.",
    );
  });

  it("condicao de marca de logo PENDENTE nao sai (texto juridico sem objeto)", () => {
    const imdb = STATIC_AUTHORIZATION.find((e) => e.license.ratingSourceKey === "imdb")!;
    const pendente: AuthorizationEntry = {
      ...imdb,
      license: {
        ...imdb.license,
        logoAsset: { ...imdb.license.logoAsset!, status: "pending_official_file" },
      },
    };
    expect(publicTrademarkNotices([pendente], [])).toEqual([]);
  });
});

describe("publicRatingSourceMark — a marca da fonte de nota, pela licenca", () => {
  it("IMDb e Metacritic: arquivo declarado e presente", () => {
    expect(publicRatingSourceMark("imdb").logo?.src).toBe("/brand/sources/imdb.webp");
    expect(publicRatingSourceMark("metacritic").logo?.src).toBe("/brand/sources/metacritic.webp");
  });

  it("largura derivada da proporcao do arquivo (IMDb 960x484 a 18px = 36px)", () => {
    expect(publicRatingSourceMark("imdb").logo).toEqual({
      src: "/brand/sources/imdb.webp",
      alt: "IMDb",
      heightPx: 18,
      widthPx: 36,
    });
  });

  it("Rotten Tomatoes: palavra-marca pendente — sem logo, com pendencia declarada", () => {
    expect(publicRatingSourceMark("rotten_tomatoes")).toEqual({ logo: null, logoPending: true });
  });

  it("fonte com exibicao revogada ou desconhecida: nada (nem pendencia)", () => {
    expect(publicRatingSourceMark("letterboxd")).toEqual({ logo: null, logoPending: false });
    expect(publicRatingSourceMark("fonte_inexistente")).toEqual({ logo: null, logoPending: false });
  });
});

describe("publicRatingStateIcon — icone de ESTADO derivado do VALOR", () => {
  it("Tomatometer >= 60: o tomate Fresh", () => {
    expect(publicRatingStateIcon("rotten_tomatoes", "critics", 60)?.alt).toBe("Fresh");
    expect(publicRatingStateIcon("rotten_tomatoes", "critics", 100)?.src).toBe(
      "/brand/sources/rotten-tomatoes-fresh.webp",
    );
  });

  it("Tomatometer < 60: nenhum icone (o Rotten Splat nao esta no repositorio)", () => {
    expect(publicRatingStateIcon("rotten_tomatoes", "critics", 59)).toBeNull();
    expect(publicRatingStateIcon("rotten_tomatoes", "critics", 0)).toBeNull();
  });

  it("o tomate e SO do Tomatometer: publico, outra fonte e valor invalido nao ganham", () => {
    expect(publicRatingStateIcon("rotten_tomatoes", "audience", 90)).toBeNull();
    expect(publicRatingStateIcon("imdb", "audience", 90)).toBeNull();
    expect(publicRatingStateIcon("metacritic", "critics", 90)).toBeNull();
    expect(publicRatingStateIcon("rotten_tomatoes", "critics", Number.NaN)).toBeNull();
  });

  it("sem licenca de marca da fonte, o icone nao sai", () => {
    const semMarca: AuthorizationEntry[] = STATIC_AUTHORIZATION.map((e) =>
      e.license.ratingSourceKey === "rotten_tomatoes"
        ? { ...e, license: { ...e.license, logoAllowed: false, logoBasis: null, logoAsset: null } }
        : e,
    );
    expect(publicRatingStateIcon("rotten_tomatoes", "critics", 90, semMarca)).toBeNull();
  });
});

describe("publicWatchProviderLogo — o logo do provedor, pela licenca dele", () => {
  it("todo provedor com arquivo declarado projeta o PNG da entrega TMDB", () => {
    const slugs = Object.keys(PROVIDER_LOGO_FILES);
    expect(slugs.length).toBeGreaterThan(30); // controle positivo
    for (const slug of slugs) {
      const logo = publicWatchProviderLogo(slug, "Nome");
      expect(logo, slug).not.toBeNull();
      expect(logo!.src).toBe(`/brand/providers/${slug}.png`);
      expect(logo!.alt).toBe("Nome");
      expect(logo!.heightPx).toBe(24);
    }
  });

  it("slug sem arquivo, vazio ou chave de fornecedor nao vira logo", () => {
    expect(publicWatchProviderLogo("provedor-sem-arquivo", "X")).toBeNull();
    expect(publicWatchProviderLogo("", "X")).toBeNull();
    expect(publicWatchProviderLogo(null, "X")).toBeNull();
    expect(publicWatchProviderLogo("vendor:8", "X")).toBeNull();
  });
});
