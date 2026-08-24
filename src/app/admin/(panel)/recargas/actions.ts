"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { criarPacote, definirPacoteAtivo, salvarPacote, type DadosDoPacote } from "@/lib/recarga-admin";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";

// O CRUD dos pacotes de recarga. O padrão é o de /admin/loja: parse aqui,
// regra no módulo (src/lib/recarga-admin.ts), slugs escritos um por linha por
// causa do teste de cobertura de src/lib/mensagens.ts.

const idSchema = z.coerce.number().int().positive();

/**
 * O preço chega em REAIS ("10" ou "10,50") e vira centavos aqui, na fronteira:
 * o resto do sistema só fala centavos. A vírgula é trocada por ponto antes do
 * parse porque o teclado numérico brasileiro digita vírgula.
 */
function paraCentavos(bruto: FormDataEntryValue | null): number | null {
  if (typeof bruto !== "string" || bruto.trim() === "") return null;
  const reais = Number(bruto.trim().replace(",", "."));
  if (!Number.isFinite(reais)) return null;
  return Math.round(reais * 100);
}

function dadosDoForm(formData: FormData): DadosDoPacote | null {
  const nome = formData.get("nome");
  const precoCentavos = paraCentavos(formData.get("preco"));
  const zenhas = z.coerce.number().int().safeParse(formData.get("zenhas"));
  const ordem = z.coerce.number().int().safeParse(formData.get("ordem"));
  if (typeof nome !== "string" || precoCentavos === null || !zenhas.success || !ordem.success) {
    return null;
  }
  return { nome, precoCentavos, zenhas: zenhas.data, ordem: ordem.data };
}

export async function criarPacoteAction(formData: FormData) {
  await requirePlatformAdmin();

  const dados = dadosDoForm(formData);
  if (dados === null) redirect("/admin/recargas?erro=dados-invalidos");

  const erro = await criarPacote(db, dados);
  if (erro !== null) redirect("/admin/recargas?erro=dados-invalidos");

  revalidatePath("/admin/recargas");
  revalidatePath("/zenhas/recarga");
  redirect("/admin/recargas?ok=pacote-criado");
}

export async function salvarPacoteAction(pacoteId: number, formData: FormData) {
  await requirePlatformAdmin();

  const id = idSchema.safeParse(pacoteId);
  const dados = dadosDoForm(formData);
  if (!id.success || dados === null) redirect("/admin/recargas?erro=dados-invalidos");

  const erro = await salvarPacote(db, id.data, dados);
  if (erro === "pacote-nao-encontrado") redirect("/admin/recargas?erro=pacote-nao-encontrado");
  if (erro !== null) redirect("/admin/recargas?erro=dados-invalidos");

  revalidatePath("/admin/recargas");
  revalidatePath("/zenhas/recarga");
  redirect("/admin/recargas?ok=pacote-salvo");
}

export async function alternarPacoteAction(pacoteId: number, ativo: boolean) {
  await requirePlatformAdmin();

  const id = idSchema.safeParse(pacoteId);
  if (!id.success) redirect("/admin/recargas?erro=pacote-nao-encontrado");

  const erro = await definirPacoteAtivo(db, id.data, ativo);
  if (erro !== null) redirect("/admin/recargas?erro=pacote-nao-encontrado");

  revalidatePath("/admin/recargas");
  revalidatePath("/zenhas/recarga");
  if (ativo) redirect("/admin/recargas?ok=pacote-republicado");
  redirect("/admin/recargas?ok=pacote-retirado");
}
