import { redirect } from "next/navigation";
import { hasDashboardSession } from "@/lib/session";

export default async function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (hasDashboardSession()) redirect("/");
  return (
    <main className="login">
      <h1>Clio Workflow Auditor</h1>
      <p className="muted">Enter the dashboard password to continue.</p>
      {searchParams.error ? <p className="danger">Incorrect password.</p> : null}
      <form action="/api/login" method="post">
        <label>
          Password
          <input type="password" name="password" autoFocus />
        </label>
        <button className="primary" type="submit">Log In</button>
      </form>
    </main>
  );
}
