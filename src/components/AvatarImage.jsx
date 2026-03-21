'use client';

import Image from 'next/image';

function trimUrl(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Profile avatars: by default uses `photoURLThumb` when set, otherwise `photoURL`.
 * Set `thumbOnly` to never use `photoURL` (e.g. `/user` page).
 */
export default function AvatarImage({
  thumbUrl,
  photoUrl,
  /** If true, only `thumbUrl` is used; no fallback to `photoUrl`. */
  thumbOnly = false,
  alt,
  width,
  height,
  className,
  priority = false,
  /** Called when the chosen URL fails to load (parent usually shows initials). */
  onExhausted,
}) {
  const thumb = trimUrl(thumbUrl);
  const photo = trimUrl(photoUrl);
  const src = thumbOnly ? thumb : thumb || photo;
  if (!src) return null;

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
      onError={() => onExhausted?.()}
    />
  );
}
