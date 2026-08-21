# Fase 9D — Jurídico, diligência imobiliária e obrigações

## Objetivo

A Fase 9D acrescenta uma camada jurídica multiempresa ao REDE Intelligence sem substituir Terrenos, Suprimentos, Financeiro, Cronograma, Riscos ou Sala de Documentos. O módulo organiza evidências, achados, condições, decisões e prazos; não emite parecer jurídico automático nem consulta fontes externas sem integração oficial.

## Arquitetura

- `LandAsset` continua sendo o cadastro canônico do imóvel.
- `OperationalContract` com tipo `ACQUISITION` continua sendo o contrato econômico canônico da aquisição.
- `ScheduleActivity` continua sendo a fonte do cronograma; marcos jurídicos apenas registram vínculo e impacto.
- `FinancialObligation` e `PayableAccount` continuam sendo as fontes financeiras. `LegalFinancialEvent` é somente o recibo idempotente da integração.
- `ProcurementDocumentLink` é reutilizado como armazenamento documental versionado e privado; a camada jurídica guarda somente o vínculo da evidência.
- todos os agregados de primeiro nível possuem `organizationId` e `projectId`; consultas e comandos validam o tenant no servidor.

## Modelo persistido

| Grupo | Models principais |
|---|---|
| Imóvel | `LegalAssetRegistration`, `MunicipalPropertyRecord` |
| Diligência | `LegalDueDiligenceCase`, `LegalPartyLink`, `LegalChecklistItem`, `LegalDocumentRequest`, `LegalFinding`, `LegalDecision` |
| Obrigações | `LegalObligation`, `LegalDeadlinePolicy`, `LegalAlert` |
| Licenciamento | `LegalLicense`, `LegalLicenseCondition`, `LegalAuthorityProcess` |
| Contrato e prazo | `LegalContractCondition`, `LegalGuarantee`, `LegalTimelineEvent` |
| Financeiro | `LegalFinancialEvent` |

Registros de matrícula, cadastro municipal, documentos e decisões são versionados ou preservam snapshot imutável. Criações, decisões e integrações relevantes produzem `AuditLog`.

## Motor de prazos

O motor `LEGAL_DEADLINE_V1.0.0` calcula dias em UTC e aplica marcos configuráveis. A política demonstrativa possui D-90, D-60, D-30, D-15, D-7 e VENCIDO. A chave única `organizationId + sourceType + sourceId + milestoneCode` impede alertas duplicados. Obrigações cumpridas, dispensadas ou canceladas não são reclassificadas.

## Integração financeira

Uma obrigação jurídica com valor somente pode ser enviada se possuir empresa/SPE e favorecido. O serviço usa a porta compartilhada `createExternalPayableObligation` com origem `LEGAL`. A chave SHA-256 baseada em organização, fonte, ID e versão garante processamento exatamente uma vez. Repetições retornam o mesmo recibo. A reversão reutiliza `reverseExternalPayableObligation` e é bloqueada quando já há pagamento efetivo.

## Adaptadores municipais

`MunicipalityAdapter` expõe `getMunicipalProperty`. Barueri e o adaptador manual retornam `MANUAL_REQUIRED` quando não há API pública estruturada; nenhum dado é inventado. O registro manual exige exercício, cadastro, origem e snapshot da evidência. Novos municípios podem implementar o mesmo contrato sem alterar o domínio.

## Interface e REDE AI

A navegação inclui **Jurídico e Diligência**, com Visão Geral, Diligência, Imóvel e Matrícula, Documentos, Achados e Decisão, Obrigações, Licenças, Contratos do Terreno e Linha do Tempo. A REDE AI ganhou apenas consultas de leitura: `getLegalReadiness`, `getLegalDeadlines` e `getPropertyDueDiligence`, todas limitadas ao contexto autenticado.

## Dados demonstrativos

O seed do START BUTANTÃ cria de modo idempotente um caso de diligência, matrícula, IPTU demonstrativo com aviso de não verificação, partes, checklist, documentos, achado crítico, decisão com condições, contrato de aquisição, condição precedente, garantia, obrigação registral, licença, processo e marco de cronograma. O seed pode ser executado repetidamente sem duplicar a obrigação financeira.

## Execução

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dev -- --port 3001
```

Credencial demonstrativa: `admin@rede.local` / `Rede@2026`.

## Limites conscientes

- consultas automáticas a cartórios, prefeituras e órgãos ambientais dependem de futuros adaptadores e credenciais oficiais;
- assinatura eletrônica, protocolo oficial e emissão de certidões não fazem parte da 9D;
- a análise apresentada é apoio à governança e não substitui validação por profissional habilitado;
- o vínculo documental usa o storage interno existente; não foi criado um segundo repositório de arquivos.
