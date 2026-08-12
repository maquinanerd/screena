# Autorização dos provedores de ratings e streaming

> Registro da decisão humana que destravou a consulta aos provedores externos em
> produção. Idioma: pt-BR. **Nenhum valor de chave, token ou senha aparece aqui.**

---

## 1. A decisão

| Campo | Valor |
| --- | --- |
| **Quem autorizou** | Pablo Eduardo, dono do projeto |
| **Quando** | 2026-08-11 |
| **O que foi autorizado** | Consulta em produção aos provedores de **ratings** (Film & Show Ratings via RapidAPI) e de **disponibilidade de streaming** (Streaming Availability via RapidAPI) |
| **Sob qual base** | Uso **jornalístico**, com **crédito visível à fonte em toda exibição** |
| **Ciência do licenciamento** | Sim — a decisão foi tomada com ciência explícita do licenciamento de cada fonte |
| **Reversível sem deploy** | Sim — basta remover a variável de ambiente |

Texto da autorização, como recebido:

> "DECISÃO DO DONO, registrada: autorizar. O uso é JORNALÍSTICO, com crédito
> visível à fonte em toda exibição."

---

## 2. Como a autorização é expressa

O bloqueio anterior era **incondicional**: `evaluateRatingsGate` e
`evaluateStreamingGate` recusavam **qualquer** chamada de rede sob
`NODE_ENV=production`, mesmo com chave válida e `--apply`.

Esse bloqueio **não foi apagado**. Ele virou autorização explícita, **uma por
provedor**:

| Variável | Serviço | Destrava |
| --- | --- | --- |
| `CINERIE_RATINGS_PROVIDER_AUTHORIZED=true` | `services/ratings` | consulta ao provedor de notas em produção |
| `CINERIE_STREAMING_PROVIDER_AUTHORIZED=true` | `services/streaming` | consulta ao provedor de disponibilidade em produção |

Três propriedades deliberadas:

1. **Separadas por provedor.** As licenças são diferentes; desligar uma não pode
   desligar a outra.
2. **Fail-closed por omissão.** O gate compara com `!== true`, não com `!`. Um
   chamador que não conheça o campo passa `undefined` — e `undefined` bloqueia
   igual a `false`. Travado por teste (`FAIL-CLOSED por OMISSAO`).
3. **Só a string exata `true`.** `"1"`, `"yes"` e `"sim"` **não** autorizam.

Sem a variável, o comportamento em produção é **exatamente** o de antes.

---

## 3. O que a autorização NÃO faz

Esta é a parte que mais importa: **autorizar a COLETA nunca foi autorizar a
EXIBIÇÃO.** Toda a cadeia a jusante continua intacta:

| Gate | Onde | Continua valendo |
| --- | --- | --- |
| `validateRating` | `packages/schemas/src/ratings.ts` | cross-label proibido; `provider_api ≠ rating_source`; escala fixa por fonte |
| `license_status` / `display_allowed` | `source_licenses`, `watch_availability` | dado sem licença clara não aparece em página indexável (invariante 6) |
| Crédito obrigatório | `ratings-presenter.ts`, `watch-availability-presenter.ts` | nota sem atribuição e oferta sem crédito **não vão ao ar** |
| Sem pirataria | invariante 8 | nenhuma fonte com torrent/IPTV/player ilegal entra — e isso **não é** algo que uma variável de ambiente possa mudar |
| Sem `AggregateRating` falso | `packages/seo` | nota de terceiro nunca vira nota própria da Cinerie |

---

## 4. Crédito é requisito bloqueante — e está travado

**Estado verificado (não implementado agora — já existia):** os dois presenters
já descartavam o item sem crédito antes desta decisão.

- `apps/web/src/lib/ratings-presenter.ts:132` — sem `attribution.text`, a nota é
  descartada (`return null`);
- `apps/web/src/lib/watch-availability-presenter.ts:258` — `requiresAttribution
  !== false && attributionText === null` → a oferta é pulada; o mesmo para
  `requiresLinkback` / `attributionUrl`.

O que **faltava** era a trava. Uma "simplificação" futura que removesse esses
`if` passaria em todos os testes existentes e violaria a licença em silêncio, em
produção. Agora existe
[`tests/governance/credit-required-on-display.test.ts`](../../tests/governance/credit-required-on-display.test.ts):
12 casos, incluindo **controle positivo** (uma nota e uma oferta que
**aparecem**, com fonte e escala visíveis).

O controle positivo não é decoração: na primeira versão do arquivo o fixture de
streaming estava malformado (faltava `displayAllowed`), o presenter devolvia
`null` em **todos** os casos, e os cinco testes negativos passavam pelo motivo
errado. O controle positivo pegou isso.

### Como a nota aparece na tela

`"7,9/10"` acompanhado de `IMDb`, da natureza (`Crítica`/`Público`), do rótulo da
métrica e da atribuição — **nunca** `"7,9"` solto. A escala anda junto com o
número, então um `92` do Rotten Tomatoes nunca se confunde com um `9,2` do IMDb.

**Sem logo.** `logo_allowed = false` para todas as fontes: o nome aparece em
texto. O painel nunca renderiza a marca gráfica.

### Estado vazio honesto

Sem nota creditada, o painel **inteiro não renderiza** — não existe
`"sem avaliações"` em lugar nenhum (verificado por `grep` repo-wide). Isso é
deliberado: *"sem avaliações"* é uma afirmação sobre o mundo; a verdade é sobre
nós — **não consultamos**, ou consultamos e a licença não permite exibir.

---

## 5. Formato de atribuição exigido por cada provedor

**NÃO DESCOBRI.** Não consegui verificar, nesta sessão, a documentação viva de
cada provedor quanto a exigência de formato específico (logo obrigatório, texto
exato, linkback com `rel` particular).

O que existe no repositório é a matriz em
[`docs/legal/source-authorization-matrix.md`](./source-authorization-matrix.md),
que registra `requires_attribution` e `requires_linkback` por fonte e é a base do
comportamento atual dos presenters. O texto de crédito exibido vem da coluna
`attribution_text` do banco — ou seja, **é configurável por fonte sem deploy**,
e adequá-lo ao formato exato que cada provedor exigir é uma alteração de dado,
não de código.

**Pendência aberta, para revisão humana:** conferir nos Termos de cada provedor
se há formato mandatório e ajustar `attribution_text` / `attribution_url` em
`source_licenses` de acordo. Enquanto isso, o comportamento é o mais
conservador possível: sem crédito, não exibe.

---

## 6. Como revogar

1. Remover (ou pôr em `false`) a variável do serviço correspondente no EasyPanel;
2. reiniciar o serviço.

Não há deploy de código envolvido. O gate volta a recusar toda chamada de rede em
produção, e a mensagem de bloqueio aponta de volta para este documento.

Revogar a autorização **não** apaga dado já coletado — ele continua no banco para
auditoria. A exibição segue governada por `display_allowed`, como sempre foi.
