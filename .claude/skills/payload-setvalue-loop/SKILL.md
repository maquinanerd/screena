---
name: payload-setvalue-loop
description: Use ao criar ou revisar componente de campo customizado do admin do Payload (apps/cms/src/admin/**) que deriva o proprio valor de outro campo do formulario. No Payload, setValue com o MESMO valor NAO e no-op — em rajada de digitacao vira laco de render, React error #185, tela branca e texto perdido. Cobre a regra de comparar antes de setar e quando usar debounce.
---

# Skill: payload-setvalue-loop

> Alerta, nao tutorial. Se voce esta escrevendo um componente que chama
> `setValue` dentro de um `useEffect`, leia as 10 linhas abaixo antes de
> continuar.

## A armadilha

`setValue` do `useField` (`@payloadcms/ui`) **nao compara o valor novo com o
atual**. Chamar com o valor identico ao que ja esta la nao e no-op: ele

1. despacha `UPDATE` no reducer do formulario,
2. recria o objeto `fields[path]`,
3. chama `setModified(true)` **incondicionalmente**,
4. rearma o efeito de validacao (throttle de 150 ms),
5. rearma o autosave.

Como `fields[path]` e um objeto novo, todo consumidor daquele path re-renderiza.
Se o re-render leva o efeito a chamar `setValue` de novo, o ciclo se fecha.

## Por que passa despercebido

O gatilho e a **cadencia da digitacao**, nao o comprimento do texto nem um valor
"errado". Digitar devagar nao reproduz: cada ciclo termina antes do proximo
caractere. Digitar rapido faz os ciclos se sobreporem e o laco escapa — React
error #185 (`Maximum update depth exceeded`), tela branca, e o que estava no
formulario se perde porque o autosave rearmado nunca conclui.

Foi assim que o CMS caiu: uma PR e dois dias de perda de dados em producao.

## A regra

**Todo componente de campo customizado que deriva valor de outro campo precisa
de uma guarda que faca a escrita atingir ponto fixo.** Qual guarda depende de o
valor derivado ser deterministico.

**1. Valor deterministico — compare por igualdade.** A mesma origem sempre
produz a mesma saida.

```tsx
// ERRADO — seta sempre que a origem muda, mesmo sem mudanca real
useEffect(() => { setValue(derive(source)) }, [source, setValue])

// CERTO
useEffect(() => {
  const next = derive(source)
  if (next === value) return
  setValue(next)
}, [source, value, setValue])
```

**2. Valor NAO deterministico — compare por predicado, nunca por igualdade.**
Se a geracao sorteia (id aleatorio, timestamp), `next === value` e sempre falso
e o laco nunca para. Guarde no estado ATUAL: "ja tem valor utilizavel?"

```tsx
useEffect(() => {
  if (isUsable(value)) return   // ponto fixo: escreve uma vez, na criacao
  setValue(generate())
}, [value, setValue])
```

Ver `apps/cms/src/admin/BlockIdField.tsx` — `isUsableBlockId(value)`.

**3. Valor composto em mais de um `setValue`** — serialize e compare num `ref`,
para que as duas escritas sejam decididas juntas.

```tsx
const lastWritten = useRef<string | null>(null)
const write = useCallback((text, marks) => {
  const serialized = JSON.stringify({ text, marks })
  if (lastWritten.current === serialized) return
  lastWritten.current = serialized
  setValue(text); setMarks(marks)
}, [setValue, setMarks])
```

Ver `apps/cms/src/admin/ParagraphTextField.tsx` (#106) — vale tambem quando a
escrita vem de um listener registrado em efeito (`registerUpdateListener`), que
dispara a cada tecla como um efeito dispararia.

Considere **debounce** quando a origem e texto digitado: a guarda mata o laco, o
debounce evita o trabalho inutil a cada tecla.

Escopo: a regra vale para `setValue` chamado em **efeito**. Em handler de clique
(`onClick`) nao ha laco — o handler nao se re-dispara sozinho. Ver
`apps/cms/src/admin/QaApprovalField.tsx` (`approve`/`revoke`), que e seguro por
isso.

## Ancoras

- Caso concreto: **PR #104**, `apps/cms/src/admin/SlugField.tsx` — o efeito que
  acompanha `title` chamava `setValue(result.slug)` sem comparar.
- Comportamento no pacote: `@payloadcms/ui`, `dist/forms/useField/index.js` — o
  `setValue` despacha `UPDATE` e chama `setModified(true)` sem comparar; a
  validacao roda sob `useThrottledEffect(..., 150, ...)`. As linhas apontadas na
  investigacao da #104 foram `:44-56` e `:87-101`. **Confira por simbolo, nao por
  linha**: o `dist` e saida de compilador e os numeros andam entre patches.

## Nota de governanca

Esta skill existe porque a skill oficial `payload` (vendorizada em
`.claude/skills/payload/`) ensina `useField`/`setValue` em `ADVANCED.md` **sem**
esse alerta. Nao e contradicao — e lacuna. Ao atualizar a skill upstream, esta
continua valendo por cima.
