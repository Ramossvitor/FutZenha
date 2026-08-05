import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

// Defesa em profundidade: o proxy já protege /admin/*, mas Server Actions são
// endpoints públicos — toda action de admin deve chamar isto antes de mutar.
export async function requireAdmin(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token))) {
    redirect("/admin/login");
  }
}
