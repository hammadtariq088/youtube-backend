import app from "./app.js";

const rawPort = process.env.PORT ?? "10000";
const port = Number(rawPort);

if (isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`[convertx-api] Server listening on port ${port}`);
  console.log(`[convertx-api] Environment: ${process.env.NODE_ENV ?? "development"}`);
});
