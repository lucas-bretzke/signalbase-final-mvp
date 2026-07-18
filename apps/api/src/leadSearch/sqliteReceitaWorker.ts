import { parentPort, workerData } from 'node:worker_threads';
import { SqliteReceitaDatabase } from './sqliteReceitaDatabase.js';
import { SqliteWorkerOptions, SqliteWorkerRequest, SqliteWorkerResponse, SqliteWorkerResult } from './sqliteReceitaProtocol.js';

const workerPort = parentPort;
if (!workerPort) throw new Error('sqliteReceitaWorker deve ser executado em uma Worker thread.');

const options = workerData as SqliteWorkerOptions;
let database: SqliteReceitaDatabase | undefined;

workerPort.on('message', (request: SqliteWorkerRequest) => {
  let response: SqliteWorkerResponse;
  try {
    database ??= new SqliteReceitaDatabase(options);
    let result: SqliteWorkerResult;
    switch (request.operation) {
      case 'initialize':
        result = undefined;
        break;
      case 'metadata':
        result = database.metadata();
        break;
      case 'count':
        result = database.count(request.query);
        break;
      case 'find':
        result = database.find(request.query);
        break;
      case 'close':
        database.close();
        result = undefined;
        break;
    }
    response = { id: request.id, ok: true, result };
  } catch (error) {
    response = { id: request.id, ok: false, error: errorMessage(error) };
  }
  workerPort.postMessage(response);
  if (request.operation === 'close') setImmediate(() => workerPort.close());
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
