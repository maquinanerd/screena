# Handoff de design — o que esta versionado e o que nao esta

Este diretorio e a **fonte de verdade do sistema visual da Cinerie**. Ele e
citado por [`apps/web/app/globals.css`](../../apps/web/app/globals.css) e por
[`docs/frontend/home-editorial-highlights-and-ticker-carousel.md`](../frontend/home-editorial-highlights-and-ticker-carousel.md).

**Nem tudo do pacote original esta no git.** Leia a secao 2 antes de concluir que
falta arquivo.

## 1. O canonico

O arquivo canonico e
[`Screena-Design-System-Final-Handoff/Screen Screens v4.dc.html`](Screena-Design-System-Final-Handoff/Screen%20Screens%20v4.dc.html).

| | |
| --- | --- |
| Tamanho | 380.309 bytes |
| SHA-256 | `6936a3416d9d008d46c0e88b87127817e7cc30a3acd5829da86e8b61296ca770` |

Esse e o hash citado no cabecalho do `globals.css`, e foi **conferido contra o
arquivo em disco** (2026-08-04). O nome do arquivo preserva a marca antiga
("Screen") por estabilidade de referencia; a marca publica renderizada e
**Cinerie** — ver [`REBRANDING-CINERIE.md`](../../REBRANDING-CINERIE.md).

Os inventarios de token que o `globals.css` transcreve vivem em
[`Screena-Design-System-Final-Handoff/design-system/`](Screena-Design-System-Final-Handoff/design-system/):
`05-DESIGN-TOKENS`, `06-COLOR-SYSTEM`, `07-TYPOGRAPHY-SYSTEM`,
`08-SPACING-GRID-LAYOUT`, `09-RADIUS-BORDERS-SHADOWS`.

## 2. `uploads/` NAO esta no git — e isso e proposital

O pacote original tem 137 MB. Deste repositorio consta apenas o subconjunto que
e fonte de verdade (**2,9 MB**): os 7 HTML canonicos, o `MANIFESTO-CANONICO.json`
e o `design-system/` inteiro.

O `uploads/` (134 MB) esta em [`.gitignore`](../../.gitignore) porque:

- o proprio `MANIFESTO-CANONICO.json` o declara em `referenceOnlyDirectories` —
  nao e fonte de verdade, e moodboard (capturas de concorrente, PDFs de artigo,
  fotos de banco);
- **39,8 MB dos 134 MB sao duplicata byte-a-byte** (25 grupos de arquivos
  identicos, ex.: `home oficial.png` e `home oficial-82b9349c.png`);
- sao assets ja comprimidos (PNG/JPG/PDF), que o git nao encolhe e que todo
  clone e todo checkout de CI pagaria para sempre.

Ele continua existindo **no disco local**, no checkout principal, em
`docs/design-handoff/Screena-Design-System-Final-Handoff/uploads/`. **Nao delete
esse diretorio**: e o unico lugar onde esse material existe. Se voce precisa dele
e nao o tem, peca a copia — nao ha como recuperar do git.

## 3. Cuidado: o `MANIFESTO-CANONICO.json` nao descreve este pacote

O manifesto veio de um pacote **maior e anterior**, e nao foi regenerado. Ele nao
e um indice confiavel do que esta aqui. Divergencias confirmadas (2026-08-04):

| Campo | Manifesto diz | Realidade |
| --- | --- | --- |
| `canonicalDesign.sha256` | `0cc8fcd6afe74b64…` | `6936a3416d9d008d…` |
| `canonicalDesign.sizeBytes` | 367.827 | 380.309 |

Alem disso, ele indexa em `canonicalDocuments`/`canonicalPages` arquivos que
**nao existem** neste pacote — `paginas/`, `docs/`, `00-LEIA-PRIMEIRO.md`,
`PROMPT-CLAUDE-CODE.md` — e lista em `legacyDirectories` diretorios que tambem
nao existem aqui (`screen-v4-design-handoff/`, `design_handoff_the_screen/`,
`handoff/`, `backups/`).

O manifesto foi commitado **como recebido**, sem correcao, para nao alterar a
proveniencia do artefato. Em caso de conflito, **o arquivo em disco vence o
manifesto**, e o hash da secao 1 e o valor conferido.

## 4. Referencias historicas nao apontam para ca

Duas mencoes a "design-handoff" no repositorio sao **registros datados**, nao
ponteiros vivos, e por isso nao foram reescritas:

- [`FASE-0-RELATORIO.md`](../../FASE-0-RELATORIO.md) cita
  `screen-v4-design-handoff/` — nome **legado e diferente**, marcado como
  material historico que nao deve guiar decisao visual.
- [`apps/cms/ADMIN-UX-2026-08-01.md`](../../apps/cms/ADMIN-UX-2026-08-01.md)
  registra o resultado de um `grep` executado naquela data.
