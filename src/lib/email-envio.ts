// Transporte de email — a única peça do projeto que fala com o Resend.
//
// Família `email-*`: este é o transporte, `email-modelos.ts` monta o conteúdo e
// `email-convite.ts` orquestra os dois com o banco. (`email.ts`, sem hífen, é
// outra coisa: canoniza endereço para comparação.)
//
// Fetch cru em vez do SDK pelo mesmo motivo do OAuth (ver google-oauth.ts): é um
// POST e um parse de status, e o SDK só embrulharia isso ao custo de uma
// dependência. Sem `server-only` seguindo o mesmo precedente — a parte que
// merece teste (`classificarRespostaResend`, `esperaAposRajada`) é pura, e o
// vitest aqui roda sem config e sem alias.
//
// Free tier do Resend: 3.000 emails/mês, 100/dia e ~2 requisições/segundo.
// Cota estourada vira "limite" e a action traduz em "copie o link e mande no
// WhatsApp" — sem retry, amanhã volta. Já a rajada (dois cliques de convite no
// mesmo segundo) é passageira por definição, então SÓ ela ganha retentativa:
// curta, com teto de tentativas e respeitando o retry-after. Timeout, rede e
// 5xx continuam sem retry (retentar um timeout de 10s triplicaria a espera), e
// segue sem fila/outbox: fila exigiria estado compartilhado entre instâncias, e
// o projeto recusa isso para continuar custando R$ 0 (ver README) — o fallback
// do WhatsApp já existe e sempre funciona.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Segura a lentidão do outro lado sem prender a action para sempre; o pior caso
// (duas rajadas + esperas capadas + última tentativa estourando o timeout) fica
// em ~21s, dentro do maxDuration = 60 do layout. O timeout NUNCA dispara nova
// tentativa — quem repete é só a resposta rápida de 429 de rajada, e o controle
// do laço é o contador de tentativas, não o relógio.
const TIMEOUT_ENVIO_MS = 10_000;
const MAX_TENTATIVAS = 3;
const ESPERA_BASE_MS = 1_000;
const ESPERA_MAXIMA_MS = 5_000;
const JITTER_MAXIMO_MS = 250;

/** O que um template produz. `texto` é a alternativa sem HTML — cliente que só mostra texto. */
export type EmailPronto = { assunto: string; html: string; texto: string };

export type ResultadoEnvio =
  | { ok: true }
  | { ok: false; motivo: "nao-configurado" | "limite" | "rajada" | "recusado" | "indisponivel" };

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

// O corpo de erro do Resend é `{ name, message, statusCode }` (ver
// resend.com/docs/api-reference/errors). Corpo ilegível devolve null e o
// classificador assume o caso terminal — melhor deixar de retentar uma rajada
// do que martelar uma cota estourada.
function nomeDoErroResend(corpo: string): string | null {
  try {
    const json: unknown = JSON.parse(corpo);
    if (json && typeof json === "object" && "name" in json && typeof json.name === "string") {
      return json.name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * O contrato de status do Resend, isolado para teste.
 *
 * O 429 se divide pelo `name` do corpo: `rate_limit_exceeded` é rajada
 * (requisições/segundo — passageira, retryável), qualquer outro nome ou corpo
 * ilegível é cota diária/mensal ("limite" — terminal, amanhã volta). Os demais
 * 4xx são configuração ou payload errados (key inválida, domínio não
 * verificado, endereço malformado); é bug nosso, não do usuário — por isso um
 * motivo separado, que a action reporta genericamente enquanto o log guarda o
 * corpo da resposta.
 *
 * 3xx cai em "indisponivel" junto com o 5xx: o `fetch` já segue redirect
 * sozinho, então um 3xx que chega aqui é o endpoint tendo mudado de lugar —
 * nada que o admin resolva, e o WhatsApp segue como saída.
 */
export function classificarRespostaResend(status: number, corpo: string): ResultadoEnvio {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 429) {
    const motivo = nomeDoErroResend(corpo) === "rate_limit_exceeded" ? "rajada" : "limite";
    return { ok: false, motivo };
  }
  if (status >= 400 && status < 500) return { ok: false, motivo: "recusado" };
  return { ok: false, motivo: "indisponivel" };
}

/**
 * Quanto esperar antes de retentar uma rajada. Puro, isolado para teste.
 *
 * O retry-after do Resend (em segundos) manda quando presente, capado em 5s —
 * um valor alto ali é sinal de cota, não de rajada, e não vale prender a
 * request. Sem o header, 1s × tentativa. O jitter de até 250ms dessincroniza
 * `after()`s que nasceram da mesma sequência de cliques e retentariam juntos.
 */
export function esperaAposRajada(tentativa: number, retryAfterSegundos: number | null): number {
  const base =
    retryAfterSegundos !== null
      ? Math.min(retryAfterSegundos * 1000, ESPERA_MAXIMA_MS)
      : ESPERA_BASE_MS * tentativa;
  return base + Math.floor(Math.random() * (JITTER_MAXIMO_MS + 1));
}

// Header em segundos; ausente ou ilegível vira null e a espera usa o degrau
// por tentativa.
function retryAfterDaResposta(resposta: Response): number | null {
  const bruto = resposta.headers.get("retry-after");
  if (bruto === null) return null;
  const segundos = Number.parseInt(bruto, 10);
  return Number.isFinite(segundos) && segundos >= 0 ? segundos : null;
}

/**
 * Envia um email. **Nunca lança**: falha de email não pode derrubar a action que
 * a causou — o convite já está criado e o link continua entregável na mão. Quem
 * chama decide o que fazer com o motivo.
 */
export async function enviarEmail(msg: { para: string } & EmailPronto): Promise<ResultadoEnvio> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, motivo: "nao-configurado" };

  for (let tentativa = 1; ; tentativa++) {
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
      // Timeout e falha de rede caem aqui — para quem clicou, o mesmo que um
      // 5xx, e encerram o laço na hora: retry é só para rajada confirmada.
      console.error("[email-envio] envio não chegou ao Resend:", erro);
      return { ok: false, motivo: "indisponivel" };
    }

    // O corpo da resposta diz o porquê (key, domínio, payload — e o `name` que
    // separa rajada de cota). A key não é logada. Lido sempre, inclusive no
    // sucesso: quem decide a faixa de status é `classificarRespostaResend`, e
    // repetir o teste de 2xx aqui daria duas definições de "enviado".
    const corpo = await resposta.text().catch(() => "");
    const resultado = classificarRespostaResend(resposta.status, corpo);
    if (resultado.ok) return resultado;

    if (resultado.motivo === "rajada" && tentativa < MAX_TENTATIVAS) {
      const espera = esperaAposRajada(tentativa, retryAfterDaResposta(resposta));
      console.warn(
        `[email-envio] rajada no Resend (tentativa ${tentativa} de ${MAX_TENTATIVAS}), nova tentativa em ${espera}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, espera));
      continue;
    }

    console.error("[email-envio] Resend recusou o envio:", resposta.status, corpo);
    return resultado;
  }
}
