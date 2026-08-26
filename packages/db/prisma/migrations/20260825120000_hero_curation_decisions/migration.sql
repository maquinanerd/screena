-- hero_curation_decisions: o dono pode FIXAR o destaque da home.
--
-- O DEFEITO QUE ESTA MIGRATION AJUDA A FECHAR
-- ---------------------------------------------------------------------------
-- Ate 25/08/2026 o hero da home ordenava por ano de lancamento DECRESCENTE e
-- nao filtrava nada alem de "tem slug canonico pt-BR". O TMDB e comunitario e o
-- lixo dele se concentra nas datas futuras, entao a consulta entregava o pior
-- registro do catalogo com precisao: o destaque era "Der Liebesbrief", um curta
-- alemao de 1938 cadastrado com release_date em 2057, sem poster.
--
-- O portao de qualidade (codigo, sem banco) resolve o caso comum. Esta tabela
-- resolve o outro: estreia, efemeride e campanha editorial pedem que um HUMANO
-- diga qual titulo abre a home. Sem ela, trocar o destaque exigiria mexer em
-- codigo e implantar.
--
-- E UMA DECISAO GOVERNADA
-- ---------------------------------------------------------------------------
-- Mesmo molde de page_indexability_decisions: carrega QUEM decidiu
-- (decided_by, NOT NULL -- decisao sem dono nao e decisao governada), QUANDO
-- (decided_at) e POR QUE (reason). Nenhum worker, job ou IA escreve aqui: a
-- linha nasce de INSERT humano. Por isso nao ha default para decided_by nem
-- caminho de escrita automatica no codigo.
--
-- SEM UNIQUE PARCIAL DE VIGENCIA
-- ---------------------------------------------------------------------------
-- page_indexability_decisions usa is_current com unique parcial porque ali a
-- decisao vigente e UMA. Aqui a vigencia e uma JANELA (valid_from/valid_until) e
-- o hero tem varias posicoes, entao duas linhas legitimamente se sobrepoem no
-- tempo. O desempate e do leitor (posicao, depois decided_at mais recente) e
-- esta coberto por teste -- nao ha constraint que o banco possa afirmar sem
-- proibir agendamento futuro, que e justamente o uso pretendido.

-- CreateTable
CREATE TABLE "hero_curation_decisions" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "language_code" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "reason" TEXT,
    "decided_by" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hero_curation_decisions_pkey" PRIMARY KEY ("id")
);

-- A consulta do hero: idioma + janela de validade.
CREATE INDEX "hero_curation_decisions_language_code_valid_from_valid_unti_idx"
    ON "hero_curation_decisions"("language_code", "valid_from", "valid_until");

-- Auditoria: "este titulo ja foi destaque alguma vez?".
CREATE INDEX "hero_curation_decisions_entity_type_entity_id_idx"
    ON "hero_curation_decisions"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "hero_curation_decisions"
    ADD CONSTRAINT "hero_curation_decisions_language_code_fkey"
    FOREIGN KEY ("language_code") REFERENCES "languages"("code")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Posicao e 1-based: 0 ou negativo seria posicao inexistente no carousel.
ALTER TABLE "hero_curation_decisions"
    ADD CONSTRAINT "hero_curation_decisions_position_positive" CHECK ("position" >= 1);

-- Janela invertida (valid_until <= valid_from) nunca vigeria: e erro de digitacao
-- travado na escrita, e nao uma linha morta que ninguem percebe.
ALTER TABLE "hero_curation_decisions"
    ADD CONSTRAINT "hero_curation_decisions_window_ordered"
    CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from");
