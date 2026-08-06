import { z } from "zod";

// Compartilhado entre criar (/grupos/novo) e editar (/grupo/[id]/gerenciar),
// pelo mesmo motivo de ./match-day-form: são os mesmos campos, e duplicar o
// schema deixaria as validações divergirem na primeira mudança.
//
// `visibility` e `joinPolicy` passam por `z.enum` e não por um cast. Server
// Action é endpoint POST público — o `<select>` da tela não valida nada, e sem
// o enum um `visibility=publico` (ou qualquer string) chegaria ao insert e o
// Postgres devolveria erro 500 em vez de "dados inválidos". Pior no update:
// gravar lixo na coluna que decide quem enxerga o grupo.
const grupoSchema = z.object({
  name: z.string().trim().min(3, "Nome muito curto").max(60),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
  visibility: z.enum(["private", "public"]),
  joinPolicy: z.enum(["request", "open"]),
});

export function parseGrupoForm(formData: FormData) {
  return grupoSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    visibility: formData.get("visibility") ?? "",
    joinPolicy: formData.get("joinPolicy") ?? "",
  });
}
