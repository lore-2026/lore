'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { fetchMediaDetails, getPosterUrl } from '../../lib/tmdb';
import { useAuth } from '../../contexts/AuthContext';
import MediaCard from '../../components/MediaCard';
import { Globe, Lock, X, Pencil, Trash2 } from 'lucide-react';
import styles from './page.module.css';

function ListContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const uid = searchParams.get('uid');
  const router = useRouter();
  const { user } = useAuth();

  const [listData, setListData] = useState(null);
  const [items, setItems] = useState(null);
  const [ownerName, setOwnerName] = useState('');
  const [watchlist, setWatchlist] = useState([]);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editVisibility, setEditVisibility] = useState('public');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!uid || !id) return;
    (async () => {
      const [listSnap, userSnap] = await Promise.all([
        getDoc(doc(db, 'users', uid, 'customLists', id)),
        getDoc(doc(db, 'users', uid)),
      ]);
      if (!listSnap.exists()) return;
      const list = { id: listSnap.id, ...listSnap.data() };
      setListData(list);
      if (userSnap.exists()) {
        const u = userSnap.data();
        const name = `${u.firstname || ''} ${u.lastname || ''}`.trim() || u.username || 'Unknown';
        setOwnerName(name);
      }
      if (list.items?.length) {
        const enriched = await Promise.all(
          list.items.map(async (item) => {
            const d = await fetchMediaDetails(item.mediaType, item.mediaId);
            return {
              mediaId: item.mediaId,
              mediaType: item.mediaType,
              title: d.title || d.name || 'Untitled',
              year: (d.release_date || d.first_air_date || '').split('-')[0],
              posterPath: d.poster_path || '',
              overview: d.overview || '',
            };
          })
        );
        setItems(enriched);
      } else {
        setItems([]);
      }
    })();
  }, [uid, id]);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (snap.exists()) setWatchlist(snap.data().lists?.watchlist || []);
    });
  }, [user]);

  const openEditModal = () => {
    setEditName(listData.name);
    setEditDesc(listData.description || '');
    setEditVisibility(listData.visibility || 'public');
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', uid, 'customLists', id), {
        name: editName.trim(),
        description: editDesc.trim(),
        visibility: editVisibility,
      });
      setListData((prev) => ({
        ...prev,
        name: editName.trim(),
        description: editDesc.trim(),
        visibility: editVisibility,
      }));
      setShowEditModal(false);
    } catch (err) {
      console.error('Failed to save list:', err);
    } finally {
      setSaving(false);
    }
  };

  const deleteList = async () => {
    await deleteDoc(doc(db, 'users', uid, 'customLists', id));
    router.push(isOwner ? '/profile' : `/user?uid=${uid}`);
  };

  const removeItem = async (mediaId, mediaType) => {
    const updatedItems = (listData.items || []).filter(
      (i) => !(String(i.mediaId) === String(mediaId) && i.mediaType === mediaType)
    );
    await updateDoc(doc(db, 'users', uid, 'customLists', id), { items: updatedItems });
    setListData((prev) => ({ ...prev, items: updatedItems }));
    setItems((prev) => prev.filter(
      (i) => !(String(i.mediaId) === String(mediaId) && i.mediaType === mediaType)
    ));
  };

  const isOwner = user?.uid === uid;
  const backHref = isOwner ? '/profile' : `/user?uid=${uid}`;

  return (
    <div className={styles.listSection}>
      <div className={styles.listContainer}>
        {listData && (
          <div className={styles.listMeta}>
            <div className={styles.listTitleRow}>
              <div className={styles.listTitleGroup}>
                <button className={styles.backBtn} onClick={() => router.push(backHref)}>
                  <i className="fas fa-arrow-left" aria-hidden="true" />
                </button>
                <h1 className={styles.listTitle}>{listData.name}</h1>
              </div>
              <div className={styles.listActions}>
                {isOwner && (
                  <>
                    <button className={styles.iconBtn} onClick={openEditModal} aria-label="Edit list">
                      <Pencil size={16} />
                    </button>
                    <button className={styles.iconBtnDanger} onClick={() => setConfirmDelete(true)} aria-label="Delete list">
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
                <button
                  className={styles.iconBtn}
                  aria-label="Share list"
                  onClick={() => {
                    const url = window.location.href;
                    navigator.clipboard.writeText(url)
                      .then(() => alert('List link copied to clipboard!'))
                      .catch(() => alert(`Here's the list link: ${url}`));
                  }}
                >
                  <i className="fas fa-link" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={styles.listSubMeta}>
              <span className={styles.listCount}>{listData.items?.length || 0} titles</span>
              <span className={styles.listMetaDot}>·</span>
              {listData.visibility === 'private' ? <Lock size={13} /> : <Globe size={13} />}
              <span>{listData.visibility === 'private' ? 'Private' : 'Public'}</span>
            </div>
            {listData.description && (
              <p className={styles.listDescription}>{listData.description}</p>
            )}
          </div>
        )}

        <div className={styles.resultsContainer}>
          {items === null ? null : items.length === 0 ? (
            <p className={styles.emptyState}>No titles in this list yet.</p>
          ) : (
            items.map((item) => (
              <MediaCard
                key={`${item.mediaType}-${item.mediaId}`}
                mediaId={item.mediaId}
                mediaType={item.mediaType}
                title={item.title}
                year={item.year}
                overview={item.overview}
                posterPath={item.posterPath}
                variant="grid"
                inWatchlist={watchlist.some((w) => w.mediaId === String(item.mediaId))}
                onRemove={isOwner ? () => removeItem(item.mediaId, item.mediaType) : undefined}
              />
            ))
          )}
        </div>
      </div>

      {showEditModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowEditModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Edit list</h3>
              <button className={styles.modalCloseBtn} onClick={() => setShowEditModal(false)}>
                <X size={16} />
              </button>
            </div>
            <input
              className={styles.modalInput}
              placeholder="List name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setShowEditModal(false); }}
              autoFocus
              spellCheck={false}
            />
            <textarea
              className={styles.modalTextarea}
              placeholder="Description (optional)"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />
            <div className={styles.modalVisibility}>
              <button
                className={editVisibility === 'public' ? styles.modalVisibilityBtnActive : styles.modalVisibilityBtn}
                onClick={() => setEditVisibility('public')}
              >
                <Globe size={14} /> Public
              </button>
              <button
                className={editVisibility === 'private' ? styles.modalVisibilityBtnActive : styles.modalVisibilityBtn}
                onClick={() => setEditVisibility('private')}
              >
                <Lock size={14} /> Private
              </button>
            </div>
            <div className={styles.modalButtons}>
              <button className={styles.modalCancelBtn} onClick={() => setShowEditModal(false)}>Cancel</button>
              <button
                className={styles.modalSaveBtn}
                onClick={saveEdit}
                disabled={saving || !editName.trim()}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className={styles.modalBackdrop} onClick={() => setConfirmDelete(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Delete list</h3>
              <button className={styles.modalCloseBtn} onClick={() => setConfirmDelete(false)}>
                <X size={16} />
              </button>
            </div>
            <p className={styles.deleteConfirmText}>
              Are you sure you want to delete <strong>{listData?.name}</strong>? This can&apos;t be undone.
            </p>
            <div className={styles.modalButtons}>
              <button className={styles.modalCancelBtn} onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className={styles.deleteConfirmBtn} onClick={deleteList}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ListPage() {
  return (
    <Suspense fallback={null}>
      <ListContent />
    </Suspense>
  );
}
