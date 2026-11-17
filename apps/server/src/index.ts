import { buildApp } from "./app.js";
import { config } from "./config.js";
import { disposeSearchPool } from "./services/search-pool.js";

const app = await buildApp();

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`legado-web listening on http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void disposeSearchPool();
    app.close().then(() => process.exit(0));
  });
}
