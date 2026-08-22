import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matchDays } from "@/db/schema";
import { urlGoogleAgenda } from "@/lib/agenda";
import { siteUrl } from "@/lib/site-url";

// O "Adicionar ao Google Agenda" do e-mail, servido pela nossa origem.
//
// O botão apontava direto para calendar.google.com, e o Resend avisa: link de um
// domínio e remetente de outro é sinal que filtro de spam pesa contra. Com esta
// rota o e-mail leva um endereço de futzenha.com.br — o mesmo domínio do `from`
// — e o Google continua sendo o destino, um salto depois.
//
// Nada muda no que o clique faz: `action=TEMPLATE` nunca marcou nada sozinho,
// abre a tela de criação já preenchida. Quem entra na agenda sem clique é o .ics
// anexo ao convite (src/lib/agenda-convite.ts), que este arquivo não toca.
//
// De brinde, o link deixa de congelar data/hora/local no instante do envio: como
// o fut é relido a cada clique, um e-mail de semanas atrás leva para o fut atual.
//
// Só o e-mail passa por aqui. Os botões da página do fut
// (src/components/ui/botoes-de-agenda.tsx) seguem indo direto: filtro de spam não
// olha para a página, e o salto a mais ali só somaria latência.
//
// Irmã da agenda.ics/route.ts ao lado, e pública pelo mesmo motivo: o proxy só
// exige sessão em /fut/[id]/gerenciar (ver src/proxy.ts), e o link do e-mail é
// aberto no celular por quem quase nunca está logado.

// O 302 é temporário de propósito. O 301/308 fica cacheado no browser e na edge
// praticamente para sempre, e o destino muda toda vez que a gestão mexe no
// horário ou no local — é o mesmo raciocínio dos `permanent: false` do
// next.config.ts. O `force-dynamic` é a outra metade: sem ele o fut lido aqui
// poderia vir de cache.
export const dynamic = "force-dynamic";

// GET pode redirecionar sem quebrar a regra de "nenhuma rota deste projeto
// executa ação no GET" (ver src/lib/email-modelos.ts): prefetcher de cliente de
// e-mail e antivírus corporativo abrem link sozinhos, e o que eles encontram
// aqui é uma leitura e um Location — nada que mude estado.
export async function GET(_request: Request, ctx: RouteContext<"/fut/[id]/agenda/google">) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return new Response("Not Found", { status: 404 });

  const [fut] = await db.select().from(matchDays).where(eq(matchDays.id, id));
  if (!fut) return new Response("Not Found", { status: 404 });

  return Response.redirect(urlGoogleAgenda(fut, siteUrl()), 302);
}
