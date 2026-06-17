globalThis.fetch = async (url) => {
  const parsed = new URL(typeof url === "string" ? url : url.url);
  if (parsed.pathname === "/external/v1/teams") {
    return new Response(JSON.stringify({ items: [{ name: "Operations", created_at: "2026-03-01T00:00:00.000Z" }], next_cursor: null, limit: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  throw new Error(`Unexpected mocked fetch URL: ${parsed.toString()}`);
};
