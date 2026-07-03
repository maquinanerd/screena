import type { ReactNode } from "react";

import type { CastMemberView } from "../../src/lib/cast-presenter";

/**
 * CastStrip — faixa de ELENCO PRINCIPAL das paginas de detalhe (filme/serie).
 *
 * PRESENTACIONAL e PURO: recebe os `CastMemberView` ja montados pelo presenter
 * (`cast-presenter.ts`) e so produz JSX. Nao importa @screena/db nem faz IO
 * (invariantes 3/4). Renderiza apenas dados reais; sem retrato local seguro,
 * mostra fallback visual; sem slug canonico, o nome aparece como texto.
 *
 * Elenco = dado factual de catalogo (nome + personagem). Nunca exibe nota,
 * licenca de rating ou disponibilidade — nada disso chega a este componente.
 */

interface CastStripProps {
  /** Titulo da secao (ex.: "Elenco principal"). */
  heading: string;
  /** Membros ja ordenados/limitados pelo presenter. */
  members: CastMemberView[];
}

function CastPortrait({ member }: { member: CastMemberView }): ReactNode {
  if (member.profile !== null) {
    return (
      <img
        src={member.profile.src}
        alt={`Retrato de ${member.name}`}
        width={member.profile.width}
        height={member.profile.height}
        className="cast-member__image"
        loading="lazy"
      />
    );
  }
  return <span className="cast-member__fallback" aria-hidden="true" />;
}

function CastName({ member }: { member: CastMemberView }): ReactNode {
  if (member.href !== null) {
    return (
      <a className="cast-member__name cast-member__name--link" href={member.href}>
        {member.name}
      </a>
    );
  }
  return <span className="cast-member__name">{member.name}</span>;
}

export function CastStrip({ heading, members }: CastStripProps): ReactNode {
  if (members.length === 0) return null;
  return (
    <section className="cast-strip" aria-labelledby="cast-strip-title">
      <h2 id="cast-strip-title" className="cast-strip__title">
        {heading}
      </h2>
      <ul className="cast-strip__list">
        {members.map((member, index) => (
          <li key={`${member.name}-${index}`} className="cast-member">
            <span className="cast-member__media">
              <CastPortrait member={member} />
            </span>
            <span className="cast-member__body">
              <CastName member={member} />
              {member.character !== null ? (
                <span className="cast-member__character">{member.character}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
