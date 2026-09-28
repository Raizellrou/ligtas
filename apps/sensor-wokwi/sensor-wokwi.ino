/**
 * LIGTAS L1 sensor node (PRD Section 5.1/9) -- ESP32, simulated in Wokwi.
 * No physical hardware anywhere in this build (CLAUDE.md hard constraint).
 *
 * Reads a simulated river gauge (potentiometer standing in for an
 * ultrasonic/pressure sensor), debounces the reading against three severity
 * thresholds, and on a confirmed tier change builds and signs a real
 * 84-byte LIGTAS alert packet -- byte-for-byte the same wire format
 * packages/core encodes and packages/hub/apps/pwa verify. It is printed to
 * Serial as hex; this sketch does not attempt to also simulate a LoRa
 * radio -- packages/mesh-sim (Meshtasticator) already owns the real
 * mesh-propagation proof, and duplicating a fake radio here would only
 * blur which proof judges are actually looking at.
 *
 * Wire format (see packages/core/src/codec.ts -- keep these in sync by
 * hand, this file cannot import that one):
 *   byte  0      version
 *   byte  1      hazard
 *   byte  2      severity
 *   byte  3      issuerIndex
 *   bytes 4-7    purokBitmap   (u32 BE)
 *   bytes 8-11   issuedAt      (u32 BE, unix seconds)
 *   bytes 12-15  sequence      (u32 BE)
 *   bytes 16-17  waterLevelCm  (u16 BE)
 *   bytes 18-19  reserved (0)
 *   bytes 20-83  Ed25519 signature (64 bytes)
 *
 * Signing is SEP-53 (see packages/core/src/sign.ts and
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md):
 *   signature = Ed25519_sign(seed, SHA256("Stellar Signed Message:\n" + body))
 * Ed25519 itself is done by Monocypher's monocypher-ed25519 module (BSD-2/CC0,
 * see MONOCYPHER-LICENCE.md) -- real RFC 8032 Ed25519 with SHA-512, not
 * Monocypher's default BLAKE2b EdDSA variant, which is why this sketch links
 * monocypher.c *and* monocypher-ed25519.c rather than just the former.
 * The SHA-256 half of SEP-53 uses ESP32's built-in mbedtls, already part of
 * the Arduino-ESP32 core (no extra library needed for that half).
 *
 * This exact signing path -- same seed, same body-encoding, same SEP-53
 * hash step -- was cross-checked against a real @stellar/stellar-sdk
 * signature in a throwaway gcc container during development: byte-for-byte
 * identical signature output. See README.md for how to reproduce that check.
 */
#include <WiFi.h>
#include <time.h>
#include "mbedtls/sha256.h"
#include "monocypher.h"
#include "monocypher-ed25519.h"

// ---- Wire format constants (packages/core/src/codec.ts, types.ts) ----
static const size_t BODY_LENGTH = 20;
static const size_t PACKET_LENGTH = 84;
static const uint8_t WIRE_VERSION = 1;
static const uint8_t HAZARD_RIVER_FLOOD = 1;
static const uint8_t ISSUER_INDEX = 0; // this sketch's own demo issuer, index 0 in its own right -- not the hub's

// Demo puroks 3 and 4 (bit n set = purok n+1), matching the rest of this
// repo's demo data (see apps/pwa/public/alert-bundle.json).
static const uint32_t PUROK_BITMAP = 0b00001100;

// ---- DEMO ISSUER KEYPAIR -- TESTNET DEMO ONLY, NEVER A REAL SECRET ----
// Generated once for this sketch (Keypair.random() via @stellar/stellar-sdk),
// distinct from packages/hub's own demo issuer -- this sketch is standalone
// per docs/BUILD-PLAN.md ("nothing depends on it"), not wired to the live
// hub/PWA deployment. Public key: GARORK5AHBYBGQPNG2HK5E225D77DUQYKVNDSMAV6CVJR26SBOBJAZHC
// Regenerate with: node packages/core/scripts/emit-alert.js --sequence 1
// and take expectedIssuerSecret's raw seed bytes (kp.rawSecretKey()).
static const uint8_t DEMO_SEED[32] = {
  0x03, 0x75, 0xa2, 0x93, 0x10, 0xde, 0x96, 0x53, 0xb6, 0x27, 0xdf, 0x87,
  0x2a, 0x13, 0xf8, 0xc5, 0xda, 0xdb, 0x0b, 0xcf, 0x7c, 0x8b, 0xbb, 0x33,
  0xc2, 0x18, 0x54, 0x31, 0xce, 0x86, 0xfe, 0x11,
};

