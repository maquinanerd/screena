/**
 * adsense.ts — a conta do Google AdSense da Cinerie, num lugar so.
 *
 * ============================================================================
 * O QUE EXISTE HOJE: SO A VERIFICACAO DE PROPRIEDADE
 * ============================================================================
 * O dono cadastrou `cinerie.com` no AdSense (28/09/2026), e o Google so abre a
 * revisao do site depois que ele prova ser da conta. Das tres formas que o
 * painel oferece, esta leva usa as duas que NAO carregam script:
 *
 *  - a metatag `google-adsense-account`, no layout raiz (logo, em toda pagina);
 *  - o `/ads.txt` (padrao IAB de vendedores autorizados), que o Google
 *    recomenda de qualquer jeito para quando o anuncio for vendido — sem ele o
 *    painel passa a avisar de "ganhos em risco".
 *
 * As duas sao texto servido pela propria origem: nenhuma requisicao a
 * terceiro, nenhum cookie, nenhum custo de desempenho.
 *
 * ============================================================================
 * O QUE CONTINUA AUSENTE, DE PROPOSITO: O SCRIPT `adsbygoogle.js`
 * ============================================================================
 * A terceira forma (o snippet do AdSense no `<head>`) carregaria o runtime de
 * anuncios em toda pagina. Ele segue fora (DIVERGENCIAS.md, D-005) ate uma
 * decisao do dono que cubra o que ele puxa junto:
 *  - a Politica de Privacidade (item 6) afirma HOJE que nao ha cookie de
 *    publicidade e que por isso nao ha banner de cookies. O script tornaria
 *    esse texto falso no mesmo deploy — e as politicas do proprio AdSense
 *    exigem declarar cookie de terceiro para anuncio;
 *  - nao existe banner nem finalidade de consentimento para publicidade (as
 *    registradas sao termos, privacidade, e-mail de marketing e analytics);
 *  - `Permissions-Policy` (`browsing-topics=()`, em `next.config.ts`) e o CSP
 *    (`middleware.ts`) foram calibrados para um site SEM anuncio;
 *  - o script e os iframes de anuncio pesam no LCP/INP que a auditoria de SEO
 *    mediu.
 * Antes da aprovacao ele nem teria o que mostrar: a conta nao serve anuncio
 * enquanto o site esta em revisao.
 *
 * ============================================================================
 * POR QUE O ID MORA NO CODIGO, E NAO EM ENV VAR
 * ============================================================================
 * O ID de publisher nao e segredo — e o oposto: o `ads.txt` existe para
 * publica-lo, e o snippet do Google o escreve no HTML de toda pagina. "API key
 * so em env" (CLAUDE.md) protege credencial; isto e identificador publico.
 * Morar aqui tambem impede que a metatag e o `ads.txt` divirjam: os dois leem
 * a mesma constante.
 */

/** ID de publisher da conta AdSense, na grafia do `ads.txt` (sem o `ca-`). */
export const ADSENSE_PUBLISHER_ID = "pub-9994816010226342";

/**
 * O mesmo ID na grafia de cliente (`ca-pub-...`) — a que a metatag de
 * verificacao e o snippet do Google usam.
 */
export const ADSENSE_CLIENT_ID = `ca-${ADSENSE_PUBLISHER_ID}`;

/**
 * ID da autoridade certificadora do Google no `ads.txt` (o TAG-ID do
 * Trustworthy Accountability Group). E o mesmo para toda conta AdSense: e o
 * quarto campo da linha que o proprio painel entrega.
 */
export const GOOGLE_ADS_TXT_CERTIFICATION_ID = "f08c47fec0942fa0";

/**
 * O `ads.txt` inteiro: uma linha `dominio, conta, relacao, certificadora`.
 *
 * `DIRECT` porque a conta e do proprio dono do site — nao ha revendedor.
 */
export function buildAdsTxt(): string {
  return `google.com, ${ADSENSE_PUBLISHER_ID}, DIRECT, ${GOOGLE_ADS_TXT_CERTIFICATION_ID}\n`;
}
