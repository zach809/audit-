import { redirect } from "next/navigation";
import { APP_VERSION } from "@/lib/version";
import { hasCaseManagerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function CaseManagerLoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (hasCaseManagerSession()) redirect("/case-manager");

  return (
    <main className="cm-login-shell">
      <section className="cm-login-card">
        <div>
          <span className="label">Case Manager Portal</span>
          <h1>Workflow Tasks</h1>
          <p className="muted">Complete the work in Clio, then ask CWCA to verify it before the task clears.</p>
        </div>
        {searchParams.error ? (
          <p className="login-error">That case-manager login did not match. Please try again.</p>
        ) : null}
        <form className="login-form" action="/api/case-manager/login" method="post">
          <label>
            Name
            <input name="name" type="text" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="primary" type="submit">Open Tasks</button>
        </form>
        <small className="muted">Version: {APP_VERSION}</small>
      </section>
    </main>
  );
}
