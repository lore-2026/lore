'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { doc, getDoc, collection, getDocs, addDoc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getRatings } from '../lib/ratingsFirestore';
import { useRatings } from '../contexts/RatingsContext';
import { deriveDisplayScoresForGroup, deriveDisplayScoresForTv } from '../lib/ratingsRanking';
import { fetchMediaDetails, getPosterUrl } from '../lib/tmdb';
import { useAuth } from '../contexts/AuthContext';
import { Globe, Lock } from 'lucide-react';
import Modal from './Modal';
import EmptyState from './EmptyState';
import styles from './ProfileTabs.module.css';

/**
 * ProfileTabs — shared between /profile (current user) and /user (other users).
 *
 * Props:
 *   userId — Firestore uid to load data for
 */
export default function ProfileTabs({ userId }) {
  const { user } = useAuth();
  const { ratings: cachedRatings } = useRatings();
  const router = useRouter();
  const isOwner = user?.uid === userId;

  const [activeTab, setActiveTab] = useState('lists');
  const [movies, setMovies] = useState(null);
  const [shows, setShows] = useState(null);
  const [watchlist, setWatchlist] = useState(null);
  const [lists, setLists] = useState(null);
  const [watchlistFilter, setWatchlistFilter] = useState('all');
  const [expandedShows, setExpandedShows] = useState({});

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [newListVisibility, setNewListVisibility] = useState('public');
  const [savingList, setSavingList] = useState(false);

  const loadRatingsForUser = async (uid) => {
    if (user?.uid === uid && cachedRatings) return cachedRatings;
    return getRatings(uid);
  };

  const loadMovies = async (uid) => {
    const data = await loadRatingsForUser(uid);

    const seen = new Map();
    for (const sentiment in data.movie || {}) {
      const derived = deriveDisplayScoresForGroup(data.movie[sentiment] || [], sentiment);
      for (const entry of derived) {
        const key = String(entry.mediaId);
        if (!seen.has(key) || (entry.displayScore ?? 0) > (seen.get(key).score ?? 0)) {
          seen.set(key, { ...entry, sentiment, score: entry.displayScore ?? 0 });
        }
      }
    }
    const itemRatings = Array.from(seen.values());

    if (itemRatings.length === 0) { setMovies([]); return; }

    itemRatings.sort((a, b) => b.score - a.score);
    itemRatings.forEach((item, i) => { item.rank = i + 1; });

    const enriched = await Promise.all(
      itemRatings.map(async (item) => {
        const d = await fetchMediaDetails('movie', item.mediaId);
        return {
          ...item,
          title: d.title || 'Untitled',
          year: (d.release_date || '').split('-')[0],
          posterPath: d.poster_path || '',
          genres: (d.genres || []).map((g) => g.name),
        };
      })
    );
    setMovies(enriched);
  };

  const loadShows = async (uid) => {
    const data = await loadRatingsForUser(uid);

    const seen = new Map();
    const derivedTv = deriveDisplayScoresForTv(data.tv || {});
    for (const entry of derivedTv) {
      const key = `${entry.mediaId}-s${entry.season ?? 'show'}`;
      if (!seen.has(key) || (entry.displayScore ?? 0) > (seen.get(key).score ?? 0)) {
        seen.set(key, { ...entry, score: entry.displayScore ?? 0 });
      }
    }
    const showRatings = Array.from(seen.values());

    if (showRatings.length === 0) { setShows([]); return; }

    showRatings.sort((a, b) => b.score - a.score);
    showRatings.forEach((item, i) => { item.rank = i + 1; });

    const enriched = await Promise.all(
      showRatings.map(async (item) => {
        const d = await fetchMediaDetails('tv', item.mediaId);
        return {
          ...item,
          mediaType: 'tv',
          title: d.name || 'Untitled',
          year: (d.first_air_date || '').split('-')[0],
          posterPath: d.poster_path || '',
          genres: (d.genres || []).map((g) => g.name),
        };
      })
    );
    setShows(enriched);
  };

  const loadWatchlist = async (uid) => {
    const userDoc = await getDoc(doc(db, 'users', uid));
    const data = userDoc.exists() ? userDoc.data() : {};
    const items = data.lists?.watchlist || [];

    if (items.length === 0) { setWatchlist([]); return; }

    const enriched = await Promise.all(
      items.map(async (item) => {
        const d = await fetchMediaDetails(item.mediaType, item.mediaId);
        return {
          mediaId: item.mediaId,
          mediaType: item.mediaType,
          title: d.title || d.name || 'Untitled',
          year: (d.release_date || d.first_air_date || '').split('-')[0],
          posterPath: d.poster_path || '',
          genres: (d.genres || []).map((g) => g.name),
          overview: d.overview || '',
        };
      })
    );
    setWatchlist(enriched);
  };

  const loadLists = async (uid) => {
    const q = query(collection(db, 'users', uid, 'customLists'), orderBy('createdAt', 'asc'));
    const snap = await getDocs(q);
    const rawLists = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const visible = isOwner ? rawLists : rawLists.filter((l) => l.visibility === 'public');

    const enriched = await Promise.all(
      visible.map(async (list) => {
        const first4 = (list.items || []).slice(0, 4);
        const posters = await Promise.all(
          first4.map(async (item) => {
            try {
              const d = await fetchMediaDetails(item.mediaType, item.mediaId);
              return d.poster_path || '';
            } catch {
              return '';
            }
          })
        );
        return { ...list, posters };
      })
    );
    setLists(enriched);
  };

  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(() => loadLists(userId), 0);
    return () => clearTimeout(timer);
  }, [userId]);

  const selectTab = (tab) => {
    setActiveTab(tab);
    if (tab === 'movies' && movies === null) loadMovies(userId);
    if (tab === 'shows' && shows === null) loadShows(userId);
    if (tab === 'watchlist' && watchlist === null) loadWatchlist(userId);
    if (tab === 'lists' && lists === null) loadLists(userId);
  };

  const createList = async () => {
    if (!newListName.trim() || !user) return;
    setSavingList(true);
    try {
      await addDoc(collection(db, 'users', userId, 'customLists'), {
        name: newListName.trim(),
        description: newListDesc.trim(),
        visibility: newListVisibility,
        items: [],
        createdAt: serverTimestamp(),
      });
      setNewListName('');
      setNewListDesc('');
      setNewListVisibility('public');
      setShowCreateModal(false);
      setLists(null);
      loadLists(userId);
    } catch (err) {
      console.error('Failed to create list:', err);
    } finally {
      setSavingList(false);
    }
  };

  const getListItemLabel = (items) => {
    const n = items?.length || 0;
    const allMovies = n > 0 && items.every((i) => i.mediaType === 'movie');
    const allTV = n > 0 && items.every((i) => i.mediaType === 'tv');
    const noun = allMovies ? 'film' : allTV ? 'show' : 'title';
    return `${n} ${noun}${n !== 1 ? 's' : ''}`;
  };

  const renderRatedRow = (item, mediaType, rankOverride) => (
    <div key={item.mediaId}>
      <Link
        href={`/details?id=${item.mediaId}&media_type=${mediaType}`}
        className={styles.ratedRow}
      >
        <span className={styles.rowRank}>{rankOverride ?? item.rank}</span>
        <Image
          src={getPosterUrl(item.posterPath, 'w200')}
          alt={item.title}
          className={styles.rowPoster}
          width={200}
          height={300}
        />
        <div className={styles.rowInfo}>
          <div className={styles.rowTitleLine}>
            <span className={styles.rowTitle}>{item.title}</span>
            {item.year && <span className={styles.rowYear}>{item.year}</span>}
          </div>
          {item.note && <div className={styles.rowNote}>{item.note}</div>}
          {item.genres?.length > 0 && (
            <div className={styles.rowGenres}>
              {item.genres.map((g) => (
                <span key={g} className={styles.rowGenreBadge}>{g}</span>
              ))}
            </div>
          )}
        </div>
        {item.score != null && (
          <div className={styles.rowScore}>{item.score}</div>
        )}
      </Link>
      <hr className={styles.rowDivider} />
    </div>
  );

  const renderWatchlistRow = (item) => (
    <div key={`${item.mediaType}-${item.mediaId}`}>
      <Link
        href={`/details?id=${item.mediaId}&media_type=${item.mediaType}`}
        className={styles.ratedRow}
      >
        <Image
          src={getPosterUrl(item.posterPath, 'w200')}
          alt={item.title}
          className={styles.rowPoster}
          width={200}
          height={300}
        />
        <div className={styles.rowInfo}>
          <div className={styles.rowTitleLine}>
            <span className={styles.rowTitle}>{item.title}</span>
            {item.year && <span className={styles.rowYear}>{item.year}</span>}
          </div>
          {item.overview && <div className={styles.rowNote}>{item.overview}</div>}
          {item.genres?.length > 0 && (
            <div className={styles.rowGenres}>
              {item.genres.map((g) => (
                <span key={g} className={styles.rowGenreBadge}>{g}</span>
              ))}
            </div>
          )}
        </div>
      </Link>
      <hr className={styles.rowDivider} />
    </div>
  );

  const getShowScore = (group) => {
    const wholeShow = group.find(item => item.season == null);
    if (wholeShow) return wholeShow.score;
    const seasons = group.filter(item => item.season != null);
    if (!seasons.length) return null;
    const numericScores = seasons.map(item => item.score).filter(s => typeof s === 'number' && !isNaN(s));
    if (!numericScores.length) return null;
    const avg = numericScores.reduce((sum, s) => sum + s, 0) / numericScores.length;
    return Math.round(avg * 10) / 10;
  };

  const renderShowGroup = (group, rank) => {
    const first = group[0];
    const wholeShow = group.find(item => item.season == null);
    const seasons = group.filter(item => item.season != null).sort((a, b) => a.season - b.season);
    const showScore = getShowScore(group);
    const isExpanded = !!expandedShows[first.mediaId];

    if (!seasons.length) return renderRatedRow(first, 'tv', rank);

    const toggleExpanded = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setExpandedShows(prev => ({ ...prev, [first.mediaId]: !prev[first.mediaId] }));
    };

    return (
      <div key={first.mediaId}>
        <div className={styles.showGroupRow} onClick={toggleExpanded} style={{ cursor: 'pointer' }}>
          {rank != null && <span className={styles.rowRank}>{rank}</span>}
          <Image
            src={getPosterUrl(first.posterPath, 'w200')}
            alt={first.title}
            className={styles.rowPoster}
            width={200}
            height={300}
          />
          <div className={styles.rowInfo}>
            <div className={styles.rowTitleLine}>
              <Link
                href={`/details?id=${first.mediaId}&media_type=tv`}
                className={styles.rowTitle}
                onClick={(e) => e.stopPropagation()}
              >
                {first.title}
              </Link>
              {first.year && <span className={styles.rowYear}>{first.year}</span>}
              <span className={styles.chevronBtn}>
                <span className={isExpanded ? styles.chevronUp : styles.chevronDown}>›</span>
              </span>
            </div>
            {!isExpanded && wholeShow?.note && (
              <div className={styles.rowNote}>{wholeShow.note}</div>
            )}
            {first.genres?.length > 0 && (
              <div className={styles.rowGenres}>
                {first.genres.map((g) => (
                  <span key={g} className={styles.rowGenreBadge}>{g}</span>
                ))}
              </div>
            )}
          </div>
          {showScore != null && <div className={styles.rowScore}>{showScore}</div>}
        </div>
        <div className={isExpanded ? styles.seasonBreakdown : styles.seasonBreakdownHidden}>
          {wholeShow && (
            <div className={styles.seasonBreakdownEntry}>
              <div className={styles.seasonBreakdownLeft}>
                <span className="eyebrow">Whole show</span>
                <span className={styles.seasonBreakdownNote}>{wholeShow.note || 'No review written'}</span>
              </div>
              <span className={styles.seasonBreakdownScore}>{wholeShow.score}</span>
            </div>
          )}
          {seasons.map(item => (
            <div key={item.season} className={styles.seasonBreakdownEntry}>
              <div className={styles.seasonBreakdownLeft}>
                <span className="eyebrow">Season {item.season}</span>
                <span className={styles.seasonBreakdownNote}>{item.note || 'No review written'}</span>
              </div>
              <span className={styles.seasonBreakdownScore}>{item.score}</span>
            </div>
          ))}
        </div>
        <hr className={styles.rowDivider} />
      </div>
    );
  };

  const renderListCard = (list) => (
    <Link key={list.id} href={`/list?id=${list.id}&uid=${userId}`} className={styles.listCard}>
      <div className={styles.listCardPosters}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.listCardPosterCell}>
            {list.posters?.[i]
              ? <Image src={getPosterUrl(list.posters[i], 'w200')} alt="" className={styles.listCardPosterImg} width={200} height={300} aria-hidden="true" />
              : <div className={styles.listCardPosterEmpty} />
            }
          </div>
        ))}
      </div>
      <div className={styles.listCardInfo}>
        <span className={styles.listCardTitle}>{list.name}</span>
        <div className={styles.listCardMeta}>
          <span>{getListItemLabel(list.items)}</span>
          <span>·</span>
          <span className={styles.listCardVisibility}>
            {list.visibility === 'private' ? <Lock size={12} /> : <Globe size={12} />}
            {list.visibility === 'private' ? 'Private' : 'Public'}
          </span>
        </div>
        {list.description && (
          <p className={styles.listCardDesc}>{list.description}</p>
        )}
      </div>
    </Link>
  );

  const renderContent = () => {
    if (activeTab === 'movies') {
      if (movies === null) return null;
      if (movies.length === 0) return <EmptyState title="Nothing to show here yet." subtitle="Rate movies from the Search page." action={{ label: 'Search for movies', onClick: () => router.push('/explore') }} secondaryAction={{ label: 'Or, Import from Letterboxd', onClick: () => router.push('/settings') }} />;
      return movies.map((item) => renderRatedRow(item, item.mediaType || 'movie'));
    }

    if (activeTab === 'shows') {
      if (shows === null) return null;
      if (shows.length === 0) return <EmptyState title="Nothing to show here yet." subtitle="Rate shows from the Search page." action={{ label: 'Search for shows', onClick: () => router.push('/explore') }} />;

      const groupMap = {};
      for (const item of shows) {
        if (!groupMap[item.mediaId]) groupMap[item.mediaId] = [];
        groupMap[item.mediaId].push(item);
      }
      const sortedGroups = Object.values(groupMap).sort(
        (a, b) => getShowScore(b) - getShowScore(a)
      );
      return sortedGroups.map((group, i) => renderShowGroup(group, i + 1));
    }

    if (activeTab === 'watchlist') {
      if (watchlist === null) return null;
      if (watchlist.length === 0) return <EmptyState title="Your watchlist is empty." subtitle="Add anything you want to watch from the Search page." action={{ label: 'Search for something to watch', onClick: () => router.push('/explore') }} />;
      const filtered = watchlistFilter === 'all' ? watchlist : watchlist.filter((item) => item.mediaType === watchlistFilter);
      return (
        <>
          <div className={styles.filterRow}>
            {['all', 'movie', 'tv'].map((type) => (
              <button
                key={type}
                className={watchlistFilter === type ? styles.chipSelected : styles.chip}
                onClick={() => setWatchlistFilter(type)}
              >
                {type === 'all' ? 'All' : type === 'movie' ? 'Movies' : 'TV shows'}
              </button>
            ))}
          </div>
          {filtered.length === 0
            ? <EmptyState title={`No ${watchlistFilter === 'movie' ? 'movies' : 'TV shows'} in your watchlist.`} action={{ label: `Search for ${watchlistFilter === 'movie' ? 'movies' : 'TV shows'}`, onClick: () => router.push('/explore') }} />
            : filtered.map((item) => renderWatchlistRow(item))
          }
        </>
      );
    }

    if (activeTab === 'lists') {
      if (lists === null) return null;
      if (lists.length === 0) return (
        <EmptyState
          title="No lists yet."
          subtitle="Create a list to organize your films."
          action={isOwner ? { label: 'Create a list', onClick: () => setShowCreateModal(true) } : undefined}
        />
      );
      return (
        <>
          <div className={styles.listsHeader}>
            <span className={styles.emptyState}>{lists.length} {lists.length === 1 ? 'list' : 'lists'}</span>
            {isOwner && (
              <button className={styles.newListBtn} onClick={() => setShowCreateModal(true)}>
                <i className="fas fa-plus" aria-hidden="true" />New list
              </button>
            )}
          </div>
          <div className={styles.listsGrid}>{lists.map(renderListCard)}</div>
        </>
      );
    }
  };

  const tabs = [
    { key: 'lists', label: 'Lists' },
    { key: 'movies', label: 'Movies' },
    { key: 'shows', label: 'Shows' },
    { key: 'watchlist', label: 'Want to Watch' },
  ];

  return (
    <>
      <div className={styles.tabs}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            className={activeTab === key ? styles.tabActive : styles.tab}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles.tabContent}>
        {renderContent()}
      </div>

      {showCreateModal && (
        <Modal
          title="New list"
          onClose={() => setShowCreateModal(false)}
          actions={[
            { label: 'Cancel', onClick: () => setShowCreateModal(false), variant: 'secondary' },
            { label: savingList ? 'Creating...' : 'Create', onClick: createList, disabled: savingList || !newListName.trim() },
          ]}
        >
          <input
            className={styles.modalInput}
            placeholder="List name"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createList(); if (e.key === 'Escape') setShowCreateModal(false); }}
            autoFocus
            spellCheck={false}
          />
          <textarea
            className={styles.modalTextarea}
            placeholder="Description (optional)"
            value={newListDesc}
            onChange={(e) => setNewListDesc(e.target.value)}
          />
          <div className={styles.modalVisibility}>
            <button
              className={newListVisibility === 'public' ? styles.modalVisibilityBtnActive : styles.modalVisibilityBtn}
              onClick={() => setNewListVisibility('public')}
            >
              <Globe size={14} /> Public
            </button>
            <button
              className={newListVisibility === 'private' ? styles.modalVisibilityBtnActive : styles.modalVisibilityBtn}
              onClick={() => setNewListVisibility('private')}
            >
              <Lock size={14} /> Private
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
