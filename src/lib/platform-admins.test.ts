import { describe, expect, it } from "vitest";
import { parsePlatformAdmins } from "./platform-admins";

describe("parsePlatformAdmins", () => {
  it("sem a env var, ninguém é admin por ambiente", () => {
    expect(parsePlatformAdmins(undefined).size).toBe(0);
    expect(parsePlatformAdmins("").size).toBe(0);
  });

  it("um username só", () => {
    expect([...parsePlatformAdmins("vitor")]).toEqual(["vitor"]);
  });

  it("lista separada por vírgula, com espaços à vontade", () => {
    expect([...parsePlatformAdmins(" vitor , du,  ps ")]).toEqual(["vitor", "du", "ps"]);
  });

  // O username no banco é sempre minúsculo (usernameSchema normaliza no login e
  // no resgate do convite). Sem esta normalização, um "Vitor" na env var da
  // Vercel nunca casaria — e a chave-mestra falharia calada, justamente quando
  // ela é a única forma de voltar para dentro.
  it("normaliza maiúsculas", () => {
    expect([...parsePlatformAdmins("Vitor,DU")]).toEqual(["vitor", "du"]);
  });

  it("ignora entradas vazias de vírgula sobrando", () => {
    expect([...parsePlatformAdmins("vitor,,du,")]).toEqual(["vitor", "du"]);
    expect(parsePlatformAdmins(",  ,").size).toBe(0);
  });
});
