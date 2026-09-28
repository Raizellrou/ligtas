export { CURRENT_VERSION, Hazard, Severity } from "./types.js";
export type { AlertBody, AlertPacket } from "./types.js";

export { BODY_LENGTH, encodeBody, decodeBody, validateBody } from "./codec.js";

export { ALERT_HASH_LENGTH, alertHash, toHex, bytesFromHex } from "./hash.js";

export { SIGNATURE_LENGTH, signBody, verifyBody } from "./sign.js";

export { PACKET_LENGTH, encodePacket, decodePacket, verifyPacket } from "./packet.js";

export { ReplayGuard } from "./replay.js";
export type { ReplayDecision, ReplayGuardOptions } from "./replay.js";

export { ALERT_BUNDLE_VERSION } from "./bundle.js";
export type { AlertBundle, AlertBundleEntry, AlertBundleIssuer, AlertBundleSource } from "./bundle.js";
