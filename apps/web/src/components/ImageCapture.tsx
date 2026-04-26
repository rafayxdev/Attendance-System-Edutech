import { useRef, useState } from "react";
import type { ChangeEvent } from "react";

interface ImageCaptureProps {
  value: string;
  onChange: (value: string) => void;
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

export function ImageCapture({ value, onChange }: ImageCaptureProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState("");

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
        <span>Attendance Image</span>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => inputRef.current?.click()}
        >
          {value ? "Replace" : "Capture"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden-file-input"
      />
      <div className="image-dropzone" onClick={() => inputRef.current?.click()}>
        {value ? (
          <img src={value} alt="Captured preview" />
        ) : (
          <span>Tap to capture or upload a photo</span>
        )}
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      {value ? (
        <button type="button" className="text-btn" onClick={() => onChange("")}>
          Remove image
        </button>
      ) : null}
    </div>
  );
}
