/**
 * youtube-id.ts — A FORMA de um id de video do YouTube. PURO.
 *
 * ============================================================================
 * POR QUE ISTO SUBIU DE `apps/web` PARA CA
 * ============================================================================
 * O padrao vivia em `apps/web/src/lib/youtube-embed.ts`, e era o unico lugar
 * que o conhecia — o que bastava enquanto so o render precisava dele.
 *
 * Deixou de bastar quando a promocao de midia (`services/ingestion`) passou a
 * ter de decidir, ANTES de acender uma linha de `tmdb_videos`, se aquele
 * `video_key` chega a ser reproduzivel. Um worker nao pode importar de
 * `apps/web`; a alternativa era reescrever a regex la, e regex duplicada e
 * drift garantido — o dia em que uma delas apertar, a outra promove o que a
 * outra recusa, e a promocao passa a acender linhas que a tela descarta.
 *
 * O que subiu foi so a FORMA do id. Os DOMINIOS (`youtube-nocookie.com` para o
 * player, `youtube.com` para o link de escape) continuam em `youtube-embed.ts`:
 * eles sao politica de render — quem carrega terceiro, e como —, nao contrato
 * de dado. Mover host para ca ampliaria a superficie que o guard de pureza
 * (`scripts/audit/check-render-purity.mjs`) tem de vigiar, sem nenhum ganho.
 */

/**
 * Id de video do YouTube: 11 caracteres do alfabeto seguro, exatos.
 *
 * Sem as ancoras `^`/`$` (ou com quantificador frouxo) um id com barra passaria
 * e viraria caminho na URL do embed.
 */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

/** O valor e um id de YouTube valido? */
export function isYouTubeVideoId(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  return YOUTUBE_VIDEO_ID_PATTERN.test(value)
}
