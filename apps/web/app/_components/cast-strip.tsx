import type { ReactNode } from 'react'

import type { CastMemberView } from '../../src/lib/cast-presenter'

/**
 * CastStrip — faixa de retratos do ELENCO das fichas de titulo (filme e serie).
 *
 * PRESENTACIONAL e PURO: recebe os `CastMemberView` ja montados, ordenados e
 * limitados pelo presenter (`cast-presenter.ts`) e so produz JSX. Nao importa
 * @screena/db e nao faz IO (invariantes 3 e 4). Elenco e dado factual de
 * catalogo (nome + personagem) — nota, licenca de rating e disponibilidade
 * nunca chegam aqui.
 *
 * POR QUE ELE EXISTE, EM VEZ DO BLOCO INLINE NAS PAGINAS.
 * A faixa vivia inline nas duas fichas, e cada uma a escrevia DUAS vezes: uma
 * para o membro COM slug (envolvido em `<a>`) e outra — identica em tudo menos
 * na tag — para o membro SEM slug (`<div>`). Eram quatro copias do mesmo
 * cartao; mexer no fallback de iniciais exigia acertar as quatro, e a primeira
 * que alguem esquecesse passaria despercebida, porque as duas metades so
 * aparecem juntas em titulos que misturam elenco com e sem pagina propria.
 *
 * Aqui o corpo do cartao existe UMA vez e so o involucro varia com o slug.
 *
 * As classes (`cast-strip`, `cast-tile`, `cast-tile__photo`, `cast-tile__name`,
 * `cast-tile__role`) e a ordem dos atributos do `<img>` sao as mesmas de antes:
 * o CSS de `globals.css` resolve por ordem de documento e nao foi tocado.
 */

/** Ate duas iniciais, exibidas quando o membro nao tem retrato. */
function castInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')
}

/**
 * Conteudo do cartao — identico com ou sem link. So a tag que o envolve muda,
 * e e por isso que ele mora aqui: era exatamente esta metade que estava
 * duplicada em cada ficha.
 */
function CastTileBody({ member }: { member: CastMemberView }): ReactNode {
  return (
    <>
      <span className="cast-tile__photo">
        {member.profile !== null ? (
          <img alt="" loading="lazy" src={member.profile.src} />
        ) : (
          <span aria-hidden="true">{castInitials(member.name)}</span>
        )}
      </span>
      <p className="cast-tile__name">{member.name}</p>
      {member.character !== null ? <p className="cast-tile__role">{member.character}</p> : null}
    </>
  )
}

/**
 * Membro sem slug canonico vira `<div>`, nunca link quebrado — a decisao ja
 * veio resolvida do presenter em `member.href`.
 *
 * Nao ha guarda de lista vazia: quem chama passa por `SectionBoundary`, e
 * `decideSection` ja trata array vazio como ausencia (a secao inteira sai do
 * DOM e a causa vai para o log). Uma guarda aqui seria codigo morto.
 */
export function CastStrip({ members }: { members: CastMemberView[] }): ReactNode {
  return (
    <ul className="cast-strip">
      {members.map((member, index) => (
        <li key={`${member.name}-${index}`}>
          {member.href !== null ? (
            <a className="cast-tile" href={member.href}>
              <CastTileBody member={member} />
            </a>
          ) : (
            <div className="cast-tile">
              <CastTileBody member={member} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
