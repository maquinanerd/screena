/**
 * institutional-facts.ts — os fatos institucionais que Sobre e Contato mostram,
 * num lugar so. PURO.
 *
 * NENHUM destes valores nasce aqui. Todos ja foram publicados pelo controlador nos
 * documentos legais — `app/pt/termos/page.tsx` (item 12) e
 * `app/pt/privacidade/page.tsx` (item 1) —, e
 * `tests/web/institutional-pages-facts.test.ts` reprova se algum deixar de constar
 * la. Um canal de contato ou um CNPJ que existisse so aqui seria procedencia
 * inventada.
 *
 * DEPENDENCIA EXTERNA: as duas caixas precisam RECEBER e-mail. Criar as caixas e
 * acao do controlador, nao do codigo (ver o cabecalho da Politica de Privacidade e
 * `docs/seo/SEO-INFRA-CHANGES-2026-09-11.md`).
 */

/** Duvidas gerais (Termos de Uso, item 12). */
export const GENERAL_CONTACT_EMAIL = "contato@cinerie.com";

/** Privacidade e direitos do titular (Politica de Privacidade, item 1). */
export const PRIVACY_CONTACT_EMAIL = "privacidade@cinerie.com";

/** O responsavel pela Cinerie, como os Termos de Uso o identificam (item 12). */
/**
 * A sede do controlador em PARTES, para o `PostalAddress` do JSON-LD. E o MESMO
 * fato que `SITE_CONTROLLER.seat` imprime na tela; schema.org pede cidade,
 * estado e pais em campos proprios.
 */
export const SITE_CONTROLLER_ADDRESS = {
  addressLocality: "Aparecida de Goiânia",
  addressRegion: "GO",
  addressCountry: "BR",
} as const;

/**
 * Perfis OFICIAIS da Cinerie em outras plataformas, para o `sameAs` da
 * `Organization`.
 *
 * E por `sameAs` que o buscador liga o site a MESMA entidade em outros lugares
 * — e e o sinal que falta para a marca ser reconhecida como entidade (o painel
 * de marca, os sitelinks de marca). Lista VAZIA de proposito: so entra aqui
 * perfil que a Cinerie de fato controla. Apontar para conta de terceiro, ou
 * para uma conta que nao e da marca, afirma ao buscador uma identidade falsa.
 *
 * Assim que o dono informar os enderecos, basta acrescenta-los: o JSON-LD passa
 * a emitir `sameAs` sozinho, e o teste de governanca cobre os dois estados.
 *
 * ============================================================================
 * O CUSTO DE ELA ESTAR VAZIA, MEDIDO
 * ============================================================================
 * 28/09/2026, busca por "Cinerie" no Google: o site ja e o primeiro resultado e
 * ja tem sitelinks — mas a Visao Geral de IA abre com
 *
 *     "O termo Cinerie pode se referir principalmente a duas vertentes
 *      diferentes na internet"
 *
 * Ou seja: o buscador NAO tem como saber que a marca daqui e uma entidade so.
 * `sameAs` e exatamente o sinal que resolve isso, e continua vazio porque
 * ninguem pode inventar um perfil oficial — nem eu, nem o codigo.
 *
 * FORMATO, para quando os enderecos chegarem: URL absoluta do PERFIL, uma por
 * plataforma, sem parametro de rastreio. Exemplo do que entraria:
 *
 *     "https://www.instagram.com/<perfil>/",
 *     "https://www.youtube.com/@<canal>",
 *     "https://x.com/<perfil>",
 *
 * Perfil que a Cinerie nao controla NAO entra, mesmo que fale dela.
 */
export const OFFICIAL_PROFILES: readonly string[] = [];

export const SITE_CONTROLLER = {
  name: "Pablo Eduardo Gameleira",
  tradeName: "Grupo Maquina Nerd",
  cnpj: "22.739.386/0001-90",
  seat: "Aparecida de Goiânia, Goiás",
} as const;