static uint8_t secretKey[64]; // derived at boot -- crypto_ed25519_key_pair output, never the raw seed again
static uint8_t publicKey[32];

// ---- Pins (see diagram.json) ----
static const int RIVER_LEVEL_PIN = 34; // potentiometer wiper, ADC1_CH6, input-only pin
static const int ALERT_LED_PIN = 25;

// ---- Threshold + debounce tuning ----
static const uint16_t RIVER_MAX_CM = 400; // full potentiometer swing maps to this
static const uint16_t TIER1_CM = 150;
static const uint16_t TIER2_CM = 200;
static const uint16_t TIER3_CM = 250;
static const unsigned long SAMPLE_INTERVAL_MS = 250;
// A reading must hold for this long before it's treated as real, not noise --
// PRD Section 5.1's "debounce so a fluctuating reading does not emit a burst
// of alerts."
static const unsigned long DEBOUNCE_MS = 3000;

static uint8_t confirmedTier = 0;   // last tier an alert was actually emitted for (0 = none yet)
static uint8_t pendingTier = 0;
static unsigned long pendingSince = 0;
static unsigned long lastSampleAt = 0;

// Sequence is per-issuer and must strictly increase -- it's the sole replay
// defence (packages/core/src/replay.ts). Kept in RAM only for this
// simulated cut: a real field node would persist it in NVS so a reboot
// can't reset it to 1 and reopen the replay window. Out of scope here --
// Wokwi resets are a demo restart, not a field power-cycle.
static uint32_t nextSequence = 1;

static bool timeSynced = false;

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(ALERT_LED_PIN, OUTPUT);
  digitalWrite(ALERT_LED_PIN, LOW);

  uint8_t seedCopy[32];
  memcpy(seedCopy, DEMO_SEED, 32);
  crypto_ed25519_key_pair(secretKey, publicKey, seedCopy); // wipes seedCopy, not DEMO_SEED

  Serial.print("[sensor] issuer public key (raw hex)=");
  printHex(publicKey, 32);

  connectWiFiAndSyncTime();
}

void loop() {
  unsigned long now = millis();
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) return;
  lastSampleAt = now;

  uint16_t levelCm = readWaterLevelCm();
  uint8_t tier = tierFor(levelCm);
  handleReading(tier, levelCm, now);
}

// ---- Sensing ----

uint16_t readWaterLevelCm() {
  int raw = analogRead(RIVER_LEVEL_PIN); // 0-4095, 12-bit ADC
  return (uint16_t)((uint32_t)raw * RIVER_MAX_CM / 4095);
}

uint8_t tierFor(uint16_t levelCm) {
  if (levelCm >= TIER3_CM) return 3;
  if (levelCm >= TIER2_CM) return 2;
  if (levelCm >= TIER1_CM) return 1;
  return 0;
}

void handleReading(uint8_t tier, uint16_t levelCm, unsigned long now) {
  if (tier != pendingTier) {
    pendingTier = tier;
    pendingSince = now;
    return; // reset the debounce window, don't act yet
  }
  if (now - pendingSince < DEBOUNCE_MS) return; // still settling
  if (tier == confirmedTier) return; // nothing new to report

  confirmedTier = tier;
  digitalWrite(ALERT_LED_PIN, tier > 0 ? HIGH : LOW);

  if (tier == 0) {
    Serial.println("[sensor] river receded below tier 1 -- no alert packet (no cancellation format defined)");
    return;
  }
  emitAlert(tier, levelCm);
}

// ---- Packet build + sign ----

