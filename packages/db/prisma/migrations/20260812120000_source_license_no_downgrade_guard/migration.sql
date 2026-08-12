-- ============================================================
-- Guarda simetrica: uma licenca VIGENTE nunca passa a permitir MENOS do que
-- suas decisoes vivas ja concedem.
-- ============================================================
--
-- POR QUE ESTA MIGRATION EXISTE.
--
-- `data_usage_decisions_guard` (migration 20260717120000) e fail-closed na
-- escrita da DECISAO: nenhuma decisao pode conceder alem da licenca-mae. Mas o
-- teto era verificado apenas de um lado. `source_licenses` nao tinha guarda
-- nenhuma contra ser REBAIXADA depois — o unico trigger da tabela
-- (`source_licenses_supersedes_guard`) so valida a cadeia `supersedes_id`.
--
-- A assimetria custou caro em 2026-08-12: `packages/db/prisma/seed.ts` fazia
-- `update` IN PLACE na licenca VIGENTE de cada fonte de rating, rebaixando-a
-- para `license_status='unknown'`/`display_allowed=false` com as decisoes
-- `rating_display` ainda penduradas nela. O resultado foram 5 decisoes
-- concedendo display sob licenca nao-exibivel — linhas que o guarda de decisoes
-- recusaria criar hoje — e um impasse no `legal sources apply` seguinte: a
-- decisao velha nao saia porque a licenca-mae era `unknown`; a licenca nao era
-- substituida porque a decisao velha nao saia.
--
-- Esta guarda recusa o rebaixamento NA ORIGEM, independente de quem tente
-- (seed, script, psql aberto, migration futura). Ela APERTA a invariante 6 —
-- nao afrouxa nada: nenhum caminho que antes era permitido e legitimo passa a
-- ser recusado.
--
-- ESCOPO DELIBERADO — o que esta guarda NAO faz:
--
--  * NAO bloqueia APOSENTAR a licenca (`is_current` true -> false). Esse e o
--    caminho legitimo do supersede, e o apply ja aposenta as decisoes ANTES da
--    licenca. Bloquear aqui quebraria o `supersede` normal e tambem o check 16
--    de `validate-source-authorization-and-attribution`, que aposenta uma
--    licenca de proposito para provar que a nota exibida para de ser
--    reescrivel. "Aposentar licenca deixando decisao viva concedendo" e uma
--    invariante ADICIONAL candidata, registrada em
--    docs/legal/2026-08-12-remediacao-decisoes-legadas.md para decisao humana
--    separada — nao entra aqui de carona.
--
--  * NAO cobre DELETE (nem aqui nem no guarda de decisoes). Lacuna conhecida,
--    documentada no mesmo arquivo. Nao e consertada nesta migration: o tamanho
--    real dela precisa ser medido antes.
--
-- As condicoes abaixo espelham, uma a uma, os checks de teto de
-- `data_usage_decision_guard`. Divergir delas faria a guarda prometer uma
-- simetria que nao entrega.
CREATE OR REPLACE FUNCTION source_license_no_downgrade_under_live_grants() RETURNS trigger AS $$
DECLARE
  offending "data_usage_decisions"%ROWTYPE;
BEGIN
  -- So interessa licenca que CONTINUA vigente. Aposentar e outro caminho (ver
  -- ESCOPO acima); linha nao vigente nao e autoridade de nada.
  IF NOT NEW."is_current" THEN
    RETURN NEW;
  END IF;

  -- Nada a checar quando a licenca nao ficou mais restritiva em nenhuma das
  -- dimensoes que o guarda de decisoes le. Evita varrer decisoes a cada UPDATE
  -- de campo irrelevante (notas, decided_by, updated_at).
  IF     NEW."license_status"       IS NOT DISTINCT FROM OLD."license_status"
     AND NEW."display_allowed"      IS NOT DISTINCT FROM OLD."display_allowed"
     AND NEW."requires_attribution" IS NOT DISTINCT FROM OLD."requires_attribution"
     AND NEW."requires_linkback"    IS NOT DISTINCT FROM OLD."requires_linkback"
     AND NEW."territory_code"       IS NOT DISTINCT FROM OLD."territory_code"
  THEN
    RETURN NEW;
  END IF;

  -- A primeira decisao VIVA que a licenca nova deixaria de sustentar. So
  -- decisao que CONCEDE algo importa — decisao sem grant nao depende do teto,
  -- exatamente como no guarda de decisoes.
  SELECT * INTO offending
    FROM "data_usage_decisions" d
   WHERE d."source_license_id" = NEW."id"
     AND d."is_current"
     AND (d."display_allowed" OR d."storage_allowed" OR d."derivative_allowed")
     AND (
          NEW."license_status" NOT IN ('official', 'licensed', 'third_party')
       OR (d."display_allowed" AND NOT NEW."display_allowed")
       OR (NEW."requires_attribution" AND NOT d."attribution_required")
       OR (NEW."requires_linkback"    AND NOT d."linkback_required")
       OR (NEW."territory_code" IS NOT NULL AND d."territory" IS DISTINCT FROM NEW."territory_code")
     )
   ORDER BY d."id"
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'source_licenses fail-closed: licenca % nao pode ser rebaixada (license_status=%, display_allowed=%) enquanto a decisao vigente % (use_case=%, territorio=%) concede sob ela. Aposente a decisao primeiro, ou supersede a licenca.',
      NEW."id", NEW."license_status", NEW."display_allowed",
      offending."id", offending."use_case", COALESCE(offending."territory", '<global>');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apenas UPDATE: no INSERT a linha ainda nao tem decisoes apontando para ela, e
-- o proprio `NEW.id` nao existe antes do insert de qualquer forma.
CREATE TRIGGER "source_licenses_no_downgrade_guard"
  BEFORE UPDATE ON "source_licenses"
  FOR EACH ROW EXECUTE FUNCTION source_license_no_downgrade_under_live_grants();
