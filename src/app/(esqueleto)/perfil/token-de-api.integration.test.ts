// O token do relógio pelo perfil: nasce em claro uma vez, fica só como hash,
// gerar de novo substitui, revogar zera — e nada disso encosta na sessão do
// celular (token_version).

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sessaoPorToken } from "@/lib/sessao-por-token";
import { hashDoToken, PREFIXO_DO_TOKEN } from "@/lib/token-de-api";
import { criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";
import { gerarTokenDeApi, revogarTokenDeApi } from "./actions";

async function conta(id: number) {
  const [linha] = await db.select().from(users).where(eq(users.id, id));
  return linha;
}

describe("gerarTokenDeApi", () => {
  it("gera um token que autentica o relógio, guardando só o hash", async () => {
    const { conta: dona } = await criarJogadorComConta();
    await logarComo(dona);

    const { token } = await gerarTokenDeApi();

    expect(token.startsWith(PREFIXO_DO_TOKEN)).toBe(true);
    const depois = await conta(dona.id);
    expect(depois.apiTokenHash).toBe(hashDoToken(token));
    expect(depois.apiTokenCriadoEm).not.toBeNull();
    expect(depois.apiTokenUsadoEm).toBeNull();
    expect((await sessaoPorToken(`Bearer ${token}`))?.userId).toBe(dona.id);
  });

  // O relógio não é sessão: o celular continua logado.
  it("não mexe em token_version", async () => {
    const { conta: dona } = await criarJogadorComConta();
    await logarComo(dona);

    await gerarTokenDeApi();

    expect((await conta(dona.id)).tokenVersion).toBe(dona.tokenVersion);
  });

  it("gerar de novo invalida o anterior e zera o último uso", async () => {
    const { conta: dona } = await criarJogadorComConta();
    await logarComo(dona);
    const { token: antigo } = await gerarTokenDeApi();
    await sessaoPorToken(`Bearer ${antigo}`);
    expect((await conta(dona.id)).apiTokenUsadoEm).not.toBeNull();

    const { token: novo } = await gerarTokenDeApi();

    expect(novo).not.toBe(antigo);
    // Lido ANTES de usar o token novo: `sessaoPorToken` carimba o último uso,
    // e depois dela o zero não seria mais observável.
    expect(await conta(dona.id)).toMatchObject({
      apiTokenHash: hashDoToken(novo),
      apiTokenUsadoEm: null,
    });
    expect(await sessaoPorToken(`Bearer ${antigo}`)).toBeNull();
    expect((await sessaoPorToken(`Bearer ${novo}`))?.userId).toBe(dona.id);
  });

  it("sem sessão, manda para o login", async () => {
    deslogar();

    expect(await esperaRedirect(gerarTokenDeApi())).toBe("/login");
    expect(await esperaRedirect(revogarTokenDeApi())).toBe("/login");
  });
});

describe("revogarTokenDeApi", () => {
  it("zera as três colunas e o token para de valer", async () => {
    const { conta: dona } = await criarJogadorComConta();
    await logarComo(dona);
    const { token } = await gerarTokenDeApi();

    await revogarTokenDeApi();

    expect(await conta(dona.id)).toMatchObject({
      apiTokenHash: null,
      apiTokenCriadoEm: null,
      apiTokenUsadoEm: null,
    });
    expect(await sessaoPorToken(`Bearer ${token}`)).toBeNull();
  });
});
