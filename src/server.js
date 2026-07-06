import express from "express";

export function createApp() {
  const app = express();
  app.get("/healthz", (req, res) => res.json({ status: "ok" }));
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`listening on ${port}`));
}
