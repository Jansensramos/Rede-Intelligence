# 9P.4 — camadas locais de bancos, bureau e funding

## Fontes e autorização

HEAD inicial `2dd403419b63ee95b7514802b87a58300ac504c8`, CI aprovado
https://github.com/Jansensramos/Rede-Intelligence/actions/runs/34121184857.
Branch fornecida pelo usuário: `codex/fase-9p4-local`. Sem commit/push pelo agente.

Escopo derivado do Relatório Mestre `REDE_Intelligence_Relatorio_Mestre_2026_ATUALIZADO_2026-09-05.pdf`,
Apêndice D, páginas 14–17, especialmente D.2/D.3/D.4, e dos checkpoints da campanha.
Os contratos já existentes BankingAdapter, CreditBureauProvider e FundingProviderAdapter
delimitam as capacidades; não se reabrem os fluxos oficiais de 9B, 9K e 9N.

## Implementação local

- Instalações por tenant, capacidade BANK/BUREAU/FUNDING, inicialmente DISABLED.
- MOCK determinístico, transporte injetável interno sem implementação HTTP; REAL bloqueado
  antes de credenciais ou transporte. Não se escolhe banco, agregador ou bureau contratado.
- Bancos: leitura paginada de extrato como evidência de simulação, cursor e deduplicação por
  evento/conta/instalação. Não criar BankTransaction oficial com dinheiro sintético e não
  conciliar automaticamente. A conciliação governada existente continua sendo a autoridade.
- Bureau: consulta pontual vinculada ao cliente e projeto da instalação, finalidade e base
  legal obrigatórias informadas pelo responsável, resultado mínimo cifrado e imutável.
  MOCK não lê CPF/CNPJ; não modifica política de crédito, venda ou CreditBureauConsultation
  oficial. O relatório local é explicitamente sintético.
- Funding: preparar submissão local a partir da proposta oficial e consultar estado com
  referência local proveniente da submissão. O dossiê existente assembleFundingDossier é
  congelado/cifrado no enqueue e não recalculado no retry. Nenhuma resposta altera proposta, dívida,
  obrigação ou desembolso. CREDIT+RECONCILED permanece requisito do fluxo oficial de realizado.
- Fila única IntegrationJob, fencing por lease e tentativa, idempotência do pedido e evidência,
  rate limit persistido, retry limitado/backoff, dead-letter e retry manual auditado.
- Evidências cifradas em tabela aditiva, imutáveis durante a retenção; exclusão somente depois
  do vencimento, auditada. Leitura expirada falha fechada. Retenção configurada explicitamente
  entre 1 e 180 dias é limite técnico local, não parecer jurídico ou política produtiva.
- Sem webhook de fornecedor fictício. Qualquer futuro webhook deverá passar pelo Inbox único
  e autenticação do adapter; nenhuma rota externa é habilitada nesta entrega.

## Gates

Backup real validado por restauração antes da migration; schema existente e migrations
antigas preservados. Prisma, banco efêmero/seed, tipos, lint, testes focais, suíte completa,
build e diff check. Auditoria adversarial local após implementação; resultados separados do QA.

## Uso das camadas locais

As actions em `src/app/actions/financial-provider.ts` criam/configuram a instalação,
enfileiram uma operação e consultam estados. O worker processa FINANCIAL_PROVIDER. A listagem
auditada de evidências retorna IDs e metadados sem conteúdo cifrado; o ID de FUNDING_SUBMIT
é usado para pedir FUNDING_STATUS. Leitura de relatório tem RBAC próprio e audit trail.
Expurgo e retry manual também passam pelo servidor. Não é necessário inspecionar o banco
para obter uma referência de submissão. Nenhuma credencial ou transporte é aceito pelas actions.

## Pendências da campanha final REAL

Fornecedor, contrato, finalidade/base legal efetivas, retenção operacional, credentials,
transporte/assinatura/webhooks específicos, quotas, reconciliação de resultado ambíguo,
smokes, observabilidade e rollback por tenant permanecem pendentes. Não há evidência externa.
As camadas MOCK não são operação bancária, consulta de crédito real ou captação de recursos.
