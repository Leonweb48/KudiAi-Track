// Compress an image file on the client before upload.
// Accepts images up to maxKB (default 900 KB target for avatars).
// Always outputs JPEG so the result is predictable.
export async function compressImage(file, maxKB = 900) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      // Scale down to max 2400px on longest side — preserves quality at display sizes
      const MAX_DIM = 2400;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width >= height) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM; }
        else                 { width  = Math.round(width  * MAX_DIM / height); height = MAX_DIM; }
      }
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      let quality = 0.85;
      const tryCompress = () => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= maxKB * 1024 || quality <= 0.28) {
            resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
          } else {
            quality = Math.max(quality - 0.08, 0.28);
            tryCompress();
          }
        }, "image/jpeg", quality);
      };
      tryCompress();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
