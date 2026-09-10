# Fase 9Q.2B — Checklist LGPD (preparação, não aprovação)

Este documento organiza os pontos que exigem validação humana/jurídica antes do piloto.
**Nenhum item aqui está aprovado.** Nenhuma pessoa com responsabilidade jurídica ou de
encarregado (DPO) revisou este documento nesta sessão — um agente de engenharia não pode
declarar conformidade LGPD.

## Inventário de dados pessoais (o que o sistema já modela, para revisão)

| Categoria de dado | Onde aparece no domínio | Observação |
|---|---|---|
| Identificação (nome, e-mail, telefone) | Usuários, contatos comerciais, fornecedores | Redigido em log por `logger.ts` |
| CPF | Pessoas físicas em contratos/fornecedores | Redigido em log por padrão de valor |
| CNPJ | Organizações/fornecedores/ERP | Redigido em log por padrão de valor e por nome de campo (`tax.*id`) |
| Dados financeiros | Financeiro, funding, bureau (mock) | Cifrado em repouso via KMS quando aplicável (`enterprise-evidence-cipher.ts`, `financial-evidence-cipher.ts`) |
| Documentos de sala de dados | `ProjectDocument` (15 categorias, incluindo jurídico/societário) | Storage privado, checksum, agora com validação de MIME/assinatura (esta fase) |
| Evidência de assinatura eletrônica | Clicksign (quando conectado) | URL de evidência nunca fixa; sempre pré-assinada e com TTL |

Este inventário é um ponto de partida técnico, não um relatório de impacto (RIPD/DPIA) —
esse é um artefato jurídico a produzir por quem tem essa responsabilidade.

## Pontos que exigem decisão humana antes do piloto

- [ ] **Finalidade e base legal** de cada categoria de dado pessoal tratada — a confirmar
      pelo responsável de LGPD/jurídico, não inferível do código.
- [ ] **Retenção**: por quanto tempo cada categoria é mantida após o fim do contrato/uso;
      hoje não há mecanismo automático de expurgo no código.
- [ ] **Operadores e suboperadores**: cada integração externa (Clicksign, Google Drive,
      e-mail quando escolhido, bureau quando escolhido, ERP/CRM) é um operador de dados
      pessoais do titular — exige contrato/cláusula de operador antes de dados reais
      trafegarem por ela.
- [ ] **Atendimento ao titular** (acesso, correção, exclusão, portabilidade): não há
      fluxo de atendimento a titular implementado no código desta sessão; a existir, é
      decisão de produto + jurídico.
- [ ] **Incidente de segurança**: procedimento técnico de contenção existe
      (`docs/PHASE_9Q2B_OBSERVABILITY_INCIDENTS.md`), mas o **plano de comunicação legal**
      ao titular/ANPD é responsabilidade jurídica, não coberta aqui.
- [ ] **Descarte seguro**: política de storage (lifecycle/retenção) depende de decisão
      jurídica ainda pendente (`docs/PHASE_9Q2B_STORAGE_SECURITY.md`).
- [ ] **Responsabilidades contratuais**: contrato com o cliente-piloto precisa refletir
      papel de operador/controlador do REDE, sem envolvimento desta fase técnica.

## Regra que este documento segue

Nenhuma revisão LGPD é declarada aprovada por este agente. A linha correspondente na
matriz Go/No-Go (`docs/PHASE_9Q2B_GO_NO_GO_MATRIX.md`) permanece `BLOQUEADO — pendente de
responsável humano` até que uma pessoa designada assine.
