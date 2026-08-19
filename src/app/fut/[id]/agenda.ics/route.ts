import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matchDays } from "@/db/schema";
import { icsParaBaixar } from "@/lib/agenda";
import { siteUrl } from "@/lib/site-url";

// O download do .ics do fut, para quem não usa Google nem Outlook.
//
// Existe como rota, e não como `data:` URI no href do botão, porque o Safari do
// iPhone ignora o atributo `download` em `data:` e abre o arquivo como texto na
// tela — justamente o cliente que o botão "Apple e outros" atende. Com
// Content-Disposition o iOS oferece "Adicionar ao Calendário". De quebra, o
// .ics deixa de viajar dentro do HTML de toda visita à página do fut.
//
// Sem login, como a própria /fut/[id]: o proxy só exige sessão em /gerenciar
// (ver src/proxy.ts), e o arquivo não diz nada que a página já não mostre a
// quem abre o link.

// Data, hora e local mudam pela tela de gestão; um .ics cacheado entregaria o
// fut de ontem. A rota não é cacheada por default no Next — a linha existe para
// isso ficar dito, não para mudar o comportamento.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/fut/[id]/agenda.ics">) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return new Response("Not Found", { status: 404 });

  const [fut] = await db.select().from(matchDays).where(eq(matchDays.id, id));
  if (!fut) return new Response("Not Found", { status: 404 });

  return new Response(icsParaBaixar({ fut, urlBase: siteUrl(), agora: new Date() }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="fut-${fut.id}.ics"`,
    },
  });
}
