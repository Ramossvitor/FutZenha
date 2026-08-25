"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  apagarItem,
  camposDoItemSchema,
  criarItem,
  dadosDoItemSchema,
  definirVenda,
  editarItem,
  type ErroDeAdminDaLoja,
} from "@/lib/loja-admin";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";

// O cadastro da loja. Cinco portas, todas começando por `requirePlatformAdmin()`
// — Server Action é POST público que nem passa pelo proxy, então o guard da
// página é rede e este é a garantia (ver src/lib/require-platform-admin.ts).
//
// As REGRAS não moram aqui: quem valida é `dadosDoItemSchema` e as funções de
// src/lib/loja-admin.ts, que são as donas. Este arquivo só traduz FormData em
// argumento e slug em redirect.

const idSchema = z.number().int().positive();

/**
 * O slug do erro virando query string — com a INTERROGAÇÃO junto.
 *
 * Os slugs vão escritos, um por linha, e o `?` faz parte de cada string: o teste
 * de cobertura de src/lib/mensagens.ts varre o FONTE atrás do par `?erro=…`, e
 * quem monta a URL com `?${paraQuery(erro)}` deixa a varredura sem enxergar
 * nenhum deles — o dia em que um ficasse sem mensagem, o banner sumiria calado.
 * Com o `?` aqui dentro, cada caso aparece inteiro no fonte.
 *
 * O `switch` fechado (com o `satisfies never`) é o par disto: slug novo em
 * `ErroDeAdminDaLoja` sem linha aqui não compila.
 */
function comErro(erro: ErroDeAdminDaLoja): string {
  switch (erro) {
    case "dados-invalidos":
      return "?erro=dados-invalidos";
    case "imagem-ausente":
      return "?erro=imagem-ausente";
    case "imagem-grande":
      return "?erro=imagem-grande";
    case "imagem-invalida":
      return "?erro=imagem-invalida";
    case "item-nao-encontrado":
      return "?erro=item-nao-encontrado";
    case "item-com-compras":
      return "?erro=item-com-compras";
    case "item-protegido":
      return "?erro=item-protegido";
    default:
      erro satisfies never;
      return "?erro=dados-invalidos";
  }
}

/**
 * O arquivo do formulário virando bytes — ou `null` quando não veio nenhum.
 *
 * Campo vazio chega como `File` de tamanho zero (o navegador manda o input
 * mesmo sem seleção), e é por isso que o `size === 0` está aqui e não só na
 * validação: na EDIÇÃO, "nenhum arquivo" quer dizer "mantenha a imagem que está
 * lá", e tratar o vazio como erro obrigaria a reenviar a arte a cada correção de
 * preço.
 */
async function lerImagemDoFormulario(formData: FormData): Promise<Uint8Array | null> {
  const arquivo = formData.get("imagem");
  if (!(arquivo instanceof File) || arquivo.size === 0) return null;
  return new Uint8Array(await arquivo.arrayBuffer());
}

/**
 * Os campos de texto do formulário, prontos para o zod.
 *
 * A cor só é lida quando o tipo a pede: o campo `<input type="color">` SEMPRE
 * manda um valor (o navegador não tem "cor vazia", ele começa em `#000000`), e
 * mandá-lo num badge gravaria preto numa coluna que precisa ser nula — o check
 * do banco recusaria, e o admin veria um 500 no lugar de um cadastro.
 */
function camposDoFormulario(formData: FormData, tipo: string) {
  const querCor = tipo === "moldura" || tipo === "cor_do_nome";
  return {
    nome: formData.get("nome") ?? "",
    descricao: formData.get("descricao") ?? "",
    preco: formData.get("preco") ?? "",
    // Minúsculas na entrada: o `check` do banco e o `REGEX_DE_COR` cobram a
    // forma canônica, e quem posta na mão pode mandar `#AABBCC`.
    cor: querCor ? String(formData.get("cor") ?? "").toLowerCase() : null,
    // Checkbox ausente é desmarcado — HTML não manda campo não marcado.
    ativo: formData.get("ativo") === "on",
  };
}

