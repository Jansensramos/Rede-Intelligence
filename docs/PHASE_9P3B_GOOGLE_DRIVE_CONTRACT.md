# 9P.3B — Google Drive: contrato de implementação

Preparado em 2026-09-06. Implementação local disponível no worktree para QA e auditoria
adversarial. O usuário autorizou adiar Clicksign para o fim da campanha.
Este documento não comprova conexão com uma conta Google nem substitui os gates da fase.

## Base e escopo

Derivado de `PHASE_9H_INTEGRATIONS_CONNECTORS_PLAN.md`, seção 18, e da sequência aprovada
na tarefa “2 Desenvolvimento REDE Intelligence”: assinatura, Google Drive, e-mail transacional.

A primeira entrega real deve consultar metadados, referenciar arquivos e preservar suas
versões dentro da instalação, organização e projeto autorizados. A sincronização começa
somente por leitura. Cópia de conteúdo, exportação e alteração de permissões exigem fluxos
específicos posteriores; uma referência não equivale a custódia de documento.

OAuth usa o menor escopo compatível com os arquivos escolhidos e credenciais no cofre.
Configuração identifica explicitamente o Drive/pasta autorizado. A aplicação resolve o
provider no servidor e não aceita um provider enviado pela action/API. Instalação pausada,
credencial ausente/expirada ou organização divergente bloqueiam a operação antes da consulta.

## Achados na fundação existente

Revisão somente leitura de `src/application/integrations/integrations-service.ts`, função
`runConnectorSync`, e `src/domain/integrations/mock-drive-connector.ts`:

1. A execução atual processa uma página e não trata `hasMore` como continuidade pendente.
2. O cursor avança mesmo quando a aplicação de um item falha. Isso pode perder alterações
   em um conector incremental real.
3. O upsert de `ConnectorDocumentReference` substitui metadados da versão anterior.
   O vínculo atual precisa ser distinguido do registro histórico preservado.
4. Erros genéricos do transporte são gravados por mensagem. O adaptador real precisa
   fornecer erros sanitizados com classificação e correlação, sem tokens ou corpos brutos.

Esses achados são requisitos de implementação da 9P.3B, não correções já executadas.

## Sincronização e persistência

- Capturar o token inicial de mudanças antes da varredura, evitando perder modificações
  ocorridas durante a listagem inicial. Tratar paginação de arquivos e de mudanças separadamente.
- Distinguir o cursor da varredura do token incremental, vinculado à instalação e ao escopo.
  Configuração alterada não pode reutilizar silenciosamente o cursor do escopo anterior.
- Só confirmar uma página após a aplicação durável de todos os seus itens. Falha mantém
  o último cursor confirmado; replay deve ser idempotente e não avançar o cursor oficial.
- Preservar revisões anteriores e registrar remoção/perda de acesso sem apagar evidência
  histórica. Ausência de checksum de conteúdo não pode ser substituída por um hash de
  metadados apresentado como se fosse checksum do arquivo.
- Usar timeout, limite de resposta, URLs de API fixas e recusa de redirecionamento com
  credencial. Links de visualização devem ser validados e não publicados como links públicos.
- Aplicar limite de uso e circuito no provider composto; classificar autenticação,
  permissão, rate limit, indisponibilidade e resposta inválida sem repetir operações sem limite.
- Webhook, se incluído, apenas sinaliza a consulta autenticada de mudanças; não constitui
  prova dos metadados recebidos nem autoriza acesso ao tenant indicado pelo corpo.

Qualquer migration necessária será aditiva, revisada separadamente e aplicada a um banco
existente somente depois de backup real restaurado e validado. Ainda não há migration desta fase.

## QA e auditoria exigidos

