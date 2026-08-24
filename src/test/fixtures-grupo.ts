// Construtores de cenário de grupo para os testes de integração — mesmas
// regras da casa de fixtures.ts (inserts do drizzle, timestamps retroativos
// pelo relógio do banco, e-mails @example.com).

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { groupInvitations, groupMembers, groups, type Group, type Player } from "@/db/schema";
import { slugBase, variacaoDeSlug } from "@/lib/slug";

// O nome default se repete entre chamadas (e `groups.name` não é unique), mas
// `groups.slug` é — então o contador desempata, como `criarGrupo` de verdade faz
// com o `slugLivreDeGrupo`. Primeiro grupo fica com a base limpa, os seguintes
// numerados.
let contador = 0;

// `visibility` fica opcional e cai no default do schema (private) para não
// mexer em quem já chamava — quem precisa do público é o perfil, onde o grupo
// visível e o invisível são o teste inteiro.
//
// Devolve a linha inteira, e não só o id: o slug é o endereço nas URLs que as
// actions montam, e os testes de redirect precisam dele.
export async function criarGrupo(
  nome = "Grupo de Teste",
  opcoes: { visibility?: "private" | "public" } = {},
): Promise<Group> {
  contador += 1;
  const [grupo] = await db
    .insert(groups)
    .values({
      name: nome,
      slug: variacaoDeSlug(slugBase(nome, "grupo"), contador),
      visibility: opcoes.visibility,
    })
    .returning();
  return grupo;
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
    // Para onde o aviso saiu. O envio de verdade grava junto com o carimbo (ver
    // enviarAvisoDeGrupo); aqui é opcional porque a maioria dos testes só
    // precisa da data, e nulo é o que existe nas linhas anteriores à coluna.
    emailEnviadoPara?: string;
  } = {},
): Promise<typeof groupInvitations.$inferSelect> {
  const {
    convidadoPor,
    status = "pending",
    emailEnviadoHaMinutos,
    emailEnviadoPara = null,
  } = opcoes;
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
      emailSentTo: emailEnviadoPara,
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
