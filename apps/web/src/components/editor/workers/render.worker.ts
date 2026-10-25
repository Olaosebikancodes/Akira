import { serveRenderWorker, type WorkerScope } from "@akira/engine";

serveRenderWorker(self as unknown as WorkerScope);
