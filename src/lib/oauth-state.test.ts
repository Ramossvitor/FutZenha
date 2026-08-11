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
    process.env.SESSION_SECRET = "outro-segredo";
    const cookie = await assinarOAuthCookie({ n: "n", cv: "cv", exp: daquiAPouco() });
    process.env.SESSION_SECRET = TEST_SECRET;
    expect(await lerOAuthCookie(cookie)).toBeNull();
  });

  // O `link` vira `eq(users.id, …)` no google-login: um valor não inteiro
  // chegando lá é query quebrada, ou pior.
  //
  // Forjado pelo próprio emissor (com o tipo afrouxado) e não pelo signBlob cru:
  // assim o `null` prova que a checagem de forma recusou, e não que o domínio de
  // assinatura não bateu.
  it("campos com tipo errado → null", async () => {
    const exp = daquiAPouco();
    const forjar = (payload: unknown) => assinarOAuthCookie(payload as never);
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
    const assinado = await assinarOAuthState({
      n: "n",
      exp: daquiAPouco(),
      t: "convite-vazado",
    } as never);
    expect(await lerOAuthState(assinado)).toEqual({ n: "n", exp: expect.any(Number) });
  });

  // O cookie tem `n` e `exp` — sozinhos, satisfazem tudo que o lerOAuthState
  // exige. É o domínio de assinatura, e só ele, que os mantém apartados.
  it("um cookie do OAuth não vale como state, nem o contrário", async () => {
    const exp = daquiAPouco();
    const cookie = await assinarOAuthCookie({ n: "n", cv: "cv", exp });
    expect(await lerOAuthState(cookie)).toBeNull();
    expect(await lerOAuthCookie(await assinarOAuthState({ n: "n", exp }))).toBeNull();
  });

  it("expirado ou adulterado → null", async () => {
    expect(await lerOAuthState(await assinarOAuthState({ n: "n", exp: Date.now() - 1 }))).toBeNull();
    const valido = await assinarOAuthState({ n: "n", exp: daquiAPouco() });
    // Trocar o último caractere por "0" fixo não adultera nada quando ele já é
    // "0" — 1 em 16, já que a assinatura é hex.
    const adulterado = valido.slice(0, -1) + (valido.endsWith("0") ? "1" : "0");
    expect(await lerOAuthState(adulterado)).toBeNull();
  });
});

describe("destinoSeguro", () => {
  it("aceita caminho interno", () => {
    expect(destinoSeguro("/perfil")).toBe("/perfil");
    expect(destinoSeguro("/fut/3/gerenciar")).toBe("/fut/3/gerenciar");
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

  // A barra invertida é o "//" disfarçado: o parser de URL a trata como "/" em
  // http(s), então uma checagem que só recusasse "//" deixaria isto passar.
  it("recusa a variante com barra invertida", () => {
    for (const destino of ["/\\evil.com", "/\\\\evil.com", "\\\\evil.com", "\\evil.com"]) {
      expect(destinoSeguro(destino)).toBe("/");
    }
  });

  // O que sai daqui é sempre montado com `new URL(destino, base)` — o teste
  // fecha o ciclo na função que de fato resolve o endereço.
  it("o que passa nunca resolve para outra origem", () => {
    const base = "https://futzenha.app";
    for (const destino of ["/perfil", "//evil.com", "/\\evil.com", "\\\\evil.com", "/a/b?c=1"]) {
      expect(new URL(destinoSeguro(destino), base).origin).toBe(base);
    }
  });
});

describe("gerarNonce", () => {
  it("não repete", () => {
    expect(gerarNonce()).not.toBe(gerarNonce());
  });
});
