import { diagnosticMetadata } from '../config/error-diagnostic.js';

// Solo server.js inicia este ciclo; importar app.js no instala señales ni abre recursos.
export function startServer({ app, database, logger, config, runtime = process, shutdownTimeoutMs = 10000 }) {
  let server, listenerReady, connectionAttempt, stopping = false, closing, listenErrorLogged = false;
  function report(event, error, level = 'error') {
    if (!logger.writableEnded && logger.writable !== false) logger[level](event, diagnosticMetadata(error));
    else runtime.stderr?.write(`ShipNow: ${event}\n`);
  }
  function shutdown(code = 0) {
    if (code) runtime.exitCode = code;
    if (closing) return closing;
    stopping = true;
    closing = Promise.resolve().then(async () => {
      let failed = false;
      const deadline = setTimeout(() => {
        report('SERVER_SHUTDOWN_TIMEOUT', new Error('Se agotó el plazo de cierre.'), 'fatal');
        server?.closeAllConnections?.();
        runtime.exit(1);
      }, shutdownTimeoutMs);
      async function attempt(event, action) {
        try { await action(); }
        catch (error) { failed = true; runtime.exitCode = 1; report(event, error); }
      }
      try {
        await attempt('SERVER_CLOSE_FAILED', async () => {
          await listenerReady?.catch(() => {});
          await new Promise((resolve, reject) => {
            if (!server?.listening) return resolve();
            server.close(error => error ? reject(error) : resolve());
          });
        });
        await attempt('MONGODB_DISCONNECT_FAILED', async () => {
          await connectionAttempt?.catch(() => {});
          await database.disconnect();
        });
        await attempt('LOGGER_CLOSE_FAILED', async () => {
          try {
            if (!logger.writableFinished && logger.writable !== false) await new Promise((resolve, reject) => {
              const finish = () => { logger.off('error', failed); resolve(); };
              const failed = error => { logger.off('finish', finish); reject(error); };
              logger.once('finish', finish);
              logger.once('error', failed);
              logger.end();
            });
          } finally { logger.close(); }
        });
      } finally {
        clearTimeout(deadline);
        runtime.off('SIGINT', signal);
        runtime.off('SIGTERM', signal);
      }
      // Una desconexión fallida puede dejar handles vivos incluso tras rechazar.
      if (failed) {
        server?.closeAllConnections?.();
        runtime.exit(1);
      }
    });
    return closing;
  }
  const signal = () => { void shutdown(); };
  runtime.on('SIGINT', signal);
  runtime.on('SIGTERM', signal);

  function listen() {
    listenerReady = new Promise((resolve, reject) => {
      const failed = error => {
        listenErrorLogged = true;
        report('SERVER_LISTEN_FAILED', error, 'fatal');
        reject(error);
        void shutdown(1);
      };
      try {
        server = app.listen(config.port, () => { if (!stopping) logger.info('SERVER_LISTENING'); resolve(); });
        server.on('error', failed);
      } catch (error) { failed(error); }
    });
    return listenerReady;
  }
  function connect() {
    connectionAttempt = Promise.resolve().then(() => database.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000 }))
      .then(() => { if (!stopping) logger.info('MONGODB_CONNECTED'); });
    return connectionAttempt;
  }
  const ready = (async () => {
    try {
      if (config.nodeEnv === 'production') {
        await connect();
        if (!stopping) await listen();
      } else {
        await listen();
        if (!stopping) void connect().catch(error => report('MONGODB_CONNECTION_FAILED', error));
      }
    } catch (error) {
      if (stopping) { await closing; return; }
      if (!listenErrorLogged) report('MONGODB_CONNECTION_FAILED', error, 'fatal');
      await shutdown(1);
    }
  })();
  return { ready, shutdown };
}
