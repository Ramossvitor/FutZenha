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
}
