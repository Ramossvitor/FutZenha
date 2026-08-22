// Imagens de verdade para fixture, geradas em vez de coladas em base64.
//
// Puro (`node:zlib` e nada mais) porque quatro lugares muito diferentes
// precisam delas: o seed do banco de desenvolvimento, o do E2E, os testes de
// integração da loja e o spec do Playwright que envia um arquivo pelo
// formulário do admin. Um blob base64 serviria a todos — mas todo badge do dev
// sairia com a MESMA arte, e a tela em que se está trabalhando é justamente a
// que mostra imagens lado a lado.
//
// São PNGs válidos, não bytes com cabeçalho de PNG: o navegador do E2E e o olho
// no passeio manual desenham estes arquivos. Para exercitar só a detecção de
// formato (`detectarMime`), cabeçalho solto basta e o teste monta o dele.

import { crc32, deflateSync } from "node:zlib";

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Um chunk de PNG: tamanho, tipo, dados e CRC32.
 *
 * O CRC cobre TIPO + DADOS, e não os dados sozinhos nem o tamanho junto — é a
 * definição do formato, e errar aí produz um arquivo que passa em `detectarMime`
 * (que só olha a assinatura) e falha no decodificador de verdade. `zlib.crc32`
 * do Node em vez de uma tabela à mão: é o mesmo polinômio, e código que ninguém
 * precisa revisar.
 */
function chunk(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dados]);
  const verificacao = Buffer.alloc(4);
  verificacao.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, verificacao]);
}

function canaisDaCor(cor: string): [number, number, number] {
  const casado = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cor);
  if (!casado) throw new Error(`Cor inválida para fixture de imagem: ${cor}`);
  return [
    Number.parseInt(casado[1], 16),
    Number.parseInt(casado[2], 16),
    Number.parseInt(casado[3], 16),
  ];
}

/**
 * Um PNG quadrado de cor sólida.
 *
 * Truecolor de 8 bits (color type 2) e filtro 0 em toda linha: é o subconjunto
 * mais simples que o formato oferece, e o que dispensa paleta, canal alfa e
 * qualquer decisão sobre pré-multiplicação. Sai com pouco mais de cem bytes —
 * um lado de 64px comprime a quase nada porque a imagem é uma cor só.
 */
export function pngDeUmaCor(cor: string, lado = 64): Buffer {
  const [r, g, b] = canaisDaCor(cor);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // truecolor RGB
  ihdr[10] = 0; // compressão (só existe o 0)
  ihdr[11] = 0; // método de filtro (só existe o 0)
  ihdr[12] = 0; // sem entrelaçamento

  // Cada linha começa com o byte de FILTRO — é isto que separa o formato de um
  // bitmap cru, e esquecê-lo desloca a imagem inteira em um pixel por linha.
  const linha = Buffer.alloc(1 + lado * 3);
  for (let x = 0; x < lado; x += 1) {
    linha[1 + x * 3] = r;
    linha[2 + x * 3] = g;
    linha[3 + x * 3] = b;
  }
  const cru = Buffer.concat(Array.from({ length: lado }, () => linha));

  return Buffer.concat([
    ASSINATURA,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(cru)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** O mesmo PNG embrulhado em `File`, que é o que uma Server Action recebe. */
export function arquivoPng(cor: string, nome = "badge.png"): File {
  const bytes = pngDeUmaCor(cor);
  return new File([new Uint8Array(bytes)], nome, { type: "image/png" });
}
