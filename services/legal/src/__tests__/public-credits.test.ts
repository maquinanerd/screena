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
  STATIC_AUTHORIZATION,
  STREAMING_ORIGIN_CREDITS,
  type AuthorizationEntry,
} from "../authorization-spec.js";
import { publicSourceCredits, tmdbNonEndorsementDisclaimer } from "../public-credits.js";

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

  it("nenhum credito carrega logo: a projecao nao tem sequer o campo", () => {
    // `logoAllowed` e o literal `false` no TIPO de LicenseTarget. Se um dia
    // alguem quiser logo, a mudanca tem que passar pela licenca — nao por um
    // campo opcional que apareceu no rodape.
    for (const credit of publicSourceCredits()) {
      expect(Object.keys(credit).sort()).toEqual(["creditKey", "role", "roleLabel", "text"]);
    }
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
