/**
 * detalhe-trailer.test.ts — O trailer chegou ao bloco de mídia do detalhe.
 *
 * ============================================================================
 * O QUE ESTAVA ERRADO, E O QUE NÃO ESTAVA
 * ============================================================================
 * O bloco de mídia das telas 06/07 é pôster · TRAILER · 3 atalhos. A célula do
 * meio mostrava o **backdrop** e nada mais.
 *
 * A causa NÃO era permissão. `licenca(tmdb/video)` existe desde 13/08/2026
 * (`authorization-spec.ts`, entrada "TMDB (trailers)", `official`,
 * `displayAllowed: true`). Dois comentários no repositório afirmavam o
 * contrário — "não existe decisão de licença para vídeo do TMDB" — e ficaram
 * desatualizados por uma semana. Este arquivo trava os dois lados: a licença
 * existe, e a fiação existe.
 *
 * ============================================================================
 * A ASSERÇÃO DE FONTE RODA SEM COMENTÁRIOS
 * ============================================================================
 * Neste repositório uma guarda que varre texto já aprovou e reprovou pelo
 * motivo errado por causa de comentário. Todo `code` aqui é o arquivo com os
 * comentários removidos.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { STATIC_AUTHORIZATION } from "../../services/legal/src/authorization-spec";

const ROOT = process.cwd();

function semComentarios(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function ler(rel: string): string {
  return semComentarios(readFileSync(path.join(ROOT, rel), "utf8"));
}

const FILME = ler("apps/web/app/pt/filmes/[slug]/page.tsx");
const SERIE = ler("apps/web/app/pt/series/[slug]/page.tsx");
const MODAL = ler("apps/web/app/_components/trailer-modal.tsx");
const HELPER = ler("apps/web/src/server/entity-trailer.ts");

describe("a licenca de video do TMDB EXISTE — a premissa conferida", () => {
  it("ha entrada `tmdb`/`video`, `official`, com exibicao autorizada", () => {
    const video = STATIC_AUTHORIZATION.find(
      (e) => e.license.sourceKey === "tmdb" && e.license.contentType === "video",
    );
    expect(video, "a licenca de video do TMDB tem de existir").toBeDefined();
    expect(video!.license.licenseStatus).toBe("official");
    expect(video!.license.displayAllowed).toBe(true);
  });

  it("NEGATIVO: nenhum modulo de render ainda afirma que a licenca NAO existe", () => {
    // As duas frases desatualizadas, verbatim. Elas foram corrigidas; este teste
    // impede que voltem — e impede uma terceira copia da mesma afirmacao falsa.
    // Roda sobre o arquivo COM comentarios, porque a afirmacao errada VIVIA num
    // comentario e era exatamente ali que enganava quem lia.
    for (const rel of [
      "apps/web/src/lib/trailer-presenter.ts",
      "apps/web/src/server/home-upcoming.ts",
      "apps/web/src/server/entity-trailer.ts",
    ]) {
      const bruto = readFileSync(path.join(ROOT, rel), "utf8");
      expect(bruto, rel).not.toContain("não existe decisão de licença para vídeo");
      expect(bruto, rel).not.toContain("não tem entrada de licença para");
    }
  });
});

describe("o trailer chega as DUAS verticais", () => {
  it("filme e serie consultam o mesmo helper server-only", () => {
    for (const rel of [
      "apps/web/src/server/movie-page.ts",
      "apps/web/src/server/series-page.ts",
    ]) {
      expect(ler(rel), rel).toContain("getTrailerForEntity(prisma,");
    }
  });

  it("as duas paginas renderizam o modal na celula de midia", () => {
    for (const [nome, code] of [["filme", FILME], ["serie", SERIE]] as const) {
      expect(code, nome).toMatch(/<TrailerModal[\s\S]{0,200}triggerClassName="media-strip__play"/);
    }
  });

  it("NEGATIVO: sem trailer, o modal NAO e montado — nada de espaco reservado", () => {
    // O `<div />` morto da faixa final ja foi um defeito aqui. A celula do
    // trailer nao pode repetir: sem trailer, so o backdrop, como antes.
    for (const [nome, code] of [["filme", FILME], ["serie", SERIE]] as const) {
      expect(code, nome).toMatch(/\{trailer !== null \? \(\s*<span className="media-strip__playwrap">/);
    }
  });

  it("o backdrop CONTINUA na celula — o trailer nao apagou a imagem", () => {
    // Ele e o poster do player. Trocar imagem por botao deixaria a celula vazia
    // enquanto nenhum titulo tiver trailer promovido — que e o estado de hoje.
    for (const [nome, code] of [["filme", FILME], ["serie", SERIE]] as const) {
      expect(code, nome).toContain("view.media.backdrop.src");
    }
  });
});

describe("NADA carrega antes do clique — medido, nao presumido", () => {
  it("o gatilho e um <button>, nunca um <iframe> escondido", () => {
    expect(MODAL).toMatch(/<button[\s\S]{0,300}ref=\{triggerRef\}/);
  });

  /**
   * QUEM MEDE ISTO DE VERDADE E OUTRO ARQUIVO, e vale registrar por que.
   *
   * A primeira versao deste bloco fatiava o fonte do modal em `indexOf("open &&
   * mounted")` e afirmava que `<YouTubeFrame` so aparecia depois do corte. O
   * controle negativo (montar o player ANTES do botao, no `return`) PASSOU: o
   * `return` fica DEPOIS de `open && mounted` no arquivo, entao o player
   * eager caiu do lado "guardado". Posicao no arquivo nao e posicao no ramo.
   *
   * A medida honesta ja existia: `apps/web/app/_components/__tests__/
   * trailer-modal.test.tsx` monta o componente em jsdom e afirma que a palavra
   * "youtube" NAO aparece em lugar nenhum do documento antes do clique — o que
   * cobre `<iframe>`, `<script>`, `<link rel=preconnect>` e `<img>` de uma vez.
   * Reaplicado ali, o mesmo defeito reprova 3 testes.
   *
   * O que sobra para ESTE arquivo e o que ele consegue ver de fato: que a
   * pagina de detalhe nao carrega player por conta propria (abaixo).
   */
  it("o gatilho do detalhe e o MESMO componente medido em jsdom", () => {
    // Se o detalhe passasse a usar outro player, a prova de "nada antes do
    // clique" deixaria de valer para ele sem ninguem perceber.
    for (const [nome, code] of [["filme", FILME], ["serie", SERIE]] as const) {
      expect(code, nome).toContain("<TrailerModal");
      expect(code, nome).toContain("_components/trailer-modal");
    }
  });

  it("NEGATIVO: as paginas de detalhe nao carregam player nenhum por conta propria", () => {
    // Nem iframe, nem <video>, nem preconnect para o YouTube na pagina.
    for (const [nome, code] of [["filme", FILME], ["serie", SERIE]] as const) {
      expect(code, nome).not.toContain("<iframe");
      expect(code, nome).not.toContain("<video");
      expect(code, nome).not.toContain("youtube");
    }
  });
});

describe("pureza de render: o helper le SO o banco", () => {
  it("nenhuma chamada externa, e o gate de licenca esta na propria consulta", () => {
    expect(HELPER).toContain("displayAllowed: true");
    expect(HELPER).toContain('licenseStatus: { notIn: ["unknown", "blocked"] }');
    expect(HELPER).not.toContain("fetch(");
    expect(HELPER).not.toContain("themoviedb.org");
  });
});
