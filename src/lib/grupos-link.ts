// A regra de "este link do grupo ainda vale", num lugar só.
//
// Ela estava escrita três vezes — em `linkAtivo` (./grupos), na página do
// convite e na action que resgata — e as três precisam concordar exatamente:
// divergir uma faz a página dizer "inválido" enquanto a action ainda deixa
// entrar, ou o contrário, que é pior. Como o resgate é o que adiciona alguém a
// um grupo privado, a cópia errada aqui é um buraco de autorização, não um
// detalhe de UI.
//
// Módulo puro (sem `server-only`, sem `@/db`, `../db/schema` por caminho
// relativo) pelo mesmo motivo de ./stats-escopo: é a única forma de o vitest
// alcançar isto.

import { and, isNull, or, sql, type SQL } from "drizzle-orm";
import { groupInviteLinks } from "../db/schema";

/**
 * O link está vivo: não revogado, dentro da validade e com vaga sobrando.
 *
 * `agora` é SQL, não `Date`, porque os três chamadores precisam de fontes de
 * tempo diferentes — a página do convite roda no render, onde a regra de pureza
 * do React proíbe `Date.now()`, e usa `now()` do Postgres; `linkAtivo` já
 * passava um `Date` do Node. Deixar a escolha com quem chama mantém a regra
 * única sem forçar nenhum dos dois.
 *
 * `maxUses` nulo é teto ausente, de propósito: link que morre no primeiro clique
 * é inútil num grupo de WhatsApp com vinte pessoas.
 */
export function condicaoLinkVivo(agora: SQL | Date): SQL | undefined {
  return and(
    isNull(groupInviteLinks.revokedAt),
    sql`${groupInviteLinks.expiresAt} > ${agora}`,
    or(
      isNull(groupInviteLinks.maxUses),
      sql`${groupInviteLinks.usesCount} < ${groupInviteLinks.maxUses}`,
    ),
  );
}
