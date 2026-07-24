# Runbook — desligar uma fonte sem quebrar a página

> Procedimento operacional para **tirar do ar** o dado de uma fonte (rating ou
> oferta de streaming), seja por revogação de licença, disputa, degradação do
> upstream ou decisão editorial.
>
> Garantia central, provada em PostgreSQL real por
> `pnpm --filter @screena/web validate:licensed-intelligence`:
> **desligar uma fonte torna o dado invisível e mantém a página inteira e
> indexável.** Nenhum passo deste runbook derruba página, gera 500 ou exige
> deploy.

## Princípio

O dado sai do ar **pela governança**, nunca por `DELETE`. A linha permanece no
banco para auditoria; o que muda é a autorização. Por isso o desligamento é
reversível e deixa rastro.

Não é preciso tocar em `external_ratings` / `watch_availability`: a **leitura**
revalida licença, decisão, vigência, território e frescor a cada render. Mexer na
autorização basta — e é o único jeito que preserva o histórico.

## Opção A — desligar uma FONTE inteira (todas as entidades)

Supersede a licença vigente. Ninguém apaga linha; a licença antiga deixa de ser
a vigente.

```bash
UPDATE source_licenses SET is_current = false
 WHERE source_key = '<fonte>' AND content_type = 'rating' AND is_current;
```

Efeito imediato (sem deploy, sem invalidação manual de cache além do ISR):

- a nota some de todas as páginas — a leitura exige `sourceLicense.isCurrent`;
- a página continua `index` e renderiza normalmente sem o painel;
- `display_allowed` na linha da nota **continua `true`** — e isso é correto: a
  autoridade é a licença, não o flag denormalizado.

Provado pelos checks 13 e 14 do validador.

## Opção B — desligar um USO específico (ex.: só exibição, mantendo análise)

Expira a decisão de uso. A janela inteira vai para o passado — o CHECK
`data_usage_decisions_validity_range` exige `valid_until > valid_from`, então
**não** basta puxar o fim para trás.

```bash
UPDATE data_usage_decisions
   SET valid_from = now() - interval '10 days',
       valid_until = now() - interval '1 day'
 WHERE id = <id> AND use_case = 'rating_display';
```

Alternativa equivalente: `SET is_current = false`.

Provado pelos checks 9 e 10.

## Opção C — restringir por território

Aponte a decisão para outro território. A decisão **não pode exceder** o
território da licença-mãe (o banco recusa), então restrinja a decisão, não a
licença:

```bash
UPDATE data_usage_decisions SET territory = 'US' WHERE id = <id>;
```

O site publica em **BR**: uma decisão escopada a outro território deixa de
autorizar a exibição aqui. Provado pelo check 11 (ratings) e 18 (streaming — uma
oferta exibível nos EUA não vaza para o painel BR).

## Opção D — desligar um provedor de streaming específico

```bash
UPDATE source_licenses SET is_current = false
 WHERE source_key = '<slug-do-provedor>' AND content_type = 'watch_availability' AND is_current;
```

As demais ofertas do título continuam no painel; some apenas a do provedor
desligado. Se nenhuma sobrar, o painel inteiro é omitido — sem heading vazio e
sem "indisponível" fabricado.

## O que **não** fazer

- **Não** `DELETE` a licença, a decisão ou a linha de dado. Perde auditoria e o
  histórico exigido pelo modelo (`supersedes_id`).
- **Não** setar `display_allowed = false` na linha do dado como único passo: isso
  esconde o sintoma e deixa a autorização ligada. Além disso, qualquer re-sync
  pode reverter o flag.
- **Não** remover o crédito para "limpar a tela": crédito órfão e dado sem
  crédito são os dois lados da mesma violação. O presenter descarta a oferta/nota
  que perdeu o crédito exigido.
- **Não** desligar via deploy/feature flag no código. A autorização mora no
  banco justamente para não depender de release.

## Religar

Reverta o campo alterado (`is_current = true`, `valid_until = NULL`, território
de volta a `BR`). O check 12 do validador prova o caminho de volta: restaurada a
decisão, a nota reaparece.

Religar uma fonte que ficou fora por **motivo jurídico** exige decisão humana
registrada — atualize
[`source-replication-authorization.md`](./source-replication-authorization.md) e
a [matriz](./source-authorization-matrix.md) antes de reativar.

## Verificação

```bash
pnpm --filter @screena/web validate:licensed-intelligence
```

21 checks em PostgreSQL 16 efêmero com os triggers reais ativos, cobrindo:
origem/licença/atribuição, invisibilidade de fonte pendente, territorialidade,
desligamento sem quebra e estado honesto sem fonte alguma.
