import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { Card, Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow, HairlineRowLink } from "@/components/ui/hairline-list";
import { IconeZenha } from "@/components/ui/icons";
import { getExtrato, getSaldo } from "@/lib/carteira";
import { cx } from "@/lib/cx";
import { recargaConfigurada } from "@/lib/recarga";
import { requirePlayer } from "@/lib/require-player";
import type { ZenhaLedgerEntry } from "@/db/schema";

export const metadata: Metadata = { title: "Minhas zenhas" };
export const dynamic = "force-dynamic";

export default async function ZenhasPage({ searchParams }: PageProps<"/zenhas">) {
  const session = await requirePlayer();
  const { p } = await searchParams;

  // O `?p=` é texto de URL. `Number("abc")` é NaN, e `getExtrato` já trata isso
  // voltando para a primeira página — mas a paginação DESTA tela também precisa
  // do número para montar os links, e um NaN ali viraria `?p=NaN` no href.
  const pagina = Math.max(0, Math.trunc(Number(typeof p === "string" ? p : 0)) || 0);

  const [saldo, extrato] = await Promise.all([
    getSaldo(session.player.id),
    getExtrato(session.player.id, pagina),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Minhas zenhas"
        descricao="Tudo que entrou e tudo que saiu, do mais recente para o mais antigo. Nada aqui é reescrito depois."
        acao={
          <div className="flex gap-2">
            {/* Só quando o gateway está configurado — mesmo kill switch do
                e-mail: sem credencial, o caminho inteiro da recarga some. */}
            {recargaConfigurada() && (
              <LinkButton href="/zenhas/recarga" tamanho="sm">
                Comprar zenhas
              </LinkButton>
            )}
            <LinkButton href="/loja" variante="secondary" tamanho="sm">
              Ir à loja
            </LinkButton>
          </div>
        }
      />

      <Card className="flex items-center gap-4 p-5">
        <IconeZenha className="size-9 shrink-0 text-accent-ink" />
        <div className="min-w-0 flex-1">
          <Eyebrow>saldo</Eyebrow>
          <p
            className="font-display text-[38px] leading-none font-black font-stretch-125% tracking-[-.02em] text-fg"
            data-num
          >
            {saldo.toLocaleString("pt-BR")}
          </p>
        </div>
      </Card>

      <Section titulo={pagina === 0 ? "Movimentações" : `Movimentações · página ${pagina + 1}`}>
        <HairlineList
          as="ul"
          vazio={
            <EmptyState
              titulo={pagina === 0 ? "Nada movimentou ainda" : "Não há mais nada por aqui"}
              descricao={
                pagina === 0
                  ? "Zenha entra quando um fut que você jogou é apurado: participação, nota que subiu, melhor em campo e sequência de presenças."
                  : "Você chegou ao fim do extrato."
              }
              acao={
                pagina > 0 ? (
                  <LinkButton href="/zenhas" variante="secondary" tamanho="sm">
                    Voltar ao começo
                  </LinkButton>
                ) : undefined
              }
            />
          }
        >
          {extrato.linhas.map((linha) => (
            <li key={linha.id}>
              <LinhaDoExtrato linha={linha} />
            </li>
          ))}
        </HairlineList>

        {(pagina > 0 || extrato.temMais) && (
          <div className="flex items-center justify-between gap-3">
            {pagina > 0 ? (
              <LinkButton
                href={pagina === 1 ? "/zenhas" : `/zenhas?p=${pagina - 1}`}
                variante="secondary"
                tamanho="sm"
              >
                Mais recentes
              </LinkButton>
            ) : (
              <span />
            )}
            {extrato.temMais && (
              <LinkButton href={`/zenhas?p=${pagina + 1}`} variante="secondary" tamanho="sm">
                Mais antigas
              </LinkButton>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

/**
 * Uma linha do extrato.
 *
 * O `match_day_id` é `set null`: apagar o fut corta o ponteiro e deixa a linha
 * de pé, legível pela `descricao` congelada. Por isso a linha só vira link
 * quando o fut ainda existe — a mesma linha, com e sem destino. A recarga segue
 * a mesma regra pelo `pedido_id`, levando à tela do pedido.
 */
function LinhaDoExtrato({ linha }: { linha: ZenhaLedgerEntry }) {
  const miolo = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-[1.35] text-fg">{linha.descricao}</span>
        <span className="mt-0.5 block text-[12px] text-fg-4" data-num>
          {linha.createdAt.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
          })}
        </span>
      </span>
      <Valor amount={linha.amount} />
    </>
  );

  if (linha.matchDayId !== null) {
    return (
      <HairlineRowLink href={`/fut/${linha.matchDayId}`} className="items-start">
        {miolo}
      </HairlineRowLink>
    );
  }
  if (linha.pedidoId !== null) {
    return (
      <HairlineRowLink href={`/zenhas/recarga/${linha.pedidoId}`} className="items-start">
        {miolo}
      </HairlineRowLink>
    );
  }
  return <HairlineRow className="items-start">{miolo}</HairlineRow>;
}

/**
 * O valor com o SINAL ESCRITO.
 *
 * Cor sozinha não carrega informação — é regra da casa, e aqui ela é a diferença
 * entre ganhar e gastar. O `+` e o `−` (o sinal de menos de verdade, não o
 * hífen: o hífen fica curto e alto demais ao lado de dígitos) resolvem o print
 * em preto e branco, o daltonismo e a visão periférica; a cor é o reforço.
 *
 * O `aria-label` diz a mesma coisa em palavras: um leitor de tela lê "+100" como
 * "mais cem" na melhor das hipóteses, e como "cem" na pior.
 */
function Valor({ amount }: { amount: number }) {
  const entrou = amount > 0;
  const absoluto = Math.abs(amount).toLocaleString("pt-BR");
  return (
    <span
      aria-label={`${entrou ? "entraram" : "saíram"} ${absoluto} zenhas`}
      className={cx(
        "shrink-0 font-display text-[15px] leading-[1.35] font-extrabold font-stretch-112%",
        entrou ? "text-accent-ink" : "text-fg-2",
      )}
      data-num
    >
      {entrou ? "+" : "−"}
      {absoluto}
    </span>
  );
}
