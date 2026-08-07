import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { logout } from "@/app/login/actions";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Eyebrow, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { GoogleButton } from "@/components/ui/google-button";
import { HairlineList, HairlineRow, HairlineRowLink } from "@/components/ui/hairline-list";
import { IconeLuva, IconeSeta } from "@/components/ui/icons";
import { Nota } from "@/components/ui/nota";
import { StatGrid, StatTile } from "@/components/ui/stat";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ERROS_LOGIN } from "@/lib/erros-login";
import { googleLoginConfigurado } from "@/lib/google-oauth";
import { contarNaoLidas } from "@/lib/notifications";
import { posicoes } from "@/lib/posicao";
import { getEstrelasRecebidas } from "@/lib/ratings";
import { requirePlayer } from "@/lib/require-player";
import { getAttendanceStats, getPlayerRecords, getTopScorers } from "@/lib/stats";
import { ChangePasswordForm } from "./change-password-form";
import { RodadaRecebida } from "./rodada-recebida";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function PerfilPage({ searchParams }: PageProps<"/perfil">) {
  const session = await requirePlayer();
  const { player } = session;
  const { erro } = await searchParams;

  const [scorers, records, attendance, rodadas, naoLidas, [conta]] = await Promise.all([
    getTopScorers(),
    getPlayerRecords(),
    getAttendanceStats(),
    getEstrelasRecebidas(player.id),
    contarNaoLidas(player.id),
    db
      .select({ email: users.email, googleSub: users.googleSub, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, session.userId)),
  ]);

  const meusGols = scorers.find((s) => s.playerId === player.id)?.total ?? 0;
  const meuRetro = records.find((r) => r.playerId === player.id);
  const minhasPresencas =
    attendance.perPlayer.find((a) => a.playerId === player.id)?.attended ?? 0;
  // `índice + 1` diria 2º para o segundo de dois artilheiros empatados, e a aba
  // de artilharia — que usa posicoes() — diria 1º para os dois.
  const indiceArtilharia = scorers.findIndex((s) => s.playerId === player.id);
  const posicaoArtilharia =
    indiceArtilharia < 0 ? 0 : posicoes(scorers, (s) => s.total)[indiceArtilharia];

  return (
    <div className="flex flex-col gap-7">
      {/* Cabeçalho com a nota gigante: é a assinatura do produto, e o perfil é
          onde ela é mais pessoal. */}
      <header className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[28px] leading-none font-black font-stretch-125% tracking-[-.015em] text-fg uppercase">
            {player.nickname ?? player.name.split(" ")[0]}
          </h1>
          <p className="mt-1.5 text-[14px] text-fg-2">
            {player.name} · @{session.username}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {player.isGoalkeeper ? (
              <Badge tom="warn">
                <IconeLuva className="size-3" />
                goleiro
              </Badge>
            ) : (
              <Badge tom="outline">linha</Badge>
            )}
            {!player.active && <Badge tom="danger">fora das listas</Badge>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Eyebrow>sua nota</Eyebrow>
          <Nota valor={player.skill} tamanho="hero" className="mt-1 block" />
        </div>
      </header>

      {!player.active && (
        <p className="text-[13px] text-fg-3">
          Você está fora das listas no momento — fala com quem administra a plataforma para voltar.
        </p>
      )}

      <Section titulo="Meus números" acao={<span className="eyebrow">só peladas encerradas</span>}>
        <StatGrid>
          <StatTile label="Gols" valor={meusGols} />
          <StatTile label="Jogos" valor={meuRetro?.gamesPlayed ?? 0} />
          <StatTile
            label="Presenças"
            valor={`${minhasPresencas}/${attendance.totalDays}`}
          />
          <StatTile
            label="V · E · D"
            valor={
              meuRetro ? `${meuRetro.wins}·${meuRetro.draws}·${meuRetro.losses}` : "0·0·0"
            }
          />
          <StatTile
            label="Aprov."
            valor={meuRetro ? `${Math.round(meuRetro.winRate * 100)}%` : "—"}
          />
          <StatTile
            label="Artilharia"
            valor={posicaoArtilharia > 0 ? `${posicaoArtilharia}º` : "—"}
          />
        </StatGrid>
      </Section>

      <Section titulo="Avaliações que recebi">
        <p className="text-[12.5px] leading-[1.5] text-fg-4">
          Você vê a distribuição da rodada, não uma fila de notas soltas — a mesma informação, sem
          o convite a adivinhar quem deu o quê.
        </p>
        {rodadas.length === 0 ? (
          <EmptyState
            titulo="Nenhuma ainda"
            descricao="Depois que uma pelada que você jogou for apurada, as estrelas que os companheiros deram aparecem aqui."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {rodadas.map((r) => (
              <RodadaRecebida key={r.roundId} rodada={r} />
            ))}
          </div>
        )}
      </Section>

      <Section titulo="Acesso">
        <BannerDaQuery erro={erro} locais={ERROS_LOGIN} />
        <Card>
          <CardBody className="flex flex-col gap-3">
            {conta?.googleSub ? (
              <p className="text-[13px] text-fg-2">
                Conta Google vinculada: <strong className="text-fg">{conta.email}</strong>
              </p>
            ) : (
              googleLoginConfigurado() && (
                <>
                  <GoogleButton
                    href="/api/auth/google?vincular=1&next=/perfil"
                    label="Conectar conta Google"
                  />
                  <p className="text-[12px] leading-[1.45] text-fg-4">
                    Depois de conectar, você entra pelo Google. Vincular encerra suas sessões nos
                    outros aparelhos.
                  </p>
                </>
              )
            )}

            {/* Conta que nasceu pelo Google nunca teve senha — não há o que trocar. */}
            {conta?.passwordHash && <ChangePasswordForm />}
          </CardBody>
        </Card>
      </Section>

      {/* No celular não há barra lateral, e o cabeçalho só tem o chip do grupo,
          o sino e o avatar. Então é aqui que moram as portas que não couberam
          nas quatro abas — inclusive o Sair. */}
      <Section titulo="Sua conta">
        <HairlineList as="ul">
          <li>
            <HairlineRowLink href="/notificacoes">
              <span className="flex-1">Avisos</span>
              {naoLidas > 0 && <Badge tom="danger">{naoLidas > 9 ? "9+" : naoLidas}</Badge>}
              <IconeSeta className="size-4 text-fg-dim" />
            </HairlineRowLink>
          </li>
          <li>
            <HairlineRowLink href="/avaliar">
              <span className="flex-1">Avaliações abertas</span>
              <IconeSeta className="size-4 text-fg-dim" />
            </HairlineRowLink>
          </li>
          <li>
            <HairlineRowLink href="/grupos">
              <span className="flex-1">Meus grupos</span>
              <IconeSeta className="size-4 text-fg-dim" />
            </HairlineRowLink>
          </li>
          {session.isPlatformAdmin && (
            <li>
              <HairlineRowLink href="/admin">
                <span className="flex-1">Plataforma</span>
                <Badge tom="warn">admin</Badge>
                <IconeSeta className="size-4 text-fg-dim" />
              </HairlineRowLink>
            </li>
          )}
          <HairlineRow as="li">
            <form action={logout} className="flex-1">
              <Button
                type="submit"
                variante="ghost"
                tamanho="sm"
                className="-mx-3 w-full justify-start text-danger-ink"
              >
                Sair
              </Button>
            </form>
          </HairlineRow>
        </HairlineList>
      </Section>
    </div>
  );
}
