import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Field, Input, RadioGroup } from "@/components/ui/field";
import { requirePlayer } from "@/lib/require-player";
import { criarGrupo } from "./actions";

export const metadata = { title: "Criar grupo" };

// O slug é genérico no dicionário global; aqui ele sabe qual campo reclamar.
const LOCAIS = {
  "dados-invalidos": "Dados inválidos — o nome precisa de 3 a 60 caracteres.",
};

export default async function NovoGrupoPage({ searchParams }: PageProps<"/grupos/novo">) {
  await requirePlayer();
  const { erro } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Criar grupo"
        descricao="Você fica como administrador: convida gente, promove organizadores e decide quem entra."
      />

      <BannerDaQuery erro={erro} locais={LOCAIS} />

      <form action={criarGrupo}>
        <Card>
          <CardBody className="flex flex-col gap-5">
            <Field htmlFor="name" label="Nome" obrigatorio>
              <Input
                id="name"
                name="name"
                required
                minLength={3}
                maxLength={60}
                placeholder="Fut da firma"
              />
            </Field>

            <Field
              htmlFor="description"
              label="Descrição"
              ajuda="Opcional. Serve para lembrar quando e onde a bola rola."
            >
              <Input
                id="description"
                name="description"
                placeholder="Quarta às 20h, quadra do clube"
              />
            </Field>

            <RadioGroup
              name="visibility"
              legenda="Quem encontra o grupo"
              valorPadrao="private"
              opcoes={[
                {
                  valor: "private",
                  titulo: "Privado",
                  descricao: "Não aparece em lugar nenhum. Só entra quem receber um convite seu.",
                },
                {
                  valor: "public",
                  titulo: "Público",
                  descricao: "Aparece na busca de grupos da plataforma.",
                },
              ]}
            />

            <RadioGroup
              name="joinPolicy"
              legenda="Como se entra (só vale se for público)"
              valorPadrao="request"
              opcoes={[
                {
                  valor: "request",
                  titulo: "Sob aprovação",
                  descricao: "A pessoa pede para entrar e você decide.",
                },
                {
                  valor: "open",
                  titulo: "Entrada livre",
                  descricao: "Qualquer pessoa com conta entra sozinha.",
                },
              ]}
            />

            <p className="text-[12px] text-fg-4">
              Dá para mudar as duas coisas depois, na gestão do grupo.
            </p>

            <div className="flex items-center gap-3">
              <SubmitButton>Criar grupo</SubmitButton>
              <LinkButton href="/grupos" variante="ghost">
                Cancelar
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
