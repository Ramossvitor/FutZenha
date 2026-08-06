import { beforeEach, describe, expect, it } from "vitest";
import {
  assinarOAuthCookie,
  assinarOAuthState,
  destinoSeguro,
  gerarNonce,
  lerOAuthCookie,
  lerOAuthState,
  OAUTH_DURATION_MS,
} from "./oauth-state";
import { signBlob } from "./signed-blob";

const TEST_SECRET = "segredo-de-teste";

beforeEach(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
});

const daquiAPouco = () => Date.now() + OAUTH_DURATION_MS;

describe("cookie do OAuth", () => {
  it("round-trip preserva convite, vínculo e destino", async () => {
    const pendente = {
      n: "nonce",
      cv: "verificador",
      exp: daquiAPouco(),
      t: "token-do-convite",
      link: 7,
      next: "/perfil",
    };
    expect(await lerOAuthCookie(await assinarOAuthCookie(pendente))).toEqual(pendente);
  });

  it("os opcionais não aparecem quando não foram gravados", async () => {
    const pendente = { n: "nonce", cv: "verificador", exp: daquiAPouco() };
    const lido = await lerOAuthCookie(await assinarOAuthCookie(pendente));
    expect(lido).toEqual(pendente);
    // Um `link: undefined` que sobrevivesse ao parse entraria no
    // `pendente.link !== undefined` do google-login como se fosse um vínculo.
    expect("link" in lido!).toBe(false);
    expect("t" in lido!).toBe(false);
  });

  it("expirado → null", async () => {
    const cookie = await assinarOAuthCookie({ n: "n", cv: "cv", exp: Date.now() - 1 });
    expect(await lerOAuthCookie(cookie)).toBeNull();
  });

  it("assinado com outro segredo → null", async () => {
    const cookie = await signBlob({ n: "n", cv: "cv", exp: daquiAPouco() }, "outro-segredo");
    expect(await lerOAuthCookie(cookie)).toBeNull();
  });

  // O `link` vira `eq(users.id, …)` no google-login: um valor não inteiro
  // chegando lá é query quebrada, ou pior.
  it("campos com tipo errado → null", async () => {
    const exp = daquiAPouco();
    const forjar = (payload: unknown) => signBlob(payload, TEST_SECRET);
    expect(await lerOAuthCookie(await forjar({ n: "n", cv: "cv" }))).toBeNull();
    expect(await lerOAuthCookie(await forjar({ n: "", cv: "cv", exp }))).toBeNull();
    expect(await lerOAuthCookie(await forjar({ n: "n", cv: "cv", exp, link: "7" }))).toBeNull();
    expect(await lerOAuthCookie(await forjar({ n: "n", cv: "cv", exp, link: 1.5 }))).toBeNull();
    expect(await lerOAuthCookie(await forjar({ n: "n", cv: "cv", exp, t: 42 }))).toBeNull();
  });

  it("lixo, vazio e undefined → null", async () => {
    expect(await lerOAuthCookie(undefined)).toBeNull();
    expect(await lerOAuthCookie("")).toBeNull();
    expect(await lerOAuthCookie("sem-ponto")).toBeNull();
    expect(await lerOAuthCookie("a.b")).toBeNull();
  });
});

describe("state da URL", () => {
  it("round-trip preserva o nonce", async () => {
    const state = { n: gerarNonce(), exp: daquiAPouco() };
    expect(await lerOAuthState(await assinarOAuthState(state))).toEqual(state);
  });

  // O state passa pelo navegador e pelos logs do Google. Se um dia alguém
  // guardar o convite aqui em vez do cookie, este teste cai junto.
  it("não carrega nada além de nonce e prazo", async () => {
    const assinado = await signBlob(
      { n: "n", exp: daquiAPouco(), t: "convite-vazado" },
      TEST_SECRET,
    );
    expect(await lerOAuthState(assinado)).toEqual({ n: "n", exp: expect.any(Number) });
  });

  it("expirado ou adulterado → null", async () => {
    expect(await lerOAuthState(await assinarOAuthState({ n: "n", exp: Date.now() - 1 }))).toBeNull();
    const valido = await assinarOAuthState({ n: "n", exp: daquiAPouco() });
    expect(await lerOAuthState(valido.slice(0, -1) + "0")).toBeNull();
  });
});

describe("destinoSeguro", () => {
  it("aceita caminho interno", () => {
    expect(destinoSeguro("/perfil")).toBe("/perfil");
    expect(destinoSeguro("/pelada/3/gerenciar")).toBe("/pelada/3/gerenciar");
  });

  // "//evil.com" é URL protocol-relative: um teste que só olhasse a primeira
  // barra mandaria o jogador para fora do site logo depois do login.
  it("recusa destino externo e vazio", () => {
    expect(destinoSeguro("//evil.com")).toBe("/");
    expect(destinoSeguro("https://evil.com")).toBe("/");
    expect(destinoSeguro("")).toBe("/");
    expect(destinoSeguro(null)).toBe("/");
    expect(destinoSeguro(undefined)).toBe("/");
  });
});

describe("gerarNonce", () => {
  it("não repete", () => {
    expect(gerarNonce()).not.toBe(gerarNonce());
  });
});