export async function criarItemAction(formData: FormData) {
  await requirePlatformAdmin();

  const tipo = String(formData.get("tipo") ?? "");
  // O tipo volta na query junto com o erro: é ele que decide a forma do
  // formulário (ver novo/page.tsx), e sem ele a tela reabriria como badge para
  // quem estava cadastrando uma moldura. Depois do erro, de propósito: o
  // scanner de src/lib/mensagens.test.ts varre o fonte atrás de `erro=` com o
  // slug colado logo após a interrogação.
  const deVolta = `&tipo=${encodeURIComponent(tipo)}`;
  const parsed = dadosDoItemSchema.safeParse({ tipo, ...camposDoFormulario(formData, tipo) });
  if (!parsed.success) redirect(`/admin/loja/novo?erro=dados-invalidos${deVolta}`);

  const resultado = await criarItem(parsed.data, await lerImagemDoFormulario(formData));
  if (typeof resultado === "string") redirect(`/admin/loja/novo${comErro(resultado)}${deVolta}`);

  revalidatePath("/admin/loja");
  revalidatePath("/loja");
  redirect(`/admin/loja/${resultado.id}?ok=item-criado`);
}

export async function editarItemAction(id: number, formData: FormData) {
  await requirePlatformAdmin();

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) redirect("/admin/loja?erro=item-nao-encontrado");

  // O tipo vem do formulário só para decidir se a cor é lida; quem manda de
  // verdade é o tipo GRAVADO, que `editarItem` relê do banco. Tipo é imutável —
  // ver o docblock de lá.
  const campos = camposDoItemSchema.safeParse(
    camposDoFormulario(formData, String(formData.get("tipo") ?? "")),
  );
  if (!campos.success) redirect(`/admin/loja/${parsed.data}?erro=dados-invalidos`);

  const erro = await editarItem(parsed.data, campos.data, await lerImagemDoFormulario(formData));
  // Item que sumiu (apagado noutra aba) não tem tela para onde voltar: a página
  // dele responde 404 e o aviso nunca apareceria. A lista é quem explica.
  if (erro === "item-nao-encontrado") redirect("/admin/loja?erro=item-nao-encontrado");
  if (erro) redirect(`/admin/loja/${parsed.data}${comErro(erro)}`);

  revalidatePath("/admin/loja");
  revalidatePath("/loja");
  revalidatePath(`/loja/${parsed.data}`);
  redirect(`/admin/loja/${parsed.data}?ok=item-salvo`);
}

/**
 * Tira de venda, ou devolve à vitrine.
 *
 * Um booleano no `.bind`, e não duas actions: o gesto é o mesmo e o texto do
 * banner é a única diferença. `z.boolean().parse` porque ele também viaja no
 * corpo do POST — mesmo cuidado do `setPlayerActive` do painel de jogadores.
 */
export async function definirVendaAction(id: number, ativo: boolean) {
  await requirePlatformAdmin();

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) redirect("/admin/loja?erro=item-nao-encontrado");
  const querVender = z.boolean().parse(ativo);

  const erro = await definirVenda(parsed.data, querVender);
  if (erro) redirect(`/admin/loja${comErro(erro)}`);

  revalidatePath("/admin/loja");
  revalidatePath("/loja");
  revalidatePath(`/loja/${parsed.data}`);
  if (querVender) redirect("/admin/loja?ok=item-republicado");
  redirect("/admin/loja?ok=item-retirado");
}

/**
 * Apaga — e só consegue o que ninguém comprou.
 *
 * O destino do sucesso é a LISTA, e não a tela do item: ela não existe mais.
 */
export async function apagarItemAction(id: number) {
  await requirePlatformAdmin();

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) redirect("/admin/loja?erro=item-nao-encontrado");

  const erro = await apagarItem(parsed.data);
  // Mesmo motivo de `editarItemAction`: a tela do item já não existe.
  if (erro === "item-nao-encontrado") redirect("/admin/loja?erro=item-nao-encontrado");
  if (erro) redirect(`/admin/loja/${parsed.data}${comErro(erro)}`);

  revalidatePath("/admin/loja");
  revalidatePath("/loja");
  redirect("/admin/loja?ok=item-apagado");
}
