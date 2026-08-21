-- drop_user_theme_preference - o produto e claro SEMPRE.
--
-- 100% ASCII de proposito: migration com byte fora de ASCII ja quebrou deploy
-- neste repositorio (o cluster de producao nao sobe em WIN1252).
--
-- POR QUE. Decisao do dono, 21/08/2026, final: o site nao tem tema escuro e nao
-- deve ter. O canonico e o White Cinematic Editorial System e nao tem uma unica
-- tela escura; o tema escuro que existia no `globals.css` nunca foi desenhado e
-- nunca foi pedido -- e foi ele que apagou os blocos das PRs #199-#201 (a ficha
-- saia #12100e sobre #0b0b0d, 1,04:1, medido).
--
-- Com as regras de `prefers-color-scheme: dark` e `[data-theme='dark']` fora do
-- CSS, esta coluna guardaria uma escolha que NENHUM seletor le. Isso e
-- exatamente a "preferencia fake" que o cabecalho de `settings-panel.tsx`
-- proibe. Coluna que nao alimenta efeito sai junto com o efeito.
--
-- DENSIDADE E TAMANHO DE POSTER FICAM: sao preferencia de LEITURA, nao de
-- paleta, e continuam com controle, contrato e efeito.
--
-- ORDEM IMPORTA: o CHECK referencia a coluna, entao ele cai primeiro. Sem isso
-- o DROP falha com "cannot drop column theme because other objects depend on
-- it" em cluster que resolva a dependencia de forma estrita.
--
-- PERDA DE DADO: sim, e ela e intencional e aceita. O valor guardado era
-- 'system' para toda conta que nunca abriu a tela, e nenhuma escolha de tema
-- tem efeito a partir desta migration. Nao ha o que preservar.

ALTER TABLE "user_profiles"
  DROP CONSTRAINT IF EXISTS "user_profiles_theme_check";

ALTER TABLE "user_profiles"
  DROP COLUMN IF EXISTS "theme";
