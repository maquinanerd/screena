import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  icons: {
    icon: { url: "/brand/cinerie/favicon-series.svg", type: "image/svg+xml" },
  },
};

export default function SeriesLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
