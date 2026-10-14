// Standalone behavior test: servers may share a hostname as long as their
// probed ports are disjoint (different runtimes on the same machine).
// Run: node --experimental-strip-types test/servers.test.ts

import { serversShareEndpoint } from "../src/core.ts";

let failures = 0;

function check(label: string, cond: boolean, detail?: string): void {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		failures++;
		console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

console.log("servers: host uniqueness must be per (host, port)");

const tower = { id: "gpu-host", host: "gpu-host", ports: [8080, 8081], enabled: true };
const towerLm = { id: "gpu-host-lm", host: "gpu-host", ports: [1234], enabled: true };
const towerOverlap = { id: "gpu-host-x", host: "gpu-host", ports: [8081, 9000], enabled: true };
const other = { id: "other", host: "other", ports: [8080], enabled: true };

check("same host + same port collides", serversShareEndpoint(tower, towerOverlap));
check("same host + disjoint ports allowed", !serversShareEndpoint(tower, towerLm));
check("different host + same port allowed", !serversShareEndpoint(tower, other));
check("different host + different port allowed", !serversShareEndpoint({ host: "a", ports: [1] }, { host: "b", ports: [2] }));

if (failures > 0) {
	console.error(`servers tests failed: ${failures}`);
	process.exit(1);
}
console.log("servers: all checks passed");