| Cenário | Critério de aceite |
| --- | --- |
| Composição real do serviço | Cofre e instalação resolvidos; métodos necessários presentes; transporte controlado |
| Tenant/RBAC | IDs alheios e papéis insuficientes recusados antes de I/O externo |
| Paginação inicial e incremental | Todas as páginas aplicadas; término e continuidade distinguidos |
| Falha no meio de página | Cursor anterior preservado; retomada sem perda ou duplicação |
| Concorrência e replay | Duas execuções não retrocedem cursor nem duplicam versões |
| Mudança durante a varredura | Reconciliada pelo token capturado antes da primeira página |
| Revisão, remoção e perda de acesso | História preservada; referência atual não declara disponibilidade inexistente |
| URL, credencial e erros | Sem redirecionamento autenticado, vazamento em logs ou consulta a host arbitrário |
| Banco novo e existente | Deploy/seed e migrations verificados nos ambientes apropriados |
| Gate técnico | Testes focais/completos, tipos, lint, build e auditoria local; nesta entrega commit/push não autorizados pelo usuário |
| Gate REAL | OAuth e pasta do piloto; execução autorizada; resultado sanitizado real |

O gate REAL depende de conta, OAuth e escopo do piloto ainda não validados nesta campanha.
Não será inferido a partir de mocks ou da disponibilidade do conector Google Drive do Codex.

## Fontes consultadas

Documentação oficial consultada em 2026-09-06:

- [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- [changes.getStartPageToken](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/getStartPageToken)
- [changes.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)

As decisões de transação, versionamento e isolamento acima são requisitos do REDE derivados
do seu contrato, não garantias fornecidas pela API Google.

## Implementação local 9P.3B

- Adaptador `src/infrastructure/adapters/drive/google-drive.ts`: somente GET em endpoint
  fixo, transporte injetável, limite de 2 MiB, timeout de 15 segundos, redirecionamento recusado.
  Meu Drive exige pasta explícita (`driveId=MY_DRIVE`); Drive compartilhado admite pasta
  opcional. A pasta abrange filhos diretos, sem recursão implícita.
- Serviço `src/application/integrations/google-drive-service.ts`: tenant e associação ativa
  conferidos no servidor; credencial resolvida no cofre e revalidada antes das consultas.
  O cursor inclui escopo e identidade da credencial; trocas iniciam nova varredura.
- DISABLED bloqueia execução; MOCK executa simulação vazia explícita, sem rede ou versões
  fictícias; REAL consulta o adaptador. Nenhuma action recebe provider ou token.
- Cada página aplica versões, referência atual, auditoria e cursor em uma transação.
  Lease persistido de 90 segundos e lock da instalação impedem duas execuções concorrentes;
  interrupção preserva páginas já confirmadas. Worker propaga cancelamento e erros seguros.
- A marca de varredura sobrevive a falha entre páginas. Referências ausentes só são retiradas
  após listagem e mudanças concluídas, inclusive quando a retomada é incremental.
- REPLAY consulta e audita sem alterar referências, versões ou cursor oficial. FULL inicia
  nova varredura. Cada execução tem orçamento de 100 páginas; excesso falha com retry limitado.
- `DriveDocumentVersion` é histórico append-only; UPDATE, DELETE e TRUNCATE são recusados.
  `revisionKey` é hash de metadados, identificado separadamente do MD5 opcional fornecido para
  o conteúdo. Ausência de checksum permanece nula. Remoções e ausências observadas têm chaves
  derivadas `removed:`/`rescan:`, não são apresentadas como revisão ou checksum emitidos pelo Google.
- Interface na Central de Integrações permite criar conexão desativada, carregar/salvar
  escopo e modo e enfileirar sync. Nenhum campo de credencial foi acrescentado.
- O conector mock anterior permanece intacto. Worker e interface recebem apenas rotas
  adicionais para `GOOGLE_DRIVE_V3`; a lógica de fases encerradas não foi substituída.

Migration aditiva: `20260906120000_phase_9p3b_drive_versions`. Backup, QA efetivamente
executado e limitações constam em `PHASE_9P3B_AUDIT_RECORD.md`.
