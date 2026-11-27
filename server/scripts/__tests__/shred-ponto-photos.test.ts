import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface DbRow {
  id: string;
  path: string;
}

// BD controlada pelo teste: rows semeada por cenário, deletes registados.
const dbState = {
  deletedIds: [] as string[],
  rows: [] as DbRow[],
  tableExists: true,
};

vi.mock("pg", () => ({
  default: {
    Client: class {
      connect = vi.fn(async () => undefined);
      end = vi.fn(async () => undefined);
      query = vi.fn(async (sql: string, params?: unknown[]) => {
        await Promise.resolve();
        if (sql.includes("to_regclass")) {
          return {
            rows: [{ reg: dbState.tableExists ? "ponto_photos" : null }],
          };
        }
        if (sql.includes('SELECT id, path FROM "ponto_photos"')) {
          return { rows: [...dbState.rows] };
        }
        if (sql.includes("count(*)")) {
          return { rows: [{ n: dbState.rows.length }] };
        }
        if (sql.includes("DROP TABLE")) {
          dbState.tableExists = false;
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("DELETE FROM")) {
          const id = params?.[0] as string;
          dbState.deletedIds.push(id);
          dbState.rows = dbState.rows.filter((r) => r.id !== id);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });
    },
  },
}));

const { candidateUploadsBases, isValidPhotoRel, shredPontoPhotos } =
  await import("../shred-ponto-photos.js");

async function makeFile(root: string, rel: string): Promise<void> {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, "jpeg");
}

