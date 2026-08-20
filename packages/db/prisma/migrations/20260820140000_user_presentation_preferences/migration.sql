-- user_presentation_preferences - tema, densidade e tamanho de poster.
--
-- 100% ASCII de proposito: migration com byte fora de ASCII ja quebrou deploy
-- neste repositorio (o cluster de producao nao sobe em WIN1252).
--
-- POR QUE AGORA. A tela 13 do canonico pede estes tres controles. Ate hoje eles
-- eram OMITIDOS da interface, e a omissao estava CERTA: o cabecalho de
-- `settings-panel.tsx` registra "sem preferencia fake - nunca toggle sem
-- efeito". Controle que nao persiste e botao morto, e botao morto ja foi o
-- defeito da newsletter. O que faltava era a coluna.
--
-- TEXTO COM CHECK, nao enum do Prisma. Um enum obriga migration para
-- acrescentar valor e acopla o vocabulario de interface ao schema. O conjunto
-- fechado vive no CHECK (aqui) e no parser do contrato (que e quem le a
-- entrada do usuario). Os dois precisam concordar, e ha teste para isso.
--
-- DEFAULTS SEGUROS E NEUTROS: `system` respeita a preferencia do sistema
-- operacional do leitor em vez de impor um tema; `comfortable` e `medium` sao o
-- que a interface ja faz hoje, entao NENHUMA conta existente muda de aparencia
-- por causa desta migration.
ALTER TABLE "user_profiles"
  ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "density" TEXT NOT NULL DEFAULT 'comfortable',
  ADD COLUMN "poster_size" TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_theme_check"
  CHECK ("theme" IN ('system', 'light', 'dark'));

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_density_check"
  CHECK ("density" IN ('comfortable', 'compact'));

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_poster_size_check"
  CHECK ("poster_size" IN ('small', 'medium', 'large'));
