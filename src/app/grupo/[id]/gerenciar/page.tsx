import Link from "next/link";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { players, users } from "@/db/schema";
import { BuscaJogador, type ItemJogador } from "@/app/pelada/[id]/gerenciar/busca-jogador";
import { CopyButton } from "@/components/ui/copy-button";
import {
  contarPeladas,
  convitesEnviados,
  linkAtivo,
  listarMembros,
  pedidosPendentes,
  urlDoLink,
} from "@/lib/grupos";
import { papelLabel, podeGerenciarGrupo } from "@/lib/grupos-permissions";
import { requireGrupoOrganizador } from "@/lib/require-grupo";
import {
  aprovarPedido,
  atualizarGrupo,
  convidarJogador,
  definirPapel,
  excluirGrupo,
  gerarLinkDoGrupo,
  recusarPedido,
  removerMembro,
  revogarConvite,
  revogarLinkDoGrupo,
  transferirAdministracao,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gerenciar grupo" };

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const botaoSecundario =
  "rounded-lg border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";

const errorMessages: Record<string, string> = {
  "dados-invalidos": "Dados inválidos.",
  "sem-permissao": "Você não pode fazer isso.",
  "sem-conta": "Esse jogador ainda não tem conta — convide-o por uma pelada primeiro.",
  "ja-membro": "Essa pessoa já está no grupo.",
  "alvo-nao-e-membro": "Só dá para transferir para alguém que já está no grupo.",
  "alvo-ja-e-admin": "Essa pessoa já administra o grupo.",
  "alvo-sem-conta":
    "Essa pessoa não tem conta ativa. Quem administra precisa conseguir entrar — senão o grupo fica sem ninguém no comando.",
  "nao-e-o-admin": "Só quem administra o grupo transfere a administração.",
  "transferencia-para-si": "Você já administra o grupo.",
  "confirmacao-nao-confere": "O nome digitado não confere com o do grupo.",
};

const okMessages: Record<string, string> = {
  "grupo-atualizado": "Grupo atualizado.",
  "papel-alterado": "Papel alterado.",
  "administracao-transferida": "Administração transferida.",
  "membro-removido": "Membro removido. O link do grupo foi revogado junto — gere outro para continuar convidando.",
  "link-gerado": "Link novo gerado — o anterior deixou de valer.",
  "link-revogado": "Link revogado.",
  "convite-enviado": "Convite enviado.",
  "convite-revogado": "Convite revogado.",
  "pedido-aprovado": "Pedido aprovado.",
  "pedido-recusado": "Pedido recusado.",
};

export default async function GerenciarGrupoPage({
  params,
  searchParams,
}: PageProps<"/grupo/[id]/gerenciar">) {
  const { id } = await params;
  const groupId = Number(id);
  // Organizador entra aqui, e não só o admin: `gerarLinkDoGrupo`,
  // `revogarLinkDoGrupo`, `convidarJogador` e `revogarConvite` guardam com
  // `requireGrupoOrganizador`, e esta é a única tela que renderiza os
  // formulários deles. Com o guard de admin, o poder de convidar que
  // `podeConvidarParaGrupo` concede ao organizador não tinha rota nenhuma.
  const { session, grupo, papel } = await requireGrupoOrganizador(groupId);
  const souAdmin = podeGerenciarGrupo(
    { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin },
    papel,
  );

  const { erro, ok } = await searchParams;
  const mensagemErro = typeof erro === "string" ? errorMessages[erro] : undefined;
  const mensagemOk = typeof ok === "string" ? okMessages[ok] : undefined;

  // `pedidos` e `totalPeladas` só alimentam seções de admin — organizador não
  // paga por elas.
  const [membros, convites, link, pedidos, totalPeladas] = await Promise.all([
    listarMembros(groupId),
    convitesEnviados(groupId),
    linkAtivo(groupId),
    souAdmin ? pedidosPendentes(groupId) : [],
    souAdmin ? contarPeladas(groupId) : 0,
  ]);

  // Candidatos ao convite nominal: quem tem conta ativa e ainda não está no
  // grupo nem tem convite pendente. Quem não tem conta fica de fora de
  // propósito — o convite dele ficaria pendente para sempre, porque não há
  // ninguém para aceitá-lo (o caminho dessa pessoa é a pelada).
  const jaNoGrupo = membros.map((m) => m.playerId);
  const jaConvidados = convites.map((c) => c.playerId);
  const excluidos = [...jaNoGrupo, ...jaConvidados];
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
        <button type="submit" className={botaoSecundario}>
          Convidar
        </button>
      </form>
    ),
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">Gerenciar {grupo.name}</h1>
          <Link
            href={`/grupo/${groupId}`}
            className="ml-auto text-sm text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Ver o grupo
          </Link>
        </div>
        <p className="text-sm text-neutral-500">
          Papéis, convites e quem entra. Organizadores marcam peladas do grupo; membros confirmam
          presença e entram no ranking.
        </p>
      </header>

      {mensagemErro && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {mensagemErro}
        </p>
      )}
      {mensagemOk && (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {mensagemOk}
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      {souAdmin && (
      <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-bold">Dados do grupo</h2>
        <form action={atualizarGrupo.bind(null, groupId)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Nome
            <input name="name" required defaultValue={grupo.name} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Descrição
            <input
              name="description"
              defaultValue={grupo.description ?? ""}
              placeholder="Opcional"
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Quem encontra
              <select name="visibility" defaultValue={grupo.visibility} className={inputClass}>
                <option value="private">Privado — só por convite</option>
                <option value="public">Público — aparece na busca</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Como se entra
              <select name="joinPolicy" defaultValue={grupo.joinPolicy} className={inputClass}>
                <option value="request">Sob aprovação</option>
                <option value="open">Entrada livre</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            A política de entrada só vale em grupo público. Ao tornar o grupo privado, os pedidos
            que estiverem na fila são recusados.
          </p>
          <button
            type="submit"
            className="self-start rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Salvar
          </button>
        </form>
      </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {souAdmin && pedidos.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-800 dark:bg-amber-950">
          <h2 className="text-lg font-bold">
            Pedidos de entrada{" "}
            <span className="text-sm font-normal text-neutral-600 dark:text-neutral-400">
              ({pedidos.length})
            </span>
          </h2>
          <ul className="flex flex-col gap-1">
            {pedidos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
                <span className="font-medium">{p.name}</span>
                {p.nickname && <span className="text-neutral-500">“{p.nickname}”</span>}
                <span className="ml-auto flex gap-1">
                  <form action={aprovarPedido.bind(null, groupId, p.id)}>
                    <button
                      type="submit"
                      className="rounded-lg bg-emerald-700 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-800"
                    >
                      Aprovar
                    </button>
                  </form>
                  <form action={recusarPedido.bind(null, groupId, p.id)}>
                    <button type="submit" className={botaoSecundario}>
                      Recusar
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {souAdmin && (
      <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-bold">Membros</h2>
        <ul className="flex flex-col gap-1">
          {membros.map((m) => {
            const ehEu = m.playerId === session.player.id;
            return (
              <li key={m.playerId} className="flex flex-wrap items-center gap-2 py-1 text-sm">
                <span className="font-medium">{m.name}</span>
                {m.nickname && <span className="text-neutral-500">“{m.nickname}”</span>}
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  {papelLabel[m.papel]}
                </span>
                {!m.temConta && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    sem conta
                  </span>
                )}
                <span className="ml-auto flex flex-wrap gap-1">
                  {m.papel === "member" && (
                    <form action={definirPapel.bind(null, groupId, m.playerId, "organizer")}>
                      <button type="submit" className={botaoSecundario}>
                        Promover a organizador
                      </button>
                    </form>
                  )}
                  {m.papel === "organizer" && (
                    <form action={definirPapel.bind(null, groupId, m.playerId, "member")}>
                      <button type="submit" className={botaoSecundario}>
                        Rebaixar a membro
                      </button>
                    </form>
                  )}
                  {m.papel !== "admin" && !ehEu && (
                    <>
                      {/* Sem conta ativa não vira administrador: quem manda no
                          grupo precisa conseguir entrar. A action recusa do
                          mesmo jeito — aqui é só não oferecer o caminho. */}
                      {m.temConta && (
                        <form action={transferirAdministracao.bind(null, groupId, m.playerId)}>
                          <button
                            type="submit"
                            className="rounded-lg border border-amber-400 px-3 py-1 text-sm text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
                          >
                            Tornar administrador
                          </button>
                        </form>
                      )}
                      <form action={removerMembro.bind(null, groupId, m.playerId)}>
                        <button
                          type="submit"
                          className="rounded-lg border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                        >
                          Remover
                        </button>
                      </form>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-bold">Link de convite</h2>
        {link ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
                {urlDoLink(link.token)}
              </code>
              <CopyButton text={urlDoLink(link.token)} />
              <form action={revogarLinkDoGrupo.bind(null, groupId, link.id)}>
                <button type="submit" className={botaoSecundario}>
                  Revogar
                </button>
              </form>
            </div>
            <p className="text-xs text-neutral-500">
              Vale até {link.expiresAt.toLocaleDateString("pt-BR")}
              {link.maxUses !== null
                ? ` · ${link.usesCount} de ${link.maxUses} usos`
                : " · usos ilimitados"}
              . Quem abrir precisa ter conta e entra como membro.
            </p>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Nenhum link ativo.</p>
        )}
        <form action={gerarLinkDoGrupo.bind(null, groupId)} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Limite de usos
            <input
              name="maxUses"
              type="number"
              min={1}
              max={500}
              placeholder="Sem limite"
              className={inputClass}
            />
          </label>
          <button type="submit" className={botaoSecundario}>
            {link ? "Gerar link novo" : "Gerar link"}
          </button>
        </form>
        {link && (
          <p className="text-xs text-neutral-500">
            Gerar um link novo revoga o atual — o que já foi mandado no WhatsApp para de funcionar.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-bold">Convidar alguém</h2>
        {convites.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-neutral-500">Aguardando resposta</h3>
            <ul className="flex flex-col gap-1">
              {convites.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
                  <span>{c.name}</span>
                  {c.nickname && <span className="text-neutral-500">“{c.nickname}”</span>}
                  <form
                    action={revogarConvite.bind(null, groupId, c.id)}
                    className="ml-auto"
                  >
                    <button type="submit" className={botaoSecundario}>
                      Revogar
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}
        <BuscaJogador
          itens={itensCandidatos}
          vazio="Todo mundo com conta já está no grupo ou foi convidado."
          semResultado="Nenhum jogador com esse nome."
        />
        <p className="text-xs text-neutral-500">
          Só aparece aqui quem já tem conta. Para trazer alguém sem conta, inclua a pessoa numa
          pelada — de lá sai o link de cadastro dela.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {souAdmin && (
      <section className="flex flex-col gap-3 rounded-xl border border-red-300 bg-red-50 p-4 shadow-sm dark:border-red-800 dark:bg-red-950">
        <h2 className="text-lg font-bold text-red-800 dark:text-red-300">Excluir grupo</h2>
        <p className="text-sm text-red-700 dark:text-red-300">
          Membros, convites e pedidos são apagados.{" "}
          {totalPeladas === 0
            ? "O grupo não tem peladas."
            : `As ${totalPeladas} peladas do grupo continuam existindo, mas viram peladas avulsas — placares, gols e notas ficam como estão.`}{" "}
          Não tem desfazer.
        </p>
        <form action={excluirGrupo.bind(null, groupId)} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-red-800 dark:text-red-300">
            Digite <strong>{grupo.name}</strong> para confirmar
            <input name="confirmacao" required className={inputClass} />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
          >
            Excluir grupo
          </button>
        </form>
      </section>
      )}
    </div>
  );
}
