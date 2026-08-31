import { beforeAll } from "vitest";

beforeAll(() => {
  if (process.env.REDE_TEST_DATABASE_GUARD !== "confirmed") throw new Error("Guard do banco de testes não foi confirmado.");
});
