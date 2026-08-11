import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";

// Se as animações do app rodam neste aparelho. O valor sai daqui, é carimbado
// como `data-motion` no <html> pelo layout, e de lá o globals.css resolve o
// resto — inclusive o `--mov` que o JS da comemoração lê.
//
// Cookie, e não localStorage, por um motivo só: o servidor precisa saber disto
// ANTES do primeiro paint. Com localStorage a página nasceria animada e apagaria
// as animações no primeiro efeito — o flash que a pessoa que desligou o
// movimento é exatamente a menos disposta a ver.
export const MOVIMENTO_COOKIE = "futzenha_movimento";

// Sem httpOnly de propósito: não é credencial, é preferência de aparelho — a
// mesma decisão (e a mesma justificativa) do cookie de grupo. 1 ano porque quem
// desligou animação não quer ser perguntado de novo no mês que vem.
export const MOVIMENTO_COOKIE_OPTIONS = {
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
} as const;

/**
 * `auto` obedece o `prefers-reduced-motion` do sistema; os outros dois ganham
 * dele nos dois sentidos.
 *
 * Ter os três, e não um booleano, é o que permite ligar as animações aqui mesmo
 * com "reduzir movimento" ligado no SO. Quem mexe naquela opção do sistema
 * costuma fazê-lo por um app específico, e um booleano transformaria isso numa
 * escolha de tudo-ou-nada que a pessoa não pediu.
 */
export type Movimento = "auto" | "ligado" | "reduzido";

const VALIDOS: readonly string[] = ["auto", "ligado", "reduzido"];

/** Valor desconhecido cai em "auto" — cookie é editável, e o padrão é seguro. */
export function parseMovimento(bruto: string | undefined): Movimento {
  return bruto !== undefined && VALIDOS.includes(bruto) ? (bruto as Movimento) : "auto";
}

/**
 * `cache()` porque o layout e a página de perfil perguntam a mesma coisa no
 * mesmo render.
 *
 * Sem exigir sessão, ao contrário do grupo atual: preferência de movimento vale
 * para quem está deslogado na tela de login do mesmo jeito que para quem entrou.
 */
export const getMovimento = cache(async (): Promise<Movimento> => {
  return parseMovimento((await cookies()).get(MOVIMENTO_COOKIE)?.value);
});
