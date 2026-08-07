// Não existe campo de foto em players, users nem groups — o avatar do produto
// é a inicial. Aqui mora a regra de como tirar duas letras de um nome, para que
// a mesma pessoa não apareça como "MA" numa tela e "MV" na outra.

/**
 * Até duas letras maiúsculas para o avatar.
 *
 * Prefere as iniciais de duas palavras ("Marcos Vinícius" → MV); com uma
 * palavra só, usa as duas primeiras letras ("Zóio" → ZÓ). Descarta partículas
 * ("João da Silva" → JS) porque "JD" não identifica ninguém.
 */
export function iniciais(nome: string): string {
  const particulas = new Set(["da", "de", "do", "das", "dos", "e"]);
  const palavras = nome
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0 && !particulas.has(p.toLowerCase()));

  if (palavras.length === 0) return "?";
  if (palavras.length === 1) return [...palavras[0]].slice(0, 2).join("").toUpperCase();
  return (
    [...palavras[0]][0] + [...palavras[palavras.length - 1]][0]
  ).toUpperCase();
}
