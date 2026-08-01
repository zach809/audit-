import { NextRequest, NextResponse } from "next/server";
import { auditOneMatterById } from "@/lib/audit";
import { initDb } from "@/lib/db";
import { isAuthorizedWorkerRequest } from "@/lib/session";

export const maxDuration = 300;

function redirectBack(request: NextRequest, params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return NextResponse.redirect(new URL(`/?${search.toString()}`, request.url), 303);
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const form = await request.formData();
  const filters = {
    attorney: form.get("attorney")?.toString() ?? "",
    overall: form.get("overall")?.toString() ?? "",
    from: form.get("from")?.toString() ?? "",
    to: form.get("to")?.toString() ?? "",
    tab: form.get("tab")?.toString() || "ongoing",
    wstatus: form.get("wstatus")?.toString() ?? "",
    wfocus: form.get("wfocus")?.toString() ?? "",
  };
  const matterIds = Array.from(
    new Set(form.getAll("matter_id").map((value) => value.toString().trim()).filter(Boolean)),
  ).slice(0, 25);

  if (!matterIds.length) {
    return redirectBack(request, { ...filters, audit: "failed", message: "No matters were selected for refresh." });
  }

  try {
    await initDb();
    let checked = 0;
    for (const matterId of matterIds) {
      await auditOneMatterById(undefined, matterId);
      checked += 1;
    }

    return redirectBack(request, {
      ...filters,
      audit: "ran",
      message: `Refreshed ${checked} matter${checked === 1 ? "" : "s"} from Clio proof. Template/email rows should clear if proof exists.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return redirectBack(request, { ...filters, audit: "failed", message: message.slice(0, 240) });
  }
}
