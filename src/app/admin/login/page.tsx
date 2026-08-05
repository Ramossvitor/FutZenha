import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Login" };

export default function LoginPage() {
  return (
    <div className="mx-auto mt-16 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h1 className="mb-4 text-xl font-bold">Área do admin</h1>
      <LoginForm />
    </div>
  );
}
