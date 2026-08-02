import { Dashboard } from "./dashboard";
import { requireUser } from "@/src/lib/auth";

export default async function Home() {
  if (process.env.AUTH_REQUIRED === "true") {
    await requireUser("/");
  }

  return <Dashboard />;
}
