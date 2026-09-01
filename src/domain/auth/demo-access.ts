export type DemoLoginPresentation =
  | { enabled: false }
  | { enabled: true; email: string; password: string };

export function resolveDemoLoginPresentation(environment: Record<string, string | undefined>): DemoLoginPresentation {
  if (environment.NODE_ENV === "production" || environment.ENABLE_DEMO_LOGIN !== "true") return { enabled: false };
  const email = environment.DEMO_LOGIN_EMAIL?.trim();
  const password = environment.DEMO_LOGIN_PASSWORD;
  if (!email || !password) return { enabled: false };
  return { enabled: true, email, password };
}

export function assertDemoSeedAllowed(environment: Record<string, string | undefined>) {
  if (environment.NODE_ENV === "production") {
    throw new Error("Execução recusada: o seed demonstrativo é proibido em produção.");
  }
}
