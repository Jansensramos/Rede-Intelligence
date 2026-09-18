import type { Metadata } from "next";
import { UserFacingTextSanitizer } from "@/components/user-facing-text-sanitizer";
import "./globals.css";
import "./professional-overrides.css";
import "./presentation-polish.css";

export const metadata: Metadata = {
  title: "REDE Intelligence",
  description: "Inteligência para decisões imobiliárias.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <UserFacingTextSanitizer />
      </body>
    </html>
  );
}
