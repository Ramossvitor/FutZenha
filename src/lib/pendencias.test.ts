// O throttle e o furo dele — só a mecânica de agendamento, sem banco: o `after`
// aqui é um vi.fn() inerte, então o callback da varredura nunca roda e nenhuma
// query acontece. O que a varredura FAZ está em pendencias.integration.test.ts.
import { describe, expect, it, vi } from "vitest";

const { after } = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after }));

// Import dinâmico com módulos zerados: `ultimaExecucao` é estado de módulo, e
// cada teste precisa começar com o throttle frio.
async function carregar() {
  vi.resetModules();
  after.mockClear();
  const { agendarProcessamento } = await import("./pendencias");
  return agendarProcessamento;
}

describe("agendarProcessamento", () => {
  it("agenda na primeira chamada e segura a seguinte dentro do intervalo", async () => {
    const agendar = await carregar();
    agendar();
    expect(after).toHaveBeenCalledTimes(1);
    agendar();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("com `forcar` agenda mesmo com o throttle quente", async () => {
    const agendar = await carregar();
    agendar();
    expect(after).toHaveBeenCalledTimes(1);
    agendar(true);
    expect(after).toHaveBeenCalledTimes(2);
  });
});
