import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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
script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
root_dir="$(dirname "$script_dir")"
backup_count="$root_dir/backup-count"
fail_backup="$root_dir/fail-backup"
case "$args" in
  "compose version"*) exit 0 ;;
  "network inspect"*) exit 1 ;;
  "network create"*) exit 0 ;;
  "cp "*) exit 0 ;;
  "exec --env-file"*) echo '{"paired":true}'; exit 0 ;;
  *"ps -q db-backup"*) echo fake-backup; exit 0 ;;
  "exec fake-backup sh -c find"*)
    if [ -s "$backup_count" ]; then echo /backups/oficinaos-fake.sql.gz; fi
    exit 0
    ;;
  "exec fake-backup bash /scripts/run-backup.sh"*)
    if [ -f "$fail_backup" ]; then rm -f "$fail_backup"; exit 1; fi
    echo backup >>"$backup_count"
    exit 0
    ;;
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
    "corre três vezes sem duplicar configuração nem repetir backup recente",
    () => {
      const root = mkdtempSync(join(tmpdir(), "ponto-hosted-test-"));
      const binDir = join(root, "bin");
      dirs.push(root);
      mkdirSync(binDir);
      writeFakeDocker(binDir);

      writeFileSync(join(root, "fail-backup"), "1");
      const first = runInstaller(root, binDir);
      expect(first.status, first.stderr).toBe(0);
      expect(first.stderr).toContain("backup pós-bootstrap falhou");
      const clientDir = join(root, "clientes", "empresa-teste");
      expect(existsSync(join(clientDir, ".bootstrap-backup-done"))).toBe(false);
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
      expect(existsSync(join(clientDir, ".bootstrap-backup-done"))).toBe(true);
      expect(
        readFileSync(join(root, "backup-count"), "utf8").trim().split("\n")
      ).toHaveLength(1);

      const third = runInstaller(root, binDir);
      expect(third.status, third.stderr).toBe(0);
      expect(
        readFileSync(join(root, "backup-count"), "utf8").trim().split("\n")
      ).toHaveLength(1);
      expect(
        readFileSync(join(clientDir, "docker-compose.yml"), "utf8")
      ).toContain("name: \u0024{PONTO_PROXY_NETWORK}");
    }
  );
});
