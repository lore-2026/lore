'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../../lib/firebase';
import { resizeImageForAvatar } from '../../lib/imageUtils';
import { useAuth } from '../../contexts/AuthContext';
import ProfileTabs from '../../components/ProfileTabs';
import { Pencil, X } from 'lucide-react';
import styles from './page.module.css';
import inputStyles from '../login/page.module.css';

/** Survives Strict Mode remount on refresh so the profile doesn’t flash away then back. */
let cachedProfileUid = null;
let cachedProfileUserData = null;

function initialProfileStateFromCache() {
  const u = auth?.currentUser?.uid;
  if (u && cachedProfileUid === u && cachedProfileUserData != null) {
    return { userData: cachedProfileUserData, profileReady: true };
  }
  return { userData: null, profileReady: false };
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, photoURL, setPhotoURL } = useAuth();
  const uid = user?.uid;
  const [userData, setUserData] = useState(() => initialProfileStateFromCache().userData);
  const [profileReady, setProfileReady] = useState(() => initialProfileStateFromCache().profileReady);
  /** true until localStorage is read (useLayoutEffect, before first paint). */
  const [tipHidden, setTipHidden] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [listModalType, setListModalType] = useState(null); // 'followers' | 'following'
  const [listUsers, setListUsers] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const fileInputRef = useRef(null);

  const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

  useLayoutEffect(() => {
    try {
      setTipHidden(localStorage.getItem('dismissedTip') === 'true');
    } catch {
      setTipHidden(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      cachedProfileUid = null;
      cachedProfileUserData = null;
      router.push('/login');
      return;
    }
    if (!uid || !db) return;

    let cancelled = false;
    const sameAsCache = cachedProfileUid === uid;

    if (!sameAsCache) {
      setProfileReady(false);
      setUserData(null);
    }

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : {};
        cachedProfileUid = uid;
        cachedProfileUserData = data;
        setUserData(data);
        setProfileReady(true);
      } catch {
        if (cancelled) return;
        cachedProfileUid = uid;
        cachedProfileUserData = {};
        setUserData({});
        setProfileReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, loading, user, router]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/login');
  };

  const handleShare = () => {
    if (!user) return;
    const link = `${window.location.origin}/user?uid=${user.uid}`;
    navigator.clipboard.writeText(link)
      .then(() => alert('Profile link copied to clipboard!'))
      .catch(() => alert(`Here's your profile link: ${link}`));
  };

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const storageRef = ref(storage, `avatars/${user.uid}`);
      const blob = await resizeImageForAvatar(file);
      await uploadBytes(storageRef, blob);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', user.uid), { photoURL: url });
      setPhotoURL(url);
      setUserData((prev) => {
        const next = { ...prev, photoURL: url };
        if (cachedProfileUid === user.uid) cachedProfileUserData = next;
        return next;
      });
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const startEditUsername = () => {
    setUsernameInput(userData?.username || '');
    setUsernameError('');
    setEditingUsername(true);
  };

  const saveUsername = async () => {
    const trimmed = usernameInput.trim().toLowerCase();
    if (!USERNAME_RE.test(trimmed)) {
      setUsernameError('3–20 chars, letters, numbers, underscores only.');
      return;
    }
    const previousUsername = (userData?.username || '').trim().toLowerCase();
    if (trimmed === previousUsername) { setEditingUsername(false); return; }

    setSavingUsername(true);
    setUsernameError('');
    try {
      const usernameRef = doc(db, 'usernames', trimmed);
      const snap = await getDoc(usernameRef);
      if (snap.exists()) { setUsernameError('Already taken.'); setSavingUsername(false); return; }

      const batch = writeBatch(db);
      batch.set(usernameRef, { uid: user.uid });
      batch.set(doc(db, 'users', user.uid), { username: trimmed }, { merge: true });
      if (previousUsername) batch.delete(doc(db, 'usernames', previousUsername));
      await batch.commit();

      setUserData((prev) => ({ ...prev, username: trimmed }));
      setEditingUsername(false);
    } catch {
      setUsernameError('Something went wrong.');
    } finally {
      setSavingUsername(false);
    }
  };

  const dismissTip = () => {
    setTipHidden(true);
    localStorage.setItem('dismissedTip', 'true');
  };

  const openListModal = async (type) => {
    if (!userData || !db) return;
    const uids = type === 'followers' ? (userData.followerlist || []) : (userData.followinglist || []);
    setListModalType(type);
    setListUsers([]);
    setListLoading(true);
    try {
      const snaps = await Promise.all(uids.map((uid) => getDoc(doc(db, 'users', uid))));
      const users = snaps
        .filter((s) => s.exists())
        .map((s) => ({ uid: s.id, ...s.data() }));
      setListUsers(users);
    } catch (e) {
      console.error(e);
    } finally {
      setListLoading(false);
    }
  };

  const closeListModal = () => {
    setListModalType(null);
    setListUsers([]);
  };

  if (loading) return null;
  if (!user) return null;
  if (!profileReady) return null;

  const fullName = userData
    ? `${userData.firstname || ''} ${userData.lastname || ''}`.trim()
    : '';
  const displayName = fullName || 'Unnamed';
  const displayUsername = userData?.username ? `@${userData.username}` : '@set username';
  const ratingCount = userData?.ratingCount || 0;
  const followersCount = userData?.followerlist?.length || 0;
  const followingCount = userData?.followinglist?.length || 0;

  return (
    <div className={styles.profileSection}>
      <div className={styles.profileContainer}>
        <div className={styles.profileHeader}>
          <div className={styles.userInfo}>
            <div className={styles.userInfoRow}>
              <div className={styles.identifierSection}>
                <button className={styles.avatarBtn} onClick={handleAvatarClick} disabled={uploading} aria-label="Change profile picture">
                  {photoURL
                    ? <Image src={photoURL} alt="Profile" className={styles.avatarImg} width={96} height={96} />
                    : <span className={styles.avatarInitials}>{fullName ? `${fullName.split(' ')[0][0]}${fullName.split(' ')[1]?.[0] || ''}`.toUpperCase() : '?'}</span>
                  }
                  <span className={styles.avatarOverlay}>{uploading ? '...' : <i className="fas fa-camera" aria-hidden="true" />}</span>
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
                <div className={styles.nameBlock}>
                  <h2>{displayName}</h2>
                  <button type="button" className={styles.usernameBtn} onClick={startEditUsername}>
                    <span>{displayUsername}</span>
                    <Pencil size={16} className={styles.usernamePencil} />
                  </button>
                </div>
              </div>
              <div className={styles.statsSection}>
                <div className={styles.statItem}>
                  <span className="eyebrow">Ratings</span>
                  <span className={styles.statNumber}>{ratingCount}</span>
                </div>
                <button
                  type="button"
                  className={styles.statItemButton}
                  onClick={() => openListModal('followers')}
                  aria-label="View followers"
                >
                  <span className="eyebrow">Followers</span>
                  <span className={styles.statNumber}>{followersCount}</span>
                </button>
                <button
                  type="button"
                  className={styles.statItemButton}
                  onClick={() => openListModal('following')}
                  aria-label="View following"
                >
                  <span className="eyebrow">Following</span>
                  <span className={styles.statNumber}>{followingCount}</span>
                </button>
              </div>
            </div>
          </div>
          <div className={styles.buttons}>
            <button className={styles.btn} onClick={handleShare}>
              <i className="fas fa-link" aria-hidden="true"></i>Share
            </button>
          </div>
        </div>

        {!tipHidden && (
          <div className={styles.alerts}>
            <div className={styles.inlineAlertTip}>
              <div className={styles.alertHeader}>
                💡 Quick tip
                <button className={styles.alertClose} onClick={dismissTip}>
                  <i className="fas fa-times" aria-hidden="true"></i>
                </button>
              </div>
              <p>Share your profile link to add friends — more ways to connect coming soon!</p>
            </div>
          </div>
        )}

        {user && <ProfileTabs userId={user.uid} />}
      </div>

      {editingUsername && (
        <div className={styles.modalBackdrop} onClick={() => setEditingUsername(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Edit username</h3>
              <button className={styles.modalCloseBtn} onClick={() => setEditingUsername(false)}>
                <X size={16} />
              </button>
            </div>
            <div className={inputStyles.inputWrapper}>
              <span className={inputStyles.inputIconLeft}>@</span>
              <input
                className={inputStyles.inputWithPrefix}
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveUsername(); if (e.key === 'Escape') setEditingUsername(false); }}
                autoFocus
                spellCheck={false}
                placeholder="username"
              />
            </div>
            {usernameError && <p className={styles.usernameError}>{usernameError}</p>}
            <div className={styles.modalButtons}>
              <button className={styles.modalCancelBtn} onClick={() => setEditingUsername(false)}>Cancel</button>
              <button className={styles.modalSaveBtn} onClick={saveUsername} disabled={savingUsername}>
                {savingUsername ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {listModalType && (
        <div className={styles.modalBackdrop} onClick={closeListModal} role="dialog" aria-modal="true" aria-labelledby="list-modal-title">
          <div className={styles.modalList} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 id="list-modal-title" className={styles.modalTitle}>
                {listModalType === 'followers' ? 'Followers' : 'Following'}
              </h3>
              <button className={styles.modalCloseBtn} onClick={closeListModal} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className={styles.modalListBody}>
              {listLoading ? (
                <p className={styles.modalListEmpty}>Loading…</p>
              ) : listUsers.length === 0 ? (
                <p className={styles.modalListEmpty}>
                  {listModalType === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
                </p>
              ) : (
                <ul className={styles.modalListUl}>
                  {listUsers.map((u) => {
                    const name = `${u.firstname || ''} ${u.lastname || ''}`.trim() || 'Unnamed';
                    return (
                      <li key={u.uid}>
                        <Link href={`/user?uid=${u.uid}`} className={styles.modalListRow} onClick={closeListModal}>
                          <div className={styles.modalListAvatar}>
                            {u.photoURL
                              ? <Image src={u.photoURL} alt="" width={40} height={40} className={styles.modalListAvatarImg} />
                              : <span className={styles.modalListInitials}>{name ? `${name.split(' ')[0][0]}${name.split(' ')[1]?.[0] || ''}`.toUpperCase() : '?'}</span>
                            }
                          </div>
                          <div className={styles.modalListInfo}>
                            <span className={styles.modalListName}>{name}</span>
                            {u.username && <span className={styles.modalListUsername}>@{u.username}</span>}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
