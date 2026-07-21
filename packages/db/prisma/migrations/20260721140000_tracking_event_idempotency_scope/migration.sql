-- Alinhamento da IDEMPOTENCIA dos eventos de tracking (Backend C - C7A.1).
--
-- Fecha o gap T1 registrado em docs/product/user-product-persistence-decisions.md
-- (secao 4.1), o unico gap CRITICO que bloqueava C7B.
--
-- NOTA DE ENCODING: este arquivo e 100% ASCII de proposito. O cliente psql pode
-- rodar em WIN1252 (embedded-postgres no Windows), e um caractere fora desse
-- conjunto (emoji, por exemplo) faz o `migrate deploy` FALHAR na aplicacao.
--
-- PROBLEMA: uma operacao de tracking emite VARIOS eventos irmaos que
-- compartilham a MESMA `idempotency_key` (a chave e da OPERACAO, nao do evento):
--   applyWatchStateChange -> `state_changed` + UM de
--     `watch_started` | `watch_completed` | `rewatch_started`
--   applyEpisodeProgress  -> UM de `episode_watched` | `episode_unwatched`
--     + `progress_updated`
-- Com UNIQUE(user_id, idempotency_key) o primeiro evento entrava e o SEGUNDO
-- falhava: um plano valido do dominio nao era persistivel atomicamente.
--
-- PREMISSA PROVADA: nenhuma operacao emite dois eventos do MESMO `event_type`
-- (as condicionais do dominio sao mutuamente exclusivas e cada `push` usa um
-- literal distinto). Travado por varredura exaustiva em
-- services/user-platform/src/tracking/__tests__/event-identity-contract.test.ts.
-- Logo `event_type` e suficiente para desambiguar os eventos irmaos.
--
-- SEGURANCA: a nova unique e ESTRITAMENTE MAIS PERMISSIVA - todo estado valido
-- sob a antiga continua valido sob a nova (a antiga e um caso particular). A
-- substituicao nao pode falhar e NAO exige backfill. Nenhuma linha e lida,
-- alterada ou apagada; nenhuma coluna, tabela ou enum muda; nenhuma migration
-- anterior e tocada.

-- Remove a identidade antiga (apenas para substitui-la imediatamente abaixo).
DROP INDEX "user_viewing_events_user_id_idempotency_key_key";

-- Identidade nova: (usuario, operacao, TIPO do evento).
-- A ordem preserva o prefixo (user_id, idempotency_key), que continua servindo
-- para ler TODOS os eventos de uma mesma operacao.
CREATE UNIQUE INDEX "user_viewing_events_user_id_idempotency_key_event_type_key"
  ON "user_viewing_events"("user_id", "idempotency_key", "event_type");
