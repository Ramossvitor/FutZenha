// Lista de usernames que são admin da plataforma por env var, separados por
// vírgula. É a chave-mestra: vale mesmo com `users.is_platform_admin = false`,
// porque a Vercel não dá shell no banco e sem isso um `update` errado tranca
// todo mundo do lado de fora — o único jeito de voltar seria um deploy.
//
// Módulo puro de propósito (sem `server-only`, sem drizzle): quem lê isto é
// tanto o DAL da sessão quanto o `src/db/migrate.ts`, que roda sob tsx.
export function parsePlatformAdmins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter((u) => u.length > 0),
  );
}

/** Os usernames de `PLATFORM_ADMIN_USERNAMES`, já normalizados. */
export function platformAdminsDoAmbiente(): Set<string> {
  return parsePlatformAdmins(process.env.PLATFORM_ADMIN_USERNAMES);
}
