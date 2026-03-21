'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import ProfileTabs from '../../components/ProfileTabs';
import AvatarImage from '../../components/AvatarImage';
import ListUserAvatar, { listInitialsFromName } from '../../components/ListUserAvatar';
import styles from './page.module.css';

function UserContent() {
  const searchParams = useSearchParams();
  const selectedUserId = searchParams.get('uid');
  const { user } = useAuth();

  const [targetUserData, setTargetUserData] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [listModalType, setListModalType] = useState(null); // 'followers' | 'following'
  const [listUsers, setListUsers] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [headerAvatarBroken, setHeaderAvatarBroken] = useState(false);
  const isSelf = user && selectedUserId && user.uid === selectedUserId;

  const hasHeaderAvatarUrl = Boolean(targetUserData?.photoURLThumb);

  useEffect(() => {
    setHeaderAvatarBroken(false);
  }, [selectedUserId, targetUserData?.photoURLThumb]);

  const loadTargetUser = async () => {
    const snap = await getDoc(doc(db, 'users', selectedUserId));
    if (snap.exists()) setTargetUserData(snap.data());
  };

  const checkFollowing = async () => {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const data = snap.data();
      setIsFollowing((data.followinglist || []).includes(selectedUserId));
    }
  };

  useEffect(() => {
    if (!selectedUserId) return;
    let cancelled = false;
    setProfileReady(false);
    setTargetUserData(null);
    getDoc(doc(db, 'users', selectedUserId))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) setTargetUserData(snap.data());
        else setTargetUserData(null);
        setProfileReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setTargetUserData(null);
          setProfileReady(true);
        }
      });
    return () => { cancelled = true; };
  }, [selectedUserId]);

  useEffect(() => {
    if (!user || !selectedUserId) return;
    let cancelled = false;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (!cancelled && snap.exists()) {
        const data = snap.data();
        setIsFollowing((data.followinglist || []).includes(selectedUserId));
      }
    });
    return () => { cancelled = true; };
  }, [user, selectedUserId]);

  const handleFollow = async () => {
    if (!user) return;
    const currentUserRef = doc(db, 'users', user.uid);
    const targetUserRef = doc(db, 'users', selectedUserId);

    try {
      if (isFollowing) {
        await updateDoc(currentUserRef, { followinglist: arrayRemove(selectedUserId) });
        await updateDoc(targetUserRef, { followerlist: arrayRemove(user.uid) });
        setIsFollowing(false);
      } else {
        await setDoc(currentUserRef, { followinglist: arrayUnion(selectedUserId) }, { merge: true });
        await setDoc(targetUserRef, { followerlist: arrayUnion(user.uid) }, { merge: true });
        setIsFollowing(true);
      }
      loadTargetUser();
    } catch (err) {
      console.error('Follow failed:', err);
    }
  };

  const handleShare = () => {
    const link = `${window.location.origin}/user?uid=${selectedUserId}`;
    navigator.clipboard.writeText(link)
      .then(() => alert('Profile link copied to clipboard!'))
      .catch(() => alert(`Here's the profile link: ${link}`));
  };

  const openListModal = async (type) => {
    if (!targetUserData || !db) return;
    const uids = type === 'followers' ? (targetUserData.followerlist || []) : (targetUserData.followinglist || []);
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

  if (!selectedUserId) {
    return (
      <div className={styles.profileMissingUid}>
        <Link href="/">Back to home</Link>
        <span>This link is missing a profile id.</span>
      </div>
    );
  }

  if (!profileReady) return null;

  const fullName = targetUserData
    ? `${targetUserData.firstname || ''} ${targetUserData.lastname || ''}`.trim()
    : '';
  const displayName = fullName || 'Unnamed';
  const ratingCount = targetUserData?.ratingCount || 0;
  const followersCount = targetUserData?.followerlist?.length || 0;
  const followingCount = targetUserData?.followinglist?.length || 0;

  return (
    <div className={styles.profileSection}>
      <div className={styles.profileContainer}>
        <div className={styles.profileHeader}>
          <div className={styles.userInfo}>
            <div className={styles.userInfoRow}>
              <div className={styles.identifierSection}>
                <div className={styles.avatarCircle}>
                  {hasHeaderAvatarUrl && !headerAvatarBroken ? (
                    <AvatarImage
                      thumbUrl={targetUserData?.photoURLThumb}
                      photoUrl=""
                      thumbOnly
                      alt="Profile"
                      className={styles.avatarImg}
                      width={96}
                      height={96}
                      onExhausted={() => setHeaderAvatarBroken(true)}
                    />
                  ) : (
                    <span className={styles.avatarInitials}>
                      {fullName ? listInitialsFromName(fullName) : '?'}
                    </span>
                  )}
                </div>
                <div className={styles.nameBlock}>
                  <h2>{displayName}</h2>
                  {targetUserData?.username && (
                    <p className={styles.username}>@{targetUserData.username}</p>
                  )}
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
            {user && !isSelf && (
              <button
                className={`${styles.followButton} ${isFollowing ? styles.following : ''}`}
                onClick={handleFollow}
              >
                {isFollowing ? 'Unfollow' : 'Follow'}
              </button>
            )}
          </div>
        </div>

        {selectedUserId && <ProfileTabs userId={selectedUserId} />}
      </div>

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
                            <ListUserAvatar
                              thumbUrl={u.photoURLThumb}
                              photoUrl={u.photoURL}
                              thumbOnly
                              name={name}
                              classNameImg={styles.modalListAvatarImg}
                              classNameInitials={styles.modalListInitials}
                            />
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

export default function UserPage() {
  return (
    <Suspense fallback={null}>
      <UserContent />
    </Suspense>
  );
}
