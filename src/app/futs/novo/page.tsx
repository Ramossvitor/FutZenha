import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { LinhaDeCampos } from "@/components/ui/linha-de-campos";
import { todayISO } from "@/lib/format";
import { getGroupIdAtual } from "@/lib/grupo-atual";
import { listarMeusGrupos } from "@/lib/grupos";
import { requirePlayer } from "@/lib/require-player";
import { createMatchDay } from "./actions";

export const metadata = { title: "Marcar fut" };

const LOCAIS = {
  "dados-invalidos": "Dados inválidos — confira data e local.",
};

export default async function NovoFutPage({ searchParams }: PageProps<"/futs/novo">) {
  const session = await requirePlayer();
  const { erro, grupo } = await searchParams;

  // Só os grupos em que a pessoa pode criar fut entram no <select>. A action
  // reconfere o papel de qualquer jeito — a lista aqui é conveniência, não trava.
  const meusGrupos = (await listarMeusGrupos(session.player.id)).filter(
    (g) => g.papel === "admin" || g.papel === "organizer",
  );

  // O grupo em que a pessoa está navegando vem pré-selecionado: quem entrou no
  // contexto de um grupo e clicou em "marcar fut" quase sempre quer marcar
  // nele. O ?grupo= da URL ainda ganha, para o link vindo da página do grupo.
  const doContexto = await getGroupIdAtual();
  const preSelecionado =
    typeof grupo === "string"
      ? grupo
      : doContexto && meusGrupos.some((g) => g.id === doContexto)
        ? String(doContexto)
        : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Marcar fut"
        descricao="Você fica responsável por ela: sorteio dos times, presenças, placar, gols e o encerramento."
      />

      <BannerDaQuery erro={erro} locais={LOCAIS} />

      <form action={createMatchDay}>
        <Card>
          <CardBody className="flex flex-col gap-5">
            <LinhaDeCampos colunas={["curto", "curto", "curto"]}>
              <Field htmlFor="date" label="Data" obrigatorio>
                <Input id="date" name="date" type="date" required defaultValue={todayISO()} />
              </Field>
              <Field htmlFor="startTime" label="Horário">
                <Input id="startTime" name="startTime" type="time" />
              </Field>
              <Field htmlFor="endTime" label="Término" ajuda="Vazio = 1h.">
                <Input id="endTime" name="endTime" type="time" />
              </Field>
            </LinhaDeCampos>

            <LinhaDeCampos colunas={["cheio", "curto"]}>
              <Field htmlFor="location" label="Local" obrigatorio>
                <Input id="location" name="location" required placeholder="Quadra do clube" />
              </Field>
              <Field htmlFor="maxPlayers" label="Vagas" ajuda="Deixe vazio para não limitar.">
                <Input
                  id="maxPlayers"
                  name="maxPlayers"
                  type="number"
                  min={2}
                  max={60}
                  inputMode="numeric"
                  placeholder="20"
                />
              </Field>
            </LinhaDeCampos>

            <Field
              htmlFor="notes"
              label="Observações"
              ajuda="Opcional. Ex.: leva colete branco e preto."
              largura="longo"
            >
              <Input id="notes" name="notes" placeholder="Society 2, quadra do fundo" />
            </Field>

            {meusGrupos.length > 0 && (
              <Field
                htmlFor="groupId"
                label="Grupo"
                largura="longo"
                ajuda="Fut de grupo entra no ranking do grupo. Você continua podendo convidar gente de fora — inclusive quem não tem conta."
              >
                <Select id="groupId" name="groupId" defaultValue={preSelecionado}>
                  <option value="">Sem grupo (fut avulso)</option>
                  {meusGrupos.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="flex items-center gap-3">
              <SubmitButton>Criar fut</SubmitButton>
              <LinkButton href="/futs" variante="ghost">
                Cancelar
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
