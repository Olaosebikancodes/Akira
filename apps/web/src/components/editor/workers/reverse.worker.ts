import { serveReverseWorker, type WorkerScope } from "@akira/engine";

serveReverseWorker(self as unknown as WorkerScope);
