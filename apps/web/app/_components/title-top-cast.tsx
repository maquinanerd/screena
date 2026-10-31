import type { ReactNode } from "react";

/**
 * TitleTopCast — a coluna "Elenco e Equipe" da barra superior das fichas de
 * filme e série (canônico de 2026-10-30): até três pessoas em avatar circular
 * de 62px, nome 12/600 e papel 11px, e "Ver elenco e equipe completos" levando
 * à faixa de elenco da própria página.
 *
 * PRESENTACIONAL e PURO: a página escolhe QUEM entra (elenco já gateado pelo
 * presenter; direção da ficha técnica). Pessoa sem página vira texto, nunca link
 * morto; sem foto, as INICIAIS no círculo — não um círculo cinza vazio.
 */

export interface TitleTopPerson {
  readonly name: string;
  /** "como Daniel", "Direção" — `null` omite a linha. */
  readonly role: string | null;
  readonly href: string | null;
  readonly profile: { readonly src: string } | null;
}

interface TitleTopCastProps {
  readonly people: readonly TitleTopPerson[];
  /** Âncora da faixa de elenco completa; `null` omite o link. */
  readonly seeAllHref: string | null;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join("");
}

function PersonBody({ person }: { person: TitleTopPerson }): ReactNode {
  return (
    <>
      <span className="title-top__avatar">
        {person.profile !== null ? (
          <img alt="" loading="lazy" src={person.profile.src} />
        ) : (
          <span aria-hidden="true">{initials(person.name)}</span>
        )}
      </span>
      <span className="title-top__person-name">{person.name}</span>
      {person.role !== null ? (
        <span className="title-top__person-role">{person.role}</span>
      ) : null}
    </>
  );
}

export function TitleTopCast({ people, seeAllHref }: TitleTopCastProps): ReactNode {
  if (people.length === 0) return null;
  return (
    <div className="title-top__cast">
      <p className="title-top__cast-label">Elenco e Equipe</p>
      <ul className="title-top__people">
        {people.map((person, index) => (
          <li key={`${person.name}-${index}`}>
            {person.href !== null ? (
              <a className="title-top__person" href={person.href}>
                <PersonBody person={person} />
              </a>
            ) : (
              <div className="title-top__person">
                <PersonBody person={person} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {seeAllHref !== null ? (
        <a className="title-top__see-all" href={seeAllHref}>
          Ver elenco e equipe completos
          <svg aria-hidden="true" fill="none" height="13" viewBox="0 0 24 24" width="13">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
          </svg>
        </a>
      ) : null}
    </div>
  );
}
