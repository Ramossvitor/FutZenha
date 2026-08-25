import type { Metadata } from "next";
import Link from "next/link";
import { assinarPush, cancelarPush } from "@/app/pwa/actions";
import { PedidoDePush } from "@/components/push/pedido-de-push";
import { SubmitButton } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconeAlerta, IconeBola, IconeGrafico, IconeGrupo, IconeZenha } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { formatDateShort } from "@/lib/format";
import { listarNotificacoes } from "@/lib/notifications";
import { requirePlayer } from "@/lib/require-player";
import { marcarComoLida, marcarTodasComoLidas } from "./actions";
import type { notificationTypeEnum } from "@/db/schema";

type TipoDeAviso = (typeof notificationTypeEnum.enumValues)[number];

/**
 * O ícone por família de aviso. São 26 tipos e seis famílias — o que importa
 * de relance é a natureza do aviso, não o tipo exato.
 *
 * `rating_round_closed` está declarado no enum mas nunca é emitido: o
 * fechamento avisa por skill_changed. `rating_round_open` também não é mais —
 * o encerramento passou a mandar um aviso só, com o resumo do fut junto (ver
 * fut_encerrado). Os dois ficam mapeados mesmo assim, porque há linhas antigas
 * em produção e um `undefined` aqui quebraria a linha.
 */
const ICONE: Record<TipoDeAviso, { icone: React.ReactNode; cor: string }> = {
  rating_round_open: { icone: <IconeBola />, cor: "text-accent-ink" },
  rating_round_closed: { icone: <IconeBola />, cor: "text-accent-ink" },
  skill_changed: { icone: <IconeGrafico />, cor: "text-accent-ink" },
  skill_recalculated: { icone: <IconeGrafico />, cor: "text-fg-3" },
  rating_report_resolved: { icone: <IconeAlerta />, cor: "text-warn-ink" },
  deletion_vote_open: { icone: <IconeAlerta />, cor: "text-danger-ink" },
  deletion_vote_resolved: { icone: <IconeAlerta />, cor: "text-fg-3" },
  group_invitation: { icone: <IconeGrupo />, cor: "text-accent-ink" },
  group_join_request: { icone: <IconeGrupo />, cor: "text-warn-ink" },
  group_join_request_resolved: { icone: <IconeGrupo />, cor: "text-fg-3" },
  group_role_changed: { icone: <IconeGrupo />, cor: "text-fg-3" },
  pelada_presenca_definida: { icone: <IconeBola />, cor: "text-accent-ink" },
  pelada_criada: { icone: <IconeBola />, cor: "text-accent-ink" },
  pelada_times_sorteados: { icone: <IconeBola />, cor: "text-accent-ink" },
  pelada_lembrete_vespera: { icone: <IconeBola />, cor: "text-warn-ink" },
  mvp_do_fut: { icone: <IconeBola />, cor: "text-warn-ink" },
  // A entrada no fut. Mesma leitura de cor dos três de grupo: o que espera
  // resposta SUA vem em accent, o que espera decisão sua vem em warn, e o
  // resolvido é histórico.
  fut_convite: { icone: <IconeBola />, cor: "text-accent-ink" },
  fut_pedido: { icone: <IconeBola />, cor: "text-warn-ink" },
  fut_pedido_resolvido: { icone: <IconeBola />, cor: "text-fg-3" },
  // O encerramento. Quem jogou vem em accent — pode ter avaliação esperando por
  // ele; quem só é do grupo vem apagado, que é o peso da notícia para ele.
  fut_encerrado: { icone: <IconeBola />, cor: "text-accent-ink" },
  fut_encerrado_no_grupo: { icone: <IconeBola />, cor: "text-fg-3" },
  // A zenha. O crédito é notícia boa e chega dias depois do fut, quando ninguém
  // está esperando — vem em accent. A devolução do multiplicador contraria o
  // que a pessoa combinou ao armar, e é o único aviso da moeda em warn.
  zenha_creditada: { icone: <IconeGrafico />, cor: "text-accent-ink" },
  multiplicador_devolvido: { icone: <IconeAlerta />, cor: "text-warn-ink" },
  // A recarga. A confirmação leva o símbolo da própria moeda — é a única vez em
  // que a zenha chega por dinheiro, e o aviso deve parecer com o saldo que ele
  // anuncia. O estorno só aparece para admins, e é alerta como todo aviso que
  // pede decisão de alguém.
  recarga_confirmada: { icone: <IconeZenha />, cor: "text-accent-ink" },
  recarga_estornada: { icone: <IconeAlerta />, cor: "text-warn-ink" },
  // A compra. Símbolo da moeda como a recarga — é a outra ponta do mesmo saldo
  // —, mas apagado: gastar o que já era seu é recibo, não novidade.
  loja_compra: { icone: <IconeZenha />, cor: "text-fg-3" },
};

export const metadata: Metadata = { title: "Avisos" };

export default async function NotificacoesPage() {
  const session = await requirePlayer();
  const notificacoes = await listarNotificacoes(session.player.id);
  const naoLidas = notificacoes.filter((n) => n.readAt === null).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        titulo="Avisos"
        descricao={
          naoLidas > 0
            ? `${naoLidas} ${naoLidas === 1 ? "não lido" : "não lidos"}.`
            : "Tudo em dia."
        }
        acao={
          naoLidas > 0 ? (
            <form action={marcarTodasComoLidas}>
              <SubmitButton variante="secondary" tamanho="sm">
                Marcar todas como lidas
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      {/* Quem abriu a caixa de avisos se importa com avisos — é o terceiro e
          mais óbvio momento de oferecer o push. */}
      <PedidoDePush contexto="avisos" acoes={{ aoAssinar: assinarPush, aoCancelar: cancelarPush }} />

      {notificacoes.length === 0 ? (
        <EmptyState
          titulo="Nada por aqui ainda"
          descricao="Aviso de avaliação aberta, de nota que mudou, de convite e de votação chega aqui."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {notificacoes.map((n) => {
            const naoLida = n.readAt === null;
            const { icone, cor } = ICONE[n.type];
            const conteudo = (
              <>
                <span className={cx("mt-0.5 block size-[18px] shrink-0", cor)}>{icone}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={cx(
                        "font-display text-[14px] leading-[1.3]",
                        naoLida ? "font-extrabold text-fg" : "font-semibold text-fg-2",
                      )}
                    >
                      {n.title}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-fg-4" data-num>
                      {formatDateShort(n.createdAt.toISOString().slice(0, 10))}
                    </span>
                  </span>
                  {n.body && (
                    <span className="mt-0.5 block text-[13px] leading-[1.45] text-fg-3">
                      {n.body}
                    </span>
                  )}
                </span>
              </>
            );

            return (
              <li key={n.id}>
                <Card
                  className={cx(
                    "overflow-hidden",
                    naoLida && "border-accent-line bg-accent-tint",
                  )}
                >
                  {n.href ? (
                    <Link href={n.href} className="flex gap-2.5 p-3.5 hover:bg-surface-2">
                      {conteudo}
                    </Link>
                  ) : (
                    <div className="flex gap-2.5 p-3.5">{conteudo}</div>
                  )}
                  {naoLida && (
                    <form
                      action={marcarComoLida.bind(null, n.id)}
                      className="border-t border-line"
                    >
                      <SubmitButton
                        variante="ghost"
                        tamanho="sm"
                        className="w-full justify-center rounded-none"
                      >
                        Marcar como lida
                      </SubmitButton>
                    </form>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
