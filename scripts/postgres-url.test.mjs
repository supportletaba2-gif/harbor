import assert from "node:assert/strict";
import test from "node:test";
import { pgSsl, postgresUrl } from "./postgres-url.mjs";

test("strips channel_binding and keeps the password", () => {
  const url = postgresUrl(
    "postgresql://harbor:p%40ss@ep-cool.neon.tech/neondb?sslmode=require&channel_binding=require",
  );
  assert.equal(url.includes("channel_binding"), false);
  assert.match(url, /^postgresql:\/\/harbor:p%40ss@ep-cool\.neon\.tech\/neondb\?/);
  assert.match(url, /sslmode=require/);
});

test("adds sslmode when the string has none", () => {
  assert.match(postgresUrl("postgresql://u:p@ep.neon.tech/db"), /sslmode=require/);
});

test("local postgres does not force certificate bypass", () => {
  assert.equal(pgSsl("postgresql://u:p@127.0.0.1:5432/db"), undefined);
  assert.deepEqual(pgSsl("postgresql://u:p@ep.neon.tech/db"), { rejectUnauthorized: false });
});
