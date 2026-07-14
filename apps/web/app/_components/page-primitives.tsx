import type { ReactNode } from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export type PageVertical = "movie" | "series" | "person" | "news" | "neutral";

export interface EmptyStateAction {
  label: string;
  href: string;
}

interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  onMedia?: boolean;
}

interface PageIntroProps {
  title: string;
  description: string;
  vertical?: PageVertical;
}

interface SectionHeaderProps {
  id: string;
  title: string;
  href?: string;
  linkLabel?: string;
  vertical?: PageVertical;
  eyebrow?: string;
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: EmptyStateAction;
  headingLevel?: 2 | 3;
}

/** Trilha de navegação sem estado, própria para Server Components. */
export function Breadcrumbs({ items, onMedia = false }: BreadcrumbsProps): ReactNode {
  const className = onMedia ? "ui-breadcrumb ui-breadcrumb--on-media" : "ui-breadcrumb";

  return (
    <nav className={className} aria-label="Trilha de navegação">
      <ol className="ui-breadcrumb__list">
        {items.map((item, index) => {
          const current = item.href === undefined;
          return (
            <li
              key={`${item.href ?? "current"}-${item.label}-${index}`}
              className="ui-breadcrumb__item"
              aria-current={current ? "page" : undefined}
            >
              {item.href !== undefined ? (
                <a className="ui-breadcrumb__link" href={item.href}>
                  {item.label}
                </a>
              ) : (
                <span className="ui-breadcrumb__current">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Introdução de página com o H1 canônico e sua descrição editorial. */
export function PageIntro({ title, description, vertical }: PageIntroProps): ReactNode {
  return (
    <header className="page-intro" data-vertical={vertical}>
      <h1 className="page-intro__title">{title}</h1>
      <p className="page-intro__description">{description}</p>
    </header>
  );
}

/** Cabeçalho reutilizável para seções editoriais e coleções. */
export function SectionHeader({
  id,
  title,
  href,
  linkLabel = "Ver tudo",
  vertical,
  eyebrow,
}: SectionHeaderProps): ReactNode {
  return (
    <header className="section-heading" data-vertical={vertical}>
      <div className="section-heading__copy">
        {eyebrow !== undefined ? <span className="section-heading__eyebrow">{eyebrow}</span> : null}
        <h2 id={id} className="section-heading__title">
          {title}
        </h2>
      </div>
      {href !== undefined ? (
        <a className="section-heading__link" href={href}>
          {linkLabel}
        </a>
      ) : null}
    </header>
  );
}

/** Estado vazio honesto, com ação opcional para um destino real. */
export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
}: EmptyStateProps): ReactNode {
  return (
    <section className="empty-state">
      {headingLevel === 3 ? (
        <h3 className="empty-state__title">{title}</h3>
      ) : (
        <h2 className="empty-state__title">{title}</h2>
      )}
      <p className="empty-state__description">{description}</p>
      {action !== undefined ? (
        <a className="empty-state__action" href={action.href}>
          {action.label}
        </a>
      ) : null}
    </section>
  );
}
