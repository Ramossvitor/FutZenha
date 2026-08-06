import Link from "next/link";
import { requirePlayer } from "@/lib/require-player";
import { criarGrupo } from "./actions";

export const metadata = { title: "Criar grupo" };

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const errorMessages: Record<string, string> = {
  "dados-invalidos": "Dados inválidos — o nome precisa de 3 a 60 caracteres.",
};

export default async function NovoGrupoPage({ searchParams }: PageProps<"/grupos/novo">) {
  await requirePlayer();
  const { erro } = await searchParams;
  const mensagemErro = typeof erro === "string" ? errorMessages[erro] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Criar grupo</h1>
        <p className="text-sm text-neutral-500">
          Você fica como administrador: convida gente, promove organizadores e decide quem entra.
        </p>
      </header>

      {mensagemErro && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {mensagemErro}
        </p>
      )}

      <form
        action={criarGrupo}
        className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      >
        <label className="flex flex-col gap-1 text-sm">
          Nome
          <input name="name" required placeholder="Pelada da firma" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Descrição
          <input
            name="description"
            placeholder="Opcional — quarta às 20h, quadra do clube"
            className={inputClass}
          />
        </label>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <legend className="px-1 text-sm font-medium">Quem encontra o grupo</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="visibility" value="private" defaultChecked className="mt-1" />
            <span>
              <span className="font-medium">Privado</span>
              <span className="block text-neutral-500">
                Não aparece em lugar nenhum. Só entra quem receber um convite seu.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="visibility" value="public" className="mt-1" />
            <span>
              <span className="font-medium">Público</span>
              <span className="block text-neutral-500">
                Aparece na busca de grupos da plataforma.
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <legend className="px-1 text-sm font-medium">Como se entra (só vale se for público)</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="joinPolicy" value="request" defaultChecked className="mt-1" />
            <span>
              <span className="font-medium">Sob aprovação</span>
              <span className="block text-neutral-500">
                A pessoa solicita e você decide.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="joinPolicy" value="open" className="mt-1" />
            <span>
              <span className="font-medium">Entrada livre</span>
              <span className="block text-neutral-500">
                Qualquer pessoa com conta entra sozinha.
              </span>
            </span>
          </label>
        </fieldset>

        <p className="text-xs text-neutral-500">
          Dá para mudar as duas coisas depois, na gestão do grupo.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Criar grupo
          </button>
          <Link href="/grupos" className="text-sm text-neutral-500 hover:underline">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
