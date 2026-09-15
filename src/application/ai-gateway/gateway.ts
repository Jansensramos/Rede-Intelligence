import { checkAndConsumeRateLimit, checkCircuitBreakerGate, recordCircuitBreakerOutcome } from "@/application/integrations/resilience-service";
import {
  AiGatewayError,
  classifyTransportFailureAsGatewayError,
  evaluateSafety,
  isSafeCanonicalRef,
  isSafeUsageUnits,
  isSafeCostUsdMicros,
  requiresHumanApproval,
  selectRoute,
  validateEnvelope,
  type AiGateway,
  type AiProviderAdapter,
  type AiRequest,
  type AiResponse,
  type AiRoutingPolicy,
  type AiSafetyPolicy,
} from "@/domain/ai-gateway";
import { AI_PRICE_CATALOG_VERSION_SYNTHETIC, SYNTHETIC_PRICE_TABLE } from "@/infrastructure/ai-gateway/model-catalog";
import { assertBundleScope, ContextEngineError, renderContextBundleForTransport } from "@/domain/context-engine";
import { AI_GATEWAY_PROMPT_VERSION, confirmGatewayExecution, markGatewayExecutionTransportStarted, releaseGatewayExecution, reserveGatewayExecution, type GatewayLedgerContext } from "./ledger-service";

/**
 * Implementacao do AiGateway (docs Fase 10A). Unico caminho autorizado para executar uma
 * chamada de IA: envelope -> seguranca -> roteamento -> aprovacao humana (bloqueio, nunca
 * decidida sozinha) -> limite de custo do request -> rate limit + circuit breaker
 * (reaproveitados de domain/integrations, persistidos por organizationId+scopeKey) ->
 * reserva de orcamento/idempotencia (Serializable) -> promocao para RUNNING -> UMA UNICA
 * chamada ao adapter -> confirmacao/liberacao da reserva -> resposta versionada.
 *
 * Correcao critica DEFINITIVA pos-reauditoria (achado CRITICO "liberacao automatica de
 * execucao potencialmente cobravel"): a reauditoria provou ao vivo que a versao anterior
 * retentava `adapter.execute()` automaticamente (ate 1+3 tentativas) e liberava a reserva
 * (custo zerado) para QUALQUER classe de erro que nao fosse `RECONCILIATION_REQUIRED` -
 * incluindo TIMEOUT/PROVIDER_UNAVAILABLE/UNEXPECTED, que sao ambiguos por definicao (nao
 * ha garantia de que o provider nao recebeu/processou a chamada antes do erro).
 *
 * Regra conservadora adotada agora, sem excecao por classe de erro/status HTTP/tipo de
 * excecao: ANTES de `adapter.execute` ser invocado, uma falha e comprovadamente
 * pre-transporte e pode liberar a reserva com seguranca. DEPOIS que `adapter.execute` for
 * invocado (`adapterInvoked = true`), a execucao passa a ser potencialmente cobravel -
 * nenhum erro, de nenhuma classe, aciona liberacao automatica ou uma segunda chamada ao
 * adapter. A reserva permanece `RUNNING` (ou, se a confirmacao chegou a rodar mas o custo
 * observado excedeu o orcamento, o estado equivalente `RECONCILIATION_REQUIRED`) -
 * continua contabilizada contra o orcamento ate reconciliacao manual. Isso vale mesmo para
 * AUTHENTICATION/AUTHORIZATION/RATE_LIMIT/INVALID_RESPONSE/PROVIDER_USAGE_INVALID/
 * PROVIDER_IDENTITY_MISMATCH - sem contrato real de nenhum provedor comercial (nenhum esta
 * habilitado nesta fase) e sem prova de idempotencia do lado externo, nenhuma classe de
 * erro pos-invocacao e segura de tratar como "nao cobrou".
 */

export const AI_GATEWAY_POLICY_VERSION = "AI_GATEWAY_POLICY_V1.0.0";

const RATE_LIMIT_POLICY = { limit: 20, windowMs: 60_000 };
const CIRCUIT_BREAKER_POLICY = { failureThreshold: 5, cooldownMs: 30_000 };

