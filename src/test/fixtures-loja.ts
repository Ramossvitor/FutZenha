// Construtores de itens da loja para os testes de integração.
//
// ── Por que o multiplicador precisa de fixture ──────────────────────────────
//
// A linha do consumível nasce na migration 0033, mas o `limparBanco()` do
// beforeEach trunca TODAS as tabelas do schema — inclusive `loja_itens`. Então
// dentro da suíte ela NÃO existe, e todo teste que fala do multiplicador tem que
// pedir `garantirMultiplicador()` primeiro. É o preço de o truncate ser
// indiscriminado, e ele vale: um teste que dependesse de dado semeado por
// migration passaria a depender da ordem em que as suítes rodam.
//
// As imagens são PNGs de verdade (ver ./fixtures-imagem), com cor derivada do
// nome: dois badges diferentes têm bytes diferentes, e portanto hashes e URLs
// diferentes — que é exatamente o que os testes da rota de imagem precisam.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojaImagens, lojaItens, type LojaTipo, type Player } from "@/db/schema";
import { creditar } from "@/lib/carteira";
import { hashDaImagem } from "@/lib/imagem-de-item";
import type { ItemDaLoja } from "@/lib/item-da-loja";
import { criarJogadorComConta } from "./fixtures";
import { pngDeUmaCor } from "./fixtures-imagem";

let contador = 0;

/** Uma cor estável e distinta por chamada, para dois badges nunca terem a mesma arte. */
function proximaCor(): string {
  contador += 1;
  // Fica longe do preto e do branco de propósito: estas imagens acabam olhadas
  // por gente no banco de desenvolvimento.
  const canal = (deslocamento: number) => (60 + ((contador * 37 + deslocamento) % 160)) % 256;
  return `#${[canal(0), canal(70), canal(140)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

type ExtraDoItem = Partial<Omit<typeof lojaItens.$inferInsert, "tipo">> & { tipo: LojaTipo };

/**
 * Um item da loja. Badge ganha imagem junto, porque o `check` do banco cobra
 * `imagem_hash` de todo badge — e um badge sem imagem não é um badge.
 */
export async function criarItemDaLoja(extra: ExtraDoItem): Promise<ItemDaLoja> {
  const cor = extra.cor ?? proximaCor();
  const imagem = extra.tipo === "badge" ? pngDeUmaCor(cor) : null;

  const [item] = await db
    .insert(lojaItens)
    .values({
      nome: `Item ${contador}`,
      descricao: "",
      preco: 250,
      ...extra,
      // A cor só entra onde o check a aceita; nos outros tipos ela precisa ser
      // nula, e a fixture não pode ser mais permissiva que o banco.
      cor: extra.tipo === "moldura" || extra.tipo === "cor_do_nome" ? cor : null,
      imagemHash: imagem ? hashDaImagem(imagem) : null,
    })
    .returning();

  if (imagem) {
    await db.insert(lojaImagens).values({
      itemId: item.id,
      hash: hashDaImagem(imagem),
      mime: "image/png",
      bytes: imagem,
    });
  }

  return { ...item, efeito: item.efeito === "multiplicador" ? "multiplicador" : null };
}

export function criarBadge(nome = "Dono da bola", preco = 250): Promise<ItemDaLoja> {
  return criarItemDaLoja({ tipo: "badge", nome, preco });
}

export function criarMoldura(nome = "Moldura de ouro", preco = 600): Promise<ItemDaLoja> {
  return criarItemDaLoja({ tipo: "moldura", nome, preco });
}

export function criarCorDoNome(nome = "Nome brasa", preco = 400): Promise<ItemDaLoja> {
  return criarItemDaLoja({ tipo: "cor_do_nome", nome, preco });
}

export function criarTitulo(nome = "Camisa 10", preco = 750): Promise<ItemDaLoja> {
  return criarItemDaLoja({ tipo: "titulo", nome, preco });
}

/**
 * A linha do consumível — a única que o CÓDIGO exige existir.
 *
 * `preco` é o primeiro degrau da escada do mês; os outros saem dele por
 * `precoDoMultiplicador`. O padrão de 120 é o mesmo que a migration semeia, para
 * o teste e a produção falarem do mesmo número.
 *
 * GARANTE, e não cria: existe UM multiplicador, e a unique parcial sobre
 * `efeito` recusa o segundo. Chamar duas vezes no mesmo teste é comum (um helper
 * pede, o corpo do teste pede de novo) e não pode estourar — a segunda chamada
 * ajusta o preço e devolve a mesma linha, que é o que "garantir" promete.
 */
export async function garantirMultiplicador(preco = 120): Promise<ItemDaLoja> {
  const [existente] = await db
    .select()
    .from(lojaItens)
    .where(eq(lojaItens.efeito, "multiplicador"));

  if (existente) {
    if (existente.preco === preco) return { ...existente, efeito: "multiplicador" };
    const [atualizado] = await db
      .update(lojaItens)
      .set({ preco })
      .where(eq(lojaItens.id, existente.id))
      .returning();
    return { ...atualizado, efeito: "multiplicador" };
  }

  return criarItemDaLoja({
    tipo: "consumivel",
    nome: "Multiplicador de nota",
    preco,
    efeito: "multiplicador",
  });
}

/**
 * Jogador logável com saldo de estreia.
 *
 * `boas_vindas` é a única porta de entrada de zenha que não depende de liquidar
 * um fut inteiro — no app ninguém ganha por existir, mas aqui é o que deixa o
 * teste falar de compra sem montar uma temporada.
 */
export async function jogadorComSaldo(saldo: number): Promise<Player> {
  const { jogador } = await criarJogadorComConta();
  if (saldo > 0) {
    await creditar(db, [
      {
        playerId: jogador.id,
        motivo: "boas_vindas",
        amount: saldo,
        dedupeKey: "boas-vindas",
        descricao: "Boas-vindas ao FutZenha",
      },
    ]);
  }
  return jogador;
}
