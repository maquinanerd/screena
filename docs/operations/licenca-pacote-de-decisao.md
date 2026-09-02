# Pacote de decisão de licença — ofertas e biografias

> **Este documento não decide nada.** Ele reúne as consultas, o que cada número
> significa e o que cada decisão destrava, para que a decisão seja tomada por um
> humano com o dado na frente.
>
> Invariante 6: dado com `license_status` em `unknown`/`blocked`, ou com
> `display_allowed = false`, **não aparece em página indexável**. Mudar isso é
> decisão humana registrada — nunca inferência de agente.

---

## Por que existem dois pacotes aqui

São duas decisões independentes, de mecânica diferente, que a auditoria de
2026-09-01 mediu juntas:

| | Ofertas ("onde assistir") | Biografias |
| --- | --- | --- |
| Onde mora o gate | `watch_availability.display_allowed` | `people.biography_source_status` |
| Estado medido | 70.036 de 70.869 com `false` | 100% de 1,3 M em `unknown` |
| Dado existe? | sim, 70.869 linhas | sim, 2.152 biografias preenchidas |
| Ferramenta pronta? | **sim** — CLI com lote | script de atualização, ainda não escrito |
| O que destrava | "onde assistir" sai de 147 de 83.314 títulos | ficha de pessoa + shard de pessoas do sitemap |

---

## Parte 1 — Ofertas

### 1.1. A consulta do pacote

Ela responde **por fornecedor técnico, plataforma e estado de licença**, que é o
recorte pelo qual a decisão pode ser tomada em blocos em vez de linha a linha.

```sql
SELECT w.provider_api,
       COALESCE(p.name, '(sem plataforma)')            AS plataforma,
       w.country_code,
       w.offer_type,
       COALESCE(sl.license_status, '(sem licenca)')    AS license_status,
       w.display_allowed,
       count(*)                                        AS ofertas,
       count(DISTINCT w.entity_id)                     AS titulos
  FROM watch_availability w
  LEFT JOIN watch_providers p ON p.id = w.provider_id
  LEFT JOIN source_licenses sl ON sl.source_key = w.provider_api
 GROUP BY 1, 2, 3, 4, 5, 6
 ORDER BY ofertas DESC;
```

### 1.2. Como ler o resultado

- **`display_allowed = false` com `license_status` permissivo** (`official`,
  `licensed`, `third_party`) → é o balde que a decisão pode abrir. A licença
  comporta; o gate simplesmente nunca foi virado.
- **`display_allowed = false` com `unknown`/`blocked`** → **não abra**. A
  invariante 6 barra, e virar o gate aqui exigiria antes uma decisão de licença
  sobre a FONTE, que é outro assunto (`services/legal`).
- **`offer_type`** importa: `subscription`, `free`, `ads`, `rent`, `buy` são
  modalidades diferentes e a tela mostra a modalidade ao lado da marca. Liberar
  `buy`/`rent` sem querer muda o que a página afirma.

### 1.3. Depois de decidir — a execução

A CLI ganhou modo em lote nesta leva. **Dry-run é o default**; `--confirm` exige
`--reviewer` (a identidade vai para `reviewed_by`), e o lote tem teto duro de
500 por invocação.

```bash
corepack pnpm --filter @screena/streaming exec tsx bin/promote-watch-availability.ts --provider=tmdb --country=BR --limit=100
```

Conferido o dry-run, repita com `--confirm --reviewer=<seu-nome>`.

O lote **não afrouxa nada**: ele só escolhe quais ids entram, e cada linha passa
pelos mesmos guardrails de elegibilidade de sempre.

### 1.4. Como medir o efeito

```sql
SELECT count(*) FILTER (WHERE display_allowed) AS exibiveis,
       count(*)                                AS total
  FROM watch_availability;
```

Antes: 833 de 70.869.

---

## Parte 2 — Biografias

### 2.1. O que torna esta decisão diferente

Preencher `people.biography` **não muda nada na tela**. Quem decide a exibição é
`people.biography_source_status`, que nasce `unknown` — o estado que a invariante
6 usa para bloquear — e **nada no sistema o altera**. Existem 2.152 biografias no
banco e nenhuma delas pode aparecer.

E há uma consequência que não é óbvia: o shard de pessoas do sitemap responde
**404** porque o predicado dele exige
`biography_source_status IN ('official','licensed','third_party')`, e ninguém
passa. O sitemap não está quebrado — ele está correto sobre um catálogo vazio.
Destravar a licença conserta os dois de uma vez.

### 2.2. A consulta do pacote

De onde vêm as biografias que existem:

```sql
SELECT p.biography_source_status,
       count(*)                                              AS pessoas,
       count(*) FILTER (WHERE p.biography IS NOT NULL
                          AND btrim(p.biography) <> '')      AS com_texto,
       count(*) FILTER (WHERE p.profile_path IS NOT NULL)    AS com_foto
  FROM people p
 GROUP BY 1
 ORDER BY pessoas DESC;
```

E a origem real do texto, por amostragem — a pergunta que decide a classificação:

```sql
SELECT e.source, count(*) AS pessoas
  FROM people p
  JOIN entity_external_ids e
    ON e.entity_type = 'person' AND e.entity_id = p.id
 WHERE p.biography IS NOT NULL AND btrim(p.biography) <> ''
 GROUP BY 1
 ORDER BY 2 DESC;
```

### 2.3. A decisão a tomar

Para **cada origem** que a consulta acima revelar, escolher um estado:

| Estado | Quando | Efeito |
| --- | --- | --- |
| `official` | acordo/licença da própria fonte | exibe |
| `licensed` | licença de terceiro com direito de exibição | exibe |
| `third_party` | origem de terceiro com direito limitado | exibe se as flags permitirem |
| `unknown` | licença não confirmada | **não exibe** (é o estado de hoje) |
| `blocked` | exibição proibida | **não exibe** |

> **Atenção ao TMDB.** Se a amostragem mostrar que o texto vem do TMDB, a
> classificação precisa olhar os termos dele sobre obra derivada — o mesmo ponto
> que já bloqueia o Cinerie Score
> (`docs/legal/cinerie-score-derivative-authorization.md`). Não presuma
> `third_party` por conveniência.

### 2.4. O que ainda não existe

O **script de atualização em lote** de `biography_source_status`. Ele não foi
escrito de propósito: sem a classificação acima, não há o que ele escreveria.
Assim que a decisão vier, ele é pequeno — e deve seguir o mesmo padrão da
promoção de ofertas: dry-run por default, `--confirm` com revisor identificado,
teto por invocação.

### 2.5. Como medir o efeito

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://cinerie.com/sitemaps/people-1
```

Antes: **404**. Depois da decisão e da execução: **200** com URLs.

---

## O que NÃO fazer em nenhuma das duas

- Não abrir o gate "para testar" e reverter depois: `display_allowed` alimenta
  página indexável, e o buscador não desfaz o que já leu.
- Não classificar uma origem como `third_party` só porque `unknown` está
  bloqueando. `unknown` é o default seguro, e ele existe exatamente para o caso
  de ninguém ter verificado.
- Não decidir por fornecedor técnico (`provider_api`) o que é decisão de fonte
  editorial. Quem transportou o byte não é quem licencia o dado — invariante 2.
