// Guarda-corpo do E2E: a ausência de RESEND_API_KEY é o único kill switch do
// envio real de e-mail (src/lib/email-envio.ts). Com a key no ambiente, um
// smoke que cadastra jogador com e-mail mandaria e-mail DE VERDADE do domínio
// verificado. Falha o run inteiro antes de abrir qualquer browser.
//
// Preparar o banco NÃO cabe aqui: o webServer do Playwright sobe antes do
// globalSetup, então o `next start` chegaria a um banco inexistente. Mora em
// src/db/preparar-e2e.ts, que é o primeiro passo do comando do webServer.

export default function globalSetup(): void {
  if (process.env.RESEND_API_KEY) {
    throw new Error(
      "RESEND_API_KEY está definida no ambiente do E2E. Remova-a — os smokes " +
        "assumem envio de e-mail desligado (e a UI sem os botões de reenvio).",
    );
  }
  // Mesmo contrato para o push. As DUAS chaves, e a pública em primeiro lugar:
  // ela é NEXT_PUBLIC_*, ou seja, embutida no `next build` que o webServer roda
  // — e o webServer só sobrescreve DATABASE_URL, então o .env do dev entra
  // inteiro. Sem esta trava, quem seguiu o .env.example para testar push local
  // via um `toBeHidden()` falhar sem nenhuma pista do motivo (e o kill switch
  // desligado na suíte que também gateia o deploy).
  if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PRIVATE_KEY) {
    throw new Error(
      "Chave VAPID definida no ambiente do E2E. Remova-a — os smokes assumem " +
        "push desligado (a UI de avisos some inteira sem a chave pública no build).",
    );
  }
}
