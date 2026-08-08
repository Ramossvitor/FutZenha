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
 * `agora` é SQL e NÃO aceita `Date` de propósito. Um `Date` interpolado em
 * `sql` cru não passa pelo mapeamento de coluna do drizzle, e o serializer que
 * o driver postgres-js instala para timestamp é passthrough — o objeto Date
 * chegava inteiro no escritor de bytes e derrubava a query
 * (ERR_INVALID_ARG_TYPE). Foi exatamente assim que a tela de gestão de grupo
 * quebrou em produção. `now()` do Postgres serve a todos os chamadores e ainda
 * respeita a regra de pureza do render (sem Date.now()).
 *
 * `maxUses` nulo é teto ausente, de propósito: link que morre no primeiro clique
 * é inútil num grupo de WhatsApp com vinte pessoas.
 */
export function condicaoLinkVivo(agora: SQL): SQL | undefined {
  return and(
    isNull(groupInviteLinks.revokedAt),
    sql`${groupInviteLinks.expiresAt} > ${agora}`,
    or(
      isNull(groupInviteLinks.maxUses),
      sql`${groupInviteLinks.usesCount} < ${groupInviteLinks.maxUses}`,
    ),
  );
}
