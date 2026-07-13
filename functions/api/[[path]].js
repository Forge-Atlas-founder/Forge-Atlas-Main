import worker from "../../workers/api/src/index.js";

export function onRequest(context) {
  return worker.fetch(context.request, context.env, {
    waitUntil: context.waitUntil?.bind(context),
    passThroughOnException: context.passThroughOnException?.bind(context)
  });
}
