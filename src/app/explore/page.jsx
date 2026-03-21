'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import MediaCard from '../../components/MediaCard';
import AddToListModal from '../../components/AddToListModal';
import { searchMedia, getTrendingMovies, getTrendingShows } from '../../lib/tmdb';
import { publicAssetPath } from '../../lib/publicPath';
import { auth, db } from '../../lib/firebase';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import styles from './page.module.css';

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV shows' },
  { value: 'profiles', label: 'Profiles' },
];

async function searchProfileByUsername(query) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return null;
  const usernameSnap = await getDoc(doc(db, 'usernames', trimmed));
  if (!usernameSnap.exists()) return null;
  const uid = usernameSnap.data().uid;
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (!userSnap.exists()) return null;
  return { type: 'profile', uid: userSnap.id, ...userSnap.data() };
}

/**
 * @param {string} searchText
 * @param {{ minChars?: number }} [options] - default minChars 3 for "All" + profiles; use 1 for Profiles-only.
 */
async function searchProfilesByUsernameOrName(searchText, options = {}) {
  const { minChars = 3 } = options;
  const trimmed = searchText.trim().toLowerCase();
  if (trimmed.length < minChars) return [];

  const usersRef = collection(db, 'users');
  const usernameQ = query(
    usersRef,
    orderBy('username'),
    where('username', '>=', trimmed),
    where('username', '<=', `${trimmed}\uf8ff`),
    limit(10)
  );
  const fullNameQ = query(
    usersRef,
    orderBy('fullNameLower'),
    where('fullNameLower', '>=', trimmed),
    where('fullNameLower', '<=', `${trimmed}\uf8ff`),
    limit(10)
  );

  const [usernameSnap, fullNameSnap] = await Promise.all([getDocs(usernameQ), getDocs(fullNameQ)]);
  const byUid = new Map();

  usernameSnap.forEach((userDoc) => {
    byUid.set(userDoc.id, { type: 'profile', uid: userDoc.id, ...userDoc.data() });
  });
  fullNameSnap.forEach((userDoc) => {
    if (!byUid.has(userDoc.id)) {
      byUid.set(userDoc.id, { type: 'profile', uid: userDoc.id, ...userDoc.data() });
    }
  });

  return Array.from(byUid.values());
}

