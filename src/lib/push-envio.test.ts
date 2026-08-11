import { afterEach, describe, expect, it, vi } from "vitest";
import { assinaturaMorta, chaveRecusada, payloadDePush, pushConfigurado } from "./push-envio";

// Camada unit: nada aqui toca banco. O que precisa de Postgres (claim, lock,
// auto-limpeza) mora no push-envio.integration.test.ts.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pushConfigurado", () => {
  it("exige as DUAS chaves — meia configuração é configuração nenhuma", () => {
    expect(pushConfigurado()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "publica-fake");
    expect(pushConfigurado()).toBe(false);

    vi.stubEnv("VAPID_PRIVATE_KEY", "privada-fake");
    expect(pushConfigurado()).toBe(true);
  });
});

describe("assinaturaMorta / chaveRecusada", () => {
  it("404 e 410 são o device: a linha pode ser apagada", () => {
    expect(assinaturaMorta(404)).toBe(true);
    expect(assinaturaMorta(410)).toBe(true);
  });

  // A separação é o que impede um par de chaves trocado no deploy de zerar a
  // tabela: o 403 chega igual para TODO endpoint.
  it("403 é o remetente, não o device — nunca conta como morta", () => {
    expect(assinaturaMorta(403)).toBe(false);
    expect(chaveRecusada(403)).toBe(true);
  });

  it("erro transitório e erro sem status não apagam nada", () => {
    for (const status of [500, 429, undefined]) {
      expect(assinaturaMorta(status)).toBe(false);
      expect(chaveRecusada(status)).toBe(false);
    }
  });
});

describe("payloadDePush", () => {
  it("preenche os defaults que o sw.js espera", () => {
    expect(JSON.parse(payloadDePush({ title: "Oi", body: null, href: null }))).toEqual({
      title: "Oi",
      body: "",
      href: "/",
    });
  });

  it("passa o corpo normal intacto", () => {
    const { body } = JSON.parse(
      payloadDePush({ title: "Pelada marcada", body: "13/08, em Quadra do Zé", href: "/pelada/7" }),
    );
    expect(body).toBe("13/08, em Quadra do Zé");
  });

  // O corpo sai de campo livre (`location`) e o aviso de pelada avulsa vai para
  // TODA conta ativa: sem isto, qualquer jogador escreve o que quiser — em
  // quantas linhas quiser — na tela de bloqueio de todo mundo.
  it("achata quebras de linha e caracteres de controle num espaço só", () => {
    const { body } = JSON.parse(
      payloadDePush({ title: "x", body: "Quadra\n\ndo\tZé ", href: null }),
    );
    expect(body).toBe("Quadra do Zé");
  });

  it("trunca corpo longo com reticências", () => {
    const { body } = JSON.parse(payloadDePush({ title: "x", body: "a".repeat(500), href: null }));
    expect(body).toHaveLength(120);
    expect(body.endsWith("…")).toBe(true);
  });
});
