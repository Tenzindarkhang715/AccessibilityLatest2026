import { test } from "node:test";
import assert from "node:assert/strict";
import { assessAddress } from "../dist/security/address-policy.js";

test("allows ordinary public IPv4 and IPv6 literals without resolving them", () => {
  for (const value of ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.0", "100.128.0.0",
    "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(assessAddress(value).allowed, true, value);
  }
  assert.deepEqual(assessAddress("2606:4700:4700:0:0:0:0:1111"),
    { allowed: true, address: "2606:4700:4700::1111", family: 6 });
});

test("rejects IPv4 private, loopback, link-local, metadata and special-use ranges", () => {
  for (const value of ["0.0.0.0", "0.255.255.255", "10.0.0.0", "10.255.255.255",
    "100.64.0.0", "100.127.255.255", "100.100.100.200", "127.0.0.1", "127.255.255.255",
    "169.254.0.0", "169.254.169.254", "169.254.170.2", "169.254.255.255",
    "172.16.0.0", "172.31.255.255", "192.168.0.0", "192.168.255.255",
    "192.0.0.9", "192.0.2.1", "192.31.196.1", "192.52.193.1", "192.88.99.1",
    "192.175.48.1", "198.18.0.0", "198.19.255.255", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255", "168.63.129.16"]) {
    assert.deepEqual(assessAddress(value), { allowed: false, reason: "PROHIBITED_ADDRESS" }, value);
  }
});

test("rejects IPv6 local, mapped, translation, transition and special-purpose addresses", () => {
  for (const value of ["::", "::1", "fc00::1", "fdff::1", "fe80::1", "febf::1", "fec0::1",
    "fd00:ec2::254", "ff02::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "::127.0.0.1",
    "64:ff9b::7f00:1", "64:ff9b:1::1", "100::1", "2001::1", "2001:2::1",
    "2001:20::1", "2001:db8::1", "2002:7f00:1::", "2620:4f:8000::1", "3fff::1", "4000::1"]) {
    assert.deepEqual(assessAddress(value), { allowed: false, reason: "PROHIBITED_ADDRESS" }, value);
  }
});

test("rejects invalid, scoped and nonliteral DNS answers", () => {
  for (const value of ["", "example.com", "8.8.8.8 ", "8.8.8.8/32", "[::1]", "fe80::1%en0",
    "127.1", "2130706433", "0x7f000001", "0177.0.0.1", "999.1.1.1", null, undefined]) {
    assert.deepEqual(assessAddress(value), { allowed: false, reason: "INVALID_ADDRESS" }, String(value));
  }
});
