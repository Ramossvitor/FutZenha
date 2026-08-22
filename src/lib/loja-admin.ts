import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { lojaImagens, lojaItens } from "@/db/schema";
import { isForeignKeyViolation } from "./db-errors";
import { validarImagem, type ErroDeImagem } from "./imagem-de-item";
import {
  DESCRICAO_MAXIMA,
  NOME_MAXIMO,
  PRECO_MAXIMO,
  REGEX_DE_COR,
  corBateComTipo,
  type TipoDeItem,
} from "./item-da-loja";

// A administração do catálogo: criar, editar, retirar de venda e apagar.
//
// Este módulo é o DONO das regras do item — o schema de validação mora aqui e é
// exportado para a action apenas CHAMAR, no mesmo espírito do `salvarAjuste` de
// zenha-config.ts. A alternativa (a action montando a sua própria validação)
// abriria a porta para duas regras: uma na tela do admin e outra em qualquer
// caminho novo que aparecesse depois.
//
// ── As duas coisas que o admin NÃO pode fazer ──────────────────────────────
//
// Criar consumível: o efeito de um consumível é código (o multiplicador tem
// motor, prazo de arme, congelamento e replay). Uma linha nova com
// `efeito = 'multiplicador'` seria um segundo multiplicador que o motor não
// espera; uma com efeito inventado não faria nada. O admin edita preço, texto e
// disponibilidade da linha que existe.
//
// Apagar item vendido: a FK `on delete restrict` de `zenha_inventario` recusa, e
// isso é proposital — a zenha que pagou já saiu do ledger, que é append-only, e
// não há estorno a rodar. Tirar de venda (`ativo = false`) é o gesto certo: o
// item some da vitrine e continua no perfil de quem pagou por ele.

/** Os tipos que nascem de uma tela. `consumivel` fica de fora — ver o cabeçalho. */
export const TIPOS_QUE_O_ADMIN_CRIA = ["badge", "moldura", "cor_do_nome", "titulo"] as const;

export type ErroDeAdminDaLoja =
  | "dados-invalidos"
  | ErroDeImagem
  | "item-nao-encontrado"
  /** Alguém já comprou: dá para retirar de venda, não para apagar. */
  | "item-com-compras"
  /** O consumível não se apaga: o efeito dele é código. */
  | "item-protegido";

// Mesma razão do nome de jogador (ver admin/jogadores/actions.ts): o `.trim()`
// corta as pontas, e uma quebra no meio do nome atravessaria a tela inteira.
const SEM_QUEBRA = /^[^\r\n]+$/;

const camposDoItem = {
  nome: z.string().trim().min(1).max(NOME_MAXIMO).regex(SEM_QUEBRA),
  descricao: z.string().trim().max(DESCRICAO_MAXIMA),
  preco: z.coerce.number().int().min(0).max(PRECO_MAXIMO),
  /**
   * Já em minúsculas quando chega: `<input type="color">` envia assim, e a
   * normalização de quem posta na mão é da action. O regex aqui é o mesmo que o
   * `check` do banco cobra — recusar é melhor que gravar duas formas da mesma
   * cor e depois comparar strings.
   */
  cor: z.string().regex(REGEX_DE_COR).nullable(),
  ativo: z.boolean(),
};

/** Os campos que a edição mexe. O tipo não está aqui: ele é imutável. */
export const camposDoItemSchema = z.object(camposDoItem);
export type CamposDoItem = z.infer<typeof camposDoItemSchema>;

/**
 * O item inteiro, para a criação.
 *
 * O `refine` da cor espelha o check do banco. Ele existe além do check porque a
 * diferença entre "o Postgres estourou 23514" e "o campo Cor ficou vazio" é a
 * diferença entre um 500 e um formulário que diz o que fazer.
 */
export const dadosDoItemSchema = camposDoItemSchema
  .extend({ tipo: z.enum(TIPOS_QUE_O_ADMIN_CRIA) })
  .refine((d) => corBateComTipo(d.tipo, d.cor), {
    error: "Cor é obrigatória em moldura e cor do nome, e não existe nos outros tipos.",
    path: ["cor"],
  });

export type DadosDoItem = z.infer<typeof dadosDoItemSchema>;

/**
 * Cria o item — e, quando ele é badge, a imagem junto, na mesma transação.
 *
 * Badge SEM imagem não existe: a imagem é a identidade do produto (é ela que o
 * jogador vai ostentar), e `loja_itens` tem `check (tipo = 'badge') = (imagem_hash
 * is not null)` para que nem um caminho novo consiga criar um. Por isso a
 * validação da imagem vem antes de qualquer escrita.
 */
export async function criarItem(
  dados: DadosDoItem,
  imagem: Uint8Array | null,
): Promise<{ id: number } | ErroDeAdminDaLoja> {
  if (!corBateComTipo(dados.tipo, dados.cor)) return "dados-invalidos";

  const validada = dados.tipo === "badge" ? validarImagem(imagem ?? new Uint8Array()) : null;
  if (validada && !validada.ok) return validada.erro;

  return db.transaction(async (tx) => {
    const [novo] = await tx
      .insert(lojaItens)
      .values({
        tipo: dados.tipo,
        nome: dados.nome,
        descricao: dados.descricao,
        preco: dados.preco,
        cor: dados.cor,
        ativo: dados.ativo,
        imagemHash: validada?.ok ? validada.imagem.hash : null,
        // Só a linha semeada pela migration tem efeito, e ela não nasce daqui.
        efeito: null,
      })
      .returning({ id: lojaItens.id });

    if (validada?.ok) {
      await tx.insert(lojaImagens).values({
        itemId: novo.id,
        hash: validada.imagem.hash,
        mime: validada.imagem.mime,
        bytes: validada.imagem.bytes,
      });
    }

    return { id: novo.id };
  });
}

