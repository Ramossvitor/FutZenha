// Construtores de cenário de grupo para os testes de integração — mesmas
// regras da casa de fixtures.ts (inserts do drizzle, timestamps retroativos
// pelo relógio do banco, e-mails @example.com).

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { groupInvitations, groupMembers, groups, type Player } from "@/db/schema";

export async function criarGrupo(nome = "Grupo de Teste"): Promise<number> {
  const [grupo] = await db.insert(groups).values({ name: nome }).returning();
  return grupo.id;
}

export async function entrarNoGrupo(
  groupId: number,
  jogador: Player,
  role: "admin" | "organizer" | "member" = "member",
): Promise<void> {
  await db.insert(groupMembers).values({ groupId, playerId: jogador.id, role });
}

/**
 * Convite nominal de grupo, direto no banco — para montar cenário do envio do
 * aviso, não para testar a action de convidar. `emailEnviadoHaMinutos` carimba
 * email_sent_at retroativo, como o criarConvite de plataforma.
 */
export async function criarConviteDeGrupo(
  groupId: number,
  jogador: Player,
  opcoes: {
    convidadoPor?: Player;
    status?: "pending" | "accepted" | "declined" | "revoked";
    emailEnviadoHaMinutos?: number;
  } = {},
): Promise<typeof groupInvitations.$inferSelect> {
  const { convidadoPor, status = "pending", emailEnviadoHaMinutos } = opcoes;
  const [convite] = await db
    .insert(groupInvitations)
    .values({
      groupId,
      playerId: jogador.id,
      invitedByPlayerId: convidadoPor?.id ?? null,
      status,
      emailSentAt:
        emailEnviadoHaMinutos === undefined
          ? null
          : sql`now() - interval '${sql.raw(String(Math.trunc(emailEnviadoHaMinutos)))} minutes'`,
    })
    .returning();
  return convite;
}

/**
 * Volume de avisos de grupo já enviados, para o teto diário combinado e o teto
 * por convidante. Status "revoked" de propósito: o índice parcial só admite um
 * pendente por (grupo, jogador), e para as contagens o que importa é o
 * email_sent_at — o status não entra no where.
 */
export async function criarVolumeDeAvisosDeGrupo(
  groupId: number,
  jogador: Player,
  quantos: number,
  opcoes: { convidadoPor?: Player } = {},
): Promise<void> {
  await db.insert(groupInvitations).values(
    Array.from({ length: quantos }, () => ({
      groupId,
      playerId: jogador.id,
      invitedByPlayerId: opcoes.convidadoPor?.id ?? null,
      status: "revoked" as const,
      emailSentAt: sql`now() - interval '60 minutes'`,
    })),
  );
}
