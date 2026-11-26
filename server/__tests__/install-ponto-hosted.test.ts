import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const isWindows = process.platform === "win32";
const installerPath = join(process.cwd(), "scripts", "install-ponto-hosted.sh");

const fakeDocker = `#!/usr/bin/env bash
set -euo pipefail
args="$*"
case "$args" in
  "compose version"*) exit 0 ;;
  "network inspect"*) exit 1 ;;
  "network create"*) exit 0 ;;
  "cp "*) exit 0 ;;
  "exec --env-file"*) echo '{"paired":true}'; exit 0 ;;
  "exec "*) exit 0 ;;
  *"ps -q caddy"*) echo fake-caddy; exit 0 ;;
  *"ps -q app"*) echo fake-app; exit 0 ;;
  "compose"*) exit 0 ;;
  *) exit 0 ;;
esac
`;

function writeFakeDocker(binDir: string): void {
  const path = join(binDir, "docker");
  writeFileSync(path, fakeDocker);
  chmodSync(path, 0o755);
}

function runInstaller(root: string, binDir: string) {
  return spawnSync("bash", [installerPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUD_PAIRING_CODE: "ABCD-1234",
      PATH: `${binDir}:${process.env.PATH}`,
      PONTO_BASE_DOMAIN: "clientes.test",
      PONTO_CLIENT_NAME: "Empresa Teste",
      PONTO_CLIENT_SLUG: "empresa-teste",
      PONTO_CLOUD_API_URL: "https://cloud.example",
      PONTO_HOST_ROOT: root,
      PONTO_OWNER_LOGIN: "dono@example.com",
      PONTO_OWNER_NAME: "Dono Teste",
      PONTO_OWNER_PASSWORD: "password-inicial-forte",
    },
  });
}

describe("install-ponto-hosted.sh", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it.skipIf(isWindows)(
    "corre duas vezes sem duplicar configuração nem rodar segredos",
    () => {
      const root = mkdtempSync(join(tmpdir(), "ponto-hosted-test-"));
      const binDir = join(root, "bin");
      dirs.push(root);
      mkdirSync(binDir);
      writeFakeDocker(binDir);

      const first = runInstaller(root, binDir);
      expect(first.status, first.stderr).toBe(0);
      const clientDir = join(root, "clientes", "empresa-teste");
      const envBefore = readFileSync(join(clientDir, ".env"), "utf8");
      const caddyBefore = readFileSync(
        join(root, "proxy", "Caddyfile"),
        "utf8"
      );

      const second = runInstaller(root, binDir);
      expect(second.status, second.stderr).toBe(0);
      const envAfter = readFileSync(join(clientDir, ".env"), "utf8");
      const caddyAfter = readFileSync(join(root, "proxy", "Caddyfile"), "utf8");

      expect(envAfter).toBe(envBefore);
      expect(caddyAfter).toBe(caddyBefore);
      expect(
        caddyAfter.match(/empresa-teste\.clientes\.test \{/g) ?? []
      ).toHaveLength(1);
      expect(envAfter).toContain("COMPOSE_PROJECT_NAME=ponto-empresa-teste");
      expect(envAfter).toContain("APP_URL=https://empresa-teste.clientes.test");
      expect(
        readFileSync(join(clientDir, "docker-compose.yml"), "utf8")
      ).toContain("name: \u0024{PONTO_PROXY_NETWORK}");
    }
  );
});
