# 2026-08-12 — Remediação das decisões legadas sob licença `unknown`

> Registro de governança. Este documento **substitui os booleanos de grant** que
> a remediação zera nas linhas aposentadas — é aqui que fica o que elas
> concediam. Decisão de Pablo Eduardo, proprietário da Cinerie.

## 1. O que aconteceu

`pnpm legal sources apply --confirm` parou duas vezes, em ramos diferentes do
mesmo guarda `data_usage_decisions_guard`:

```
1º  P0001: data_usage_decisions fail-closed: licenca 8 nao e a vigente (is_current=false)
2º  P0001: data_usage_decisions fail-closed: licenca 8 com license_status unknown nao permite uso concedido
```

O primeiro era ordem errada no laço de escrita (corrigido na PR #161: as
decisões saem antes da licença). O segundo é **dado corrompido**, e é o assunto
deste documento.

## 2. Como o dado corrompeu

`packages/db/prisma/seed.ts` fazia `update` **in place** na licença VIGENTE de
cada fonte de rating:

```ts
const existing = await prisma.sourceLicense.findFirst({ where: { …, isCurrent: true } });
if (existing) await prisma.sourceLicense.update({ where: { id: existing.id }, data: license });
```

`SOURCE_LICENSE_SEED` carrega o default conservador da Fase 1
(`license_status='unknown'`, `display_allowed=false`). Rodar `db:seed` **depois**
de um apply rebaixava a licença autorizada pelo proprietário — mesmo `id`, mesmo
`is_current`, mesmas decisões penduradas. As decisões continuavam concedendo,
agora sob licença não-exibível.

**As decisões eram legais quando nasceram.** `data_usage_decisions` e seu guarda
nascem na mesma migration (`20260717120000`, tabela na linha 85, trigger na 236)
e nenhuma migration insere decisões — nenhuma linha pode preceder o guarda.
Foram criadas sob licenças `third_party`/`display=true`. A licença é que foi
rebaixada debaixo delas.

**Impressão digital, checável:** `license_status='unknown'` **junto com**
`decision_origin='owner_authorization'` e `policy_version` preenchido. O apply
nunca escreve `unknown`; o seed nunca escreve `decision_origin`/`policy_version`.
As duas coisas na mesma linha só existem por sobrescrita.

**Não era caso isolado.** Repetia a cada `db:seed` posterior a um apply, por
qualquer pessoa seguindo o runbook — foi assim que aconteceu em 2026-08-12. Nada
impedia: o único trigger de `source_licenses` era o
`source_licenses_supersedes_guard`, que só valida a cadeia `supersedes_id`.

## 3. O impasse

A decisão não saía porque a licença-mãe era `unknown` (o guarda reavalia o teto
em **qualquer** UPDATE numa linha que concede, e `is_current=false` não zera os
grants). A licença não era substituída porque a decisão não saía.

## 4. O que foi feito

| | |
|---|---|
| **(b1)** | O seed **cria quando falta e pula quando existe**, logando o motivo. Nunca sobrescreve licença vigente. |
| **(b4)** | Trigger `source_licenses_no_downgrade_guard` (migration `20260812120000`): recusa rebaixar licença vigente enquanto houver decisão viva concedendo sob ela. **Aperta** a invariante 6. |
| **(a)** | `pnpm legal sources remediate` — comando próprio de reparo de dado. Dry-run por default. O `apply` **não** mudou: continua falhando alto diante de estado corrompido. |

## 5. O que a remediação zera, e o que preserva

**Zerado** nas linhas aposentadas: `display_allowed`, `storage_allowed`,
`derivative_allowed` (este já era `false`).

**Preservado:** `id`, `use_case`, `territory`, **`stage`**, `policy_version`,
`decided_by`, `reason`, `valid_from`, `created_at`, `supersedes_id`.

A perda é pequena porque **`stage` é a fonte semântica e os booleanos são
derivados dela** — o próprio schema prova, nos CHECKs
`data_usage_decisions_display_requires_stage` e `..._storage_requires_stage`:
`display_allowed=true` só é possível com `stage='approved_for_display'`. Uma
linha aposentada com `stage='approved_for_display'` + `use_case='rating_display'`
+ `territory='BR'` continua dizendo, sem ambiguidade, o que autorizava.

`stage` **não** é movido para `revoked` de propósito: o CHECK
`revoked_allows_nothing` aceitaria, mas perderia-se justamente o registro de que
aquilo já foi aprovado para exibição.

## 6. Registro nominal

**São 10 linhas, não 5.** Cada licença de rating carrega duas decisões vigentes:
`rating_display`/BR (display + storage) e `internal_analytics`/global (storage).
As duas concedem, logo as duas estavam travadas.

### 6.1 Reprodução verificada (`pnpm validate:source-authorization-legacy-grants`)

