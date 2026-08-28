/**
 * cast-strip.tsx — A faixa de retratos de elenco, com e sem link.
 *
 * ============================================================================
 * POR QUE ISTO É UM COMPONENTE
 * ============================================================================
 * A ficha de série e a de filme desenham esta faixa INLINE, e cada uma escreve
 * o bloco DUAS vezes: uma para o membro com slug (vira `<a>`) e outra para o
 * membro sem slug (vira `<div>`). São quatro cópias do mesmo retrato, das
 * mesmas iniciais de fallback e do mesmo par nome/personagem.
 *
 * A página de episódio precisa da MESMA faixa em dois lugares (elenco
 * convidado e elenco regular). Copiá-la de novo levaria a seis cópias — e a
 * primeira correção aplicada a uma e esquecida nas outras é o defeito que este
 * repositório já pagou em `buildCoverageJob` e em `youtube-embed.ts`.
 *
 * As fichas de filme e série NÃO foram migradas nesta leva: mexer no corpo
 * delas é escopo próprio, com risco visual próprio. A duplicação delas está
 * registrada como pendência, não resolvida aqui em silêncio.
 *
 * PRESENTACIONAL e SERVER: sem estado, sem `use client`, sem fetch. Recebe a
 * view já decidida pelo presenter.
 */

import type { ReactNode } from 'react'

import type { CastMemberView } from '../../src/lib/cast-presenter'

export interface CastStripProps {
  readonly members: readonly CastMemberView[]
  /**
   * Classe da `<ul>`. Default `cast-strip` — a mesma da ficha de filme/série,
   * que já existe em `globals.css`. Inventar um vocabulário visual novo aqui
   * criaria uma segunda grade de retratos para a mesma coisa.
   */
  readonly className?: string
}

/**
 * As iniciais do nome, quando não há retrato.
 *
 * Duas letras, das duas primeiras palavras. Nunca o nome inteiro (estouraria o
 * círculo) e nunca uma silhueta genérica (que some com a identidade de quem
 * não tem foto no TMDB — em geral figurantes e técnicos).
 */
function iniciais(nome: string): string {
  return nome
    .split(' ')
    .slice(0, 2)
    .map((parte) => parte.slice(0, 1))
    .join('')
}

/** O conteúdo do retrato — idêntico com e sem link. */
function Retrato({ member }: { member: CastMemberView }): ReactNode {
  return (
    <>
      <span className="cast-tile__photo">
        {member.profile !== null ? (
          // `alt=""` de propósito: o nome vem logo abaixo, em texto. Repetir o
          // nome no alt faria o leitor de tela anunciá-lo duas vezes.
          <img alt="" loading="lazy" src={member.profile.src} />
        ) : (
          <span aria-hidden="true">{iniciais(member.name)}</span>
        )}
      </span>
      <p className="cast-tile__name">{member.name}</p>
      {member.character !== null ? <p className="cast-tile__role">{member.character}</p> : null}
    </>
  )
}

export function CastStrip({ members, className = 'cast-strip' }: CastStripProps): ReactNode {
  return (
    <ul className={className}>
      {members.map((member, index) => (
        <li key={`${member.name}-${String(index)}`}>
          {member.href !== null ? (
            <a className="cast-tile" href={member.href}>
              <Retrato member={member} />
            </a>
          ) : (
            // Sem slug canônico a pessoa não tem página: texto, nunca um link
            // que leva a 404.
            <div className="cast-tile">
              <Retrato member={member} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
