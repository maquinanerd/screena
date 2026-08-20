# Cinerie Score — o que a mudança de `derivative_allowed` exige, fonte por fonte

> Determinação de **20/08/2026**. Pesquisa e redação: agente. **Decisão de
> produto (a fórmula): Pablo Eduardo, proprietário da Cinerie.** Fonte
> executável da fórmula:
> [`formula-2026-08-v1.ts`](../../packages/cinerie-score/src/formula-2026-08-v1.ts).

## O pedido, e o que foi encontrado

O proprietário fechou a fórmula e autorizou remover a barreira legal
(`derivative_allowed = false` em toda licença de nota). O pedido dizia, na mesma
frase:

> "Determine, fonte por fonte, o que a mudança exige — e **se alguma torna isto
> impossível por termo próprio, diga qual e por quê**. Autorização do dono não
> cria direito que a fonte não deu."

Foi o que aconteceu. **As quatro fontes da fórmula proíbem obra derivada nos
próprios termos.**

## A determinação, fonte por fonte

| Fonte | Chega por | Obra derivada | Consequência |
|---|---|---|---|
| **IMDb** | OMDb | ❌ **Proibida** | Sai da fórmula |
| **Rotten Tomatoes** | OMDb | ❌ **Proibida** | Sai da fórmula |
| **Metacritic** | OMDb | ❌ **Proibida** | Sai da fórmula |
| **TMDB** | API oficial | ❌ **Proibida** | Sai da fórmula |

### OMDb — entrega três das quatro fontes

> "You are strictly prohibited from creating derivative works or materials that
> otherwise are derived from or based on Contributions in any way [...] **unless
> it is expressly permitted by us in writing**."

E, separadamente:

> "You may not build a business utilizing the Contributions, whether or not for
> profit."

> "The Site is made available to you only for your personal use, and you may not
> use the Site or any Contributions or Materials in connection with any
> commercial endeavors."

**Não há distinção de tier** nos termos: nenhuma menção a Patreon, assinatura ou
direitos comerciais diferenciados por pagamento. As restrições valem para todos.

O Cinerie Score é, por definição, **obra derivada** das notas. As três fontes que
chegam pela OMDb saem.

### TMDB — a quarta

Os termos da API proíbem derivar da API e do conteúdo, e a TMDB **reserva
expressamente** o direito de fazer derivados. Uso comercial exige licença
específica, solicitada em separado.

## A consequência aritmética

A regra do proprietário resolve o caso sozinha:

> "Se alguma fonte não puder entrar na composição, **ela sai da fórmula** e o
> piso de duas fontes passa a valer sobre as que restam."

Quatro saem. **Restam zero.** O piso de duas nunca é alcançado, e o Score não
tem como ser exibido — não por decisão nossa, mas por aritmética sobre o que
sobrou.

## O que foi entregue mesmo assim, e por quê

A fórmula **está implementada, versionada, testada e registrada** em
`PRODUCTION_FORMULA_REGISTRY` como `cinerie-score/2026-08-v1`.

Isso não é contradição: **registrar não é ligar.** O engine só usa uma fórmula
que a `DataUsageDecision` vigente aprove **nominalmente**
(`approvedFormulaVersion`). Sem essa decisão, ele devolve `blocked_by_decision` —
e é o que continua fazendo.

O trabalho fica pronto para o dia em que a permissão existir. Nada além disso
muda de estado.

## O que destravaria — e é a única coisa que destrava

**Autorização por escrito**, de cada detentor:

1. **OMDb** — `unless it is expressly permitted by us in writing`. Contato:
   o canal de suporte da OMDb.
2. **TMDB** — licença comercial/de derivação, solicitada em separado.
3. Como a **OMDb não pode sublicenciar dado nem marca de terceiro** (seção 11:
   *"THIS AGREEMENT DOES NOT APPLY TO THIRD PARTY SITES"*), a permissão da OMDb
   provavelmente **não basta** para IMDb, Rotten Tomatoes e Metacritic —
   cada um seria um acordo próprio.

Com autorização escrita em mãos, a sequência é:

1. Registrar a autorização em `docs/legal/`, com o documento.
2. Remover a exclusão de tipo `Exclude<DataUsageCase, "cinerie_score_display">`
   em `authorization-spec.ts` e a guarda correspondente em `plan.ts` — **as
   duas existem para impedir que isso aconteça por engano.**
3. Emitir a decisão com `derivativeAllowed: true` e
   `approvedFormulaVersion: "cinerie-score/2026-08-v1"`, **só para as fontes que
   autorizaram**.
4. Rodar `legal sources review` e, se o plano estiver correto,
   `legal sources apply`.

## O que NÃO entrego, e por quê

**Não entrego um comando `legal sources apply` que ligue `derivative_allowed`.**

O registro legal existe para dizer o que as fontes permitiram. Gravar
`derivative_allowed = true` para IMDb, Rotten Tomatoes, Metacritic ou TMDB hoje
registraria uma autorização que **nenhuma delas deu** — e o registro passaria a
mentir exatamente sobre o que ele existe para provar. O comando de leitura vai
abaixo; ele não escreve nada.

```bash
corepack pnpm legal sources review
```

## Cobertura, para quando destravar

Medida em produção, no topo do catálogo: **IMDb 88%, Rotten Tomatoes 60%,
Metacritic 44%** — e despenca abaixo do topo.

Com o piso de duas fontes e **só as três da OMDb** autorizadas, a estimativa é
que a maioria dos títulos do topo alcançaria o piso (IMDb + Rotten cobre ~60%) e
a cauda longa ficaria sem Score. Com **só o TMDB** autorizado, nenhum título
alcança o piso — uma fonte não compõe.

Números exatos por título exigem consulta ao banco de produção, que não é
executada daqui.
