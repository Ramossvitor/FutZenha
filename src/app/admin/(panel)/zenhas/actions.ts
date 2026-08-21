"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { ID_DO_MULTIPLICADOR, chaveDePreco, itensAVenda } from "@/lib/loja-catalogo";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { AJUSTES, CHAVES_DE_AJUSTE } from "@/lib/zenha";
import { limparAjuste, salvarAjuste } from "@/lib/zenha-config";

// O painel manda a seção inteira de uma vez, e não um campo por submit: mexer na
// economia é quase sempre mexer em dois ou três números que só fazem sentido
// juntos (o prêmio da sequência e o tamanho dela, o preço-base e o fator). Um
// POST por campo obrigaria o admin a salvar cada metade de uma decisão sozinha,
// com a tela passando por estados que ele não escolheu.

/** O que a página monta em cada campo, e o que esta action volta a procurar. */
type CampoConhecido = { chave: string; padrao: number };

/**
 * As chaves que o formulário pode conter — derivadas, nunca escritas à mão.
 *
 * Chave de ajuste nova em zenha.ts e item novo no catálogo passam a ser
 * salváveis sem tocar aqui, que é a mesma promessa que a página faz ao iterar
 * `AJUSTES` em vez de listar os campos.
 *
 * O multiplicador fica de fora dos preços de propósito: o preço dele não sai do
 * catálogo, sai da escada sobre `multiplicador_preco_base` — que já é um dos
 * ajustes acima. Aceitar `preco:multiplicador-de-nota` gravaria uma linha que
 * ninguém lê e faria o admin acreditar ter mudado um preço que seguiu igual.
 */
function camposConhecidos(): CampoConhecido[] {
  const campos: CampoConhecido[] = CHAVES_DE_AJUSTE.map((chave) => ({
    chave,
    padrao: AJUSTES[chave].padrao,
  }));
  for (const item of itensAVenda()) {
    if (item.id === ID_DO_MULTIPLICADOR) continue;
    campos.push({ chave: chaveDePreco(item.id), padrao: item.preco });
  }
  return campos;
}

// O campo do formulário é texto; o que a economia guarda é inteiro. O `trim`
// separa o campo esvaziado (que volta ao padrão) do campo com lixo dentro.
const valorSchema = z.coerce.number().int();

/** Marca o campo que a página deve destacar, sem vazar texto para a query. */
function recusar(chave: string): never {
  redirect(`/admin/zenhas?erro=ajuste-recusado&campo=${encodeURIComponent(chave)}`);
}

/**
 * Aborta a gravação inteira quando um valor é recusado.
 *
 * Sai como exceção, e não como `return`, porque a única forma de desfazer os
 * ajustes já gravados no mesmo submit é derrubar a transação — e o `redirect`
 * não pode acontecer lá dentro: ele também é uma exceção, e sair da transação
 * por ela deixaria o rollback certo com o motivo errado no log.
 */
class AjusteRecusado extends Error {
  constructor(readonly chave: string) {
    super(`Ajuste recusado: ${chave}`);
    this.name = "AjusteRecusado";
  }
}

/**
 * Grava os ajustes de uma seção do painel.
 *
 * Tudo ou nada: o primeiro valor recusado derruba a transação, então o admin
 * nunca fica com metade de uma decisão aplicada — e a mensagem pode dizer "nada
 * foi salvo" sem mentir.
 *
 * Campo vazio e caixa "voltar ao padrão" marcada são a MESMA coisa: apagam a
 * sobrescrita. É o que o placeholder do campo já promete — sem número escrito, o
 * que vale é o padrão do código.
 *
 * Digitar exatamente o padrão também apaga, em vez de gravar. `zenha_config`
 * guarda só o que foi mudado: uma linha com o número de hoje congelaria o número
 * de hoje, e o valor deixaria de acompanhar sozinho uma mudança futura em
 * zenha.ts (ver `limparAjuste`).
 */
export async function salvarAjustes(formData: FormData) {
  const session = await requirePlatformAdmin();

  // A leitura e o parse vêm antes de qualquer escrita: lixo digitado num campo
  // volta com a tela intocada, sem depender do rollback.
  const pedidos: { chave: string; valor: number | null }[] = [];
  for (const { chave, padrao } of camposConhecidos()) {
    const bruto = formData.get(chave);
    // Ausente quer dizer campo de outra seção — cada formulário manda os seus.
    if (typeof bruto !== "string") continue;

    if (bruto.trim() === "" || formData.get(`padrao:${chave}`) !== null) {
      pedidos.push({ chave, valor: null });
      continue;
    }

    const parsed = valorSchema.safeParse(bruto);
    if (!parsed.success) recusar(chave);
    pedidos.push({ chave, valor: parsed.data === padrao ? null : parsed.data });
  }

  try {
    await db.transaction(async (tx) => {
      for (const pedido of pedidos) {
        if (pedido.valor === null) {
          await limparAjuste(tx, pedido.chave);
          continue;
        }
        // A faixa, a lista fechada e o teto de preço são de `salvarAjuste`: ele
        // é o dono da regra e o único que a aplica na escrita. Repetir a
        // validação aqui daria dois lugares para divergirem.
        const recusa = await salvarAjuste(tx, pedido.chave, pedido.valor, session.player.id);
        if (recusa !== null) throw new AjusteRecusado(pedido.chave);
      }
    });
  } catch (erro) {
    if (erro instanceof AjusteRecusado) recusar(erro.chave);
    throw erro;
  }

  revalidatePath("/admin/zenhas");
  // O guia mostra a tabela de ganho com os valores VIGENTES (ver
  // src/app/guia/valores-da-zenha.tsx). Sem isto ele seguiria prometendo o
  // número velho a quem abriu justamente para conferir quanto vale aparecer.
  revalidatePath("/guia");
  redirect("/admin/zenhas?ok=ajustes-salvos");
}