/** Hide the current user from profile results so they don't see their own card. */
function excludeSelfFromProfiles(profiles, selfUid) {
  if (!selfUid || !profiles?.length) return profiles;
  return profiles.filter((p) => p.uid !== selfUid);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function exploreListInitials(fullName) {
  if (!fullName || !fullName.trim()) return '?';
  const parts = fullName.trim().split(/\s+/);
  return `${parts[0][0]}${parts[1]?.[0] || ''}`.toUpperCase();
}

/** Explore profile cards: `photoURLSearch` only (no `photoURL` fallback). */
function ExploreProfileAvatar({ photoURLSearch, fullName, classNameImg, classNameInitials }) {
  const [failed, setFailed] = useState(false);
  const url = typeof photoURLSearch === 'string' ? photoURLSearch.trim() : '';
  if (!url || failed) {
    return <span className={classNameInitials}>{exploreListInitials(fullName)}</span>;
  }
  return (
    <Image
      src={url}
      alt=""
      width={160}
      height={160}
      className={classNameImg}
      onError={() => setFailed(true)}
    />
  );
}

export default function ExplorePage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = empty state, [] = no results
  const [selectedType, setSelectedType] = useState('all');
  const [watchlist, setWatchlist] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [modalMedia, setModalMedia] = useState(null);
  const [trendingMovies, setTrendingMovies] = useState([]);
  const [trendingShows, setTrendingShows] = useState([]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      setCurrentUser(user);
      if (!user) { setWatchlist([]); return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      setWatchlist(snap.exists() ? snap.data().lists?.watchlist || [] : []);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    Promise.all([getTrendingMovies(), getTrendingShows()]).then(([movies, shows]) => {
      setTrendingMovies(movies);
      setTrendingShows(shows);
    });
  }, []);

  const handleModalClose = async () => {
    setModalMedia(null);
    if (currentUser) {
      const snap = await getDoc(doc(db, 'users', currentUser.uid));
      setWatchlist(snap.exists() ? snap.data().lists?.watchlist || [] : []);
    }
  };

  const debouncedSearch = useMemo(
    () =>
      debounce(async (q, type) => {
        if (!q.trim()) {
          setResults(null);
          return;
        }
        const selfUid = auth.currentUser?.uid;
        if (type === 'profiles') {
          const broadMatches = await searchProfilesByUsernameOrName(q, { minChars: 1 });
          const withoutSelf = excludeSelfFromProfiles(broadMatches, selfUid);
          if (withoutSelf.length > 0) {
            setResults(withoutSelf);
            return;
          }
          const exactProfile = await searchProfileByUsername(q);
          if (exactProfile && exactProfile.uid === selfUid) {
            setResults([]);
          } else {
            setResults(exactProfile ? [exactProfile] : []);
          }
          return;
        }
        const mediaData = await searchMedia(q);
        const filteredMedia =
          type === 'all' ? mediaData : mediaData.filter((item) => item.media_type === type);
        if (type === 'all') {
          const broadMatches = await searchProfilesByUsernameOrName(q);
          let profiles = broadMatches;
          if (profiles.length === 0) {
            const exactProfile = await searchProfileByUsername(q);
            profiles = exactProfile ? [exactProfile] : [];
          }
          profiles = excludeSelfFromProfiles(profiles, selfUid);
          const combined = [...filteredMedia, ...profiles];
          setResults(combined);
        } else {
          setResults(filteredMedia);
        }
      }, 300),
    []
  );

  const fetchResults = useCallback((q, type) => {
    debouncedSearch(q, type);
  }, [debouncedSearch]);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    fetchResults(val, selectedType);
  };

  const handleChip = (type) => {
    setSelectedType(type);
    // Re-filter current query with new type
    if (results !== null) {
      fetchResults(query, type);
    }
  };

  return (
    <>
    {modalMedia && (
      <AddToListModal
        mediaId={modalMedia.id}
        mediaType={modalMedia.type}
        onClose={handleModalClose}
      />
    )}
    <div className={styles.searchSection}>
      <div className={styles.searchContainer}>
        <div className={styles.searchWrapper}>
          <input
            type="text"
            placeholder="Search movies, shows, or users"
            className={styles.searchInput}
            value={query}
            onChange={handleInput}
          />
          <span className={styles.searchIcon}>
            <i className="fas fa-search" aria-hidden="true"></i>
          </span>
        </div>

        <div className={styles.filterContainer}>
          <span>Filter by</span>
          <div className={styles.chipContainer}>
            {FILTER_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                className={selectedType === value ? styles.chipSelected : styles.chip}
                onClick={() => handleChip(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {results === null ? (
          <div className={styles.trendingContainer}>
            {[{ label: 'Trending Movies', items: trendingMovies }, { label: 'Trending Shows', items: trendingShows }].map(({ label, items }) => (
              <div key={label} className={styles.trendingSection}>
                <h2 className={styles.trendingTitle}>{label}</h2>
                <div className={styles.trendingRow}>
                  {items.map((item) => {
                    const title = item.title || item.name || 'No Title';
                    const year = (item.release_date || item.first_air_date || '').split('-')[0];
                    return (
                      <div key={`${item.media_type}-${item.id}`} className={styles.trendingCard}>
                        <MediaCard
                          mediaId={item.id}
                          mediaType={item.media_type}
                          title={title}
                          year={year}
                          overview={item.overview}
                          posterPath={item.poster_path}
                          variant="grid"
                          inWatchlist={watchlist.some((w) => w.mediaId === String(item.id))}
                          onAddToList={(id, type) => setModalMedia({ id, type })}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className={styles.resultsContainer}>
          {results.length === 0 ? (
            <div className={styles.emptyState}>No results found.</div>
          ) : (
            results.map((item) => {
              if (item.type === 'profile') {
                const fullName = `${item.firstname || ''} ${item.lastname || ''}`.trim() || 'Unnamed';
                return (
                  <Link
                    key={`profile-${item.uid}`}
                    href={`/user?uid=${item.uid}`}
                    className={styles.profileCard}
                  >
                    <div className={styles.profileCardAvatar}>
                      <div className={styles.profileCardAvatarCircle}>
                        <ExploreProfileAvatar
                          photoURLSearch={item.photoURLSearch}
                          fullName={fullName}
                          classNameImg={styles.profileCardImg}
                          classNameInitials={styles.profileCardInitials}
                        />
                      </div>
                    </div>
                    <div className={styles.profileCardInfo}>
                      <span className={styles.profileCardName}>{fullName}</span>
                      {item.username && <span className={styles.profileCardUsername}>@{item.username}</span>}
                    </div>
                  </Link>
                );
              }
              const title = item.title || item.name || 'No Title';
              const year = (item.release_date || item.first_air_date || '').split('-')[0];
              return (
                <MediaCard
                  key={`${item.media_type}-${item.id}`}
                  mediaId={item.id}
                  mediaType={item.media_type}
                  title={title}
                  year={year}
                  overview={item.overview}
                  posterPath={item.poster_path}
                  variant="grid"
                  inWatchlist={watchlist.some((w) => w.mediaId === String(item.id))}
                  onAddToList={(id, type) => setModalMedia({ id, type })}
                />
              );
            })
          )}
        </div>
        )}
      </div>
    </div>
    </>
  );
}
