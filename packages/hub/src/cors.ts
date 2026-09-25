import type { RequestHandler } from "express";

/**
 * Lets the PWA's origin read a response, and no one else's. GET-only routes
 * with no custom headers need nothing more (no preflight). The origin is
 * echoed back only on an exact match -- never "*" -- with `Vary: Origin` so a
 * cache can't hand one origin's answer to another.
 */
export function allowPwaOrigin(pwaOrigin: string): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin === pwaOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    next();
  };
}
