import { NextResponse } from "next/server";
import { join } from "node:path";
import { isLocalMutationHost } from "@/lib/webPalaceAddNode";
import { registerWebPalaceFile } from "@/lib/webPalaceRegistration.server";

type RegistrationRequest = { project_id?: string; run_id?: string; title?: string; subject?: string; summary?: string };

export async function POST(request: Request) {
  const host = request.headers.get("host");
  if (!isLocalMutationHost(host)) return NextResponse.json({ message: "Brain registration is local-only." }, { status: 403 });
  const body = await request.json() as RegistrationRequest;
  if (!body.project_id || !/^[a-z0-9][a-z0-9-]*$/.test(body.project_id) || !body.run_id || !body.title || !body.subject || !body.summary) return NextResponse.json({ message: "The accepted project metadata is incomplete." }, { status: 422 });
  try {
    const result = await registerWebPalaceFile({
      registryPath: join(process.cwd(), "src", "data", "webPalaceRegistry.json"),
      appDirectory: join(process.cwd(), "src", "app"),
      candidate: {
        id: `generated-${body.project_id}`,
        title: body.title,
        subject: body.subject,
        destination: { type: "internal", href: `/generated?project=${encodeURIComponent(body.project_id)}` },
        status: "live",
        cluster: body.subject,
        summary: body.summary.slice(0, 280),
        tags: ["agent-created", body.subject.toLowerCase().slice(0, 40)],
        createdAt: new Date().toISOString().slice(0, 10)
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to register the accepted website." }, { status: 409 });
  }
}
