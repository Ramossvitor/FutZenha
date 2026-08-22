import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { LinhaDeCampos } from "@/components/ui/linha-de-campos";
import { DESCRICAO_MAXIMA, NOME_MAXIMO, PRECO_MAXIMO, type TipoDeItem } from "@/lib/item-da-loja";
import { CampoDeImagem } from "./campo-de-imagem";

// Os campos do item, escritos uma vez e usados na criação e na edição.
//
// ── O tipo é PROP, e nunca um campo deste formulário ────────────────────────
//
// Ele decide quais campos existem (cor em moldura e cor do nome, imagem em
// badge), e um `<select>` aqui prometeria que trocá-lo troca o formulário — o
// que só seria verdade com estado no cliente. Em vez disso a escolha acontece
// ANTES, por link (`/admin/loja/novo?tipo=…`), e a tela chega já sabendo o que
// desenhar: zero JavaScript, e o formulário nunca fica com um campo que não
// serve ao que está selecionado.
//
// Na edição o tipo nem é escolha: trocá-lo mudaria o que quem comprou levou (um
// badge virando moldura sumiria da vitrine de todo mundo que o tinha). Ele viaja
// num hidden só para a action saber quais campos ler, e quem manda de verdade é
// o tipo GRAVADO, que `editarItem` relê do banco.
//
// Os campos que não servem ao tipo ficam de FORA da árvore, e não desabilitados:
// um campo de cor cinza num badge é ruído que o admin precisa aprender a
// ignorar, e um input desabilitado ainda ocupa uma coluna da linha.

export function CamposDoItem({
  tipo,
  item,
  criando,
}: {
  tipo: TipoDeItem;
  /** Os valores atuais, na edição. Ausente = formulário em branco. */
  item?: {
    nome: string;
    descricao: string;
    preco: number;
    cor: string | null;
    ativo: boolean;
  };
  criando: boolean;
}) {
  const querCor = tipo === "moldura" || tipo === "cor_do_nome";
  const querImagem = tipo === "badge";

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="tipo" value={tipo} />

      <LinhaDeCampos colunas={["curto"]}>
        <Field
          htmlFor="campo-preco"
          label="Preço"
          obrigatorio
          ajuda={
            tipo === "consumivel"
              ? "O primeiro degrau da escada do mês. Os outros saem dele."
              : "Em zenhas. Zero entrega de graça."
          }
        >
          <Input
            id="campo-preco"
            name="preco"
            type="number"
            inputMode="numeric"
            step={1}
            min={0}
            max={PRECO_MAXIMO}
            defaultValue={item?.preco ?? 250}
            required
          />
        </Field>
      </LinhaDeCampos>

      <LinhaDeCampos colunas={querCor ? ["medio", "curto"] : ["medio"]}>
        <Field
          htmlFor="campo-nome"
          label="Nome"
          obrigatorio
          ajuda={
            tipo === "titulo"
              ? "É o texto que aparece no perfil — o nome É o produto aqui."
              : `Até ${NOME_MAXIMO} caracteres.`
          }
        >
          <Input
            id="campo-nome"
            name="nome"
            maxLength={NOME_MAXIMO}
            defaultValue={item?.nome ?? ""}
            required
          />
        </Field>
        {querCor && (
          <Field
            htmlFor="campo-cor"
            label="Cor"
            obrigatorio
            ajuda="Vale nos dois temas — confira a prévia."
          >
            {/* `type="color"` tem a mesma altura dos outros controles porque o
                `Input` aplica `h-10` — é o que mantém a faixa da linha alinhada
                (ver e2e/alinhamento.spec.ts). */}
            <Input
              id="campo-cor"
              name="cor"
              type="color"
              defaultValue={item?.cor ?? "#147044"}
              className="px-1"
            />
          </Field>
        )}
      </LinhaDeCampos>

      <Field
        htmlFor="campo-descricao"
        label="Descrição"
        largura="longo"
        ajuda={`Uma ou duas linhas, na vitrine e na tela de compra. Até ${DESCRICAO_MAXIMA} caracteres.`}
      >
        <Textarea
          id="campo-descricao"
          name="descricao"
          maxLength={DESCRICAO_MAXIMA}
          defaultValue={item?.descricao ?? ""}
        />
      </Field>

      {querImagem && (
        <CampoDeImagem
          obrigatorio={criando}
          ajuda={
            criando
              ? "PNG, JPEG ou WebP. O navegador recorta em quadrado e reduz para 256×256 antes de enviar."
              : "Só se for trocar. Em branco, a imagem atual continua."
          }
        />
      )}

      <Checkbox name="ativo" defaultChecked={item?.ativo ?? true} label="À venda na loja" />
    </div>
  );
}

/** O que cada tipo É, em uma linha — o texto que a escolha do tipo mostra. */
export const AJUDA_DO_TIPO: Readonly<Record<TipoDeItem, string>> = {
  badge: "Uma figura para a vitrine do perfil. Precisa de imagem.",
  moldura: "Um anel colorido em volta do avatar.",
  cor_do_nome: "Pinta o nome do jogador no perfil.",
  titulo: "Uma cápsula de texto ao lado do nome. O nome do item É o texto.",
  consumivel: "Faz alguma coisa em campo. O efeito é código — não se cria por aqui.",
};
