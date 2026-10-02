/// <reference lib="webworker" />

import { createEngineHandler, fetchDataSource } from './engine-handler';

/**
 * Dedicated worker that parses the consumption file and runs the cost engine off the main thread.
 * Data files are read from the app's own origin; the worker script sits next to index.html.
 */
const handle = createEngineHandler(fetchDataSource(new URL('./', self.location.href)));

addEventListener('message', (event: MessageEvent<unknown>) => {
  void handle(event.data).then((response) => postMessage(response));
});
