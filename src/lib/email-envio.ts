// Transporte de email — a única peça do projeto que fala com o Resend.
//
// Família `email-*`: este é o transporte, `email-modelos.ts` monta o conteúdo e
// `email-convite.ts` orquestra os dois com o banco. (`email.ts`, sem hífen, é
// outra coisa: canoniza endereço para comparação.)
//
// Fetch cru em vez do SDK pelo mesmo motivo do OAuth (ver google-oauth.ts): é um
// POST e um parse de status, e o SDK só embrulharia isso ao custo de uma
// dependência. Sem `server-only` seguindo o mesmo precedente — a parte que
// merece teste (`classificarStatusResend`) é pura, e o vitest aqui roda sem
// config e sem alias.
//
// Free tier do Resend: 3.000 emails/mês, 100/dia. Estourou, o 429 vira "limite"
// e a action traduz em "copie o link e mande no WhatsApp". Sem retry e sem fila
// de propósito: fila exigiria estado compartilhado entre instâncias, e o projeto
// recusa isso para continuar custando R$ 0 (ver README) — o fallback do WhatsApp
// já existe e sempre funciona.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Segura a lentidão do outro lado sem prender a action para sempre; o pior caso
// soma com o resto da request dentro do maxDuration = 60 do layout.
const TIMEOUT_ENVIO_MS = 10_000;

/** O que um template produz. `texto` é a alternativa sem HTML — cliente que só mostra texto. */
export type EmailPronto = { assunto: string; html: string; texto: string };

export type ResultadoEnvio =
  | { ok: true }
  | { ok: false; motivo: "nao-configurado" | "limite" | "recusado" | "indisponivel" };

/**
 * Para a UI esconder os botões de envio em ambiente sem key (preview, dev de
 * outra pessoa) — espelho do googleLoginConfigurado. Sem key, criar convite
 * continua funcionando e o link segue entregável no WhatsApp.
 */
export function emailConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// O remetente precisa ser do domínio verificado no Resend. A env var existe para
// testar antes da verificação terminar (onboarding@resend.dev) ou trocar o nome
// exibido — no dia a dia o default basta e é uma env var a menos na Vercel.
//
// Interno: só `enviarEmail` monta payload de Resend, e é aqui.
function emailFrom(): string {
  return process.env.EMAIL_FROM || "FutZenha <convite@futzenha.com.br>";
}

/**
 * O contrato de status do Resend, isolado para teste.
 *
 * 429 cobre o rate limit e a cota diária — dos dois o admin sai do mesmo jeito:
 * manda o link no WhatsApp e amanhã volta. Os demais 4xx são configuração ou
 * payload errados (key inválida, domínio não verificado, endereço malformado);
 * é bug nosso, não do usuário — por isso um motivo separado, que a action
 * reporta genericamente enquanto o log guarda o corpo da resposta.
 *
 * 3xx cai em "indisponivel" junto com o 5xx: o `fetch` já segue redirect
 * sozinho, então um 3xx que chega aqui é o endpoint tendo mudado de lugar —
 * nada que o admin resolva, e o WhatsApp segue como saída.
 */
export function classificarStatusResend(status: number): ResultadoEnvio {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 429) return { ok: false, motivo: "limite" };
  if (status >= 400 && status < 500) return { ok: false, motivo: "recusado" };
  return { ok: false, motivo: "indisponivel" };
}

/**
 * Envia um email. **Nunca lança**: falha de email não pode derrubar a action que
 * a causou — o convite já está criado e o link continua entregável na mão. Quem
 * chama decide o que fazer com o motivo.
 */
export async function enviarEmail(msg: { para: string } & EmailPronto): Promise<ResultadoEnvio> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, motivo: "nao-configurado" };

  let resposta: Response;
  try {
    resposta = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: emailFrom(),
        to: [msg.para],
        subject: msg.assunto,
        html: msg.html,
        text: msg.texto,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
    });
  } catch (erro) {
    // Timeout e falha de rede caem aqui — para quem clicou, o mesmo que um 5xx.
    console.error("[email-envio] envio não chegou ao Resend:", erro);
    return { ok: false, motivo: "indisponivel" };
  }

  const resultado = classificarStatusResend(resposta.status);
  if (!resultado.ok) {
    // O corpo da resposta diz o porquê (key, domínio, payload). A key não é logada.
    const corpo = await resposta.text().catch(() => "");
    console.error("[email-envio] Resend recusou o envio:", resposta.status, corpo);
  }
  return resultado;
}
