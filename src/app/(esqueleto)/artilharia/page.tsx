import { permanentRedirect } from "next/navigation";

// A artilharia virou uma aba dos rankings. A rota fica de pé como redirect
// permanente, e não é apagada, por dois motivos: `typedRoutes` está desligado,
// então um link esquecido para cá viraria 404 silencioso sem o tsc reclamar; e
// duas actions ainda chamam revalidatePath("/artilharia").
export default function ArtilhariaPage() {
  permanentRedirect("/rankings?aba=artilharia");
}
