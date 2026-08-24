import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { retomarResumosPendentes } from "@/lib/email-resumo";
import { processarPendencias } from "@/lib/pendencias";
import { despacharPush } from "@/lib/push-envio";
import { processarRecargas } from "@/lib/recarga";
import { segredoConfere } from "@/lib/segredo";

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
  // A recarga fica por ÚLTIMO, e por FORA da transação das pendências: é a única
  // etapa que fala HTTP com terceiro, e a única que pode demorar por culpa de
  // alguém de fora. Vindo antes, um Mercado Pago degradado gastaria o
  // `maxDuration` da rota em timeouts e o push e os resumos — que não têm nada
  // com pagamento — não rodariam naquele disparo. Aqui, o pior caso é a recarga
  // ser cortada no meio, e ela retoma sozinha no próximo ciclo.
  //
  // O aviso de recarga confirmada, portanto, sai no push do disparo SEGUINTE.
  // É o preço aceito: o caminho feliz da recarga é o webhook mais o vigia da
  // tela, e este cron é a rede de segurança da rede de segurança.
  const recargas = await processarRecargas();
  return NextResponse.json({ ...resultado, recargas, push, resumos });
}
