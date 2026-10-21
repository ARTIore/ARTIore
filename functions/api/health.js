export function onRequestGet() {
  return Response.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      message: "Hello World!",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
