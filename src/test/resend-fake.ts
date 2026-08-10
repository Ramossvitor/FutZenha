// Fake do Resend para os testes de integração: key fake + fetch stubado.
//
// Mora aqui (e não em cada arquivo de teste) porque quatro suítes exercitam o
// envio — convite de plataforma, aviso de grupo, a action de convidar e o admin
// de jogadores — e o contrato do stub é o mesmo: nunca a key real, nunca rede
// real (o setup de integração já bloqueia fetch por baixo).

import { vi } from "vitest";

type RespostaFake = number | { status: number; corpo?: unknown; headers?: Record<string, string> };

/**
 * Stuba o transporte: cada chamada consome a próxima resposta da lista (a
 * última repete se faltarem). Sem argumentos, responde 200 sempre. Para simular
 * rajada sem deixar o teste lento, use `headers: { "retry-after": "0" }` — a
 * espera do retry fica só no jitter (≤ 250ms).
 */
export function stubResend(...respostas: RespostaFake[]): ReturnType<typeof vi.fn> {
  const lista: RespostaFake[] = respostas.length === 0 ? [200] : respostas;
  let chamada = 0;
  const fetchMock = vi.fn(async () => {
    const proxima = lista[Math.min(chamada, lista.length - 1)];
    chamada += 1;
    const { status, corpo = { id: "x" }, headers = {} } =
      typeof proxima === "number" ? { status: proxima } : proxima;
    return new Response(JSON.stringify(corpo), { status, headers });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test_fake");
  return fetchMock;
}

/** O corpo do primeiro POST ao Resend, para asserir destinatário, assunto e texto. */
export function payloadDoEnvio(fetchMock: ReturnType<typeof vi.fn>): {
  to: string[];
  subject: string;
  text: string;
} {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}