Estado reconstruído pelo caminho real, idêntico ao de produção (8 licenças
vigentes de 13; 13 decisões vigentes; 5 `rating_display`/BR concedendo):

| decisao | licenca | fonte | use_case | territorio | stage (preservado) | concedia (ZERADO) | policy_version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | 8 (unknown) | imdb/rating | rating_display | BR | `approved_for_display` | **display + storage** | cinerie-source-auth/imdb/2026-08-v1 |
| 4 | 8 (unknown) | imdb/rating | internal_analytics | global | `approved_for_internal_use` | **storage** | cinerie-source-auth/imdb/2026-08-v1 |
| 5 | 9 (unknown) | rotten_tomatoes/rating | rating_display | BR | `approved_for_display` | **display + storage** | cinerie-source-auth/rotten-tomatoes/2026-08-v1 |
| 6 | 9 (unknown) | rotten_tomatoes/rating | internal_analytics | global | `approved_for_internal_use` | **storage** | cinerie-source-auth/rotten-tomatoes/2026-08-v1 |
| 7 | 10 (unknown) | metacritic/rating | rating_display | BR | `approved_for_display` | **display + storage** | cinerie-source-auth/metacritic/2026-08-v1 |
| 8 | 10 (unknown) | metacritic/rating | internal_analytics | global | `approved_for_internal_use` | **storage** | cinerie-source-auth/metacritic/2026-08-v1 |
| 9 | 11 (unknown) | letterboxd/rating | rating_display | BR | `approved_for_display` | **display + storage** | cinerie-source-auth/letterboxd/2026-07-v1 |
| 10 | 11 (unknown) | letterboxd/rating | internal_analytics | global | `approved_for_internal_use` | **storage** | cinerie-source-auth/letterboxd/2026-07-v1 |
| 11 | 12 (unknown) | filmaffinity/rating | rating_display | BR | `approved_for_display` | **display + storage** | cinerie-source-auth/filmaffinity/2026-07-v1 |
| 12 | 12 (unknown) | filmaffinity/rating | internal_analytics | global | `approved_for_internal_use` | **storage** | cinerie-source-auth/filmaffinity/2026-07-v1 |

Todas decididas por `Pablo Eduardo — proprietário da Cinerie`.

### 6.2 Produção — PREENCHER ANTES DO `--confirm`

> `pnpm legal sources remediate` (sem `--confirm`) imprime esta tabela já pronta
> para colar. **Os ids de produção podem diferir dos da reprodução.** Cole a
> saída real aqui, no mesmo commit em que o `--confirm` for executado; é este
> bloco que substitui os booleanos zerados.

```
<colar aqui a saída de `pnpm legal sources remediate`>
```

## 7. Lacunas registradas, não corrigidas

Levantadas durante o diagnóstico. **Nenhuma das duas foi mexida** — ficam aqui
para dimensionamento antes de qualquer decisão.

### 7.1 Os guardas não cobrem `DELETE`

`data_usage_decisions_guard` e `source_licenses_no_downgrade_guard` são
`BEFORE INSERT [OR UPDATE]`. Um `DELETE` passa por fora dos dois. Na prática
`data_usage_decisions_source_license_fkey` é `ON DELETE RESTRICT`, o que protege
a licença de sumir sob decisões — mas **a decisão em si pode ser apagada**, e com
ela o histórico. Não foi usado como saída para este impasse justamente por isso.
Falta medir: quais FKs apontam para `data_usage_decisions` e com que ação.

### 7.2 Aposentar licença deixando decisão viva concedendo

`source_licenses_no_downgrade_guard` foi escopado ao **rebaixamento** de licença
vigente — exatamente o que foi aprovado. Ele **não** bloqueia
`is_current: true → false` com decisões vivas concedendo embaixo, que é o outro
jeito de produzir decisão órfã (foi o 1º erro, hoje evitado pela ordem do laço,
mas só por convenção de código).

Bloquear isso quebraria o check 16 de
`validate-source-authorization-and-attribution`, que aposenta uma licença de
propósito para provar que a nota exibida deixa de ser reescrivível. Entra como
invariante candidata, com o custo já conhecido.

## 8. Ordem de execução em produção

1. Deploy do código + `prisma migrate deploy` (traz a trava (b4) e o seed (b1))
2. Backup do banco
3. `pnpm legal sources remediate` — dry-run; colar a saída na seção 6.2
4. `pnpm legal sources remediate --confirm --reviewer="…"`
5. `pnpm legal sources apply --confirm --reviewer="…" --policy-version="…"`
6. Sync OMDb

Depois do passo 5, `pnpm legal sources remediate` deve reportar **0 linhas** —
é a checagem de que não sobrou decisão concedendo sob licença não-exibível.

`db:seed` volta a ser seguro a qualquer momento após o passo 1: virou
create-if-absent. Continua necessário para ambiente novo (banco limpo, CI,
local), onde é ele quem garante que nenhuma fonte exista sem licença.
