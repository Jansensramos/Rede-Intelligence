import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../src/infrastructure/database/prisma";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3001";
const cookieName = process.env.SESSION_COOKIE_NAME ?? "rede_session";
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");

async function main() {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "rede-nucleo-de-negocios" } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@rede.local" } });
  const session = await prisma.session.create({ data: { tokenHash, userId: user.id, organizationId: organization.id, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  try {
    const response = await fetch(baseUrl, { headers: { cookie: `${cookieName}=${token}` }, redirect: "manual" });
    const html = await response.text();
    if (response.status !== 200) throw new Error(`Página inicial respondeu HTTP ${response.status}.`);
    for (const marker of ["START BUTANTÃ", "Pessoas e Eficiência", "Visão executiva", "REDE AI"]) {
      if (!html.includes(marker)) throw new Error(`Marcador ausente na página autenticada: ${marker}.`);
    }
    if (/Runtime TypeError|__webpack_modules__\[moduleId\] is not a function|Application error/i.test(html)) throw new Error("A página autenticada contém um erro crítico de runtime.");
    const scriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map((match) => match[1]);
    const scriptStatuses = await Promise.all(scriptPaths.map(async (path) => ({ path, status: (await fetch(new URL(path, baseUrl))).status })));
    const failedScripts = scriptStatuses.filter((item) => item.status !== 200);
    if (failedScripts.length) throw new Error(`Chunks JavaScript indisponíveis: ${JSON.stringify(failedScripts)}.`);
    console.info(JSON.stringify({ status: response.status, authenticated: true, markers: 4, scripts: scriptStatuses.length, runtimeErrorInHtml: false }));
  } finally {
    await prisma.session.deleteMany({ where: { id: session.id } });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
