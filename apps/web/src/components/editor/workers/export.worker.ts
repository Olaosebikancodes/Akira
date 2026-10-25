import { serveExportWorker, type WorkerScope } from "@akira/engine";

serveExportWorker(self as unknown as WorkerScope);