void emitAlert(uint8_t severityTier, uint16_t levelCm) {
  uint8_t body[BODY_LENGTH];
  body[0] = WIRE_VERSION;
  body[1] = HAZARD_RIVER_FLOOD;
  body[2] = severityTier;
  body[3] = ISSUER_INDEX;
  writeU32BE(body + 4, PUROK_BITMAP);
  writeU32BE(body + 8, currentUnixTime());
  writeU32BE(body + 12, nextSequence);
  writeU16BE(body + 16, levelCm);
  body[18] = 0;
  body[19] = 0;

  uint8_t hash[32];
  sep53Hash(body, BODY_LENGTH, hash);

  uint8_t signature[64];
  crypto_ed25519_sign(signature, secretKey, hash, 32);

  uint8_t packet[PACKET_LENGTH];
  memcpy(packet, body, BODY_LENGTH);
  memcpy(packet + BODY_LENGTH, signature, 64);

  Serial.println("[sensor] ==== ALERT ====");
  Serial.print("  severity tier   = "); Serial.println(severityTier);
  Serial.print("  water level cm  = "); Serial.println(levelCm);
  Serial.print("  sequence        = "); Serial.println(nextSequence);
  Serial.print("  purok bitmap    = 0b");
  for (int b = 7; b >= 0; b--) Serial.print((PUROK_BITMAP >> b) & 1);
  Serial.println();
  Serial.print("  packetHex       = ");
  printHex(packet, PACKET_LENGTH);
  Serial.println("  verify with: node packages/core/scripts/verify-alert.js --packet <above> --issuer-public-key <above>");

  nextSequence++;
}

// SEP-53: SHA256("Stellar Signed Message:\n" + body), see
// packages/core/src/sign.ts and @stellar/stellar-sdk's Keypair.signMessage.
void sep53Hash(const uint8_t *body, size_t bodyLen, uint8_t out[32]) {
  static const char PREFIX[] = "Stellar Signed Message:\n";
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0); // 0 selects SHA-256 over SHA-224
  mbedtls_sha256_update(&ctx, (const unsigned char *)PREFIX, strlen(PREFIX));
  mbedtls_sha256_update(&ctx, body, bodyLen);
  mbedtls_sha256_finish(&ctx, out);
  mbedtls_sha256_free(&ctx);
}

// ---- Wall clock ----
// issuedAt is never trusted for ordering by any verifier in this repo (PRD
// Section 5.4 -- sequence is the sole replay defence), so a best-effort
// clock is fine: real NTP time when Wokwi's simulated network is up, a
// millis()-based placeholder otherwise.
void connectWiFiAndSyncTime() {
  Serial.println("[sensor] connecting to Wokwi-GUEST WiFi for NTP...");
  WiFi.begin("Wokwi-GUEST", "");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(250);
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[sensor] WiFi unavailable -- issuedAt will use a millis()-based placeholder");
    return;
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  time_t nowSec = 0;
  start = millis();
  while (nowSec < 1700000000 && millis() - start < 10000) { // wait for a plausible post-2023 timestamp
    delay(250);
    time(&nowSec);
  }
  timeSynced = nowSec >= 1700000000;
  Serial.println(timeSynced ? "[sensor] NTP time synced" : "[sensor] NTP sync timed out -- using placeholder clock");
}

uint32_t currentUnixTime() {
  if (timeSynced) {
    time_t nowSec;
    time(&nowSec);
    return (uint32_t)nowSec;
  }
  // Placeholder epoch (2026-01-01T00:00:00Z) + uptime -- monotonic and
  // plausible-looking, but not real wall time. Fine here: nothing in this
  // repo trusts issuedAt for ordering.
  return (uint32_t)1767225600UL + (uint32_t)(millis() / 1000);
}

// ---- Small helpers ----

void writeU32BE(uint8_t *out, uint32_t value) {
  out[0] = (uint8_t)(value >> 24);
  out[1] = (uint8_t)(value >> 16);
  out[2] = (uint8_t)(value >> 8);
  out[3] = (uint8_t)value;
}

void writeU16BE(uint8_t *out, uint16_t value) {
  out[0] = (uint8_t)(value >> 8);
  out[1] = (uint8_t)value;
}

void printHex(const uint8_t *buf, size_t len) {
  for (size_t i = 0; i < len; i++) {
    if (buf[i] < 0x10) Serial.print('0');
    Serial.print(buf[i], HEX);
  }
  Serial.println();
}
