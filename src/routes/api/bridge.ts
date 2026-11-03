import { createFileRoute } from "@tanstack/react-router";
import { handleBridge } from "@/lib/desk/bridge.server";

const handle = ({ request }: { request: Request }) => handleBridge(request);

export const Route = createFileRoute("/api/bridge")({
  server: { handlers: { GET: handle, POST: handle } },
});
