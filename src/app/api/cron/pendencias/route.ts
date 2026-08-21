import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { retomarResumosPendentes } from "@/lib/email-resumo";
import { processarPendencias } from "@/lib/pendencias";
import { despacharPush } from "@/lib/push-envio";

// Rede de segurança do varredor de prazos: o gatilho principal é o `after()`
// no layout, que só roda quando alguém acessa o site. Este cron garante que
// uma rodada feche mesmo se ninguém abrir o app por dias.
//
// Atenção: /api/* NÃO passa pelo src/proxy.ts (o matcher cobre só as áreas de
// admin e de jogador). Esta rota se autentica sozinha.
export const dynamic = "force-dynamic";

// Um dia ruim de varredura fecha várias rodadas com replay em cascata — melhor
// declarar o teto do que descobrir o default do plano no meio de uma transação.
export const maxDuration = 60;

// Comparação em tempo constante — o mesmo cuidado que src/lib/auth.ts toma com
// a assinatura do cookie. Um `!==` vazaria o prefixo correto pelo tempo.
function segredoConfere(recebido: string, esperado: string): boolean {
  if (recebido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < recebido.length; i++) {
    diff |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(request: NextRequest) {
  const esperado = process.env.CRON_SECRET;
  // Sem segredo configurado a rota fica fechada. Liberar tudo seria pior.
  if (!esperado) {
    return NextResponse.json(
      { erro: "CRON_SECRET não configurado no ambiente." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const prefixo = "Bearer ";
  if (!header.startsWith(prefixo) || !segredoConfere(header.slice(prefixo.length), esperado)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const resultado = await processarPendencias();
  // Depois das pendências, de propósito: fechar rodada e resolver votação
  // geram notificações, e despachar em seguida as entrega no mesmo disparo.
  const push = await despacharPush();
  // A rede de segurança do e-mail de resumo: completa quem ficou de fora de um
  // lote cortado no meio, e reaproveita a cota renovada para o fut que foi
  // recusado inteiro ontem. Idempotente — quem já recebeu não recebe de novo.
  const resumos = await retomarResumosPendentes();
  return NextResponse.json({ ...resultado, push, resumos });
}
