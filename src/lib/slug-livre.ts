import "server-only";
import { like } from "drizzle-orm";
import { type Executor } from "@/db";
import { groups, players } from "@/db/schema";
import { primeiroLivre, troncoDeColisao } from "./slug";

// Onde o slug de verdade nasce: `slugBase` dá o palpite, isto resolve a colisão
// contra o que já está no banco.
//
// Roda com o `exec` do chamador, dentro da transação dele, porque quem cria
// jogador ou grupo já está numa. Não é trava contra corrida: dois inserts
// simultâneos podem escolher o mesmo slug, e aí o segundo estoura a unique
// constraint. Isso é de propósito — dentro de uma transação, uma violação de
// unique aborta a transação inteira, então não há "tenta de novo" possível aqui.
// Quem chama já trata `isUniqueViolation` e devolve o banner de erro, e a corrida
// é rara o bastante para não valer um advisory lock.

/**
 * Os slugs que podem disputar com esta base: o próprio, os numerados e as
 * variantes truncadas que `variacaoDeSlug` gera quando a base está cheia — por
 * isso a busca é pelo tronco, e não por `base-%` (ver `troncoDeColisao`).
 *
 * O `_` do charset é curinga de um caractere no LIKE, então o tronco também
 * casa slugs alheios parecidos. É inofensivo e por isso não há ESCAPE aqui: o
 * excedente só entra no conjunto de ocupados — nenhum candidato nosso vira
 * falso positivo, e nenhum disputante de verdade escapa do filtro.
 */
export async function slugLivreDeJogador(exec: Executor, base: string): Promise<string> {
  const rows = await exec
    .select({ slug: players.slug })
    .from(players)
    .where(like(players.slug, `${troncoDeColisao(base)}%`));
  return primeiroLivre(base, new Set(rows.map((r) => r.slug)));
}

export async function slugLivreDeGrupo(exec: Executor, base: string): Promise<string> {
  const rows = await exec
    .select({ slug: groups.slug })
    .from(groups)
    .where(like(groups.slug, `${troncoDeColisao(base)}%`));
  return primeiroLivre(base, new Set(rows.map((r) => r.slug)));
}
