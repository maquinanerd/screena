/**
 * Decisoes PURAS de apresentacao do hero da materia (tela 05).
 *
 * Vivem fora do componente por dois motivos: sao regras que merecem teste
 * proprio (o componente e um Server Component sem ambiente DOM neste
 * repositorio), e nenhuma delas depende de React.
 *
 * Nada aqui inventa dado. Cada funcao recebe o que o contrato publico
 * (`NewsArticleView`) realmente projeta e devolve `null` quando nao ha o que
 * dizer — a alternativa seria desenhar um residuo com aparencia de conteudo.
 */

/** Ancora de recorte da capa (`object-position`), derivada da proporcao. */
export type HeroCrop = 'landscape' | 'standard' | 'portrait';

/**
 * Ancora de recorte da capa a partir da proporcao DECLARADA do arquivo.
 *
 * Por que nao focal point: o CMS TEM o campo (`focalPoint` em
 * `apps/cms/src/collections.ts`), mas ele NAO chega ao lado publico —
 * `NewsHeroMediaInput` carrega somente `alt`, `credit`, `width` e `height`.
 * Ligar focal point de ponta a ponta exigiria projecao nova no worker E
 * migration no banco publico, que e tarefa aprovada de banco (CLAUDE.md §10),
 * nao efeito colateral de uma tarefa de layout. Enquanto isso nao acontece, o
 * recorte sai do unico dado real disponivel: a proporcao.
 *
 * Por que a proporcao e um fallback honesto, e nao um chute: quando o asset
 * governado nao esta vinculado, `heroImageAsset` cai no `HERO_IMAGE_SPEC` fixo
 * de 1280x720 — 16:9, classificado aqui como `landscape`, que e exatamente o
 * comportamento neutro. Ou seja, a regra so desloca alguma coisa quando existe
 * dimensao REAL de um arquivo alto ou quadrado. Ela nunca recorta com base num
 * numero inventado.
 *
 * A direcao do ajuste e sempre para CIMA porque o hero e largo e baixo: no
 * `cover`, um arquivo alto perde topo e base, e e no terco superior que ficam
 * cabecas e rostos. Descer a ancora decapitaria o assunto da foto.
 */
export function heroCropOf(width: number, height: number): HeroCrop {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 'landscape';
  if (width <= 0 || height <= 0) return 'landscape';
  const ratio = width / height;
  if (ratio >= 1.6) return 'landscape';
  if (ratio >= 1.15) return 'standard';
  return 'portrait';
}

/**
 * Iniciais do autor, para o avatar do byline.
 *
 * O contrato publico nao tem URL de retrato: `NewsArticleView.author` e um
 * nome, e so. O circulo do byline, portanto, nunca teve o que mostrar — o que
 * existia era um degrade cinza, que na tela le como imagem quebrada, nao como
 * avatar. Iniciais sao a unica coisa VERDADEIRA que da para desenhar a partir
 * do dado que existe.
 *
 * Primeira e ULTIMA palavra: "Pablo Eduardo Gameleira" vira "PG", nao "PE" —
 * sobrenome identifica mais que nome do meio. Nome de redacao ("Redacao
 * Cinerie") vira "RC" pela mesma regra, sem caso especial.
 *
 * Devolve `null` quando nao sobra letra nenhuma (nome so com pontuacao ou
 * espaco). Nesse caso o avatar simplesmente nao e renderizado — voltar a
 * desenhar um circulo vazio seria reintroduzir o defeito que esta funcao
 * existe para remover.
 */
export function authorInitials(author: string): string | null {
  const words = author
    .split(/\s+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0);
  if (words.length === 0) return null;
  const first = Array.from(words[0]!)[0]!;
  const last = Array.from(words[words.length - 1]!)[0]!;
  return (words.length === 1 ? first : `${first}${last}`).toLocaleUpperCase('pt-BR');
}

/**
 * Tokens que significam "a secao de noticias" — ou seja, a propria trilha pai.
 *
 * `articles.category` e TEXTO LIVRE vindo da fonte (ver `news-presenter`), e
 * feed RSS costuma carimbar a categoria tecnica do proprio feed. O resultado
 * visivel era `Inicio > Noticias > news`: o mesmo degrau escrito duas vezes, a
 * segunda em ingles.
 *
 * A lista e curta e fechada de proposito. Ela nao tenta adivinhar o que e
 * "tecnico" em geral (isso viraria uma heuristica que engole secao legitima);
 * ela so reconhece os rotulos que repetem o degrau ANTERIOR.
 */
const NEWS_SECTION_ALIASES: ReadonlySet<string> = new Set([
  'news',
  'noticia',
  'noticias',
]);

/**
 * Rotulo da secao editorial para o ultimo degrau da trilha.
 *
 * Recebe a secao APROVADA quando existe (`articleSection`, que ja cai para
 * `category` quando a traducao nao declara uma) e devolve:
 *  - `null` quando nao ha secao, ou quando ela apenas repete "Noticias";
 *  - o texto do editor INTACTO quando ele ja veio formatado (tem maiuscula,
 *    acento ou mais de uma palavra) — nao cabe a esta funcao reescrever rotulo
 *    que passou por revisao;
 *  - o token em caixa de titulo quando veio cru e minusculo ("cinema" ->
 *    "Cinema"), que e o caso do texto livre de feed.
 */
export function sectionCrumbLabel(section: string | null): string | null {
  if (section === null) return null;
  const trimmed = section.trim();
  if (trimmed.length === 0) return null;

  // Faixa de marcas combinantes escrita ESCAPADA: colar os caracteres crus aqui
  // deixa marca invisivel no fonte, que sobrevive a revisao e quebra na proxima
  // reconversao de encoding do arquivo.
  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
  if (NEWS_SECTION_ALIASES.has(normalized)) return null;

  // Rotulo ja formatado por gente: preserva como esta.
  if (trimmed !== trimmed.toLocaleLowerCase('pt-BR')) return trimmed;
  if (/\s/u.test(trimmed)) return trimmed;

  return trimmed.charAt(0).toLocaleUpperCase('pt-BR') + trimmed.slice(1);
}
