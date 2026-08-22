import {
  cloneElement,
  isValidElement,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "@/lib/cx";
import { CLASSES_DA_LARGURA, type LarguraDeCampo } from "./larguras-de-campo";

// Havia quatro strings de input divergentes espalhadas por nove arquivos —
// umas com text-sm, outra com foco vermelho, outra sem cor de texto. Agora é
// uma só, e o foco sai do :focus-visible global do globals.css.

// Os 16px do `pointer-coarse` não são escolha estética: abaixo disso o iOS dá
// zoom sozinho ao focar o campo, e a página continua zoomada depois que o
// teclado some. Vale só onde o ponteiro é grosso (dedo) — no desktop o campo
// segue nos 14px do resto da interface.
// O `min-w-0` é o que impede o <select> de mandar na largura da coluna: item de
// flex/grid tem `min-width: auto`, e o min-content de um <select> é a MAIOR
// <option>. Sem esta palavra, nome de time comprido põe um piso que nenhum
// `min-w-*` do call site derruba, e a página ganha rolagem lateral no celular.
const controle =
  "w-full min-w-0 rounded-ctl border border-line-strong bg-surface px-3 text-fg " +
  "text-[14px] pointer-coarse:text-[16px] " +
  "placeholder:text-fg-dim outline-none transition-colors " +
  "focus:border-accent-edge disabled:opacity-55 " +
  "aria-[invalid=true]:border-danger-line";

/**
 * Rótulo + controle + ajuda/erro. O `htmlFor` é obrigatório de propósito — e
 * agora também porque é dele que sai o id da mensagem.
 *
 * As três partes saem NESTA ordem e nunca em outra: dentro de uma LinhaDeCampos
 * elas são as três faixas da grade, e é a ordem que faz o controle de todas as
 * colunas cair na mesma altura. Não meta nada entre o controle e a ajuda — um
 * checkbox enfiado aí era o defeito do /admin/zenhas, onde a mensagem de erro
 * aparecia duas caixas abaixo do campo vermelho. O que acompanha o campo sem
 * ser o campo é uma <AcaoDaLinha> ao lado.
 *
 * `data-faixas` é o gancho por onde a LinhaDeCampos transforma este bloco em
 * subgrid. Fora de uma linha ele não faz nada, e o campo segue coluna flex.
 */
export function Field({
  htmlFor,
  label,
  ajuda,
  erro,
  obrigatorio = false,
  largura,
  className,
  children,
}: {
  htmlFor: string;
  label: ReactNode;
  ajuda?: ReactNode;
  /**
   * Toma o lugar da `ajuda` quando o valor foi recusado.
   *
   * Sem call site hoje, e não por descuido: o único que havia (/admin/zenhas)
   * tem a mensagem larga demais para a trilha do campo e a escreve ao lado, com
   * <MensagemDeCampo> abaixo da linha inteira. O ramo fica porque é o contrato
   * do primitivo para o caso normal — campo em coluna, mensagem da largura do
   * campo —, e porque é dele que sai o `aria-describedby` de graça.
   */
  erro?: ReactNode;
  obrigatorio?: boolean;
  /**
   * Teto de largura para o campo que vive FORA de uma LinhaDeCampos. Dentro de
   * uma linha a largura é da COLUNA, declarada em `colunas` — quem decide
   * largura tem que enxergar os irmãos, e o campo não enxerga.
   *
   * Sem o `acao`: aquela trilha nomeia o que NÃO é campo — botão, checkbox, o
   * "×" entre dois times. Num campo rotulado ela viraria um `sm:max-w-max` que
   * não quer dizer nada, e o tipo é o único lugar onde isso pode ser dito.
   */
  largura?: Exclude<LarguraDeCampo, "acao">;
  /** Só layout. Nunca `items-*`, nunca largura — as duas coisas têm dono. */
  className?: string;
  children: ReactNode;
}) {
  const idDaMensagem = `${htmlFor}-msg`;
  const temMensagem = Boolean(erro || ajuda);

  return (
    <div
      data-faixas
      className={cx(
        "flex min-w-0 flex-col gap-1.5",
        largura && CLASSES_DA_LARGURA[largura],
        className,
      )}
    >
      <label htmlFor={htmlFor} className="font-display text-[12px] font-semibold text-fg-2">
        {label}
        {obrigatorio && (
          <span aria-hidden className="text-danger-ink">
            {" "}
            *
          </span>
        )}
      </label>
      {descrever(children, temMensagem ? idDaMensagem : undefined)}
      {temMensagem && <MensagemDeCampo id={idDaMensagem} erro={erro} ajuda={ajuda} />}
    </div>
  );
}

/**
 * A ajuda/erro de um campo — a terceira faixa, escrita uma vez só.
 *
 * Fica exportada por causa de quem PRECISA da mensagem fora do Field: em
 * /admin/zenhas a descrição é um parágrafo, e na faixa do campo (estreita, o
 * controle é um número de três dígitos) ela quebrava em seis linhas com meia
 * tela vazia ao lado — então mora abaixo da LinhaDeCampos inteira. Ali era uma
 * cópia à mão que já tinha divergido no `leading`; agora é esta função.
 *
 * Quem a usa por fora fica devendo o `aria-describedby` no controle, com o `id`
 * daqui — dentro do Field isso vem de graça, fora não tem como vir.
 */
export function MensagemDeCampo({
  id,
  erro,
  ajuda,
}: {
  id: string;
  erro?: ReactNode;
  ajuda?: ReactNode;
}) {
  return (
    // `erro ? … : ajuda` nos DOIS lugares, e não um `??` no conteúdo: com `??`
    // um erro string vazia venceria a ajuda e sairia um parágrafo em branco com
    // o tom da ajuda — texto sumido e cor errada de uma vez só.
    <p
      id={id}
      className={cx("text-[12px] leading-[1.45]", erro ? "text-danger-ink" : "text-fg-4")}
    >
      {erro ? erro : ajuda}
    </p>
  );
}

/**
 * Liga o controle à ajuda/erro por `aria-describedby` sem pedir nada ao call
 * site — quem usa leitor de tela ouvia a borda vermelha e não o motivo dela.
 *
 * Só clona quando o filho é um controle DESTE arquivo: colar o atributo num
 * <div> qualquer descreveria a caixa errada, e `aria-describedby` apontando
 * para elemento inexistente é violação de acessibilidade de verdade — pior do
 * que a ausência que se queria consertar.
 */
function descrever(children: ReactNode, id: string | undefined): ReactNode {
  if (!id || !isValidElement(children)) return children;
  if (children.type !== Input && children.type !== Select && children.type !== Textarea) {
    return children;
  }
  const atual = (children.props as { "aria-describedby"?: string })["aria-describedby"];
  return cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
    "aria-describedby": atual ? `${atual} ${id}` : id,
  });
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(controle, "h-10", className)} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  // Sem seta customizada: o `color-scheme` do globals.css já faz o widget
  // nativo vir no tema certo, e o nativo é o que funciona bem no mobile.
  return (
    <select {...rest} className={cx(controle, "h-10", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(controle, "min-h-20 py-2 leading-[1.5]", className)} />;
}

/**
 * Caixa de marcar com rótulo ao lado.
 *
 * Eram três inputs crus escritos à mão, e os três resolveram o alinhamento de
 * um jeito diferente: um inventou `h-10`, outro não pôs altura nenhuma, o
 * terceiro se enfiou entre o controle e a ajuda de um Field.
 *
 * Os 40px daqui não são padding escolhido no olho: são a promessa de que o
 * checkbox ocupa exatamente a faixa do controle, e por isso este componente
 * mora neste arquivo e não num próprio — ele e a altura do `controle` acima têm
 * que mudar juntos. De quebra dá alvo de toque de 40px num form em coluna.
 *
 * `min-h-10` e não `h-10`: rótulo comprido numa coluna estreita quebra em duas
 * linhas, e com altura travada o texto vazaria para fora da caixa.
 */
export function Checkbox({
  label,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & { label: ReactNode }) {
  return (
    <label
      className={cx(
        "flex min-h-10 min-w-0 items-center gap-2 text-[13px] text-fg-2 select-none",
        className,
      )}
    >
      {/* `shrink-0`: o quadradinho nunca murcha quando o rótulo é comprido. */}
      <input {...rest} type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

/**
 * Grupo de rádios em caixa, sem uma linha de JavaScript.
 *
 * O `peer` alcança o irmão seguinte, então o input vem antes do label e o
 * `peer-checked:` pinta a caixa inteira.
 */
export function RadioGroup({
  name,
  legenda,
  opcoes,
  valorPadrao,
  className,
}: {
  name: string;
  legenda: ReactNode;
  opcoes: { valor: string; titulo: ReactNode; descricao?: ReactNode }[];
  valorPadrao?: string;
  className?: string;
}) {
  return (
    <fieldset className={cx("flex flex-col gap-1.5", className)}>
      <legend className="mb-1.5 font-display text-[12px] font-semibold text-fg-2">
        {legenda}
      </legend>
      <div className="flex flex-col gap-2">
        {opcoes.map((o) => {
          const id = `${name}-${o.valor}`;
          return (
            <div key={o.valor} className="relative">
              <input
                type="radio"
                id={id}
                name={name}
                value={o.valor}
                defaultChecked={valorPadrao === o.valor}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className="flex cursor-pointer flex-col gap-0.5 rounded-ctl border border-line-strong bg-surface px-3.5 py-2.5 transition-colors hover:border-line-hover peer-checked:border-accent-edge peer-checked:bg-accent-tint peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
              >
                <span className="font-display text-[14px] font-semibold text-fg">{o.titulo}</span>
                {o.descricao && (
                  <span className="text-[12.5px] leading-[1.45] text-fg-3">{o.descricao}</span>
                )}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
