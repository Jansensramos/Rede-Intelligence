import { COLINAS_MOOCA_BUDGET } from "@/domain/budget/budget-engine";
import { createBudget } from "@/application/budget/budget-service";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seed() {
  const project = await prisma.project.findFirst({ where: { name: "Colinas da Mooca" } });
  if (project) {
    const budget = await createBudget(prisma, { projectId: project.id, lineItems: COLINAS_MOOCA_BUDGET });
    console.log(`✅ Budget criado: ${budget.id}`);
  } else {
    console.log("⚠️  Projeto Colinas da Mooca não encontrado");
  }
}

seed().catch(console.error).finally(() => prisma.$disconnect());
