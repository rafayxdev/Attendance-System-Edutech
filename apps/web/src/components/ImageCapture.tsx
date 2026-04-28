import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

interface ImageCaptureProps {
  value: string;
  onChange: (value: string) => void;
  cameraOnly?: boolean;
  required?: boolean;
}

async function fileToDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to load image."));
    img.src = dataUrl;
  });

  const maxWidth = 960;
  const scale = Math.min(1, maxWidth / image.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas not available.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

export function ImageCapture({
  value,
  onChange,
  cameraOnly = false,
  required = false,
}: ImageCaptureProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);

  async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0
    ) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Camera stream did not become ready in time."));
      }, 4500);

      const onReady = () => {
        if (video.videoWidth > 0) {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("canplay", onReady);
      };

      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("canplay", onReady);
    });
  }

  async function getCameraStream(): Promise<MediaStream> {
    const fallbackConstraints: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ];

    let lastError: unknown;
    for (const constraints of fallbackConstraints) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("Unable to access camera stream.");
  }

  function stopCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  async function startCamera() {
    if (cameraOpen || cameraBusy) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not supported on this device/browser.");
      return;
    }

    try {
      setCameraBusy(true);
      setError("");
      stopCamera();

      const stream = await getCameraStream();

      streamRef.current = stream;
      setCameraOpen(true);

      // Wait one paint so the <video> node exists in the DOM before binding stream.
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;

        await video.play();
        await waitForVideoReady(video);
      } else {
        throw new Error("Camera preview element is not available.");
      }
    } catch {
      setError(
        "Unable to open camera feed. Allow permission and ensure no other app is using the camera.",
      );
      stopCamera();
    } finally {
      setCameraBusy(false);
    }
  }

  function captureFromCamera() {
    const video = videoRef.current;
    if (!video) return;

    if (video.videoWidth < 2 || video.videoHeight < 2) {
      setError(
        "Camera is not ready yet. Please wait one moment and try again.",
      );
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 540;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Unable to capture image from camera.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    onChange(dataUrl);
    stopCamera();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError("");
      const dataUrl = await fileToDataUrl(file);
      onChange(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to process image.");
    }
  }

  return (
    <div className="image-capture">
      <div className="image-capture-head">
        <span>
          Attendance Image
          {required ? " (Required)" : ""}
        </span>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            if (cameraOnly) {
              void startCamera();
            } else {
              inputRef.current?.click();
            }
          }}
        >
          {cameraOnly
            ? cameraOpen
              ? "Camera On"
              : "Capture"
            : value
              ? "Replace"
              : "Capture"}
        </button>
      </div>

      {!cameraOnly ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden-file-input"
          />
          <div
            className="image-dropzone"
            onClick={() => inputRef.current?.click()}
          >
            {value ? (
              <img src={value} alt="Captured preview" />
            ) : (
              <span>Tap to capture or upload a photo</span>
            )}
          </div>
        </>
      ) : (
        <div className="camera-only-wrap">
          {cameraOpen ? (
            <>
              <video
                ref={videoRef}
                className="camera-preview"
                playsInline
                muted
              />
              <div className="camera-actions">
                <button
                  type="button"
                  className="primary-btn slim"
                  onClick={captureFromCamera}
                >
                  Capture Now
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={stopCamera}
                >
                  Close Camera
                </button>
              </div>
            </>
          ) : value ? (
            <div className="image-dropzone" onClick={() => void startCamera()}>
              <img src={value} alt="Captured preview" />
            </div>
          ) : (
            <div className="image-dropzone" onClick={() => void startCamera()}>
              <span>
                Tap to open camera and capture your photo.
                <br />
                Upload and paste are disabled.
              </span>
            </div>
          )}
        </div>
      )}

      {error ? <div className="form-error">{error}</div> : null}
      {value ? (
        <button type="button" className="text-btn" onClick={() => onChange("")}>
          Remove image
        </button>
      ) : null}
    </div>
  );
}
