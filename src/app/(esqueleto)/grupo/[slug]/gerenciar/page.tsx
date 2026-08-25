import { and, asc, eq, notInArray } from "drizzle-orm";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import type { ItemJogador } from "@/components/ui/busca-jogador";
import { db } from "@/db";
import { players, users } from "@/db/schema";
import { emailConfigurado } from "@/lib/email-envio";
import { podeGerenciarGrupo } from "@/lib/grupos-permissions";
import { contarFuts, convitesEnviados, linkAtivo, listarMembros, pedidosPendentes } from "@/lib/grupos";
import { requireGrupoOrganizador } from "@/lib/require-grupo";
import { convidarJogador } from "./actions";
import {
  SecaoConvidar,
  SecaoDadosDoGrupo,
  SecaoLink,
  SecaoMembros,
  SecaoPedidos,
  ZonaDePerigoDoGrupo,
} from "./secoes";

export const metadata = { title: "Gerenciar grupo" };

export default async function GerenciarGrupoPage({
  params,
  searchParams,
}: PageProps<"/grupo/[slug]/gerenciar">) {
  const { slug } = await params;
  // Organizador entra aqui, e não só o admin: `gerarLinkDoGrupo`,
  // `revogarLinkDoGrupo`, `convidarJogador` e `revogarConvite` guardam com
  // `requireGrupoOrganizador`, e esta é a única tela que renderiza os
  // formulários deles. Com o guard de admin, o poder de convidar que
  // `podeConvidarParaGrupo` concede ao organizador não tinha rota nenhuma.
  const { session, grupo, papel } = await requireGrupoOrganizador(slug);
  const groupId = grupo.id;
  const souAdmin = podeGerenciarGrupo(
    { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin },
    papel,
  );

  const { erro, ok } = await searchParams;

  // `pedidos` e `totalFuts` só alimentam seções de admin — organizador não
  // paga por elas.
  const [membros, convites, link, pedidos, totalFuts] = await Promise.all([
    listarMembros(groupId),
    convitesEnviados(groupId),
    linkAtivo(groupId),
    souAdmin ? pedidosPendentes(groupId) : [],
    souAdmin ? contarFuts(groupId) : 0,
  ]);

  // Candidatos ao convite nominal: quem tem conta ativa e ainda não está no
  // grupo nem tem convite pendente. Quem não tem conta fica de fora de
  // propósito — o convite dele ficaria pendente para sempre, porque não há
  // ninguém para aceitá-lo (o caminho dessa pessoa é o fut).
  const excluidos = [...membros.map((m) => m.playerId), ...convites.map((c) => c.playerId)];
  const candidatos = await db
    .select({ id: players.id, name: players.name, nickname: players.nickname })
    .from(players)
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    .where(
      and(
        eq(players.active, true),
        excluidos.length > 0 ? notInArray(players.id, excluidos) : undefined,
      ),
    )
    .orderBy(asc(players.name));

  const itensCandidatos: ItemJogador[] = candidatos.map((p) => ({
    id: p.id,
    nome: p.name,
    apelido: p.nickname,
    acoes: (
      <form action={convidarJogador.bind(null, groupId)}>
        <input type="hidden" name="playerId" value={p.id} />
        <SubmitButton variante="secondary" tamanho="sm">
          Convidar
        </SubmitButton>
      </form>
    ),
  }));

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo={`Gerenciar ${grupo.name}`}
        descricao="Papéis, convites e quem entra. Organizadores marcam futs do grupo; membros confirmam presença e entram no ranking."
        acao={
          <LinkButton href={`/grupo/${grupo.slug}`} variante="secondary" tamanho="sm">
            Ver o grupo
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} ok={ok} />

      {souAdmin && <SecaoDadosDoGrupo grupo={grupo} groupId={groupId} />}
      {souAdmin && <SecaoPedidos groupId={groupId} pedidos={pedidos} />}
      {souAdmin && (
        <SecaoMembros groupId={groupId} membros={membros} meuPlayerId={session.player.id} />
      )}
      <SecaoLink groupId={groupId} link={link} />
      <SecaoConvidar
        groupId={groupId}
        convites={convites}
        candidatos={itensCandidatos}
        emailAtivo={emailConfigurado()}
      />
      {souAdmin && (
        <ZonaDePerigoDoGrupo groupId={groupId} grupo={grupo} totalFuts={totalFuts} />
      )}
    </div>
  );
}
