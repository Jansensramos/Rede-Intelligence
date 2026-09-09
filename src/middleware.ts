import { NextResponse, type NextRequest } from "next/server";
import { resolveCorrelationId } from "@/infrastructure/observability/correlation";
import { buildContentSecurityPolicy } from "@/infrastructure/security/content-security-policy";
import { INTERNAL_CLIENT_ADDRESS_HEADER, parseTrustedProxyHops, resolveTrustedClientAddress } from "@/infrastructure/http/trusted-proxy";
import { INTERNAL_REQUEST_PATH_HEADER } from "@/domain/auth/read-capabilities";
import { productionTrafficBlocked } from "@/domain/release/local-readiness";

export function middleware(request: NextRequest) {
  const correlationId = resolveCorrelationId(null);
  const production = process.env.NODE_ENV === "production";
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildContentSecurityPolicy(nonce, production);
  if (productionTrafficBlocked(process.env) && request.nextUrl.pathname !== "/api/health/live") {
    return NextResponse.json({ error: "Liberação de produção pendente de validação operacional.", correlationId }, { status: 503, headers: { "x-correlation-id": correlationId, "Content-Security-Policy": csp, "cache-control": "no-store" } });
  }
  let trustedProxyHops: number;
  try {
    trustedProxyHops = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
  } catch {
    if (production && request.nextUrl.pathname !== "/api/health/live") {
      return NextResponse.json(
        { error: "Configuração de infraestrutura inválida.", correlationId },
        { status: 503, headers: { "x-correlation-id": correlationId } },
      );
    }
    trustedProxyHops = 0;
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-correlation-id", correlationId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set(INTERNAL_CLIENT_ADDRESS_HEADER, resolveTrustedClientAddress(request.headers, trustedProxyHops));
  requestHeaders.set(INTERNAL_REQUEST_PATH_HEADER, request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
