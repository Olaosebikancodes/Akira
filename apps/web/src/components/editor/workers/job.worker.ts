import { serveJobWorker, type WorkerScope } from "@akira/engine";

serveJobWorker(self as unknown as WorkerScope);
