import { networkInterfaces } from 'node:os';

const virtual = /^(vEthernet|docker|utun|bridge|vmnet|vboxnet|tailscale|zt)/i;

/**
 * Lists the IPv4 addresses tablets could use to reach this laptop. Private
 * ranges come first, and virtual adapters (VPNs, Docker, VMs) are dropped
 * because tablets on the wifi can't reach them.
 */
export function lanAddresses(): string[] {
  const out: { address: string; privateRange: boolean }[] = [];
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    if (!infos || virtual.test(name)) continue;
    for (const info of infos) {
      if (info.family !== 'IPv4' || info.internal) continue;
      out.push({
        address: info.address,
        privateRange: /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
          info.address
        ),
      });
    }
  }
  return out
    .sort((a, b) => Number(b.privateRange) - Number(a.privateRange))
    .map((i) => i.address);
}

export type Network = {
  port: number;
  /** The address the owner picked in settings, or else the first candidate. */
  ip: string | null;
  url: string | null;
  interfaces: string[];
};

export function createNetwork() {
  let chosen: string | null = null;
  let port = 0;
  return {
    /**
     * Set after the server starts listening. The port isn't known before then,
     * because the preferred one may be taken.
     */
    setPort(p: number) {
      port = p;
    },
    describe(): Network {
      const interfaces = lanAddresses();
      const ip =
        chosen && interfaces.includes(chosen)
          ? chosen
          : (interfaces[0] ?? null);
      return {
        port,
        ip,
        url: ip ? `http://${ip}:${port}` : null,
        interfaces,
      };
    },
    choose(ip: string) {
      chosen = ip;
    },
  };
}

export type NetworkInfo = ReturnType<typeof createNetwork>;
