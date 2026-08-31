export const INVALID_LOGIN_MESSAGE = "Credenciais inválidas ou acesso temporariamente indisponível.";
export const DUMMY_PASSWORD_HASH = "$2b$12$C0raSb.FrFik6s5BeC3vre9ft1UEcGwlvcrpIDgM9zPHWzdas/Y3i";
export const LOGIN_RATE_LIMIT_POLICY = { limit: 5, windowMs: 15 * 60_000 } as const;

/** Mantém o mesmo caminho bcrypt para usuário inexistente, inativo ou válido. */
export function passwordHashForVerification(user: { isActive: boolean; passwordHash: string } | null | undefined) {
  return user?.isActive ? user.passwordHash : DUMMY_PASSWORD_HASH;
}
