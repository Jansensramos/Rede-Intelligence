import type { Metadata } from "next";
import "./globals.css";
import "./professional-overrides.css";
import "./presentation-polish.css";
import "./cognitive-product.css";
import "./product-theme.css";

export const metadata: Metadata = {
  title: "REDE Intelligence",
  description: "Inteligência para decisões imobiliárias.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
      </body>
    </html>
  );
}
