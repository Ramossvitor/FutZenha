// O identificador que vai na URL pública de jogador e de grupo: minúsculas, sem
// acento, só [a-z0-9._-]. Módulo puro — sem `server-only` e sem drizzle — pelo
// mesmo motivo de ./username.ts: o vitest aqui roda sem config e sem alias.
//
// Existe separado de ./username.ts porque as duas réguas são diferentes. Username
// é credencial: 20 caracteres, derivado só do apelido ou do primeiro nome. Slug é
// endereço público: 60 caracteres e o nome inteiro, porque quanto mais do nome
// couber, menos colisão e mais reconhecível o link fica.
//
// A regra que não pode cair: slug NUNCA é puramente numérico. Antes disto as
// rotas eram /jogador/{id} com o serial do banco, o que expunha a ordem de
// cadastro e deixava a plataforma enumerável. Garantir que nenhum slug seja só
// dígitos é o que faz `/jogador/17` dar 404 sem nem consultar o banco.

export const SLUG_MAX = 60;

export const SLUG_REGEX = /^[a-z0-9._-]{2,60}$/;

/** Pontuação nas pontas não ajuda a ler e ainda deixa `/jogador/vitor-` vivo. */
function aparar(bruto: string): string {
  return bruto.replace(/^[-._]+|[-._]+$/g, "");
}

/**
 * Normaliza texto livre para o charset do slug.
 *
 * Pode devolver string vazia ("李") ou só dígitos ("2024"): quem precisa de uma
 * base garantidamente válida usa `slugBase`.
 */
export function slugificar(texto: string): string {
  const limpo = aparar(
    texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-"),
  );
  // Aparar de novo depois do corte: o corte pode reabrir uma ponta suja.
  return aparar(limpo.slice(0, SLUG_MAX));
}

/**
 * Uma base sempre válida: nunca curta demais, nunca só dígitos.
 *
 * O prefixo entra como qualificador e não como substituto — "2024" vira
 * "grupo-2024", e não "grupo", porque o que a pessoa escreveu ainda é a melhor
 * pista do que aquele endereço é.
 */
export function slugBase(texto: string, prefixoFallback: string): string {
  const bruto = slugificar(texto);
  if (ehSlug(bruto)) return bruto;
  return aparar(`${prefixoFallback}${bruto ? `-${bruto}` : ""}`.slice(0, SLUG_MAX));
}

/**
 * A n-ésima tentativa para uma mesma base: `vitor-ramos`, `vitor-ramos-2`, …
 *
 * O sufixo come o fim da base em vez de estourar o limite, como o `comSufixo` de
 * ./username.ts — um slug truncado ainda entra na coluna, um de 61 caracteres
 * seria recusado pelo regex que este módulo existe para satisfazer.
 */
export function variacaoDeSlug(base: string, tentativa: number): string {
  if (tentativa <= 1) return base;
  const sufixo = `-${tentativa}`;
  return aparar(base.slice(0, SLUG_MAX - sufixo.length)) + sufixo;
}

/** O primeiro `base`, `base-2`, `base-3`… que não esbarra no que já existe. */
export function primeiroLivre(base: string, ocupados: Set<string>): string {
  // Com N ocupados, no máximo a (N+1)-ésima tentativa está livre: cada uma gera
  // um slug distinto das anteriores.
  for (let tentativa = 1; tentativa <= ocupados.size + 1; tentativa++) {
    const candidato = variacaoDeSlug(base, tentativa);
    if (!ocupados.has(candidato)) return candidato;
  }
  // Inalcançável pela contagem acima; existe para o tipo fechar sem `!`.
  throw new Error(`sem slug livre para "${base}"`);
}

/**
 * O prefixo que toda variação de `base` carrega — truncada ou não.
 *
 * `variacaoDeSlug` come o fim de uma base cheia para caber o sufixo, então
 * `LIKE 'base-%'` não enxerga `base[0..57]-2`: quem busca ocupados por esse
 * padrão deixa um disputante invisível e colhe unique violation na inserção.
 * Buscar por este tronco cobre a base, `base-N` e toda variante truncada com
 * sufixo de até 4 caracteres (`-999`) — a milésima colisão de uma mesma base
 * não existe fora de teste de mesa.
 */
export function troncoDeColisao(base: string): string {
  return aparar(base.slice(0, SLUG_MAX - 4));
}

/**
 * O parâmetro de rota pode ser um slug nosso?
 *
 * Recusar dígitos puros aqui é o que transforma as URLs antigas em 404 de graça:
 * `/jogador/17` nem chega ao banco. Como `slugBase` garante que nenhum slug
 * gerado é só dígitos, nada de legítimo é recusado junto.
 */
export function ehSlug(valor: string): boolean {
  return SLUG_REGEX.test(valor) && !/^[0-9]+$/.test(valor);
}
