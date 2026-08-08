import { redirect } from "next/navigation";
import type { ResultadoEnvioDeConvite } from "@/lib/email-convite";

/**
 * O resultado do envio de email vira banner. Uma cópia só, porque o mapa de
 * motivo → slug é regra e não rota: /admin/jogadores e /pelada/[id]/gerenciar
 * precisam dizer a mesma coisa, e duas cópias divergiriam na primeira mudança.
 *
 * Mora em src/app, e não em src/lib, porque os slugs precisam ficar literais
 * aqui: o teste de cobertura (src/lib/mensagens.test.ts) varre só src/app por
 * regex atrás deles, e slug montado em variável seria invisível para ele.
 */
export function redirectPosEnvio(base: string, envio: ResultadoEnvioDeConvite): never {
  if (envio.ok) redirect(`${base}?ok=convite-enviado-por-email`);

  const motivo = envio.motivo;
  if (motivo === "limite") redirect(`${base}?erro=email-limite`);
  if (motivo === "envio-recente") redirect(`${base}?erro=email-recente`);
  if (motivo === "convite-inelegivel") redirect(`${base}?erro=convite-nao-reenviavel`);
  // Sem key do Resend (preview, dev) não houve promessa de email — segue o fluxo
  // de sempre, sem banner.
  if (motivo === "nao-configurado") redirect(base);
  if (motivo === "falha") redirect(`${base}?erro=email-nao-enviado`);

  // Inalcançável hoje, e é para o TypeScript: um motivo novo em
  // ResultadoEnvioDeConvite tira o `never` daqui e quebra o build, em vez de
  // cair calado no banner genérico de falha.
  const naoTratado: never = motivo;
  throw new Error(`motivo de envio não tratado: ${String(naoTratado)}`);
}
