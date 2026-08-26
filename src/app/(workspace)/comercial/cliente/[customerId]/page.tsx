import { notFound } from "next/navigation";
import { requireAuthContext } from "@/application/auth/session";
import { getCustomer360 } from "@/application/sales/customer-360-service";
import { Customer360View } from "@/components/customer-360-view";

/**
 * Fase 9K.4B — Cliente 360, rota de drill-down a partir de Comercial (plano §1). Independente do
 * empreendimento ativo no cookie de contexto (9K.1): um cliente pode ter unidades em mais de um
 * empreendimento, então a busca é só por tenant (`organizationId`), nunca por `projectId`.
 */
export default async function CustomerDetailPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const authContext = await requireAuthContext();
  const view = await getCustomer360(authContext, customerId);
  if (!view) notFound();

  return <Customer360View view={view} />;
}
