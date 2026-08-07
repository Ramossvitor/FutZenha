import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Estrelas } from "@/components/ui/estrelas";
import { Field, Input } from "@/components/ui/field";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { PendingButton } from "@/components/ui/pending-button";
import { Prazo } from "@/components/ui/prazo";
import { db } from "@/db";
import { matchDays, ratingRoundRaters, ratingRounds, users } from "@/db/schema";
import { cx } from "@/lib/cx";
import { formatDate } from "@/lib/format";
import { getContextoDaDenuncia, getDenunciasAbertas } from "@/lib/reports";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { apurarAgora, julgarDenuncia } from "./actions";

export const metadata = { title: "Avaliações" };

export default async function AdminAvaliacoesPage() {
  const session = await requirePlatformAdmin();
  const [denuncias, rodadas] = await Promise.all([
    getDenunciasAbertas(session.player.id),
    db
      .select({
        id: ratingRounds.id,
        status: ratingRounds.status,
        matchDayId: ratingRounds.matchDayId,
        matchDayDate: matchDays.date,
        total: sql<number>`count(${ratingRoundRaters.playerId})::int`,
        pendentes: sql<number>`count(*) filter (
          where ${ratingRoundRaters.submittedAt} is null and ${users.active}
        )::int`,
        horasRestantes: sql<number>`greatest(0, ceil(extract(epoch from (
          ${ratingRounds.deadlineAt} - now()
        )) / 3600)::int)`,
      })
      .from(ratingRounds)
      .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
      .leftJoin(ratingRoundRaters, eq(ratingRoundRaters.roundId, ratingRounds.id))
      .leftJoin(users, eq(ratingRoundRaters.userId, users.id))
      .groupBy(ratingRounds.id, matchDays.date, matchDays.id)
      .orderBy(asc(ratingRounds.status), desc(matchDays.date))
      .limit(20),
  ]);

  // O contexto de cada denúncia: todas as notas que a pessoa recebeu naquela
  // rodada, para o admin não decidir olhando só a nota reclamada.
  const contextos = await Promise.all(
    denuncias.map((d) =>
      getContextoDaDenuncia(d.roundId, d.reporterPlayerId, d.ratingId, session.player.id),
    ),
  );

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Avaliações"
        descricao="As rodadas em andamento e as denúncias de nota injusta que dependem de julgamento."
      />

      <Section
        titulo="Denúncias abertas"
        acao={
          <span className="font-display text-[11px] font-bold tracking-[.08em] text-fg-4 uppercase">
            {denuncias.length}
          </span>
        }
      >
        {denuncias.length === 0 ? (
          <EmptyState
            titulo="Nada para julgar"
            descricao="Quando alguém contestar uma nota, ela aparece aqui com prazo de 3 dias."
          />
        ) : (
          denuncias.map((d, i) => {
            const contexto = contextos[i];
            return (
              <Card key={d.reportId} className="border-warn-line">
                <CardHeader className="border-warn-line bg-warn-tint">
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[14px] font-bold text-fg">
                      {d.reporterName}
                    </span>
                    <span className="block text-[12px] text-fg-3 capitalize">
                      {formatDate(d.matchDayDate)}
                    </span>
                  </span>
                  <Prazo horas={d.horasParaResponder} prefixo="responder" />
                </CardHeader>

                <CardBody className="flex flex-col gap-3">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
                    Contesta a nota de
                    <Estrelas valor={d.starsDenunciada} />
                    <span>({d.starsDenunciada} de 5)</span>
                    {d.raterName && (
                      <span>
                        dada por <strong className="text-fg">{d.raterName}</strong>
                      </span>
                    )}
                  </p>

                  <div>
                    <p className="mb-1 text-[12px] text-fg-4">
                      Todas as notas que ela recebeu nessa pelada:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {contexto.map((c, j) => (
                        <span
                          key={j}
                          className={cx(
                            "inline-flex items-center gap-1 rounded-selo border px-1.5 py-0.5 font-display text-[11.5px] font-bold",
                            c.reclamada
                              ? "border-warn-line bg-warn-tint text-warn-ink"
                              : c.descartada
                                ? "border-line bg-surface-2 text-fg-dim line-through"
                                : "border-line bg-surface-2 text-fg-2",
                          )}
                        >
                          {c.stars}/5{c.raterName && ` · ${c.raterName}`}
                          {c.reclamada && " · reclamada"}
                        </span>
                      ))}
                    </div>
                  </div>

                  <p className="text-[12px] leading-[1.45] text-fg-4">
                    {d.podeJulgar
                      ? "Os nomes de quem avaliou aparecem só aqui: entre jogadores a nota continua anônima."
                      : "Você jogou esta pelada, então não julga esta denúncia e não vê quem avaliou. Outro admin decide — ou o prazo vence e ela é aceita automaticamente."}
                  </p>

                  {d.reason && (
                    <p className="rounded-ctl bg-surface-2 px-3 py-2 text-[13px] leading-[1.5] text-fg-2">
                      “{d.reason}”
                    </p>
                  )}

                  {d.podeJulgar && (
                    /* Um formulário só, com a decisão no `value` do botão: com
                       dois formulários, o campo de observação pertencia a um
                       deles e era perdido em silêncio no outro. */
                    <form
                      action={julgarDenuncia.bind(null, d.reportId)}
                      className="flex flex-col gap-3 border-t border-line pt-3"
                    >
                      <Field
                        htmlFor={`nota-${d.reportId}`}
                        label="Observação"
                        ajuda="Opcional. Fica no registro da denúncia, seja qual for a decisão."
                      >
                        <Input
                          id={`nota-${d.reportId}`}
                          name="adminNote"
                          maxLength={500}
                          placeholder="O que pesou na decisão"
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        {/* Descartar recalcula a nota de todo mundo desta
                            pelada em diante: não tem desfazer. */}
                        <PendingButton
                          name="decisao"
                          value="aceitar"
                          variante="danger"
                          labelPending="Descartando…"
                        >
                          Descartar a nota
                        </PendingButton>
                        {/* Também PendingButton: useFormStatus tem escopo de
                            formulário, então com um Button cru este aqui
                            continuava clicável enquanto o descarte estava em
                            voo — e reenviava o mesmo form com a decisão
                            oposta. */}
                        <PendingButton
                          name="decisao"
                          value="rejeitar"
                          variante="secondary"
                          labelPending="Registrando…"
                        >
                          Manter — foi justa
                        </PendingButton>
                      </div>
                      <p className="text-[12px] leading-[1.45] text-fg-4">
                        Descartar recalcula a nota de todo mundo desta pelada em diante. Sem
                        resposta em {d.horasParaResponder}h, a denúncia é aceita automaticamente.
                      </p>
                    </form>
                  )}
                </CardBody>
              </Card>
            );
          })
        )}
      </Section>

      <Section titulo="Rodadas">
        <HairlineList
          as="ul"
          vazio={
            <EmptyState
              titulo="Nenhuma rodada ainda"
              descricao="Encerrar uma pelada abre a primeira."
            />
          }
        >
          {rodadas.map((r) => (
            <HairlineRow as="li" key={r.id}>
              <Link
                href={`/pelada/${r.matchDayId}/gerenciar`}
                className="font-display text-[14px] font-bold text-fg capitalize hover:underline"
              >
                {formatDate(r.matchDayDate)}
              </Link>
              <Badge tom={r.status === "open" ? "warn" : "neutral"}>
                {r.status === "open" ? "aberta" : r.status === "closed" ? "apurada" : "cancelada"}
              </Badge>
              <span className="text-[12.5px] text-fg-3">
                {r.total - r.pendentes} de {r.total} avaliaram
              </span>
              {r.status === "open" && <Prazo horas={r.horasRestantes} />}
              {r.status === "open" && (
                <form action={apurarAgora.bind(null, r.id)} className="ml-auto">
                  <SubmitButton variante="secondary" tamanho="sm">
                    Apurar agora
                  </SubmitButton>
                </form>
              )}
            </HairlineRow>
          ))}
        </HairlineList>
      </Section>
    </div>
  );
}
