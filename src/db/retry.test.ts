import { describe, expect, it } from "vitest";
import { comRetentativa, ehErroDeConexao, ehLeitura } from "./retry";

// O que se protege aqui é o par de decisões que autoriza reexecutar um
// statement. Um falso positivo em qualquer uma delas repete uma escrita que o
// servidor já aplicou — e o app não tem código de desfazimento para gol, grupo
// ou fut em dobro.

const erroCom = (code: unknown) => Object.assign(new Error("falhou"), { code });

describe("ehErroDeConexao", () => {
  it("aceita os códigos de socket morto do postgres.js", () => {
    for (const code of [
      "CONNECTION_CLOSED",
      "CONNECTION_ENDED",
      "CONNECTION_DESTROYED",
      "ECONNRESET",
      "EPIPE",
    ]) {
      expect(ehErroDeConexao(erroCom(code))).toBe(true);
    }
  });

  // Código do Postgres é resposta do servidor: a conexão está viva e repetir só
  // repetiria a recusa. `23505` é a unique violando — a que mais aparece aqui.
  it("recusa erro com SQLSTATE do Postgres", () => {
    expect(ehErroDeConexao(erroCom("23505"))).toBe(false);
    expect(ehErroDeConexao(erroCom("42P01"))).toBe(false);
  });

  // O timeout de conexão fica de fora de propósito: com connect_timeout de 30s
  // (ver ./index.ts) retentar dobraria a espera dentro do teto da função.
  it("recusa o timeout de conexão", () => {
    expect(ehErroDeConexao(erroCom("CONNECTION_CONNECT_TIMEOUT"))).toBe(false);
  });

  it("recusa qualquer coisa sem `code` string", () => {
    expect(ehErroDeConexao(new Error("sem code"))).toBe(false);
    expect(ehErroDeConexao(erroCom(undefined))).toBe(false);
    expect(ehErroDeConexao(erroCom(500))).toBe(false);
    expect(ehErroDeConexao(null)).toBe(false);
    expect(ehErroDeConexao(undefined)).toBe(false);
    expect(ehErroDeConexao("ECONNRESET")).toBe(false);
  });
});

describe("ehLeitura", () => {
  it("reconhece o select que o drizzle gera, com espaço ou quebra na frente", () => {
    expect(ehLeitura('select "id" from "players"')).toBe(true);
    expect(ehLeitura('\n  SELECT "id" from "players"')).toBe(true);
    expect(ehLeitura("  select 1")).toBe(true);
  });

  it("recusa toda escrita", () => {
    expect(ehLeitura('insert into "players" ("name") values ($1)')).toBe(false);
    expect(ehLeitura('update "players" set "skill" = $1')).toBe(false);
    expect(ehLeitura('delete from "players" where "id" = $1')).toBe(false);
    expect(ehLeitura('insert into "goals" ("id") values ($1) returning "id"')).toBe(false);
  });

  // Um CTE pode ter insert dentro, e a string começa por `with`. Fora.
  it("recusa CTE, mesmo terminando em select", () => {
    expect(ehLeitura('with novos as (insert into "goals" ... returning *) select * from novos')).toBe(
      false,
    );
  });

  // `selection` não é `select`: sem o \b, o prefixo casaria.
  it("exige a palavra inteira", () => {
    expect(ehLeitura("selecting")).toBe(false);
    expect(ehLeitura("selection from x")).toBe(false);
  });
});

describe("comRetentativa", () => {
  it("não repete o que deu certo de primeira", async () => {
    let chamadas = 0;
    const valor = await comRetentativa(async () => {
      chamadas += 1;
      return "ok";
    });
    expect(valor).toBe("ok");
    expect(chamadas).toBe(1);
  });

  it("repete uma vez em erro de conexão e devolve o resultado da segunda", async () => {
    let chamadas = 0;
    const valor = await comRetentativa(async () => {
      chamadas += 1;
      if (chamadas === 1) throw erroCom("CONNECTION_CLOSED");
      return "ok";
    });
    expect(valor).toBe("ok");
    expect(chamadas).toBe(2);
  });

  // Uma, e só uma: um socket que cai duas vezes seguidas é o banco fora do ar,
  // e insistir só empurra a falha para o teto da função.
  it("propaga a falha da segunda tentativa sem tentar uma terceira", async () => {
    let chamadas = 0;
    await expect(
      comRetentativa(async () => {
        chamadas += 1;
        throw erroCom("ECONNRESET");
      }),
    ).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(chamadas).toBe(2);
  });

  it("não repete erro que não é de conexão", async () => {
    let chamadas = 0;
    await expect(
      comRetentativa(async () => {
        chamadas += 1;
        throw erroCom("23505");
      }),
    ).rejects.toMatchObject({ code: "23505" });
    expect(chamadas).toBe(1);
  });
});
