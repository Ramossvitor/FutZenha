// Username: minúsculas, sem acento, só [a-z0-9._-]. Módulo puro — sem
// `server-only` e sem drizzle — porque o vitest aqui roda sem config e sem alias.
//
// A sugestão nasceu como conveniência do formulário de convite, onde a pessoa
// podia corrigir o palpite. Com o login pelo Google não há formulário nenhum: o
// username é derivado e gravado sem ninguém olhar, então ele precisa sempre sair
// válido — daí o fallback e as variações numeradas.

export const USERNAME_REGEX = /^[a-z0-9._-]{2,20}$/;

export const USERNAME_MAX = 20;

/** Usado quando o nome não sobrevive à normalização ("Zé" vira "z", "李" vira ""). */
const FALLBACK = "jogador";

/** Sugestão a partir do apelido ou, na falta dele, do primeiro nome. */
export function sugerirUsername(name: string, nickname: string | null): string {
  const base = (nickname ?? name.split(" ")[0] ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, USERNAME_MAX);
  return USERNAME_REGEX.test(base) ? base : FALLBACK;
}

/**
 * Base + sufixo dentro do limite de 20.
 *
 * O sufixo come o fim da base em vez de estourar o limite — um username
 * truncado ainda entra, um de 21 caracteres seria recusado pelo próprio regex
 * que este módulo existe para satisfazer.
 */
export function comSufixo(base: string, sufixo: string): string {
  return base.slice(0, USERNAME_MAX - sufixo.length) + sufixo;
}

/** A n-ésima tentativa para um mesmo palpite: `pedro`, `pedro2`, `pedro3`… */
export function variacaoDeUsername(base: string, tentativa: number): string {
  return tentativa <= 1 ? base : comSufixo(base, String(tentativa));
}
