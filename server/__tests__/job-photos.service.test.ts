import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobFindUnique: vi.fn(),
  jobPhotoCount: vi.fn(),
  jobPhotoCreate: vi.fn(),
  jobPhotoFindFirst: vi.fn(),
  jobPhotoDelete: vi.fn(),
  auditLogCreate: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: mocks.mkdir,
    writeFile: mocks.writeFile,
    unlink: mocks.unlink,
  },
}));

vi.mock("node:crypto", () => ({
  default: {
    randomUUID: () => "test-uuid",
  },
}));

vi.mock("../services/audit.service.js", () => ({
  createAuditLog: mocks.auditLogCreate,
}));

import { remove, upload } from "../services/job-photos.service.js";

const mockPrisma = {
  job: { findUnique: mocks.jobFindUnique },
  jobPhoto: {
    count: mocks.jobPhotoCount,
    create: mocks.jobPhotoCreate,
    findFirst: mocks.jobPhotoFindFirst,
    delete: mocks.jobPhotoDelete,
  },
} as any;

function jpegBuffer() {
  // JPEG magic bytes: FF D8 FF followed by filler
  return Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00]);
}

function makeFile(mimetype: string, buffer: Buffer) {
  return { mimetype, toBuffer: () => Promise.resolve(buffer) };
}

