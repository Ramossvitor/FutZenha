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

/**
 * O corpo do POST `indice` ao Resend, para asserir destinatário, assunto, corpo
 * e anexos.
 *
 * `html` e `text` são os dois corpos que `enviarEmail` sempre manda, e os dois
 * merecem asserção: o texto é o que sobrevive a qualquer cliente, e o html é
 * onde moram os links — um botão que sumisse do html não apareceria em nenhuma
 * asserção sobre o texto.
 */
export function payloadDoEnvio(
  fetchMock: ReturnType<typeof vi.fn>,
  indice = 0,
): {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string; content_type: string }[];
} {
  const [, init] = fetchMock.mock.calls[indice] as [string, RequestInit];
  return JSON.parse(init.body as string);
}
