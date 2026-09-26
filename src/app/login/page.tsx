import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  google_not_configured: "Google login needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
  google_failed: "Google login failed – please try again or use email + password.",
  blocked: "This account has been blocked by the administrator.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const error = params.error ? (ERRORS[params.error] ?? params.error) : undefined;
  return <AuthForm mode="login" initialError={error} />;
}
