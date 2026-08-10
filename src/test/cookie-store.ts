// Cookie-store fake que o mock de next/headers devolve nos testes de
// integração (ver setup-integration.ts). Um Map em memória com a superfície que
// o código de produção usa: get/getAll/has/set/delete.

type CookieFake = { name: string; value: string };

const jar = new Map<string, string>();

export const cookieJar = {
  get(name: string): CookieFake | undefined {
    const value = jar.get(name);
    return value === undefined ? undefined : { name, value };
  },
  getAll(): CookieFake[] {
    return [...jar.entries()].map(([name, value]) => ({ name, value }));
  },
  has(name: string): boolean {
    return jar.has(name);
  },
  // next/headers aceita set(nome, valor, opções) e set({ name, value, ... });
  // as opções (httpOnly, maxAge...) não importam para os asserts e são ignoradas.
  set(nome: string | { name: string; value: string }, valor?: string): void {
    if (typeof nome === "object") jar.set(nome.name, nome.value);
    else jar.set(nome, valor ?? "");
  },
  delete(nome: string | { name: string }): void {
    jar.delete(typeof nome === "object" ? nome.name : nome);
  },
  // Só para os testes: zera o estado entre um teste e outro.
  limpar(): void {
    jar.clear();
  },
};
