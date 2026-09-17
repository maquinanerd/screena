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
export const SITE_CONTROLLER = {
  name: "Pablo Eduardo Gameleira",
  tradeName: "Grupo Maquina Nerd",
  cnpj: "22.739.386/0001-90",
  seat: "Aparecida de Goiânia, Goiás",
} as const;