/**
 * Edita o que é editável. O TIPO não é.
 *
 * Ele vem do banco e não do formulário porque mudá-lo depois da venda mudaria o
 * que a pessoa comprou: um badge que virasse moldura sumiria da vitrine de quem
 * o tinha e apareceria no anel do avatar. E porque cada tipo tem um campo
 * obrigatório diferente — trocar o tipo exigiria a arte ou a cor que a linha não
 * tem.
 *
 * Imagem ausente MANTÉM a que está lá. É o que faz "corrigir o preço" não pedir
 * o upload de novo — e é por isso que o campo de arquivo do formulário é sempre
 * opcional na edição, inclusive para badge.
 */
export async function editarItem(
  id: number,
  campos: CamposDoItem,
  imagem: Uint8Array | null,
): Promise<ErroDeAdminDaLoja | null> {
  const validada = imagem && imagem.length > 0 ? validarImagem(imagem) : null;
  if (validada && !validada.ok) return validada.erro;

  return db.transaction(async (tx) => {
    const [atual] = await tx
      .select({ tipo: lojaItens.tipo })
      .from(lojaItens)
      .where(eq(lojaItens.id, id));
    if (!atual) return "item-nao-encontrado";
    if (!corBateComTipo(atual.tipo, campos.cor)) return "dados-invalidos";

    // Imagem só entra em badge. Mandar uma para uma moldura é ruído do
    // formulário (o campo existe na mesma tela), não pedido do admin — e gravá-la
    // quebraria o check que amarra imagem ao tipo.
    const trocaImagem = atual.tipo === "badge" && validada?.ok ? validada.imagem : null;

    if (trocaImagem) {
      await tx
        .insert(lojaImagens)
        .values({
          itemId: id,
          hash: trocaImagem.hash,
          mime: trocaImagem.mime,
          bytes: trocaImagem.bytes,
        })
        .onConflictDoUpdate({
          target: lojaImagens.itemId,
          set: {
            hash: trocaImagem.hash,
            mime: trocaImagem.mime,
            bytes: trocaImagem.bytes,
            // `now()` do Postgres, nunca `new Date()` em sql cru — regra do driver.
            atualizadoEm: sql`now()`,
          },
        });
    }

    await tx
      .update(lojaItens)
      .set({
        nome: campos.nome,
        descricao: campos.descricao,
        preco: campos.preco,
        cor: campos.cor,
        ativo: campos.ativo,
        ...(trocaImagem ? { imagemHash: trocaImagem.hash } : {}),
        atualizadoEm: sql`now()`,
      })
      .where(eq(lojaItens.id, id));

    return null;
  });
}

/**
 * Tira de venda, ou devolve à vitrine.
 *
 * Uma escrita só e sem transação: `ativo` é uma coluna, e o gesto do admin é um
 * clique numa lista. Passa pelo mesmo `item-nao-encontrado` das outras para a
 * tela não precisar distinguir "sumiu" de "não deu".
 */
export async function definirVenda(id: number, ativo: boolean): Promise<ErroDeAdminDaLoja | null> {
  const alterado = await db
    .update(lojaItens)
    .set({ ativo, atualizadoEm: sql`now()` })
    .where(eq(lojaItens.id, id))
    .returning({ id: lojaItens.id });
  return alterado.length > 0 ? null : "item-nao-encontrado";
}

/**
 * Apaga — só o que ninguém comprou e não tem efeito.
 *
 * Quem impede apagar item vendido é o `on delete restrict` de
 * `zenha_inventario`; o `catch` do 23503 só traduz a recusa do banco no slug
 * que a tela espera, em vez de um 500. Sem conferência prévia de vendas: ela
 * daria a MESMA resposta e abriria, entre a conferência e o DELETE, a janela em
 * que cabe uma compra — o banco decide numa statement só.
 *
 * A imagem cai junto por cascade (`loja_imagens.item_id`), que é o que se quer:
 * item apagado não deixa 200 KB órfãos no banco.
 */
export async function apagarItem(id: number): Promise<ErroDeAdminDaLoja | null> {
  const [atual] = await db
    .select({ efeito: lojaItens.efeito })
    .from(lojaItens)
    .where(eq(lojaItens.id, id));
  if (!atual) return "item-nao-encontrado";
  if (atual.efeito !== null) return "item-protegido";

  try {
    await db.delete(lojaItens).where(eq(lojaItens.id, id));
  } catch (erro) {
    if (isForeignKeyViolation(erro)) return "item-com-compras";
    throw erro;
  }
  return null;
}

/**
 * A linha do consumível, para o painel dizer onde mora o preço do multiplicador.
 *
 * Pelo efeito, e nunca pelo id: o id é linha de banco e muda entre dev, teste e
 * produção. A unique parcial garante que a resposta é uma só.
 */
export async function lerConsumivel(): Promise<{ id: number; nome: string } | undefined> {
  const [linha] = await db
    .select({ id: lojaItens.id, nome: lojaItens.nome })
    .from(lojaItens)
    .where(and(eq(lojaItens.tipo, "consumivel"), sql`${lojaItens.efeito} is not null`));
  return linha;
}

/** Só para a tela do admin: o rótulo de cada tipo. `Record` fechado de propósito. */
export const ROTULO_DO_TIPO: Readonly<Record<TipoDeItem, string>> = {
  consumivel: "Consumível",
  badge: "Badge",
  moldura: "Moldura",
  cor_do_nome: "Cor do nome",
  titulo: "Título",
};
