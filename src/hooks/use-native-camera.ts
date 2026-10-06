import { Capacitor } from "@capacitor/core";
import { useCallback, useState } from "react";

export type CaptureSource = "camera" | "gallery";

export interface NativeCameraResult {
  file: File;
  previewUrl: string;
}

async function mediaResultToNativeResult(
  webPath: string
): Promise<NativeCameraResult> {
  const response = await fetch(webPath);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch image: ${response.status} ${response.statusText}`
    );
  }
  const blob = await response.blob();
  const ext = blob.type.includes("png") ? "png" : "jpeg";
  const file = new File([blob], `photo_${Date.now()}.${ext}`, {
    type: blob.type || "image/jpeg",
  });
  return { file, previewUrl: URL.createObjectURL(file) };
}

export function useNativeCamera() {
  const isNative = Capacitor.isNativePlatform();
  const [isCapturing, setIsCapturing] = useState(false);

  const capturePhoto = useCallback(
    async (source: CaptureSource): Promise<NativeCameraResult | null> => {
      if (!isNative) {
        return null;
      }
      setIsCapturing(true);
      try {
        // Lazy: the camera plugin only ships code paths that run on-device;
        // web/PWA users never download it.
        const { Camera, MediaTypeSelection } = await import(
          "@capacitor/camera"
        );
        if (source === "camera") {
          const result = await Camera.takePhoto({ quality: 85 });
          const path = result.webPath;
          if (!path) {
            return null;
          }
          return await mediaResultToNativeResult(path);
        }
        const result = await Camera.chooseFromGallery({
          mediaType: MediaTypeSelection.Photo,
          allowMultipleSelection: false,
          limit: 1,
        });
        const first = result.results[0];
        if (!first?.webPath) {
          return null;
        }
        return await mediaResultToNativeResult(first.webPath);
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "message" in err &&
          typeof (err as { message: string }).message === "string" &&
          (err as { message: string }).message.includes("cancel")
        ) {
          return null;
        }
        throw err;
      } finally {
        setIsCapturing(false);
      }
    },
    [isNative]
  );

  return { capturePhoto, isCapturing, isNative };
}
