// Setup do projeto "integration" do vitest (ver vitest.config.mts). Roda uma
// vez por arquivo de teste, antes dos imports dos módulos sob teste — é aqui
// que os módulos de servidor ganham um ambiente Next fake e o banco fica limpo
// entre um teste e outro.

import { afterAll, beforeEach, vi } from "vitest";
import { flushAfter } from "./after-flush";
import { cookieJar } from "./cookie-store";
import { limparBanco } from "./limpar-banco";

// A ausência de RESEND_API_KEY é o ÚNICO kill switch do envio real de e-mail
// (src/lib/email-envio.ts): com a key de um .env local vazando para cá, um
// teste de convite mandaria e-mail de verdade do domínio verificado e queimaria
// a cota diária. Testes que exercitam o envio usam vi.stubEnv com key FAKE e
// fetch stubado — nunca a key real.
if (process.env.RESEND_API_KEY) {
  throw new Error(
    "RESEND_API_KEY está definida no ambiente de teste. Remova-a antes de rodar " +
      "a integração — com ela os testes enviariam e-mail de verdade.",
  );
}

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("./cookie-store");
  return {
    cookies: async () => cookieJar,
    headers: async () => new Headers(),
  };
});

vi.mock("next/navigation", async () => {
  const fake = await import("./navigation-fake");
  return {
    redirect: fake.redirect,
    permanentRedirect: fake.permanentRedirect,
    notFound: fake.notFound,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/server", async () => {
  const { registrarAfter } = await import("./after-flush");
  return {
    // Como no Next real, erro dentro do after() não derruba a action — mas aqui
    // o callback roda inline, então o efeito COMEÇA antes de a action retornar
    // (e só termina depois: a promessa fica registrada em after-flush.ts).
    // Teste que depende do efeito consumado — o aviso de grupo por email, por
    // exemplo — chama flushAfter() antes de asserir.
    after: (tarefa: unknown) => {
      try {
        const resultado = typeof tarefa === "function" ? (tarefa as () => unknown)() : tarefa;
        const promessa = Promise.resolve(resultado);
        void promessa.catch(() => {});
        registrarAfter(promessa);
      } catch {
        // após a resposta, erros não propagam
      }
    },
  };
});

beforeEach(async () => {
  cookieJar.limpar();
  // Drena antes de truncar: um after() que o teste anterior não esperou ainda
  // pode estar escrevendo, e a escrita chegaria depois do limparBanco() abaixo.
  await flushAfter();
  vi.clearAllMocks();
  // Nenhum teste de integração pode deixar HTTP real vazar (Resend, Google).
  // Quem precisa de fetch stuba o seu por cima com vi.stubGlobal/mockImplementation.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error(
        "fetch real bloqueado nos testes de integração — stube com vi.stubGlobal(\"fetch\", ...).",
      );
    }),
  );
  await limparBanco();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  // Sem fechar o pool, o idle_timeout de 20s do postgres.js segura o processo
  // do vitest aberto ao fim de cada arquivo.
  const { db } = await import("@/db");
  await db.$client.end({ timeout: 5 });
});
