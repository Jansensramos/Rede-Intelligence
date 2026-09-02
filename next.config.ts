import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const createNextConfig = (phase: string): NextConfig => ({
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    const values = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ];
    return [{ source: "/(.*)", headers: values }];
  },
  experimental: {
    serverActions: { bodySizeLimit: "250mb" },
  },
  // Dev e produção não podem compartilhar artefatos: executar `next build`
  // com o servidor local ativo corrompe o registro de módulos do Webpack/RSC.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
});

export default createNextConfig;
