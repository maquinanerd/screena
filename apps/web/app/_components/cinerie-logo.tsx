import type { ReactNode } from "react";

export type CinerieLogoVariant = "neutral" | "movie" | "series" | "people" | "news";
export type CinerieLogoTone = "dark" | "light";

interface CinerieLogoProps {
  readonly variant?: CinerieLogoVariant;
  readonly tone?: CinerieLogoTone;
  readonly className?: string;
}

const LOGO_SOURCES: Readonly<
  Record<CinerieLogoTone, Readonly<Record<CinerieLogoVariant, string>>>
> = {
  dark: {
    neutral: "/brand/cinerie/variantes/5a-logo-preta-sublinhado-preto.svg",
    movie: "/brand/cinerie/variantes/5b-logo-preta-sublinhado-cinema.svg",
    series: "/brand/cinerie/variantes/5c-logo-preta-sublinhado-serie.svg",
    people: "/brand/cinerie/variantes/5d-logo-preta-sublinhado-pessoas.svg",
    news: "/brand/cinerie/variantes/5e-logo-preta-sublinhado-noticias.svg",
  },
  light: {
    neutral: "/brand/cinerie/variantes/5f-logo-branca-sublinhado-branco.svg",
    movie: "/brand/cinerie/variantes/5g-logo-branca-sublinhado-cinema.svg",
    series: "/brand/cinerie/variantes/5h-logo-branca-sublinhado-serie.svg",
    people: "/brand/cinerie/variantes/5i-logo-branca-sublinhado-pessoas.svg",
    news: "/brand/cinerie/variantes/5j-logo-branca-sublinhado-noticias.svg",
  },
};

/**
 * Wordmark oficial da cinerie. O arquivo é um SVG local composto somente por
 * paths; a interface não precisa carregar a fonte usada no desenho do logo.
 */
export function CinerieLogo({
  variant = "neutral",
  tone = "dark",
  className,
}: CinerieLogoProps): ReactNode {
  return (
    <img
      className={className}
      src={LOGO_SOURCES[tone][variant]}
      alt="cinerie"
      width={2978}
      height={922}
    />
  );
}
