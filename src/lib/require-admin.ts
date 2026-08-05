import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./session";

// Defesa em profundidade: o proxy já protege /admin/*, mas Server Actions são
// endpoints públicos — toda action de admin deve chamar isto antes de mutar.
export async function requireAdmin(): Promise<void> {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    redirect("/admin/login");
  }
}
