/**
 * Resize an image file for use as an avatar (smaller file size, faster loads).
 * @param {File} file - Image file from input
 * @param {number} maxSize - Max width/height in pixels (default 400)
 * @returns {Promise<Blob>} - Resized image as JPEG blob
 */
export function resizeImageForAvatar(file, maxSize = 400) {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      if (width <= maxSize && height <= maxSize) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85);
        return;
      }
      const scale = maxSize / Math.max(width, height);
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

/**
 * Create square avatar variants from one source file.
 * @param {Blob | File} file
 * @returns {Promise<{ full: Blob, search: Blob, thumb: Blob }>}
 */
export function createAvatarVariantBlobs(file) {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(file);

    const toSquareJpeg = (size, quality) => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const sourceSize = Math.min(img.width, img.height);
      const sx = Math.floor((img.width - sourceSize) / 2);
      const sy = Math.floor((img.height - sourceSize) / 2);
      ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
      return new Promise((res, rej) => {
        canvas.toBlob((blob) => (blob ? res(blob) : rej(new Error('toBlob failed'))), 'image/jpeg', quality);
      });
    };

    img.onload = async () => {
      try {
        const [full, search, thumb] = await Promise.all([
          toSquareJpeg(512, 0.88),
          toSquareJpeg(256, 0.85),
          toSquareJpeg(128, 0.82),
        ]);
        resolve({ full, search, thumb });
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };

    img.src = url;
  });
}