function estimateInputUnits(request: AiRequest): number {
  const text = `${request.content.systemInstructions}${request.content.trustedContext}${request.content.untrustedUserContent ?? ""}`;
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface AiGatewayDependencies {
  adapter: AiProviderAdapter;
  routingPolicy: AiRoutingPolicy;
  ledger: GatewayLedgerContext;
  safetyPolicy?: AiSafetyPolicy;
  requireContextBundle?: true;
}

export function createAiGateway(deps: AiGatewayDependencies): AiGateway {
  const catalog = new Map([[deps.adapter.ref, deps.adapter.profile]]);
  return {
    async execute(request: AiRequest): Promise<AiResponse> {
      let providerRequest = request;
      if (request.contextBundle) {
        try {
          if (request.organizationId !== deps.ledger.organizationId || request.actorRef !== deps.ledger.userId) throw new Error("ledger scope mismatch");
          const bundle = assertBundleScope(request.contextBundle, {
            organizationId: request.organizationId, projectId: request.projectId,
            userId: deps.ledger.userId, conversationId: deps.ledger.conversationId,
            correlationId: request.correlationId, idempotencyKey: request.idempotencyKey,
          });
          if (bundle.classification !== request.dataClassification) throw new Error("classification mismatch");
          const withoutInternalBundle = { ...request };
          delete withoutInternalBundle.contextBundle;
          providerRequest = { ...withoutInternalBundle, content: { ...request.content, trustedContext: renderContextBundleForTransport(bundle) } };
        } catch {
          throw new AiGatewayError("ContextBundle inválido, vencido ou fora do escopo.", "POLICY_BLOCKED", false, request.correlationId);
        }
      } else if (deps.requireContextBundle) {
        throw new AiGatewayError("ContextBundle obrigatório para esta chamada.", "POLICY_BLOCKED", false, request.correlationId);
      }
      const envelopeIssue = validateEnvelope(providerRequest.content);
      if (envelopeIssue) throw new AiGatewayError(`Envelope de prompt invalido (${envelopeIssue}).`, "CONFIGURATION", false, request.correlationId);

      const safety = evaluateSafety(request.dataClassification, providerRequest.content, deps.safetyPolicy);
      if (!safety.allowed) throw new AiGatewayError(`Bloqueado por politica de seguranca (${safety.reason}).`, "SAFETY_BLOCKED", false, request.correlationId);

      if (requiresHumanApproval(deps.routingPolicy, request)) {
        throw new AiGatewayError("Esta chamada exige aprovacao humana antes de prosseguir; nenhuma decisao autonoma e tomada.", "POLICY_BLOCKED", false, request.correlationId);
      }

      const routed = selectRoute(deps.routingPolicy, request, catalog);
      if (!routed) throw new AiGatewayError("Nenhum provider de IA disponivel para esta requisicao.", "PROVIDER_UNAVAILABLE", false, request.correlationId);

      // Decisao 7: retencao/residencia/DPA ausentes bloqueiam produção. O provider "disabled"
      // nunca chega aqui (profile.capabilities=[] o exclui em selectRoute); qualquer provider
      // real futuro so e roteavel com retenção zero explicitamente confirmada.
      if (routed.candidate.profile.retentionPolicy !== "ZERO_RETENTION_CONFIRMED") {
        throw new AiGatewayError("Provider sem confirmacao de retencao zero; bloqueado por politica.", "RETENTION_UNCONFIRMED", false, request.correlationId);
      }

      const price = SYNTHETIC_PRICE_TABLE[routed.candidate.providerRef];
      const priceVersion = price && (price.inputUsdMicrosPerMillion > 0 || price.outputUsdMicrosPerMillion > 0) ? AI_PRICE_CATALOG_VERSION_SYNTHETIC : null;
      const estimatedInputUnits = estimateInputUnits(providerRequest);
      const estimatedCostUsdMicros = price ? Math.round((estimatedInputUnits * price.inputUsdMicrosPerMillion) / 1_000_000) : 0;
      if (request.maxCostUsdMicros != null && estimatedCostUsdMicros > request.maxCostUsdMicros) {
        throw new AiGatewayError("Custo estimado excede o limite maximo informado pelo chamador.", "BUDGET_EXCEEDED", false, request.correlationId);
      }

      const scopeKey = `ai-gateway:${routed.candidate.providerRef}`;
      const rateLimitDecision = await checkAndConsumeRateLimit(request.organizationId, scopeKey, RATE_LIMIT_POLICY);
      if (!rateLimitDecision.allowed) throw new AiGatewayError("Limite de requisicoes ao provider de IA atingido.", "RATE_LIMIT", true, request.correlationId);
      const circuitDecision = await checkCircuitBreakerGate(request.organizationId, scopeKey, CIRCUIT_BREAKER_POLICY);
      if (!circuitDecision.allow) throw new AiGatewayError("Circuito do provider de IA aberto; tente novamente apos o cooldown.", "PROVIDER_UNAVAILABLE", true, request.correlationId);

      // Correcao focal pos-auditoria (achado ALTO "provider/model nao confiaveis no
      // ledger"): providerRef/modelRef sao decididos AQUI, pelo roteamento do servidor,
      // ANTES de qualquer chamada ao adapter - nunca depois, nunca a partir da resposta.
      // Ambos passam pelo formato fechado (isSafeCanonicalRef) antes de entrar no ledger.
      const providerRef = routed.candidate.providerRef;
      const modelRef = routed.candidate.profile.modelRef;
      if (!isSafeCanonicalRef(providerRef) || !isSafeCanonicalRef(modelRef)) {
        throw new AiGatewayError("Referencia de provider/model fora do formato canonico seguro.", "CONFIGURATION", false, request.correlationId);
      }
      const reservation = await reserveGatewayExecution(deps.ledger, request, estimatedCostUsdMicros, priceVersion, providerRef, modelRef);
      if (reservation.kind === "IDEMPOTENT_REPLAY") {
        if (reservation.status === "EXECUTING") throw new AiGatewayError("Uma execucao com a mesma idempotencyKey ja esta em andamento.", "PROVIDER_UNAVAILABLE", true, request.correlationId);
        // COMPLETED/FAILED: o Gateway nunca persiste conteudo de resposta (decisao 10), entao
        // um replay idempotente garante "nao cobra/nao executa de novo", nunca "reproduz o
        // conteudo original byte a byte" - o chamador precisa de uma nova idempotencyKey para
        // gerar uma nova resposta.
        throw new AiGatewayError("Esta chamada (idempotencyKey) ja foi concluida anteriormente; o conteudo original nao e persistido nem reexposto.", "POLICY_BLOCKED", false, request.correlationId);
      }

      // Correcao critica DEFINITIVA pos-reauditoria: marcador de controle interno, nunca
      // vindo do cliente - a unica coisa que decide, de forma deterministica (nunca por
      // classe de erro/status HTTP/tipo de excecao), se uma falha e segura de liberar
      // automaticamente: uma vez `true`, NADA no bloco catch abaixo libera a reserva ou
      // chama o adapter de novo. As outras 3 fases do ciclo de vida de uma tentativa
      // (`transportPromoted`: `transportStart.transitioned === true`, logo abaixo;
      // `providerResponseReceived`: `deps.adapter.execute` retornou, na linha seguinte a
      // `adapterInvoked = true`; `confirmationPersisted`: `confirmGatewayExecution`
      // retornou com sucesso, no fim do bloco `try`) sao identificaveis pela propria
      // posicao do codigo - nenhuma delas precisa de uma variavel separada porque nenhuma
      // delas, sozinha, muda a decisao de liberar: uma vez `adapterInvoked = true`, TUDO
      // que acontece depois (resposta invalida, identidade hostil, uso hostil, falha na
      // confirmacao) e tratado identicamente - nunca libera, nunca rechama o adapter.
      let adapterInvoked = false;
      const controller = new AbortController();
      const timeoutMs = request.maxLatencyMs ?? 45_000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Ordem obrigatoria: so promove QUEUED->RUNNING de forma ATOMICA E VERIFICADA
        // (AIExecutionLog + AIPendingAction na mesma transacao) e so chama o adapter se
        // `transitioned === true` (`transportPromoted`). Se o reaper venceu a corrida (CAS
        // perdido), o adapter NUNCA e chamado - nenhuma excecao a esta regra. Isto
        // acontece com `adapterInvoked` ainda `false`, entao uma falha aqui e sempre
        // pre-transporte.
        const transportStart = await markGatewayExecutionTransportStarted(
          reservation.executionLogId,
          reservation.pendingActionId,
          request.contextBundle ? { ledger: deps.ledger, request } : undefined,
        );
        if (!transportStart.transitioned) {
          throw new AiGatewayError("Reserva nao pode ser promovida para execucao (ja finalizada por expiracao ou outro caminho concorrente).", "RESERVATION_EXPIRED", false, request.correlationId);
        }

        // Correcao critica DEFINITIVA: marca `adapterInvoked = true` IMEDIATAMENTE ANTES
        // da unica chamada real ao adapter - a partir daqui, TODO erro (sincrono ou
        // assincrono, lancado pelo adapter ou pela validacao da resposta) e tratado como
        // pos-invocacao: nunca libera a reserva, nunca chama o adapter de novo.
        adapterInvoked = true;
        const response = await deps.adapter.execute(providerRequest, controller.signal); // retorno = providerResponseReceived

        // Correcao focal pos-auditoria: a identidade que o adapter "observa" na propria
        // resposta e comparada contra a rota esperada, mas NUNCA e persistida - so serve
        // para detectar um adapter mentiroso/hostil. Divergencia ou formato inseguro
        // falha fechado como PROVIDER_IDENTITY_MISMATCH - permanente, sem gravar a
        // identidade hostil, mas (pos-invocacao) tambem sem liberar a reserva: o adapter
        // respondeu, entao a chamada e potencialmente cobravel mesmo com identidade errada.
        const observedProvider = response.routing.provider;
        const observedModel = response.routing.model;
        if (!isSafeCanonicalRef(observedProvider) || !isSafeCanonicalRef(observedModel) || observedProvider !== providerRef || observedModel !== modelRef) {
          throw new AiGatewayError("Identidade de provider/model observada na resposta diverge da rota esperada.", "PROVIDER_IDENTITY_MISMATCH", false, request.correlationId);
        }
        // Uso reportado pelo adapter e validado antes de contar sucesso no circuit breaker
        // e antes de `confirmGatewayExecution` (que tambem valida de novo, internamente,
        // como defesa em profundidade - nunca confia no chamador). Formato hostil aqui e
        // igualmente pos-invocacao: nunca libera a reserva.
        const observedCostUsdMicros = response.usage.observedCostUsdMicros ?? response.usage.estimatedCostUsdMicros;
        if (!isSafeUsageUnits(response.usage.inputUnits) || !isSafeUsageUnits(response.usage.outputUnits) || !isSafeCostUsdMicros(observedCostUsdMicros)) {
          throw new AiGatewayError("Uso (unidades/custo) reportado pelo adapter fora do formato seguro.", "PROVIDER_USAGE_INVALID", false, request.correlationId);
        }
        await recordCircuitBreakerOutcome(request.organizationId, scopeKey, true, CIRCUIT_BREAKER_POLICY);
        // Se a confirmacao falhar por qualquer motivo (CAS perdido, custo observado acima
        // do orcamento restante, erro transitorio do Prisma), o erro sobe para o catch
        // abaixo - `adapterInvoked` ja e true, entao nunca libera a reserva nem rechama o
        // adapter. A linha permanece RUNNING (ou, no caso de excedente de orcamento,
        // `RECONCILIATION_REQUIRED` - ja deixada RUNNING por `confirmGatewayExecution`).
        await confirmGatewayExecution(reservation.executionLogId, reservation.pendingActionId, { inputUnits: response.usage.inputUnits, outputUnits: response.usage.outputUnits, observedCostUsdMicros, latencyMs: response.usage.latencyMs }, request.correlationId);
        return { ...response, policyVersion: AI_GATEWAY_POLICY_VERSION, promptVersion: AI_GATEWAY_PROMPT_VERSION, routing: { provider: providerRef, model: modelRef, fallbackCount: response.routing.fallbackCount, retryCount: 0 } };
      } catch (error) {
        const gatewayFailure = error instanceof AiGatewayError
          ? error
          : error instanceof ContextEngineError
            ? new AiGatewayError("Contexto não pôde ser autorizado para transporte.", "POLICY_BLOCKED", false, request.correlationId)
            : classifyTransportFailureAsGatewayError(error, request.correlationId);
        // Bookkeeping de saude do circuito - nunca afeta orcamento/liberacao, so a decisao
        // de abrir/fechar o circuito para chamadas futuras a este provider.
        if (adapterInvoked) await recordCircuitBreakerOutcome(request.organizationId, scopeKey, false, CIRCUIT_BREAKER_POLICY).catch(() => undefined);
        if (!adapterInvoked) {
          // Falha comprovadamente PRE-transporte (ex.: `markGatewayExecutionTransportStarted`
          // lancou de forma inesperada, ou devolveu `transitioned:false`) - o adapter nunca
          // foi chamado. `releaseGatewayExecution` so aceita CAS a partir de QUEUED; se a
          // linha ja estiver em outro estado (ex.: o reaper a expirou antes), isto e um
          // no-op seguro (`released: false`), nunca uma ressurreicao.
          await releaseGatewayExecution(reservation.executionLogId, reservation.pendingActionId, gatewayFailure.code);
        }
        // Pos-invocacao (`adapterInvoked === true`): NUNCA libera, NUNCA rechama o adapter,
        // seja qual for a classe de erro (mesmo as classificadas como "retryable" por
        // `isRetryableAiGatewayErrorCode` - essa flag so importa para decisões de retry de
        // operacoes locais anteriores ao transporte, nunca para uma segunda chamada
        // externa). A reserva permanece RUNNING/RECONCILIATION_REQUIRED, contabilizada,
        // aguardando reconciliacao manual/futura - nunca decidida automaticamente aqui.
        throw gatewayFailure;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
