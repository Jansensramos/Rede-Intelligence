import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const createNextConfig = (phase: string): NextConfig => ({
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: "250mb" },
  },
  // Dev e produção não podem compartilhar artefatos: executar `next build`
  // com o servidor local ativo corrompe o registro de módulos do Webpack/RSC.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
});

export default createNextConfig;
