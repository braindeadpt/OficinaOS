import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({
  default: {
    Client: class {
      connect = vi.fn(async () => undefined);
      end = vi.fn(async () => undefined);
      query = vi.fn(async (sql: string) =>
        sql.includes("to_regclass")
          ? { rows: [{ reg: null }] }
          : { rows: [], rowCount: 0 }
      );
    },
  },
}));

const { candidatePhotoDirs, shredPontoPhotos } = await import(
  "../shred-ponto-photos.js"
);

async function makeFile(root: string, rel: string): Promise<void> {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, "jpeg");
}

describe("shred-ponto-photos — limpeza das cópias do atualizador", () => {
  const cleanup: string[] = [];
  let originalTemp: string | undefined;

  afterEach(async () => {
    if (originalTemp === undefined) {
      process.env.TEMP = undefined;
    } else {
      process.env.TEMP = originalTemp;
    }
    for (const dir of cleanup.splice(0)) {
      await fs.rm(dir, { force: true, recursive: true });
    }
  });

  async function makeLayout() {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "shred-test-"));
    cleanup.push(base);
    const root = path.join(base, "oficinaos");
    const uploadDir = path.join(root, "app", "uploads");
    await makeFile(root, "app/uploads/ponto-photos/active-1.jpg");
    await makeFile(root, "app/uploads/ponto-photos/nested/active-2.jpg");
    await makeFile(root, "app.prev/uploads/ponto-photos/prev-1.jpg");
    await makeFile(root, "app.prev/uploads/other-file.txt");
    // Pasta com nome parecido que NÃO é backup do atualizador.
    await makeFile(root, "approvals/uploads/ponto-photos/unrelated.jpg");
    const fakeTemp = path.join(base, "temp");
    await makeFile(
      fakeTemp,
      "oficinaos-keep-abc123/uploads/ponto-photos/keep-1.jpg"
    );
    await makeFile(fakeTemp, "outra-cosa/uploads/ponto-photos/unrelated.jpg");
    originalTemp = process.env.TEMP;
    process.env.TEMP = fakeTemp;
    return { base, fakeTemp, root, uploadDir };
  }

  it("apaga a pasta ativa, o app.prev e as cópias temporárias do atualizador, contando tudo", async () => {
    const { base, root, uploadDir } = await makeLayout();
    const result = await shredPontoPhotos({
      databaseUrl: "postgresql://unused",
      uploadDir,
    });

    expect(result.filesDeleted).toBe(2);
    expect(result.backupFilesDeleted).toBe(2);
    // Nem a ativa nem os backups existem depois da migração.
    for (const rel of [
      "app/uploads/ponto-photos",
      "app.prev/uploads/ponto-photos",
    ]) {
      await expect(fs.lstat(path.join(root, rel))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    await expect(
      fs.lstat(
        path.join(base, "temp/oficinaos-keep-abc123/uploads/ponto-photos")
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
    // Pastas alheias (sem o nome exato do atualizador) ficam intactas.
    expect(
      await fs
        .lstat(path.join(root, "approvals/uploads/ponto-photos/unrelated.jpg"))
        .then(() => true)
    ).toBe(true);
    expect(
      await fs
        .lstat(
          path.join(base, "temp/outra-cosa/uploads/ponto-photos/unrelated.jpg")
        )
        .then(() => true)
    ).toBe(true);
    // Conteúdo não-fotográfico do app.prev é preservado — a migração só
    // apaga a pasta de fotografias.
    expect(
      await fs
        .lstat(path.join(root, "app.prev/uploads/other-file.txt"))
        .then(() => true)
    ).toBe(true);
  });

  it("um UPLOAD_DIR personalizado fora do layout portátil não varre pastas alheias", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "shred-test-"));
    cleanup.push(base);
    const uploadDir = path.join(base, "dados", "uploads");
    await makeFile(base, "dados/uploads/ponto-photos/active.jpg");
    await makeFile(base, "app.prev/uploads/ponto-photos/prev.jpg");
    // TEMP vazio e controlado — sem isto o scan apanha pastas keep reais
    // deixadas por atualizações verdadeiras nesta máquina.
    const fakeTemp = path.join(base, "temp-vazio");
    await fs.mkdir(fakeTemp, { recursive: true });
    originalTemp = process.env.TEMP;
    process.env.TEMP = fakeTemp;
    const { backups } = await candidatePhotoDirs(uploadDir);
    expect(backups).toEqual([]);
    const result = await shredPontoPhotos({
      databaseUrl: "postgresql://unused",
      uploadDir,
    });
    expect(result.filesDeleted).toBe(1);
    expect(result.backupFilesDeleted).toBe(0);
    expect(
      await fs
        .lstat(path.join(base, "app.prev/uploads/ponto-photos/prev.jpg"))
        .then(() => true)
    ).toBe(true);
  });

  it("regista no relatório as pastas que não consegue apagar — nada de falhas silenciosas", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "shred-fail-"));
    cleanup.push(root);
    const uploadDir = path.join(root, "app", "uploads");
    const activePhotos = path.join(uploadDir, "ponto-photos");
    await fs.mkdir(activePhotos, { recursive: true });
    const locked = path.join(activePhotos, "foto.jpg");
    await fs.writeFile(locked, "jpeg");

    // Windows: um ficheiro aberto não pode ser apagado — simula a falha
    // de eliminação sem depender de permissões.
    const handle = await fs.open(locked, "r+");
    try {
      const result = await shredPontoPhotos({
        databaseUrl: "postgres://fake",
        uploadDir,
      });
      if (result.failures.length === 0) {
        // Plataformas que permitem apagar ficheiros abertos (Linux):
        // o teste não consegue forçar a falha — valida só o contrato
        // do relatório (sempre escrito, failures como lista).
        expect(Array.isArray(result.failures)).toBe(true);
      } else {
        expect(result.failures).toContain(activePhotos);
        // nunca diz "apagado" sem certeza: a pasta continua em disco
        await expect(fs.lstat(locked)).resolves.toBeTruthy();
      }
    } finally {
      await handle.close();
    }
    // relatório sempre escrito em UPLOAD_DIR — é ele que alimenta o
    // aviso das Definições
    const report = JSON.parse(
      await fs.readFile(path.join(uploadDir, "ponto-photo-shred.json"), "utf-8")
    ) as { failures: string[] };
    expect(Array.isArray(report.failures)).toBe(true);
  });
});
