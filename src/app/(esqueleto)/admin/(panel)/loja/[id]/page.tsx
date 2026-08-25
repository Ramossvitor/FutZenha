import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader, Section } from "@/components/ui/card";
import { PreviaDoItem } from "@/components/ui/previa-do-item";
import { db } from "@/db";
import { ROTULO_DO_TIPO } from "@/lib/loja-admin";
import { lerTodosOsItens } from "@/lib/loja-itens";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { apagarItemAction, definirVendaAction, editarItemAction } from "../actions";
import { AJUDA_DO_TIPO, CamposDoItem } from "../campos-do-item";

export const dynamic = "force-dynamic";

// Só o que diz algo a mais que o texto global de src/lib/mensagens.ts.
const LOCAIS = {
  "dados-invalidos": "Confira nome, preço e — conforme o tipo — a cor. Nada foi salvo.",
};

export default async function EditarItemDaLojaPage({
  params,
  searchParams,
}: PageProps<"/admin/loja/[id]">) {
  await requirePlatformAdmin();
  const { id: idBruto } = await params;
  const { erro, ok } = await searchParams;

  const id = Number(idBruto);
  if (!Number.isInteger(id) || id <= 0) notFound();

  // Pela lista inteira, e não por um `lerItem`: é o `vendas` que decide se o
  // botão de apagar existe, e uma segunda consulta só para contar seria a mesma
  // pergunta feita duas vezes. O catálogo é pequeno por construção.
  const item = (await lerTodosOsItens(db)).find((i) => i.id === id);
  if (!item) notFound();

  const protegido = item.efeito !== null;
  const podeApagar = item.vendas === 0 && !protegido;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo={item.nome}
        selos={
          <>
            <Badge tom="outline">{ROTULO_DO_TIPO[item.tipo]}</Badge>
            {item.ativo ? (
              <Badge tom="accent" ponto>
                à venda
              </Badge>
            ) : (
              <Badge tom="neutral">fora de venda</Badge>
            )}
          </>
        }
        descricao={AJUDA_DO_TIPO[item.tipo]}
        acao={
          <LinkButton href="/admin/loja" variante="ghost" tamanho="sm">
            Voltar à loja
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} ok={ok} locais={LOCAIS} />

      {protegido && (
        <Banner tom="aviso">
          Este é o consumível do jogo: o efeito dele é código. Dá para mudar preço, texto e se está à
          venda — não dá para apagar nem para trocar o tipo. O preço aqui é o{" "}
          <strong>primeiro degrau</strong> da escada do mês.
        </Banner>
      )}

      <Section titulo="Como ele aparece">
        <Card>
          <CardBody className="flex items-center justify-center py-7">
            <PreviaDoItem item={item} tamanho="lg" />
          </CardBody>
        </Card>
        <p className="text-[12.5px] leading-[1.5] text-fg-4">
          {item.vendas === 0 ? (
            "Ninguém comprou ainda."
          ) : (
            <>
              Comprado <span data-num>{item.vendas}</span>{" "}
              {item.vendas === 1 ? "vez" : "vezes"} — quem tem continua exibindo, aconteça o que
              acontecer aqui.
            </>
          )}
        </p>
      </Section>

      <form action={editarItemAction.bind(null, item.id)}>
        <Section titulo="Cadastro">
          <Card>
            <CardBody className="flex flex-col gap-5">
              <CamposDoItem tipo={item.tipo} item={item} criando={false} />
              <SubmitButton className="self-start" labelPending="Salvando…">
                Salvar
              </SubmitButton>
            </CardBody>
          </Card>
        </Section>
      </form>

      <Section titulo="Disponibilidade">
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p className="text-[13px] leading-[1.5] text-fg-3">
              {item.ativo
                ? "Tirar de venda faz o item sumir da vitrine. Quem já comprou continua com ele, e continua exibindo — nada é apagado."
                : "Este item não aparece na vitrine. Quem comprou antes continua com ele."}
            </p>
            <form action={definirVendaAction.bind(null, item.id, !item.ativo)}>
              <SubmitButton
                variante={item.ativo ? "danger-outline" : "secondary"}
                tamanho="sm"
                labelPending={item.ativo ? "Tirando…" : "Devolvendo…"}
              >
                {item.ativo ? "Tirar de venda" : "Devolver à venda"}
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      </Section>

      {/* O botão de apagar só existe quando apagar é possível. Um botão que
          sempre falha ensina o admin a ignorar mensagens de erro — e o texto
          abaixo diz por que ele não está lá. */}
      <Section titulo="Apagar">
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p className="text-[13px] leading-[1.5] text-fg-3">
              {podeApagar
                ? "Ninguém comprou este item, então ele pode sumir de vez — junto com a imagem dele. Não tem volta."
                : protegido
                  ? "O consumível do jogo não se apaga: o efeito dele é implementado no código, e a loja sem ele perderia o único item que mexe no jogo."
                  : "Item comprado não se apaga. A zenha que pagou por ele já saiu do extrato, que é definitivo, e o perfil de quem comprou continua desenhando o item."}
            </p>
            {podeApagar && (
              <form action={apagarItemAction.bind(null, item.id)}>
                <SubmitButton variante="danger-outline" tamanho="sm" labelPending="Apagando…">
                  Apagar item
                </SubmitButton>
              </form>
            )}
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
