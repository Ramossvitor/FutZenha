import { asc, isNull, sql } from "drizzle-orm";
import { BannerDaQuery } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { createPlayer, setPlayerActive } from "./actions";
import { CamposDoJogador, LinhaDoJogador } from "./jogador";

const LOCAIS = {
  "dados-invalidos": "Dados inválidos — confira o nome.",
};

export default async function JogadoresPage({ searchParams }: PageProps<"/admin/jogadores">) {
  const session = await requirePlatformAdmin();
  const { erro, ok } = await searchParams;

  const [allPlayers, allUsers, pendingInvites] = await Promise.all([
    db.select().from(players).orderBy(asc(players.name)),
    db.select().from(users),
    db
      .select({ invite: invites, expired: sql<boolean>`${invites.expiresAt} <= now()` })
      .from(invites)
      .where(isNull(invites.usedAt)),
  ]);
  const userByPlayer = new Map(allUsers.map((u) => [u.playerId, u]));
  const inviteByPlayer = new Map(pendingInvites.map((r) => [r.invite.playerId, r]));
  const ativos = allPlayers.filter((p) => p.active);
  const inativos = allPlayers.filter((p) => !p.active);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Jogadores"
        descricao="Todo mundo cadastrado na plataforma, com ou sem conta. Quem não tem conta joga e marca gol, mas fica fora dos rankings e da avaliação."
      />

      <BannerDaQuery erro={erro} ok={ok} locais={LOCAIS} />

      <Section titulo="Novo jogador">
        <Card>
          <CardBody>
            <form action={createPlayer}>
              <CamposDoJogador />
            </form>
          </CardBody>
        </Card>
      </Section>

      <Section
        titulo="Elenco"
        acao={
          <span className="font-display text-[11px] font-bold tracking-[.08em] text-fg-4 uppercase">
            {ativos.length}
          </span>
        }
      >
        {ativos.length === 0 ? (
          <EmptyState titulo="Nenhum jogador cadastrado ainda" />
        ) : (
          <div className="flex flex-col gap-2">
            {ativos.map((player) => (
              <LinhaDoJogador
                key={player.id}
                player={player}
                user={userByPlayer.get(player.id)}
                pending={inviteByPlayer.get(player.id)}
                euMesmo={userByPlayer.get(player.id)?.id === session.userId}
              />
            ))}
          </div>
        )}
      </Section>

      {inativos.length > 0 && (
        <Section
          titulo="Inativos"
          acao={
            <span className="font-display text-[11px] font-bold tracking-[.08em] text-fg-4 uppercase">
              {inativos.length}
            </span>
          }
        >
          <HairlineList as="ul">
            {inativos.map((player) => (
              <HairlineRow as="li" key={player.id} apagado>
                <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold">
                  {player.nickname ?? player.name}
                </span>
                <form action={setPlayerActive.bind(null, player.id, true)}>
                  <SubmitButton variante="secondary" tamanho="sm">
                    Reativar
                  </SubmitButton>
                </form>
              </HairlineRow>
            ))}
          </HairlineList>
        </Section>
      )}
    </div>
  );
}
