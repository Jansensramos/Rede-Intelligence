import { DescribeSecretCommand, GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DescribeKeyCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { describe, expect, it, vi } from "vitest";
import { AwsKmsAdapter, AwsSecretsManagerAdapter } from "./aws-security-adapters";
import { ProductionDependencyError } from "./production-dependency-error";

describe("adapters AWS de segurança", () => {
  it("resolve e verifica segredo usando exclusivamente o client injetado", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetSecretValueCommand) return { SecretString: "conteudo-sintetico" };
      if (command instanceof DescribeSecretCommand) return { ARN: "referencia" };
      throw new Error("comando inesperado");
    });
    const adapter = new AwsSecretsManagerAdapter({ send } as unknown as SecretsManagerClient);
    expect(await adapter.read("referencia")).toBe("conteudo-sintetico");
    await adapter.healthCheck("referencia");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("não propaga detalhes internos do provider", async () => {
    const original = Object.assign(new Error("detalhe que não deve chegar ao operador"), { name: "AccessDeniedException" });
    const send = vi.fn(async () => { throw original; });
    const adapter = new AwsSecretsManagerAdapter({ send } as unknown as SecretsManagerClient);
    const error = await adapter.read("referencia").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProductionDependencyError);
    expect(error).toMatchObject({ kind: "PERMISSION_DENIED", originalErrorClass: "AccessDeniedException", cause: original });
    expect((error as Error).message).toBe("Não foi possível resolver o segredo no gerenciador externo.");
    await expect(adapter.read("referencia")).rejects.not.toThrow(/detalhe que não deve/);
  });

  it("verifica KMS e cifra por client injetado sem rede", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof DescribeKeyCommand) return { KeyMetadata: { KeyState: "Enabled" } };
      if (command instanceof EncryptCommand) return { CiphertextBlob: new Uint8Array([7, 8, 9]) };
      throw new Error("comando inesperado");
    });
    const adapter = new AwsKmsAdapter({ send } as unknown as KMSClient, "referencia-kms");
    await adapter.healthCheck();
    expect(await adapter.encrypt(new Uint8Array([1]), { organizationId: "organizacao" })).toEqual(new Uint8Array([7, 8, 9]));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("falha fechado com referência inválida antes do client", async () => {
    const send = vi.fn();
    const adapter = new AwsSecretsManagerAdapter({ send } as unknown as SecretsManagerClient);
    await expect(adapter.read("\n")).rejects.toMatchObject({ kind: "INVALID_CONFIGURATION", originalErrorClass: "ConfigurationError" });
    expect(send).not.toHaveBeenCalled();
  });

  it("falha fechado com chave KMS inválida antes do client", async () => {
    const send = vi.fn();
    const adapter = new AwsKmsAdapter({ send } as unknown as KMSClient, "\n");
    await expect(adapter.healthCheck()).rejects.toMatchObject({ kind: "INVALID_CONFIGURATION", originalErrorClass: "ConfigurationError" });
    expect(send).not.toHaveBeenCalled();
  });
});
