import { serveAudioWorker, type WorkerScope } from "@akira/engine";

serveAudioWorker(self as unknown as WorkerScope);
