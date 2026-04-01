'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection, query, orderBy, limit, getDocs, addDoc,
  updateDoc, deleteDoc, doc, arrayUnion, arrayRemove, serverTimestamp,
  increment, getDoc, where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import Link from 'next/link';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import Modal from './Modal';
import styles from './DiscussionSection.module.css';

function formatTime(ts) {
  if (!ts) return 'just now';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

function autoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function Avatar({ photoURL, username, size = 'md' }) {
  return <img src={photoURL || '/images/default-avatar-bg.png'} alt={username} className={styles[`avatar${size}`]} />;
}

export default function DiscussionSection({ mediaKey, mediaTitle, userScore }) {
  const { user: authUser, initials: authInitials, photoURL: authPhotoURL } = useAuth();

  const [tab, setTab] = useState('friends');
  const [followingList, setFollowingList] = useState([]);
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [newPostText, setNewPostText] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [posting, setPosting] = useState(false);
  const [openReplies, setOpenReplies] = useState(new Set());
  const [repliesData, setRepliesData] = useState({});
  const [replyTexts, setReplyTexts] = useState({});
  const [openReplyComposer, setOpenReplyComposer] = useState(new Set());
  const [postingReply, setPostingReply] = useState({});
  const [currentUsername, setCurrentUsername] = useState(null);
  const [editingThread, setEditingThread] = useState(null); // threadId
  const [editingReply, setEditingReply] = useState(null);   // { threadId, replyId }
  const [editText, setEditText] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null); // { type: 'thread'|'reply', threadId, replyId? }

  useEffect(() => {
    if (!authUser) return;
    getDoc(doc(db, 'users', authUser.uid)).then(snap => {
      if (!snap.exists()) {
        setCurrentUsername(authUser.displayName || 'Anonymous');
        return;
      }
      const data = snap.data();
      setCurrentUsername(data.username || authUser.displayName || 'Anonymous');
      setFollowingList(data.followinglist || []);
    }).catch(() => setCurrentUsername(authUser.displayName || 'Anonymous'));
  }, [authUser]);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const threadsRef = collection(db, 'mediaDiscussions', mediaKey, 'threads');
      let q;
      if (tab === 'friends') {
        // Always include the current user's own posts alongside people they follow
        const uids = [...new Set([authUser?.uid, ...followingList].filter(Boolean))].slice(0, 30);
        q = query(threadsRef, where('uid', 'in', uids), orderBy('createdAt', 'desc'), limit(20));
      } else {
        q = query(threadsRef, orderBy('voteCount', 'desc'), limit(20));
      }
      const snap = await getDocs(q);
      setThreads(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('Failed to load threads', e);
    } finally {
      setThreadsLoading(false);
    }
  }, [tab, mediaKey, followingList, authUser]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const handlePostThread = async () => {
    if (!authUser || !newPostText.trim() || posting) return;
    setPosting(true);
    try {
      const threadsRef = collection(db, 'mediaDiscussions', mediaKey, 'threads');
      const data = {
        uid: authUser.uid,
        username: currentUsername || 'Anonymous',
        photoURL: authPhotoURL || null,
        text: newPostText.trim(),
        voteCount: 1,
        upvoterUids: [authUser.uid],
        createdAt: serverTimestamp(),
        replyCount: 0,
        userScore: userScore ?? null,
      };
      const ref = await addDoc(threadsRef, data);
      setThreads(prev => [{ id: ref.id, ...data, createdAt: { toDate: () => new Date() } }, ...prev]);
      setNewPostText('');
      setShowComposer(false);
    } catch (e) {
      console.error('Failed to post thread', e);
    } finally {
      setPosting(false);
    }
  };

  const handleVoteThread = async (threadId) => {
    if (!authUser) return;
    const uid = authUser.uid;
    const thread = threads.find(t => t.id === threadId);
    if (!thread) return;
    const isVoted = (thread.upvoterUids || []).includes(uid);
    const delta = isVoted ? -1 : 1;

    setThreads(prev => prev.map(t => t.id !== threadId ? t : {
      ...t,
      voteCount: (t.voteCount || 0) + delta,
      upvoterUids: isVoted
        ? (t.upvoterUids || []).filter(u => u !== uid)
        : [...(t.upvoterUids || []), uid],
    }));

    try {
      await updateDoc(doc(db, 'mediaDiscussions', mediaKey, 'threads', threadId), {
        voteCount: increment(delta),
        upvoterUids: isVoted ? arrayRemove(uid) : arrayUnion(uid),
      });
    } catch (e) {
      console.error('Vote failed', e);
      loadThreads();
    }
  };

  const loadReplies = async (threadId) => {
    if (repliesData[threadId]) return;
    try {
      const q = query(
        collection(db, 'mediaDiscussions', mediaKey, 'threads', threadId, 'replies'),
        orderBy('createdAt', 'asc'),
      );
      const snap = await getDocs(q);
      setRepliesData(prev => ({ ...prev, [threadId]: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    } catch (e) {
      console.error('Failed to load replies', e);
    }
  };

  const toggleReplies = async (threadId) => {
    const next = new Set(openReplies);
    if (next.has(threadId)) {
      next.delete(threadId);
    } else {
      next.add(threadId);
      await loadReplies(threadId);
    }
    setOpenReplies(next);
  };

  const openReplyComposerFor = async (threadId) => {
    const nextOpen = new Set(openReplies);
    nextOpen.add(threadId);
    setOpenReplies(nextOpen);
    await loadReplies(threadId);
    setOpenReplyComposer(prev => new Set([...prev, threadId]));
  };

  const closeReplyComposer = (threadId) => {
    setOpenReplyComposer(prev => { const s = new Set(prev); s.delete(threadId); return s; });
    setReplyTexts(prev => ({ ...prev, [threadId]: '' }));
  };

  const handlePostReply = async (threadId) => {
    if (!authUser || !replyTexts[threadId]?.trim() || postingReply[threadId]) return;
    setPostingReply(prev => ({ ...prev, [threadId]: true }));
    try {
      const data = {
        uid: authUser.uid,
        username: currentUsername || 'Anonymous',
        photoURL: authPhotoURL || null,
        text: replyTexts[threadId].trim(),
        voteCount: 1,
        upvoterUids: [authUser.uid],
        createdAt: serverTimestamp(),
        userScore: userScore ?? null,
      };
      const ref = await addDoc(
        collection(db, 'mediaDiscussions', mediaKey, 'threads', threadId, 'replies'),
        data,
      );
      await updateDoc(doc(db, 'mediaDiscussions', mediaKey, 'threads', threadId), {
        replyCount: increment(1),
      });
      const optimistic = { id: ref.id, ...data, createdAt: { toDate: () => new Date() } };
      setRepliesData(prev => ({ ...prev, [threadId]: [...(prev[threadId] || []), optimistic] }));
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, replyCount: (t.replyCount || 0) + 1 } : t));
      closeReplyComposer(threadId);
    } catch (e) {
      console.error('Failed to post reply', e);
    } finally {
      setPostingReply(prev => ({ ...prev, [threadId]: false }));
    }
  };

  const handleVoteReply = async (threadId, replyId) => {
    if (!authUser) return;
    const uid = authUser.uid;
    const reply = repliesData[threadId]?.find(r => r.id === replyId);
    if (!reply) return;
    const isVoted = (reply.upvoterUids || []).includes(uid);
    const delta = isVoted ? -1 : 1;

    setRepliesData(prev => ({
      ...prev,
      [threadId]: (prev[threadId] || []).map(r => r.id !== replyId ? r : {
        ...r,
        voteCount: (r.voteCount || 0) + delta,
        upvoterUids: isVoted ? (r.upvoterUids || []).filter(u => u !== uid) : [...(r.upvoterUids || []), uid],
      }),
    }));

    try {
      await updateDoc(
        doc(db, 'mediaDiscussions', mediaKey, 'threads', threadId, 'replies', replyId),
        { voteCount: increment(delta), upvoterUids: isVoted ? arrayRemove(uid) : arrayUnion(uid) },
      );
    } catch (e) {
      console.error('Reply vote failed', e);
    }
  };

  const startEditThread = (thread) => {
    setEditingThread(thread.id);
    setEditText(thread.text);
    setEditingReply(null);
  };

  const saveEditThread = async (threadId) => {
    if (!editText.trim()) return;
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, text: editText.trim() } : t));
    setEditingThread(null);
    try {
      await updateDoc(doc(db, 'mediaDiscussions', mediaKey, 'threads', threadId), { text: editText.trim() });
    } catch (e) {
      console.error('Failed to edit thread', e);
      loadThreads();
    }
  };

  const deleteThread = async (threadId) => {
    setThreads(prev => prev.filter(t => t.id !== threadId));
    setPendingDelete(null);
    try {
      await deleteDoc(doc(db, 'mediaDiscussions', mediaKey, 'threads', threadId));
    } catch (e) {
      console.error('Failed to delete thread', e);
      loadThreads();
    }
  };

  const startEditReply = (threadId, reply) => {
    setEditingReply({ threadId, replyId: reply.id });
    setEditText(reply.text);
    setEditingThread(null);
  };

  const saveEditReply = async (threadId, replyId) => {
    if (!editText.trim()) return;
    setRepliesData(prev => ({
      ...prev,
      [threadId]: (prev[threadId] || []).map(r => r.id === replyId ? { ...r, text: editText.trim() } : r),
    }));
    setEditingReply(null);
    try {
      await updateDoc(
        doc(db, 'mediaDiscussions', mediaKey, 'threads', threadId, 'replies', replyId),
        { text: editText.trim() },
      );
    } catch (e) {
      console.error('Failed to edit reply', e);
    }
  };

  const deleteReply = async (threadId, replyId) => {
    setRepliesData(prev => ({
      ...prev,
      [threadId]: (prev[threadId] || []).filter(r => r.id !== replyId),
    }));
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, replyCount: Math.max(0, (t.replyCount || 1) - 1) } : t));
    setPendingDelete(null);
    try {
      await deleteDoc(doc(db, 'mediaDiscussions', mediaKey, 'threads', threadId, 'replies', replyId));
      await updateDoc(doc(db, 'mediaDiscussions', mediaKey, 'threads', threadId), { replyCount: increment(-1) });
    } catch (e) {
      console.error('Failed to delete reply', e);
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.type === 'thread') deleteThread(pendingDelete.threadId);
    else deleteReply(pendingDelete.threadId, pendingDelete.replyId);
  };

  const friendsEmpty = tab === 'friends' && !threadsLoading && threads.length === 0;

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <span className={styles.title}>Discussion</span>
          {!threadsLoading && (
            <span className={styles.count}>{threads.length} {threads.length === 1 ? 'thread' : 'threads'}</span>
          )}
        </div>
        <div className={styles.sortTabs}>
          {['Friends', 'All'].map(t => (
            <button
              key={t}
              className={`${styles.sortTab} ${tab === t.toLowerCase() ? styles.sortTabActive : ''}`}
              onClick={() => setTab(t.toLowerCase())}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {authUser && !showComposer && (
        <div className={styles.newPostBar} onClick={() => setShowComposer(true)}>
          <Avatar uid={authUser.uid} photoURL={authPhotoURL} username={currentUsername || authInitials} size="md" />
          <span className={styles.newPostPlaceholder}>Share a take on {mediaTitle}…</span>
        </div>
      )}

      {authUser && showComposer && (
        <div className={styles.composer}>
          <textarea
            className={styles.composerInput}
            rows={1}
            placeholder={`Share a take on ${mediaTitle}…`}
            value={newPostText}
            onChange={e => {
              setNewPostText(e.target.value);
              autoResize(e.target);
            }}
            autoFocus
          />
          <div className={styles.composerActions}>
            <button className={`${styles.actionBtn} ${styles.actionBtnCancel}`} onClick={() => { setShowComposer(false); setNewPostText(''); }}>
              Cancel
            </button>
            <button
              className={`${styles.actionBtn} ${newPostText.trim() ? '' : styles.actionBtnDisabled}`}
              onClick={handlePostThread}
              disabled={!newPostText.trim() || posting}
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}

      <div className={styles.threadList}>
        {threadsLoading ? (
          <div className={styles.emptyText}>Loading discussions…</div>
        ) : friendsEmpty ? (
          <div className={styles.emptyText}>
            No takes yet — be the first, or follow people to see theirs here.
          </div>
        ) : threads.length === 0 ? (
          <div className={styles.emptyText}>No discussions yet. Be the first to share a take!</div>
        ) : threads.map(thread => {
          const isVoted = authUser && (thread.upvoterUids || []).includes(authUser.uid);
          const repliesOpen = openReplies.has(thread.id);
          const threadReplies = repliesData[thread.id] || [];
          const replyComposerOpen = openReplyComposer.has(thread.id);

          return (
            <div key={thread.id} className={styles.thread}>
              <div className={styles.voteCol}>
                <button
                  className={`${styles.voteBtn} ${isVoted ? styles.voteBtnActive : ''}`}
                  onClick={() => handleVoteThread(thread.id)}
                  disabled={!authUser}
                >
                  🥕
                </button>
                <span className={`${styles.voteCount} ${isVoted ? styles.voteCountActive : ''}`}>
                  {thread.voteCount || 0}
                </span>
              </div>

              <div className={styles.threadBody}>
                <div className={styles.threadMeta}>
                  <Link href={`/user?uid=${thread.uid}`} className={styles.authorLink}>
                    <Avatar uid={thread.uid} photoURL={thread.photoURL} username={thread.username} size="sm" />
                    <span className={styles.threadAuthor}>{thread.username}</span>
                  </Link>
                  <span className={styles.threadTime}>{formatTime(thread.createdAt)}</span>
                  {thread.userScore != null && (
                    <span className={styles.ratingBadge}>{thread.userScore}</span>
                  )}
                </div>

                {editingThread === thread.id ? (
                  <div className={styles.inlineEdit}>
                    <textarea
                      className={styles.inlineEditInput}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      autoFocus
                    />
                    <div className={styles.inlineEditActions}>
                      <button className={`${styles.actionBtn} ${styles.actionBtnCancel}`} onClick={() => setEditingThread(null)}>Cancel</button>
                      <button className={`${styles.actionBtn} ${!editText.trim() ? styles.actionBtnDisabled : ''}`} onClick={() => saveEditThread(thread.id)} disabled={!editText.trim()}>Save</button>
                    </div>
                  </div>
                ) : (
                  <p className={styles.threadText}>{thread.text}</p>
                )}

                <div className={styles.threadActions}>
                  <button className={styles.threadActionBtn} onClick={() => toggleReplies(thread.id)}>
                    <MessageSquare size={13} />
                    {thread.replyCount || 0} {repliesOpen ? '· hide' : 'replies'}
                  </button>
                  {authUser && (
                    <button className={styles.threadActionBtn} onClick={() => openReplyComposerFor(thread.id)}>
                      Reply
                    </button>
                  )}
                  {authUser?.uid === thread.uid && (
                    <>
                      <button className={styles.threadActionBtn} onClick={() => startEditThread(thread)}>
                        <Pencil size={12} />
                      </button>
                      <button className={`${styles.threadActionBtn} ${styles.threadActionBtnDanger}`} onClick={() => setPendingDelete({ type: 'thread', threadId: thread.id })}>
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>

                {repliesOpen && (
                  <div className={styles.repliesWrap}>
                    {threadReplies.map(reply => {
                      const isReplyVoted = authUser && (reply.upvoterUids || []).includes(authUser.uid);
                      return (
                        <div key={reply.id} className={styles.reply}>
                          <div className={styles.replyVoteCol}>
                            <button
                              className={`${styles.replyVoteBtn} ${isReplyVoted ? styles.voteBtnActive : ''}`}
                              onClick={() => handleVoteReply(thread.id, reply.id)}
                              disabled={!authUser}
                            >
                              🥕
                            </button>
                            <span className={`${styles.replyVoteCount} ${isReplyVoted ? styles.voteCountActive : ''}`}>
                              {reply.voteCount || 0}
                            </span>
                          </div>
                          <div className={styles.replyBody}>
                            <div className={styles.replyMeta}>
                              <Link href={`/user?uid=${reply.uid}`} className={styles.authorLink}>
                                <Avatar uid={reply.uid} photoURL={reply.photoURL} username={reply.username} size="xs" />
                                <span className={styles.replyAuthor}>{reply.username}</span>
                              </Link>
                              <span className={styles.replyTime}>{formatTime(reply.createdAt)}</span>
                              {reply.userScore != null && (
                                <span className={`${styles.ratingBadge} ${styles.ratingBadgeSm}`}>{reply.userScore}</span>
                              )}
                            </div>
                            {editingReply?.replyId === reply.id ? (
                              <div className={styles.inlineEdit}>
                                <textarea
                                  className={styles.inlineEditInput}
                                  value={editText}
                                  onChange={e => setEditText(e.target.value)}
                                  autoFocus
                                />
                                <div className={styles.inlineEditActions}>
                                  <button className={`${styles.actionBtn} ${styles.actionBtnCancel}`} onClick={() => setEditingReply(null)}>Cancel</button>
                                  <button className={`${styles.actionBtn} ${!editText.trim() ? styles.actionBtnDisabled : ''}`} onClick={() => saveEditReply(thread.id, reply.id)} disabled={!editText.trim()}>Save</button>
                                </div>
                              </div>
                            ) : (
                              <p className={styles.replyText}>{reply.text}</p>
                            )}
                            <div className={styles.replyActions}>
                              {authUser && (
                                <button className={styles.replyActionBtn} onClick={() => openReplyComposerFor(thread.id)}>
                                  Reply
                                </button>
                              )}
                              {authUser?.uid === reply.uid && (
                                <>
                                  <button className={styles.replyActionBtn} onClick={() => startEditReply(thread.id, reply)}>
                                    <Pencil size={11} />
                                  </button>
                                  <button className={`${styles.replyActionBtn} ${styles.replyActionBtnDanger}`} onClick={() => setPendingDelete({ type: 'reply', threadId: thread.id, replyId: reply.id })}>
                                    <Trash2 size={11} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {replyComposerOpen && (
                      <div className={styles.replyComposer}>
                        <Avatar uid={authUser?.uid} photoURL={authPhotoURL} username={currentUsername || authInitials} size="xs" />
                        <div className={styles.replyComposerInputWrap}>
                          <textarea
                            className={styles.replyInput}
                            rows={1}
                            placeholder="Add a reply…"
                            value={replyTexts[thread.id] || ''}
                            onChange={e => {
                              setReplyTexts(prev => ({ ...prev, [thread.id]: e.target.value }));
                              autoResize(e.target);
                            }}
                            autoFocus
                          />
                          <div className={styles.replyComposerActions}>
                            <button className={`${styles.actionBtn} ${styles.actionBtnCancel}`} onClick={() => closeReplyComposer(thread.id)}>
                              Cancel
                            </button>
                            <button
                              className={`${styles.actionBtn} ${(replyTexts[thread.id] || '').trim() ? '' : styles.actionBtnDisabled}`}
                              onClick={() => handlePostReply(thread.id)}
                              disabled={!(replyTexts[thread.id] || '').trim() || postingReply[thread.id]}
                            >
                              {postingReply[thread.id] ? 'Posting…' : 'Post'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {threads.length >= 20 && (
        <div className={styles.footer}>
          <button className={styles.loadMoreBtn} onClick={loadThreads}>Load more discussions</button>
        </div>
      )}

      {pendingDelete && (
        <Modal
          title="Delete post?"
          onClose={() => setPendingDelete(null)}
          maxWidth="360px"
          actions={[
            { label: 'Cancel', onClick: () => setPendingDelete(null), variant: 'secondary' },
            { label: 'Delete', onClick: confirmDelete },
          ]}
        >
          <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', padding: 'var(--space-4) var(--space-4) 0' }}>
            This can&apos;t be undone.
          </p>
        </Modal>
      )}
    </section>
  );
}
