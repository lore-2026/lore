'use client';

import { useState } from 'react';
import AvatarImage from './AvatarImage';

export function listInitialsFromName(name) {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return `${parts[0][0]}${parts[1]?.[0] || ''}`.toUpperCase();
}

/**
 * Per-row avatar in followers/following modal.
 * Default: thumb when set, else photo. `thumbOnly`: thumb only (e.g. `/user` page).
 */
export default function ListUserAvatar({
  thumbUrl,
  photoUrl,
  name,
  classNameImg,
  classNameInitials,
  thumbOnly = false,
}) {
  const [showInitials, setShowInitials] = useState(false);
  const hasThumb = Boolean(thumbUrl && String(thumbUrl).trim());
  const hasPhoto = Boolean(photoUrl && String(photoUrl).trim());
  const hasUrl = thumbOnly ? hasThumb : hasThumb || hasPhoto;
  if (showInitials || !hasUrl) {
    return <span className={classNameInitials}>{listInitialsFromName(name)}</span>;
  }
  return (
    <AvatarImage
      thumbUrl={thumbUrl}
      photoUrl={photoUrl}
      thumbOnly={thumbOnly}
      alt=""
      width={40}
      height={40}
      className={classNameImg}
      onExhausted={() => setShowInitials(true)}
    />
  );
}
