import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  icons: {
    icon: { url: "/brand/cinerie/favicon-movie.svg", type: "image/svg+xml" },
  },
};

export default function MoviesLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
