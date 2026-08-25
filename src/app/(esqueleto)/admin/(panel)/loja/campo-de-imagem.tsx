"use client";

import { useRef, useState } from "react";
import { Field } from "@/components/ui/field";
import { TAMANHO_MAXIMO_DA_IMAGEM } from "@/lib/item-da-loja";

// O campo de arte do badge.
//
// ── O recorte é MELHORIA PROGRESSIVA, e não requisito ───────────────────────
//
// Sem JavaScript (ou com um navegador que não sabe `createImageBitmap`), o
// arquivo cru vai como está e o servidor valida do mesmo jeito: magic bytes e
// 200 KB. Nada aqui é a trava — a trava é `validarImagem`, no servidor. O que
// isto faz é transformar "a foto do meu celular tem 4 MB" em um upload que passa,
// sem pedir ao admin que abra um editor de imagem.
//
// O recorte é CENTRAL e quadrado porque a vitrine é uma grade de quadrados: com
// retângulo o `object-cover` cortaria de qualquer jeito na hora de desenhar, e
// cortar aqui é o único momento em que a pessoa VÊ o corte antes de salvar.

const LADO = 256;

/** Um número de bytes em algo que se lê num rótulo. */
function emKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * O WebP comprime bem melhor que o PNG numa foto, mas nem todo navegador sabe
 * ESCREVER webp num canvas — e `toBlob` com um tipo que ele não conhece devolve
 * PNG em silêncio, o que daria um arquivo com a extensão errada. Perguntar antes
 * é o que mantém o nome do arquivo honesto.
 */
function suportaWebp(canvas: HTMLCanvasElement): boolean {
  return canvas.toDataURL("image/webp").startsWith("data:image/webp");
}

async function reduzir(arquivo: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(arquivo);
    const canvas = document.createElement("canvas");
    canvas.width = LADO;
    canvas.height = LADO;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // O maior quadrado que cabe na imagem, centralizado.
    const lado = Math.min(bitmap.width, bitmap.height);
    const x = (bitmap.width - lado) / 2;
    const y = (bitmap.height - lado) / 2;
    ctx.drawImage(bitmap, x, y, lado, lado, 0, 0, LADO, LADO);
    bitmap.close();

    const webp = suportaWebp(canvas);
    const tipo = webp ? "image/webp" : "image/png";
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, 0.9));
    if (!blob) return null;

    return new File([blob], `badge.${webp ? "webp" : "png"}`, { type: tipo });
  } catch {
    // HEIC, arquivo corrompido, imagem gigante demais para o canvas: o original
    // segue para o servidor, que recusa com texto se for o caso.
    return null;
  }
}

export function CampoDeImagem({
  id = "campo-imagem",
  ajuda,
  obrigatorio = false,
}: {
  id?: string;
  ajuda?: string;
  obrigatorio?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<{ url: string; bytes: number } | null>(null);

  async function aoEscolher(evento: React.ChangeEvent<HTMLInputElement>) {
    const escolhido = evento.target.files?.[0];
    if (!escolhido) {
      // Limpar também solta o blob da prévia anterior — pela mesma razão do
      // `revokeObjectURL` logo abaixo.
      setPrevia((anterior) => {
        if (anterior) URL.revokeObjectURL(anterior.url);
        return null;
      });
      return;
    }

    const reduzido = await reduzir(escolhido);
    if (reduzido && inputRef.current) {
      // A ÚNICA forma de trocar o arquivo que o formulário vai enviar: a
      // propriedade `files` de um input só aceita uma FileList, e `DataTransfer`
      // é o jeito de fabricar uma. Sem isto o recorte existiria só na prévia e o
      // servidor receberia os 4 MB originais.
      const dt = new DataTransfer();
      dt.items.add(reduzido);
      inputRef.current.files = dt.files;
    }

    const arquivo = reduzido ?? escolhido;
    setPrevia((anterior) => {
      // Um objeto de URL vive até alguém revogá-lo; sem isto, trocar de arquivo
      // dez vezes deixaria dez blobs presos na memória da aba.
      if (anterior) URL.revokeObjectURL(anterior.url);
      return { url: URL.createObjectURL(arquivo), bytes: arquivo.size };
    });
  }

  const grande = previa !== null && previa.bytes > TAMANHO_MAXIMO_DA_IMAGEM;

  return (
    <Field
      htmlFor={id}
      label="Imagem"
      obrigatorio={obrigatorio}
      ajuda={ajuda}
      erro={
        grande
          ? `A imagem ficou com ${emKb(previa.bytes)} e o limite é ${emKb(
              TAMANHO_MAXIMO_DA_IMAGEM,
            )}. Escolha outra — esta vai ser recusada.`
          : undefined
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        {previa && (
          // `<img>` cru: a fonte é uma blob: URL do arquivo que a pessoa acabou
          // de escolher — não existe nada para o otimizador otimizar. A isenção
          // do `no-img-element` para este arquivo está no eslint.config.mjs.
          <img
            src={previa.url}
            alt="Prévia da imagem escolhida"
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-ctl bg-surface-2 object-cover"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            ref={inputRef}
            id={id}
            name="imagem"
            type="file"
            // A lista fechada no `accept` é conveniência do seletor de arquivos,
            // nunca segurança: quem posta na mão ignora o atributo, e é por isso
            // que a detecção de verdade lê os magic bytes no servidor.
            accept="image/png,image/jpeg,image/webp"
            onChange={aoEscolher}
            aria-invalid={grande || undefined}
            className="min-w-0 text-[13px] text-fg-2 file:mr-3 file:h-10 file:cursor-pointer file:rounded-ctl file:border file:border-line-strong file:bg-surface-2 file:px-3 file:font-display file:text-[13px] file:font-semibold file:text-fg-2"
          />
          {previa && !grande && (
            <span className="text-[12px] text-fg-4">
              Vai como <span data-num>{emKb(previa.bytes)}</span>, quadrada de{" "}
              <span data-num>
                {LADO}×{LADO}
              </span>
              .
            </span>
          )}
        </div>
      </div>
    </Field>
  );
}
