# Fase 9Q.2B — Integrações externas: status real

Nenhuma chamada de rede real foi feita a qualquer um destes fornecedores nesta sessão.
Nenhuma credencial real existe neste ambiente — `.env.example` não declara nenhuma
variável específica de fornecedor (Clicksign, Drive, e-mail, bureau, ERP/CRM); a
credencial de cada instalação é resolvida em runtime pelo cofre de integrações
(`SECRET_PROVIDER`), por instalação, não por variável de ambiente global. Sem uma
instalação real com credencial real, não há o que chamar.

## Status por integração

| Integração | Implementação | Sandbox suportado no código? | Credencial disponível nesta sessão? | Ação tomada |
|---|---|---|---|---|
| Clicksign (assinatura) | `src/infrastructure/adapters/signature/clicksign-signature-provider.ts` — cliente real | Sim: `ALLOWED_ORIGINS` inclui explicitamente `https://sandbox.clicksign.com`, com validação de host de conteúdo pré-assinado restrita ao bucket de sandbox (`SANDBOX_CONTENT_HOST`) | Não | Nenhuma chamada feita. Instalação (se existir) permanece `PAUSED`/sem credencial. |
| Google Drive | `src/infrastructure/adapters/drive/google-drive.ts` — cliente real contra `googleapis.com` | Não há "sandbox" separado na API do Drive; teste seguro depende de uma conta/pasta de teste dedicada, não de um host diferente | Não | Nenhuma chamada feita. |
| E-mail transacional | `src/application/integrations/transactional-email-service.ts` — provider explicitamente `"UNASSIGNED"`, instalação sempre criada `status: "PAUSED"`, `mode: "DISABLED"`; conteúdo simulado é cifrado localmente (`mode: "MOCK"`) | `sandboxAvailable: false` no registro do conector — nenhum sandbox real ligado | Não | Nenhum fornecedor real foi conectado; nada a chamar. Instalação permanece `PAUSED`/`DISABLED` como já vem por padrão. |
| Bancos/bureau/funding | `src/infrastructure/adapters/credit/mock-credit-bureau-provider.ts` — **mock explícito**, não cliente real | N/A (não há cliente real ainda) | N/A | Nenhuma chamada externa é sequer possível hoje; a integração de bureau é mock por decisão de implementação, não por bloqueio desta fase. |
| ERP/CRM | Adapters provider-neutros de fase anterior (9P.5) — ver `docs/REDE_CAMPAIGN_CHECKPOINTS.md` | Depende do conector concreto por instalação | Não | Nenhuma chamada feita. |

## Regra seguida nesta fase

- Nenhuma produção real foi chamada — nem sandbox, porque não há credencial de sandbox
  disponível nesta sessão.
- Nenhum documento, notificação ou operação financeira foi criado.
- Nenhuma instalação de integração foi ativada. Os dados de `prisma/seed-integrations.ts`
  usados em teste são sintéticos (empresa fictícia "Horizonte Construtora", CNPJ/e-mails
  inventados para o teste) e não representam uma instalação real ativa.
- `scripts/local/` (gitignored) é o único lugar autorizado a eventualmente receber uma
  credencial real de sandbox, via prompt interativo — nenhum script deste tipo foi criado
  para integrações nesta fase porque nenhuma credencial de sandbox foi solicitada pelo
  usuário nem está disponível.

## O que falta para testar cada integração em sandbox real (lista exata)

| Integração | Falta |
|---|---|
| Clicksign | Conta de sandbox Clicksign, token de API de sandbox, e autorização explícita do usuário para criar/consultar um envelope de teste |
| Google Drive | Projeto Google Cloud com Drive API habilitada, credencial OAuth/service account de teste, pasta de teste dedicada, autorização explícita |
| E-mail transacional | Decisão de qual fornecedor real assume o `provider: "UNASSIGNED"`, e credencial de sandbox dele |
| Bureau/crédito | Decisão sobre qual fornecedor real substituirá o mock, e credencial de sandbox dele |
| ERP/CRM | Depende do conector específico da instalação-alvo; credencial de sandbox do sistema ERP/CRM escolhido pelo piloto |

## Bloqueio

Todas as cinco integrações permanecem sem teste real nesta fase, por ausência de
credencial e por ausência de autorização explícita para contatar qualquer sandbox
externo. Nenhuma será testada até que ambas as condições existam.
