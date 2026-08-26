# Curadoria do hero — como fixar o destaque da home

> Operação. Idioma pt-BR. Leia antes de mexer em `hero_curation_decisions` ou no
> critério de seleção do hero.

## O que decide o destaque, em ordem

O hero de `/pt/`, `/pt/filmes/` e `/pt/series/` escolhe assim
([`apps/web/src/server/home-hero.ts`](../../apps/web/src/server/home-hero.ts)):

1. **Curadoria manual vigente** (`hero_curation_decisions`) — vence sempre;
2. **Trending da semana** (`discovery_snapshots`), na ordem da lista;
3. **`vote_count_tmdb` desc** entre os que passam no portão;
4. nada passa → `[]`, e a faixa some (com log `hero_empty`).

**A data de lançamento não ordena mais nada.** Ela sobrevive apenas como corte no
portão. O motivo está no cabeçalho de `home-hero.ts`: ordenar por data
decrescente premia, por construção, o registro mais implausível do catálogo — foi
assim que um curta de 1938 cadastrado com `release_date` em 2057 e sem pôster
virou o destaque da home em 25/08/2026.

## O portão de qualidade

Regra pura em
[`apps/web/src/lib/home-hero-eligibility.ts`](../../apps/web/src/lib/home-hero-eligibility.ts).
Um candidato só é elegível se **todos** valerem:

| Exigência | Motivo da recusa |
| --- | --- |
| `backdrop_path` presente | `sem_backdrop` |
| `poster_path` presente | `sem_poster` |
| `vote_count_tmdb >= 200` | `votos_insuficientes` |
| sinopse pt-BR não vazia | `sem_sinopse_pt_br` |
| já estreou (`<= agora`) | `estreia_futura` |
| `1888 <= ano <= ano_atual + 3` | `ano_implausivel` |
| filme: `status = 'Released'` | `nao_lancado` |

Notas que não são detalhe:

- **`vote_count_tmdb` nunca vai à tela.** É sinal técnico do fornecedor, não nota
  editorial: entra como critério de corte e de ordem, e não vira badge, nota nem
  fonte (invariantes 1 e 2). A mesma regra já valia na aba "Clássicos".
- **Série não exige `status = 'Released'`** — esse status não existe para série;
  `Returning Series` e `Ended` são ambos legítimos.
- **Não há filtro `adult`.** Essa coluna não existe em `movies`/`tv_shows`, e não
  é esquecimento: a exclusão de conteúdo adulto acontece na **descoberta**, em
  duas camadas fail-closed (ver [`.claude/rules/ingestion.md`](../../.claude/rules/ingestion.md)).
  Um título adulto não chega a existir no catálogo.
- **Fail-closed**: dado ausente reprova. Um título sem `release_date` não tem como
  provar que estreou — ele continua na listagem e em "Em breve", só não abre a home.

## Quantos passam hoje

```bash
pnpm --filter @screena/web report:hero-gate
```

Somente leitura (só `SELECT`) — seguro contra produção, e é lá que tem serventia.
Imprime, por vertical: candidatos, aprovados, **recusados por motivo** e os mais
votados. O motivo é o que orienta a ação: "412 recusados por `sem_backdrop`" pede
ingestão de mídia; "todos por `votos_insuficientes`" pede rever o piso.

## Fixar um destaque (INSERT manual)

Não há UI. A decisão é governada e nasce de um humano:

```sql
INSERT INTO hero_curation_decisions
  (entity_type, entity_id, language_code, position, valid_from, valid_until, reason, decided_by)
VALUES
  ('movie', 123, 'pt-BR', 1, now(), now() + interval '7 days',
   'estreia da semana', 'pablo');
```

- `entity_id` é o id **interno** (`movies.id` / `tv_shows.id`), não o `tmdb_id`.
- `position` é 1-based; `1` abre o carousel. O banco recusa `0` ou negativo.
- `valid_until` `NULL` = sem prazo. Janela invertida é recusada pelo banco.
- `decided_by` é obrigatório: decisão sem dono não é decisão governada.
- `entity_type` só vale `movie`/`tv` — outros tipos são ignorados pelo leitor.

Achar o id pelo slug:

```sql
SELECT entity_id, slug FROM slugs
WHERE entity_type = 'movie' AND language_code = 'pt-BR' AND is_canonical
  AND slug LIKE '%duna%';
```

**Trocar o destaque é escrever uma linha nova, nunca editar a antiga** — o
histórico de quem decidiu o que fica intacto. Empate na mesma posição é ganho
pela `decided_at` mais recente.

Encerrar uma curadoria antes do prazo:

```sql
UPDATE hero_curation_decisions SET valid_until = now()
WHERE id = <id> AND (valid_until IS NULL OR valid_until > now());
```

## Duas coisas que a curadoria faz de propósito

1. **Não passa pelo portão de qualidade.** O portão existe para conter a escolha
   *automática*; um humano que fixa um título já decidiu. O presenter continua
   descartando quem não tem slug/título — ali o que se protege não é gosto, é
   link quebrado.
2. **Não apaga os outros slides.** Ela ocupa a frente, e o automático preenche o
   resto até o teto de 5. Fixar um título e ficar com um card só seria punir quem
   usa o recurso.

## Quando o hero some

`[]` é um desfecho legítimo, não um erro: `home-like.tsx` já esconde a faixa e o
header volta ao estado sólido. O log diz por quê:

```json
{"event":"hero_empty","scope":"movies","candidates":466,"byReason":{"sem_backdrop":401,"votos_insuficientes":58}}
```

Se isso aparecer com o catálogo cheio, o `byReason` aponta o que falta antes de
qualquer mudança de código.

## Relacionados

- [`docs/frontend/page-map.md`](../frontend/page-map.md) — escopo das telas; a home
  é `Public Marketing Home v4`, não um índice de catálogo.
- [`.claude/rules/ingestion.md`](../../.claude/rules/ingestion.md) — descoberta,
  exclusão de conteúdo adulto, periodicidades.
- `apps/web/src/server/trending-snapshot.ts` — por que "em alta" não faz fallback
  para popularidade (e por que o hero, que não afirma recorte, pode degradar).