describe("shred-ponto-photos — limpeza por fotografia", () => {
  const cleanup: string[] = [];
  let originalTemp: string | undefined;

  afterEach(async () => {
    if (originalTemp === undefined) {
      // Atribuir undefined virava a string "undefined" e envenenava o
      // os.tmpdir() no Linux — apaga-se mesmo a variável.
      delete process.env.TEMP;
    } else {
      process.env.TEMP = originalTemp;
    }
    dbState.deletedIds = [];
    dbState.rows = [];
    dbState.tableExists = true;
    for (const dir of cleanup.splice(0)) {
      await fs.rm(dir, { force: true, recursive: true });
    }
  });

  async function makeLayout() {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "shred-test-"));
    cleanup.push(base);
    const root = path.join(base, "oficinaos");
    const uploadDir = path.join(root, "app", "uploads");
    const fakeTemp = path.join(base, "temp");
    await fs.mkdir(fakeTemp, { recursive: true });
    originalTemp = process.env.TEMP;
    process.env.TEMP = fakeTemp;
    return { base, fakeTemp, root, uploadDir };
  }

  it("apaga ficheiro e linha quando todas as cópias desaparecem — ativa, app.prev e keep", async () => {
    const { root, uploadDir, fakeTemp } = await makeLayout();
    const rel = "ponto-photos/u1/foto.jpg";
    dbState.rows = [{ id: "p1", path: rel }];
    for (const prefix of [
      path.join(root, "app", "uploads"),
      path.join(root, "app.prev", "uploads"),
      path.join(fakeTemp, "oficinaos-keep-abc", "uploads"),
    ]) {
      await makeFile(prefix, rel);
    }
    // Conteúdo não-fotográfico e pastas alheias ficam intactos.
    await makeFile(root, "app.prev/uploads/other-file.txt");
    await makeFile(root, "approvals/uploads/ponto-photos/unrelated.jpg");

    const result = await shredPontoPhotos({
      databaseUrl: "postgresql://unused",
      uploadDir,
    });

    expect(result.rowsDeleted).toBe(1);
    expect(result.rowsPending).toBe(0);
    expect(result.filesDeleted).toBe(1);
    expect(result.backupFilesDeleted).toBe(2);
    expect(dbState.deletedIds).toEqual(["p1"]);
    await expect(
      fs.lstat(path.join(root, "app", "uploads", rel))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.lstat(path.join(root, "app.prev", "uploads", rel))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.lstat(path.join(fakeTemp, "oficinaos-keep-abc", "uploads", rel))
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await fs
        .lstat(path.join(root, "approvals/uploads/ponto-photos/unrelated.jpg"))
        .then(() => true)
    ).toBe(true);
    expect(
      await fs
        .lstat(path.join(root, "app.prev/uploads/other-file.txt"))
        .then(() => true)
    ).toBe(true);
  });

  it("mistura de sucessos e falhas: a linha só cai na foto totalmente apagada", async () => {
    const { root, uploadDir } = await makeLayout();
    const relOk = "ponto-photos/u1/ok.jpg";
    const relLocked = "ponto-photos/u2/trancada.jpg";
    dbState.rows = [
      { id: "ok", path: relOk },
      { id: "locked", path: relLocked },
    ];
    await makeFile(path.join(root, "app", "uploads"), relOk);

    // Falha determinista e multi-plataforma, sem permissões nem handles
    // (a libuv abre ficheiros com FILE_SHARE_DELETE e o chmod só mexe no
    // atributo read-only — nenhum bloqueia a remoção de forma fiável):
    // ponto-photos/u2 é uma junction a apontar para FORA da base, pelo
    // que a proteção de caminhos recusa apagar a cópia — a fotografia
    // fica em disco e a linha na BD. Junctions não exigem privilégio no
    // Windows; no Linux o tipo é ignorado e é um symlink normal.
    const outsideDir = path.join(root, "fora-u2");
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "trancada.jpg"), "foto");
    const junctionDir = path.dirname(
      path.join(root, "app", "uploads", relLocked)
    );
    await fs.mkdir(path.dirname(junctionDir), { recursive: true });
    await fs.symlink(outsideDir, junctionDir, "junction");

    const result = await shredPontoPhotos({
      databaseUrl: "postgresql://unused",
      uploadDir,
    });
    expect(dbState.deletedIds).toContain("ok");
    expect(result.rowsPending).toBe(1);
    expect(dbState.deletedIds).not.toContain("locked");
    // a foto falhada continua em disco e na BD para a próxima corrida
    await expect(
      fs.lstat(path.join(outsideDir, "trancada.jpg"))
    ).resolves.toBeTruthy();
    expect(result.failures.some((f) => f.includes("trancada.jpg"))).toBe(true);
  });

  it("um UPLOAD_DIR personalizado fora do layout portátil não varre pastas alheias", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "shred-test-"));
    cleanup.push(base);
    const uploadDir = path.join(base, "dados", "uploads");
    await makeFile(base, "app.prev/uploads/ponto-photos/u1/prev.jpg");
    const fakeTemp = path.join(base, "temp-vazio");
    await fs.mkdir(fakeTemp, { recursive: true });
    originalTemp = process.env.TEMP;
    process.env.TEMP = fakeTemp;
    const { backups } = await candidateUploadsBases(uploadDir);
    expect(backups).toEqual([]);
    expect(
      await fs
        .lstat(path.join(base, "app.prev/uploads/ponto-photos/u1/prev.jpg"))
        .then(() => true)
    ).toBe(true);
  });

  it("recusa caminhos UNC, absolutos, com '..' e fora do formato — sem lhes tocar", async () => {
    const { root, uploadDir } = await makeLayout();
    dbState.rows = [
      { id: "unc", path: "\\\\evil\\share\\foto.jpg" },
      { id: "abs", path: "/etc/passwd" },
      { id: "drive", path: "C:/Windows/system32/config" },
      { id: "dots", path: "ponto-photos/../../../outra.jpg" },
      { id: "backslash", path: "ponto-photos\\u1\\foto.jpg" },
      { id: "outside", path: "outra-pasta/u1/foto.jpg" },
    ];
    // Ficheiro "alvo" dos caminhos com .. — se a validação falhasse,
    // a escapada apagava-o.
    await makeFile(root, "app/outra.jpg");

    const result = await shredPontoPhotos({
      databaseUrl: "postgresql://unused",
      uploadDir,
    });

    expect(result.invalidRows).toBe(6);
    expect(result.rowsDeleted).toBe(0);
    expect(result.rowsPending).toBe(6);
    expect(dbState.deletedIds).toEqual([]);
    expect(
      await fs.lstat(path.join(root, "app", "outra.jpg")).then(() => true)
    ).toBe(true);
  });

  it("isValidPhotoRel aceita o formato real das fotografias", () => {
    expect(isValidPhotoRel("ponto-photos/u1/abc-123.jpg")).toBe(true);
    expect(isValidPhotoRel("ponto-photos/u/1/abc.webp")).toBe(true);
    expect(isValidPhotoRel("ponto-photos/")).toBe(false);
    expect(isValidPhotoRel("ponto-photos//foto.jpg")).toBe(false);
  });

  it("não segue ligações simbólicas que apontem para fora da base", async () => {
    const { root, uploadDir } = await makeLayout();
    // Vítima fora da base: se o shred seguir o symlink, apaga-a.
    const outsideDir = path.join(root, "fora-da-base");
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "vitima.jpg"), "jpeg");
    const linkPath = path.join(uploadDir, "ponto-photos", "u1");
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    let linked = true;
    try {
      await fs.symlink(outsideDir, linkPath, "dir");
    } catch {
      // Windows sem privilégio de symlink — o teste não se aplica.
      linked = false;
    }
    if (!linked) {
      return;
    }
    dbState.rows = [{ id: "sym", path: "ponto-photos/u1/vitima.jpg" }];

    const result = await shredPontoPhotos({
      databaseUrl: "postgresql://unused",
      uploadDir,
    });

    // A vítima fora da base NÃO é apagada e a linha fica na BD.
    expect(
      await fs.lstat(path.join(outsideDir, "vitima.jpg")).then(() => true)
    ).toBe(true);
    expect(dbState.deletedIds).not.toContain("sym");
    expect(result.rowsDeleted).toBe(0);
  });

  it("o relatório fica sempre escrito em UPLOAD_DIR com as pendências", async () => {
    const { uploadDir } = await makeLayout();
    dbState.rows = [{ id: "inv", path: "\\\\evil\\x.jpg" }];
    await shredPontoPhotos({
      databaseUrl: "postgresql://unused",
      uploadDir,
    });
    const report = JSON.parse(
      await fs.readFile(path.join(uploadDir, "ponto-photo-shred.json"), "utf-8")
    ) as { failures: string[]; invalidPaths: string[]; pendingPaths: string[] };
    expect(Array.isArray(report.failures)).toBe(true);
    expect(report.invalidPaths).toEqual(["\\\\evil\\x.jpg"]);
    expect(report.pendingPaths).toEqual(["\\\\evil\\x.jpg"]);
  });

  it("sem tabela ponto_photos não toca na BD mas limpa órfãos em disco", async () => {
    const { root, uploadDir } = await makeLayout();
    dbState.tableExists = false;
    await makeFile(root, "app/uploads/ponto-photos/orfao.jpg");

    const result = await shredPontoPhotos({
      databaseUrl: "postgresql://unused",
      uploadDir,
    });

    expect(result.tableExisted).toBe(false);
    expect(result.rowsDeleted).toBe(0);
    await expect(
      fs.lstat(path.join(root, "app/uploads/ponto-photos"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
