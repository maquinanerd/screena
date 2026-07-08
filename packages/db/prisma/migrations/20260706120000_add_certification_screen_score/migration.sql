-- Fase 9C — classificacao indicativa (advisory) + nota editorial PROPRIA do Screen.
-- `certification` NAO e rating source (nao entra nas regras de external_ratings).
-- `screen_score*` e a nota editorial do Screen (escala 5); `screen_score_display`
-- nasce false (default seguro / invariante 6): nada aparece ate liberacao explicita.

-- AlterTable
ALTER TABLE "movies" ADD COLUMN     "certification" TEXT,
ADD COLUMN     "screen_score" DECIMAL(65,30),
ADD COLUMN     "screen_score_scale" INTEGER,
ADD COLUMN     "screen_score_display" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tv_shows" ADD COLUMN     "certification" TEXT,
ADD COLUMN     "screen_score" DECIMAL(65,30),
ADD COLUMN     "screen_score_scale" INTEGER,
ADD COLUMN     "screen_score_display" BOOLEAN NOT NULL DEFAULT false;
