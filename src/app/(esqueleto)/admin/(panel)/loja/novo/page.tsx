import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader, Section } from "@/components/ui/card";
import { Pilula } from "@/components/ui/pilula";
import { ROTULO_DO_TIPO, TIPOS_QUE_O_ADMIN_CRIA } from "@/lib/loja-admin";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { criarItemAction } from "../actions";
import { AJUDA_DO_TIPO, CamposDoItem } from "../campos-do-item";

export const metadata = { title: "Novo item" };

const LOCAIS = {
  "dados-invalidos":
    "Confira nome, preço e — conforme o tipo — a cor ou a imagem. Nada foi criado.",
};

type TipoQueCria = (typeof TIPOS_QUE_O_ADMIN_CRIA)[number];

function ehTipoQueCria(valor: unknown): valor is TipoQueCria {
  return typeof valor === "string" && (TIPOS_QUE_O_ADMIN_CRIA as readonly string[]).includes(valor);
}

export default async function NovoItemDaLojaPage({
  searchParams,
}: PageProps<"/admin/loja/novo">) {
  await requirePlatformAdmin();
  const { erro, tipo: tipoBruto } = await searchParams;

  // O tipo vem da QUERY, e a escolha é um link. Ver o cabeçalho de
  // campos-do-item.tsx: é o que permite o formulário mudar de forma conforme o
  // tipo sem uma linha de JavaScript.
  const tipo: TipoQueCria = ehTipoQueCria(tipoBruto) ? tipoBruto : "badge";

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Novo item"
        descricao="O que entra na loja. O tipo decide o resto do formulário — e não dá para trocá-lo depois."
        acao={
          <LinkButton href="/admin/loja" variante="ghost" tamanho="sm">
            Voltar à loja
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} locais={LOCAIS} />

      <Section titulo="Tipo">
        <div className="flex flex-wrap gap-2">
          {TIPOS_QUE_O_ADMIN_CRIA.map((t) => (
            <Pilula key={t} href={`/admin/loja/novo?tipo=${t}`} ativo={t === tipo}>
              {ROTULO_DO_TIPO[t]}
            </Pilula>
          ))}
        </div>
        <p className="text-[12.5px] leading-[1.5] text-fg-4">{AJUDA_DO_TIPO[tipo]}</p>
        {/* O consumível não está entre as pílulas de propósito, e o silêncio
            seria pior que a explicação: quem procura "criar multiplicador"
            precisa saber que ele já existe e por que não se cria outro. */}
        <p className="text-[12.5px] leading-[1.5] text-fg-4">
          Consumível não se cria por aqui: o efeito de um consumível é código, e o único que existe
          (o multiplicador de nota) já está cadastrado — dá para mudar preço e texto dele na lista.
        </p>
      </Section>

      <form action={criarItemAction}>
        <Section titulo="Cadastro">
          <Card>
            <CardBody className="flex flex-col gap-5">
              <CamposDoItem tipo={tipo} criando />
              <SubmitButton className="self-start" labelPending="Criando…">
                Criar item
              </SubmitButton>
            </CardBody>
          </Card>
        </Section>
      </form>
    </div>
  );
}
