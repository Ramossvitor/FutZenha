// Construtores de dados para os testes de integração. Regras da casa:
// - Sempre inserts do drizzle (nunca Date em SQL cru — quebra o postgres.js).
// - Timestamp retroativo/futuro sai do relógio do BANCO (sql`now() - interval`),
//   nunca de new Date(): o rate limit de e-mail e a fila de presença comparam
//   com now() do Postgres, e skew runner↔container viraria flake.
// - attendances sempre com confirmedAt explícito e ESCALONADO — todo mundo no
//   mesmo instante esconderia erro de ordenação atrás do desempate por id.
// - E-mails sempre @example.com: se um teste escapar com key configurada, nada
//   chega a caixa de gente de verdade. Uma exceção, e só ela: a forma canônica
//   (ponto e +tag) existe só no Gmail, então o teste dessa regra precisa de
//   @gmail.com — com local part que ninguém registraria (futzenha.fixture.*),
//   porque ali o domínio deixa de ser a rede de proteção.

import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  invites,
  matchDays,
  players,
  users,
  type MatchDay,
  type Player,
} from "@/db/schema";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { cookieJar } from "./cookie-store";

export const SENHA_DE_TESTE = "senha-de-teste-123";

// scrypt custa ~50-100ms por chamada; um hash só, computado uma vez por
// arquivo, serve para todas as contas de teste.
const hashDaSenhaDeTeste = await hashPassword(SENHA_DE_TESTE);

let contador = 0;
function proximoNome(prefixo: string): string {
  contador += 1;
  return `${prefixo}-${contador}`;
}

type Usuario = typeof users.$inferSelect;

export async function criarJogador(
  extra: Partial<typeof players.$inferInsert> = {},
): Promise<Player> {
  const [jogador] = await db
    .insert(players)
    .values({ name: proximoNome("Jogador"), ...extra })
    .returning();
  return jogador;
}

export async function criarConta(
  jogador: Player,
  extra: Partial<typeof users.$inferInsert> = {},
): Promise<Usuario> {
  const [conta] = await db
    .insert(users)
    .values({
      playerId: jogador.id,
      username: extra.username ?? jogador.name.toLowerCase(),
      passwordHash: hashDaSenhaDeTeste,
      ...extra,
    })
    .returning();
  return conta;
}

/** Jogador + conta num passo só, para os testes que só precisam de "alguém logável". */
export async function criarJogadorComConta(
  extraJogador: Partial<typeof players.$inferInsert> = {},
  extraConta: Partial<typeof users.$inferInsert> = {},
): Promise<{ jogador: Player; conta: Usuario }> {
  const jogador = await criarJogador(extraJogador);
  const conta = await criarConta(jogador, extraConta);
  return { jogador, conta };
}

/**
 * Grava um cookie de sessão REAL no cookie-store fake: o caminho inteiro de
 * verifySessionToken + validação no banco do getSession roda de verdade.
 */
export async function logarComo(conta: Usuario): Promise<void> {
  const token = await createSessionToken({ sub: conta.id, v: conta.tokenVersion });
  cookieJar.set(SESSION_COOKIE, token);
}

export function deslogar(): void {
  cookieJar.delete(SESSION_COOKIE);
}

export async function criarFut(
  extra: Partial<typeof matchDays.$inferInsert> = {},
): Promise<MatchDay> {
  const [fut] = await db
    .insert(matchDays)
    .values({ date: "2026-08-12", location: "Quadra de Teste", ...extra })
    .returning();
  return fut;
}

/**
 * Entra na lista direto pelo banco (para montar cenário, não para testar a
 * entrada — isso é papel de entrarNaLista). `minutosAtras` escalona a ordem de
 * chegada pelo relógio do banco.
 */
export async function confirmarPresenca(
  fut: MatchDay,
  jogador: Player,
  opcoes: { status?: "in" | "out" | "waitlist" | "no_show"; minutosAtras?: number } = {},
): Promise<void> {
  const { status = "in", minutosAtras = 0 } = opcoes;
  const minutos = Math.trunc(minutosAtras);
  await db.insert(attendances).values({
    matchDayId: fut.id,
    playerId: jogador.id,
    status,
    confirmedAt:
      status === "out" ? null : sql`now() - interval '${sql.raw(String(minutos))} minutes'`,
  });
}

/**
 * Volume para o teto diário, inserido DIRETO — nunca via gerarConvite, que
 * apaga a linha anterior do jogador e subcontaria o total.
 */
export async function criarVolumeDeConvites(
  jogador: Player,
  quantos: number,
  opcoes: { enviadoHaUmaHora: boolean },
): Promise<void> {
  const lote = randomBytes(4).toString("hex");
  await db.insert(invites).values(
    Array.from({ length: quantos }, (_, i) => ({
      token: randomBytes(32).toString("base64url"),
      playerId: jogador.id,
      email: `volume-${lote}-${i}@example.com`,
      expiresAt: sql`now() + interval '7 days'`,
      emailSentAt: opcoes.enviadoHaUmaHora ? sql`now() - interval '60 minutes'` : null,
    })),
  );
}

/**
 * Convite de plataforma. `emailEnviadoHaMinutos` carimba email_sent_at
 * retroativo (relógio do banco) para os testes de rate limit; `expiradoHa`
 * positivo cria convite vencido.
 */
export async function criarConvite(
  jogador: Player,
  opcoes: {
    email?: string | null;
    usado?: boolean;
    expiradoHaMinutos?: number;
    emailEnviadoHaMinutos?: number;
  } = {},
): Promise<typeof invites.$inferSelect> {
  const { email = null, usado = false, expiradoHaMinutos, emailEnviadoHaMinutos } = opcoes;
  const validade =
    expiradoHaMinutos === undefined
      ? sql`now() + interval '7 days'`
      : sql`now() - interval '${sql.raw(String(Math.trunc(expiradoHaMinutos)))} minutes'`;
  const [convite] = await db
    .insert(invites)
    .values({
      token: randomBytes(32).toString("base64url"),
      playerId: jogador.id,
      email,
      expiresAt: validade,
      usedAt: usado ? sql`now()` : null,
      emailSentAt:
        emailEnviadoHaMinutos === undefined
          ? null
          : sql`now() - interval '${sql.raw(String(Math.trunc(emailEnviadoHaMinutos)))} minutes'`,
    })
    .returning();
  return convite;
}
