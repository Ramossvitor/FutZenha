import Link from "next/link";
import { countDistinct, desc, eq, sql } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/button";
import { db } from "@/db";
import { gamePlayers, games, matchDays, players, ratingRounds, users } from "@/db/schema";
import { formatDate, formatDateShort, formatTime } from "@/lib/format";
import { STATUS_PELADA } from "@/lib/match-day-form";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { excluirPeladaAbusiva } from "./actions";

export const metadata = { title: "Supervisão de peladas" };

const LOCAIS = {
  "motivo-curto": "Escreva o motivo da exclusão (pelo menos 10 caracteres).",
};

export default async function AdminPeladasPage({ searchParams }: PageProps<"/admin/peladas">) {
  await requirePlatformAdmin();
  const { erro, ok } = await searchParams;

  // Uma linha por pelada com o que denuncia fabricação: quem criou, quantos
  // jogaram e — o que mais importa — quantos desses tinham conta, já que é a
  // conta que move a nota.
  const peladas = await db
    .select({
      id: matchDays.id,
      date: matchDays.date,
      startTime: matchDays.startTime,
      location: matchDays.location,
      status: matchDays.status,
      criador: players.name,
      jogaram: countDistinct(gamePlayers.playerId),
      comConta: countDistinct(sql`case when ${users.active} then ${users.playerId} end`),
      temRodada: sql<boolean>`bool_or(${ratingRounds.id} is not null)`,
    })
    .from(matchDays)
    .leftJoin(players, eq(matchDays.createdByPlayerId, players.id))
    .leftJoin(games, eq(games.matchDayId, matchDays.id))
    .leftJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
    .leftJoin(users, eq(users.playerId, gamePlayers.playerId))
    .leftJoin(ratingRounds, eq(ratingRounds.matchDayId, matchDays.id))
    .groupBy(matchDays.id, players.name)
    .orderBy(desc(matchDays.date), desc(matchDays.id));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Supervisão de peladas"
        descricao="Todas as peladas do sistema, de quem as criou. Excluir aqui não passa pela votação do grupo — é para desfazer pelada fabricada."
      />

      <BannerDaQuery erro={erro} ok={ok} locais={LOCAIS} />

      {peladas.length === 0 ? (
        <EmptyState titulo="Nenhuma pelada ainda" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {peladas.map((p) => (
            <Card key={p.id}>
              <CardBody className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/pelada/${p.id}`}
                    className="font-display text-[15px] font-bold text-fg capitalize hover:underline"
                  >
                    {formatDate(p.date)}
                  </Link>
                  <span className="font-display text-[12px] font-semibold text-fg-4" data-num>
                    {formatDateShort(p.date)}
                  </span>
                  <Badge tom="outline" className="ml-auto">
                    {STATUS_PELADA[p.status]}
                  </Badge>
                </div>

                <p className="text-[13px] text-fg-3">
                  {formatTime(p.startTime) && <>{formatTime(p.startTime)} · </>}
                  {p.location}
                </p>

                {/* O que denuncia pelada fabricada: quem criou, quantos jogaram
                    e — o que mais importa — quantos tinham conta, já que é a
                    conta que move a nota. */}
                <p className="text-[13px] text-fg-3">
                  Criada por{" "}
                  <strong className="text-fg-2">{p.criador ?? "— (pelada órfã)"}</strong> ·{" "}
                  {p.jogaram} jogaram,{" "}
                  <strong className="text-fg-2">{p.comConta} com conta ativa</strong>
                  {p.temRodada ? " · gerou avaliação" : " · sem avaliação"}
                </p>

                <details className="mt-2 border-t border-line pt-2">
                  <summary className="cursor-pointer font-display text-[12px] font-bold text-danger-ink">
                    Excluir por abuso
                  </summary>
                  <form
                    action={excluirPeladaAbusiva.bind(null, p.id)}
                    className="mt-2 flex flex-wrap items-end gap-2"
                  >
                    <Field
                      htmlFor={`motivo-${p.id}`}
                      label="Motivo"
                      obrigatorio
                      className="min-w-52 flex-1"
                      ajuda="Fica no log do servidor."
                    >
                      <Input
                        id={`motivo-${p.id}`}
                        name="motivo"
                        required
                        minLength={10}
                        placeholder="Pelada fabricada para inflar nota"
                      />
                    </Field>
                    {/* Apaga a pelada e recalcula a nota de todo mundo do zero:
                        não tem desfazer. */}
                    <SubmitButton variante="danger" labelPending="Excluindo…">
                      Excluir e recalcular
                    </SubmitButton>
                  </form>
                </details>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
