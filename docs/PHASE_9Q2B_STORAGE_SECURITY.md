# Fase 9Q.2B — Storage e arquivos

## Já implementado antes desta fase (verificado, não refeito)

- **Bucket privado, nunca público**: `CloudObjectStorageProvider` nunca gera URL pública
  fixa — apenas `signedReadUrl`/`signedUploadUrl` com TTL (`src/infrastructure/storage/storage-provider.ts:85-86`),
  padrão 300s (`STORAGE_SIGNED_URL_TTL_SECONDS`), configurável entre 30s e 3600s pelo
  schema de config.
- **Separação por organização/tenant**: toda chave de objeto é
  `organizationId/projectId/domain/entityId/version/<aleatório><extensão>`
  (`storageKey`, mesmo arquivo). `assertStorageAuthorization` recusa acesso quando o
  objeto não pertence à organização/projeto do chamador **e** quando a chave não começa
  pelo prefixo `organizationId/projectId/` — dupla checagem, não só metadado.
- **Bloqueio de path traversal**: `LocalStorageProvider.resolve` rejeita chave absoluta ou
  com `\`, e confirma que o caminho resolvido continua dentro da raiz.
- **Checksum SHA-256 por objeto**, calculado no momento do `put`, nunca confiado do
  cliente.
- **Design/BIM**: `validateDesignUpload` (`src/domain/design/adapters.ts`) já valida
  extensão, MIME, tamanho por tipo e assinatura binária (magic bytes) para PDF, PNG, JPG,
  WEBP, IFC, DXF, XLSX/DOCX, DWG.

## Gap encontrado e fechado nesta fase

**Sala de documentos (`registerProjectDocument`, `src/application/investment/investment-service.ts`)
não tinha nenhuma validação de MIME/extensão/assinatura binária** — apenas checksum e o
scanner (que em produção sempre falha fechado por falta de adapter real, ver abaixo).
Um cliente podia enviar `fileName`/`mimeType` arbitrários para qualquer uma das 15
categorias de data room.

Correção: `src/infrastructure/storage/upload-validation.ts` (novo) generaliza a mesma
técnica de `validateDesignUpload` para os formatos de documento (PDF, PNG, JPG/JPEG,
WEBP, DOCX, XLSX, PPTX, CSV, TXT) e **rejeita explicitamente assinaturas de executável**
(PE/EXE/DLL `MZ`, ELF, Mach-O, script `#!`, OLE/MSI composto) mesmo sob extensão e MIME
de documento — bloqueia execução de arquivo mesmo disfarçado. `inspectUpload`
(`src/infrastructure/storage/upload-policy.ts`) agora aceita `mimeType` opcional e, quando
informado, aplica essa validação antes do scanner; `registerProjectDocument` passa a
enviar `mimeType`. Chamada de `design-service.ts` (que já valida via
`validateDesignUpload` a montante, incluindo formatos fora do conjunto genérico como
IFC/DXF/DWG) continua sem `mimeType` em `inspectUpload` — comportamento preservado, sem
dupla validação incompatível. 10 testes novos (`upload-validation.test.ts`) + 2 testes
adicionados a `upload-policy.test.ts`, todos verdes.

## Scanner antimalware: bloqueador real, não fabricado

`createMalwareScanner("production", "external")` sempre devolve
`UnavailableProductionScanner` (`clean: false`) — **não existe adapter real de scanner
neste repositório**, apenas o contrato de interface (`MalwareScannerProvider`). Em
produção, qualquer upload é recusado pelo scanner até um fornecedor real (ClamAV
gerenciado, VirusTotal, AWS GuardDuty Malware Protection, ou outro) ser escolhido e
integrado. Isso é comportamento fail-closed correto, não um bug — mas é um bloqueador de
piloto real, registrado na matriz Go/No-Go, não uma lacuna a fabricar aqui.

## Retenção e exclusão

Herdado da 9P.2: versionamento + lifecycle no bucket conforme política de retenção
jurídica (não redefinida nesta fase — depende de decisão jurídica/LGPD, ver
`docs/PHASE_9Q2B_LGPD_CHECKLIST.md`). Nenhum mecanismo de exclusão automática por
prazo existe no código hoje; é responsabilidade de configuração do bucket no provedor
quando este for escolhido.

## Evidência de isolamento entre tenants — o que existe e o que falta

Existe e já é testado: `assertStorageAuthorization` recusa organização divergente,
projeto divergente e capability não concedida (`storage-provider.test.ts`, teste
"rejeita tenant, projeto ou capability divergentes antes de assinar") — isolamento no
nível do código da aplicação, comprovado. Falta nesta sessão: um teste de integração
ponta-a-ponta contra um bucket S3 real confirmando que a política IAM
(`docs/PHASE_9Q2B_IAM_KMS_POLICY.md`) de fato nega o acesso no nível do provedor, não só
no nível do código — isso exige o bucket real, então fica `NÃO COMPROVADO` nesta fase.

## Bloqueio

Scanner de produção sem adapter real, ausência de bucket real para o teste de isolamento
ponta-a-ponta, e política de retenção pendente de decisão jurídica permanecem
bloqueadores explícitos.
