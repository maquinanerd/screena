/**
 * youtube-embed.ts — A POLÍTICA de embed do YouTube, em um lugar só. PURO.
 *
 * POR QUE ESTE MÓDULO EXISTE. Antes dele havia dois pontos no `apps/web` que
 * montavam URL de player do YouTube: o corpo de matéria
 * (`article-body-presenter`) e — a partir do trailer de "Em breve" — o trilho
 * da home. Dois montadores é o começo de duas políticas: alguém conserta um
 * (troca o domínio, aperta a validação, tira um parâmetro) e o outro fica para
 * trás, silenciosamente carregando terceiro de um jeito que o site já decidiu
 * não carregar. Aqui a decisão é uma linha e vale para os dois.
 *
 * AS TRÊS REGRAS, E POR QUE CADA UMA:
 *
 * 1. `youtube-nocookie.com`, nunca `youtube.com`. O player padrão grava antes
 *    de qualquer clique de reprodução; o `nocookie` adia isso para o play.
 * 2. NENHUM parâmetro de query. Sem `autoplay`, sem `rel`, sem `origin`, sem
 *    `enablejsapi`. Cada parâmetro é superfície: uns mudam comportamento,
 *    outros vazam a página de origem. A URL mais curta é a mais auditável, e o
 *    teste consegue afirmar "nenhum `?`" — o que não conseguiria afirmar sobre
 *    "só os parâmetros bons".
 * 3. Id EXATAMENTE de 11 caracteres do alfabeto seguro. Id do YouTube tem 11
 *    caracteres; qualquer outra coisa é dado corrompido ou tentativa de injetar
 *    caminho na URL. Fail-closed: não valida, devolve `null`, e quem chamou
 *    decide o que mostrar em vez do player.
 *
 * O QUE ESTE MÓDULO NÃO DECIDE: *quando* o iframe entra no DOM. Isso é do
 * componente, e é diferente por superfície — no modal o clique em "Watch" já é
 * o disparo; na matéria é preciso um cartão de ativação. Ver
 * `app/_components/youtube-frame.tsx`.
 */

/** Domínio do player. Único lugar do `apps/web` que o escreve. */
const YOUTUBE_NOCOOKIE_ORIGIN = "https://www.youtube-nocookie.com";

/** Domínio público do vídeo — só para o link de escape ("abrir no YouTube"). */
const YOUTUBE_WATCH_ORIGIN = "https://www.youtube.com";

/**
 * Id de vídeo do YouTube: 11 caracteres do alfabeto seguro, exatos.
 *
 * Sem os âncoras `^`/`$` (ou com quantificador frouxo) um id com barra passaria
 * e viraria caminho na URL do embed.
 */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** O id é um id de YouTube válido? */
export function isYouTubeVideoId(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

/**
 * URL do PLAYER incorporável, ou `null` quando o id não é válido.
 *
 * Sem query string: o chamador não pode acrescentar parâmetro por fora sem
 * mexer aqui, e o teste afirma a ausência do `?` diretamente.
 */
export function buildYouTubeEmbedUrl(videoId: string | null | undefined): string | null {
  if (!isYouTubeVideoId(videoId)) return null;
  return `${YOUTUBE_NOCOOKIE_ORIGIN}/embed/${videoId as string}`;
}

/**
 * URL pública do vídeo no YouTube, para o link de escape.
 *
 * Existe porque player que não carrega não pode virar buraco: a superfície
 * mostra uma mensagem honesta e ESTE link. Aqui o domínio é o normal
 * (`youtube.com`) de propósito — é uma navegação que a pessoa escolheu fazer,
 * saindo do nosso site, não um recurso embutido no nosso documento.
 */
export function buildYouTubeWatchUrl(videoId: string | null | undefined): string | null {
  if (!isYouTubeVideoId(videoId)) return null;
  return `${YOUTUBE_WATCH_ORIGIN}/watch?v=${videoId as string}`;
}
