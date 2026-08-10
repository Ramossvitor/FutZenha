import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolverUrlDeE2E,
  resolverUrlDeTeste,
  URL_PADRAO_DE_E2E,
  URL_PADRAO_DE_TESTE,
} from "./db-url.mts";

// As travas do db-url.mts são a história inteira de segurança das suítes que
// apagam dados — e são funções puras, então cabem no projeto unit.
//
// Este é o valor que elas existem para recusar. Não é um caso hipotético: o
// erro provável é copiar a DATABASE_URL do .env ao criar a variável de teste, e
// aí o host passa na primeira trava enquanto o banco de dev é apagado.
const URL_DE_DEV = "postgres://futzenha:futzenha@localhost:5433/futzenha";
const URL_REMOTA = "postgres://u:p@ep-qualquer-coisa.neon.tech/futzenha_test";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolverUrlDeTeste (integração)", () => {
  it("sem a env var, cai no futzenha_test do compose", () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    expect(resolverUrlDeTeste()).toBe(URL_PADRAO_DE_TESTE);
  });

  it("aceita outra URL local, desde que termine em _test", () => {
    const url = "postgres://futzenha:futzenha@127.0.0.1:5555/outro_banco_test";
    vi.stubEnv("TEST_DATABASE_URL", url);
    expect(resolverUrlDeTeste()).toBe(url);
  });

  it("recusa a URL do banco de desenvolvimento", () => {
    vi.stubEnv("TEST_DATABASE_URL", URL_DE_DEV);
    expect(() => resolverUrlDeTeste()).toThrow(/precisa terminar em "_test"/);
  });

  it("recusa host remoto mesmo com o sufixo certo", () => {
    vi.stubEnv("TEST_DATABASE_URL", URL_REMOTA);
    expect(() => resolverUrlDeTeste()).toThrow(/só rodam contra localhost/);
  });
});

describe("resolverUrlDeE2E", () => {
  it("sem a env var, cai no futzenha_e2e do compose", () => {
    vi.stubEnv("E2E_DATABASE_URL", undefined);
    expect(resolverUrlDeE2E()).toBe(URL_PADRAO_DE_E2E);
  });

  it("aceita outra URL local, desde que termine em _e2e", () => {
    const url = "postgres://futzenha:futzenha@127.0.0.1:5555/outro_banco_e2e";
    vi.stubEnv("E2E_DATABASE_URL", url);
    expect(resolverUrlDeE2E()).toBe(url);
  });

  it("recusa a URL do banco de desenvolvimento", () => {
    vi.stubEnv("E2E_DATABASE_URL", URL_DE_DEV);
    expect(() => resolverUrlDeE2E()).toThrow(/precisa terminar em "_e2e"/);
  });

  it("recusa host remoto", () => {
    vi.stubEnv("E2E_DATABASE_URL", "postgres://u:p@ep-qualquer-coisa.neon.tech/futzenha_e2e");
    expect(() => resolverUrlDeE2E()).toThrow(/só rodam contra localhost/);
  });

  // O sufixo separa as duas suítes, não só teste de dev: o E2E semeia o banco
  // inteiro, e apontá-lo para o futzenha_test apagaria o banco da integração no
  // meio de um `npm run test:coverage`.
  it("recusa o banco da integração", () => {
    vi.stubEnv("E2E_DATABASE_URL", URL_PADRAO_DE_TESTE);
    expect(() => resolverUrlDeE2E()).toThrow(/precisa terminar em "_e2e"/);
  });
});

describe("os dois bancos juntos", () => {
  it("são diferentes entre si e nenhum é o de desenvolvimento", () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    vi.stubEnv("E2E_DATABASE_URL", undefined);
    const integracao = resolverUrlDeTeste();
    const e2e = resolverUrlDeE2E();
    expect(integracao).not.toBe(e2e);
    expect([integracao, e2e]).not.toContain(URL_DE_DEV);
  });
});