describe("job-photos service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.auditLogCreate.mockResolvedValue(undefined);
  });

  describe("upload", () => {
    it("preserves the selected repair phase on the uploaded photo", async () => {
      mocks.jobFindUnique.mockResolvedValue({
        id: "job-1",
        status: "IN_REPAIR",
      });
      mocks.jobPhotoCount.mockResolvedValue(0);
      mocks.jobPhotoCreate.mockResolvedValue({ id: "p1", stage: "REPAIR" });
      await upload(
        mockPrisma,
        "job-1",
        makeFile("image/jpeg", jpegBuffer()),
        "u1",
        { stage: "REPAIR" }
      );
      expect(mocks.jobPhotoCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ stage: "REPAIR" }),
      });
    });
    it("adds a photo to a job", async () => {
      mocks.jobFindUnique.mockResolvedValue({ id: "job-1", status: "INTAKE" });
      mocks.jobPhotoCount.mockResolvedValue(0);
      mocks.jobPhotoCreate.mockResolvedValue({
        id: "photo-1",
        jobId: "job-1",
        path: "job-photos/job-1/test-uuid.jpg",
      });

      const result = await upload(
        mockPrisma,
        "job-1",
        makeFile("image/jpeg", jpegBuffer()),
        "user-1"
      );

      expect(result).toEqual({
        id: "photo-1",
        jobId: "job-1",
        path: "job-photos/job-1/test-uuid.jpg",
      });
      expect(mocks.mkdir).toHaveBeenCalled();
      expect(mocks.writeFile).toHaveBeenCalled();
      expect(mocks.jobPhotoCreate).toHaveBeenCalledWith({
        data: {
          job: { connect: { id: "job-1" } },
          path: "job-photos/job-1/test-uuid.jpg",
        },
      });
      expect(mocks.auditLogCreate).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          jobId: "job-1",
          userId: "user-1",
          action: "PHOTO_ADDED",
          toValue: "test-uuid.jpg",
        })
      );
    });

    it("returns null for nonexistent job", async () => {
      mocks.jobFindUnique.mockResolvedValue(null);

      const result = await upload(
        mockPrisma,
        "no-such-job",
        makeFile("image/jpeg", jpegBuffer()),
        "user-1"
      );

      expect(result).toBeNull();
      expect(mocks.jobPhotoCreate).not.toHaveBeenCalled();
    });

    it("rejects 6th upload when 5 photos already exist", async () => {
      mocks.jobFindUnique.mockResolvedValue({ id: "job-1", status: "INTAKE" });
      mocks.jobPhotoCount.mockResolvedValue(5);

      const result = await upload(
        mockPrisma,
        "job-1",
        makeFile("image/jpeg", jpegBuffer()),
        "user-1"
      );

      expect(result).toEqual({ error: "PHOTO_LIMIT_REACHED" });
      expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it("rejects upload for job in terminal status", async () => {
      mocks.jobFindUnique.mockResolvedValue({
        id: "job-1",
        status: "DELIVERED",
      });

      const result = await upload(
        mockPrisma,
        "job-1",
        makeFile("image/jpeg", jpegBuffer()),
        "user-1"
      );

      expect(result).toEqual({ error: "JOB_IN_TERMINAL_STATUS" });
    });

    it("rejects invalid MIME type", async () => {
      mocks.jobFindUnique.mockResolvedValue({ id: "job-1", status: "INTAKE" });
      mocks.jobPhotoCount.mockResolvedValue(0);

      const result = await upload(
        mockPrisma,
        "job-1",
        makeFile("application/pdf", Buffer.from([0x25, 0x50, 0x44, 0x46])),
        "user-1"
      );

      expect(result).toEqual({ error: "INVALID_FILE_TYPE" });
    });

    it("rejects file with mismatched magic bytes", async () => {
      mocks.jobFindUnique.mockResolvedValue({ id: "job-1", status: "INTAKE" });
      mocks.jobPhotoCount.mockResolvedValue(0);

      // Send PNG mimetype but JPEG bytes
      const result = await upload(
        mockPrisma,
        "job-1",
        makeFile("image/png", jpegBuffer()),
        "user-1"
      );

      expect(result).toEqual({ error: "INVALID_FILE_CONTENT" });
    });

    it("cleans up file if prisma create fails", async () => {
      mocks.jobFindUnique.mockResolvedValue({ id: "job-1", status: "INTAKE" });
      mocks.jobPhotoCount.mockResolvedValue(0);
      mocks.jobPhotoCreate.mockRejectedValue(new Error("DB error"));
      mocks.unlink.mockResolvedValue(undefined);

      await expect(
        upload(
          mockPrisma,
          "job-1",
          makeFile("image/jpeg", jpegBuffer()),
          "user-1"
        )
      ).rejects.toThrow("DB error");

      expect(mocks.unlink).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deletes a photo", async () => {
      mocks.jobPhotoFindFirst.mockResolvedValue({
        id: "photo-1",
        jobId: "job-1",
        path: "job-photos/job-1/test-uuid.jpg",
      });
      mocks.unlink.mockResolvedValue(undefined);
      mocks.jobPhotoDelete.mockResolvedValue({ id: "photo-1" });

      const result = await remove(mockPrisma, "job-1", "photo-1", "user-1");

      expect(result).toBe(true);
      expect(mocks.unlink).toHaveBeenCalled();
      expect(mocks.jobPhotoDelete).toHaveBeenCalledWith({
        where: { id: "photo-1" },
      });
      expect(mocks.auditLogCreate).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          jobId: "job-1",
          userId: "user-1",
          action: "PHOTO_REMOVED",
          fromValue: "job-photos/job-1/test-uuid.jpg",
          note: "Photo deleted: job-photos/job-1/test-uuid.jpg",
        })
      );
    });

    it("returns null when photo not found", async () => {
      mocks.jobPhotoFindFirst.mockResolvedValue(null);

      const result = await remove(mockPrisma, "job-1", "no-photo", "user-1");

      expect(result).toBeNull();
      expect(mocks.unlink).not.toHaveBeenCalled();
      expect(mocks.jobPhotoDelete).not.toHaveBeenCalled();
    });

    it("succeeds even if file unlink fails", async () => {
      mocks.jobPhotoFindFirst.mockResolvedValue({
        id: "photo-1",
        jobId: "job-1",
        path: "job-photos/job-1/test-uuid.jpg",
      });
      mocks.unlink.mockRejectedValue(new Error("ENOENT"));
      mocks.jobPhotoDelete.mockResolvedValue({ id: "photo-1" });

      const result = await remove(mockPrisma, "job-1", "photo-1", "user-1");

      expect(result).toBe(true);
      expect(mocks.jobPhotoDelete).toHaveBeenCalled();
    });
  });
});
