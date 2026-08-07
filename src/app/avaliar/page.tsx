import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRowLink } from "@/components/ui/hairline-list";
import { IconeSeta } from "@/components/ui/icons";
import { Prazo } from "@/components/ui/prazo";
import { getVotacoesAbertasDoJogador } from "@/lib/deletion";
import { formatDate } from "@/lib/format";
import { getRodadasAbertasDoJogador } from "@/lib/ratings";
import { requirePlayer } from "@/lib/require-player";

export const metadata: Metadata = { title: "Avaliações abertas" };

export default async function AvaliarPage() {
  const session = await requirePlayer();
  const [rodadas, votacoes] = await Promise.all([
    getRodadasAbertasDoJogador(session.player.id),
    getVotacoesAbertasDoJogador(session.player.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Pendências"
        descricao="O que está com prazo correndo e depende de você."
      />

      {votacoes.length > 0 && (
        <Section titulo="Votações abertas">
          <HairlineList as="ul">
            {votacoes.map((v) => (
              <li key={v.voteId}>
                <HairlineRowLink href={`/votacao/${v.voteId}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[14px] font-bold text-fg">
                      Apagar a pelada de <span className="capitalize">{formatDate(v.matchDayDate)}</span>?
                    </span>
                    <span className="block text-[12px] text-fg-4">O voto é definitivo.</span>
                  </span>
                  <Badge tom={v.jaVotei ? "neutral" : "danger"}>
                    {v.jaVotei ? "já votou" : "falta votar"}
                  </Badge>
                  <Prazo horas={v.horasRestantes} />
                  <IconeSeta className="size-4 text-fg-dim" />
                </HairlineRowLink>
              </li>
            ))}
          </HairlineList>
        </Section>
      )}

      <Section titulo="Avaliações">
        <HairlineList
          as="ul"
          vazio={
            <EmptyState
              titulo="Nenhuma avaliação aberta"
              descricao="Depois que uma pelada que você jogou for encerrada, ela aparece aqui com prazo de 2 dias."
            />
          }
        >
          {rodadas.map(({ round, matchDayDate, location, jaEnviou, horasRestantes }) => (
            <li key={round.id}>
              <HairlineRowLink href={`/avaliar/${round.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[14px] font-bold text-fg capitalize">
                    {formatDate(matchDayDate)}
                  </span>
                  <span className="block truncate text-[12px] text-fg-4">{location}</span>
                </span>
                <Badge tom={jaEnviou ? "accent" : "warn"}>
                  {jaEnviou ? "avaliado" : "falta avaliar"}
                </Badge>
                <Prazo horas={horasRestantes} />
                <IconeSeta className="size-4 text-fg-dim" />
              </HairlineRowLink>
            </li>
          ))}
        </HairlineList>
      </Section>
    </div>
  );
}
