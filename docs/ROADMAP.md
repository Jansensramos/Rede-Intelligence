# Roadmap

## Fase 0 — Fundação

- decisões, modelo e fórmulas documentados;
- monólito modular e tokens visuais;
- esquema Prisma e contratos tipados.

## Fase 1 — REDE Engine v1

- fluxo editável e cálculo mensal;
- cenários padrão;
- dashboard, riscos objetivos e trilha de cálculo;
- testes unitários, typecheck, lint e build.

## Próximos incrementos recomendados

### 1. Persistência e governança

Conectar PostgreSQL, autenticação, papéis, isolamento por empresa, versionamento de premissas e auditoria persistida.

### 2. Fidelidade financeira

Parcelamento de terreno, permutas, curva de obra configurável, inflação/indexadores, distrato, inadimplência, cronograma de financiamento e repasse.

### 3. Sensibilidade

Matriz automática, tornado chart e limites de viabilidade por variável.

### 4. REDE Score

Política versionada, pesos configuráveis, evidências e justificativa reproduzível. Validar pesos com decisões históricas antes de uso institucional.

### 5. Red Team

Expandir regras determinísticas; só então acoplar agentes especializados via interface de provedor, com aprovação humana.

### 6. REDE Studio e Data

Gerar outputs a partir de snapshots aprovados e capturar previsto × realizado com evidências.

## Gates de qualidade

Nenhuma fase avança se fórmulas críticas não tiverem testes, se o snapshot não for rastreável ou se a interface não distinguir premissa, cálculo e inferência.
