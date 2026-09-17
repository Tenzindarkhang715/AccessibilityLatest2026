import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

// Conservative special-purpose exclusions, reviewed against the IANA IPv4/IPv6
// registries. Public exceptions within these blocks are deliberately not allowed.
// This list needs maintenance; it is not a claim about every deployment's routing.
const blockedV4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
  "192.31.196.0/24", "192.52.193.0/24", "192.88.99.0/24", "192.168.0.0/16",
  "192.175.48.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
  "224.0.0.0/4", "240.0.0.0/4",
  // Azure platform virtual address; other common metadata IPs fall above.
  "168.63.129.16/32",
].map(value => ipaddr.IPv4.parseCIDR(value));

const globalV6 = ipaddr.IPv6.parseCIDR("2000::/3");
const blockedV6 = [
  "2001::/23", "2001:db8::/32", "2002::/16", "2620:4f:8000::/48", "3fff::/20",
].map(value => ipaddr.IPv6.parseCIDR(value));

export type AddressAssessment =
  | { readonly allowed: true; readonly address: string; readonly family: 4 | 6 }
  | { readonly allowed: false; readonly reason: "INVALID_ADDRESS" | "PROHIBITED_ADDRESS" };

/** No DNS or network I/O. DNS answers must be literal addresses, never hostnames.
 * URL spellings such as hexadecimal IPv4 are canonicalized by URL before here.
 * All mapped/translated IPv6 is rejected, including mappings of public IPv4.
 */
export function assessAddress(input: string): AddressAssessment {
  if (typeof input !== "string" || input.includes("%") || !isIP(input)) {
    return { allowed: false, reason: "INVALID_ADDRESS" };
  }
  const address = ipaddr.parse(input);
  if (address instanceof ipaddr.IPv4) {
    if (blockedV4.some(range => address.match(range))) {
      return { allowed: false, reason: "PROHIBITED_ADDRESS" };
    }
    return { allowed: true, address: address.toString(), family: 4 };
  }
  // Positive global-unicast boundary also excludes loopback, ULA, link-local,
  // multicast, NAT64, mapped IPv4, discard-only and unallocated address space.
  if (!address.match(globalV6) || blockedV6.some(range => address.match(range))) {
    return { allowed: false, reason: "PROHIBITED_ADDRESS" };
  }
  return { allowed: true, address: address.toString(), family: 6 };
}
