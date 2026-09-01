import { redirect } from "next/navigation";
import { getAuthContext } from "@/application/auth/session";
import { LoginScreen } from "@/components/auth/login-screen";
import { resolveDemoLoginPresentation } from "@/domain/auth/demo-access";

export default async function LoginPage() {
  if (await getAuthContext()) redirect("/");
  const demo = resolveDemoLoginPresentation(process.env);
  return <LoginScreen demo={demo} />;
}
