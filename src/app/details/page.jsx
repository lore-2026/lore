'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { doc, getDoc, updateDoc, collection, getDocs, increment, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getMediaAverageRating, getRatingDocId, saveRatings } from '../../lib/ratingsFirestore';
import { useRatings } from '../../contexts/RatingsContext';
import { fetchMediaDetails, getPosterUrl } from '../../lib/tmdb';
import { createInitialRankKey, keyBetween, rebalanceRankKeys } from '../../lib/lexorank';
import { deriveDisplayScoresForGroup, deriveDisplayScoresForTv, enrichRatingsWithScoreBasic, scoreForPosition, sortRatingsByRank } from '../../lib/ratingsRanking';
import { publicAssetPath } from '../../lib/publicPath';
import AddToListModal from '../../components/AddToListModal';
import DiscussionSection from '../../components/DiscussionSection';
import { Repeat, Trash2, ChevronDown } from 'lucide-react';
import styles from './page.module.css';

function DetailsContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const mediaType = searchParams.get('media_type');
  const { user: authUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [media, setMedia] = useState(null);
  const [bgGradient, setBgGradient] = useState(null);

  // Watchlist / list modal
  const [showListModal, setShowListModal] = useState(false);

  // Rating state machine: 'season' (TV only) | 'initial' | 'comparing' | 'done'
  const [ratingPhase, setRatingPhase] = useState('initial');
  const [selectedSeason, setSelectedSeason] = useState(null); // null = whole show
  const [selectedSentiment, setSelectedSentiment] = useState(null);
  const [note, setNote] = useState('');
  const [comparisonGroup, setComparisonGroup] = useState([]);
  const [insertionState, setInsertionState] = useState(null); // { low, high, mid }
  const [compareTitle, setCompareTitle] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [finalScore, setFinalScore] = useState(null);
  const [, setExistingRating] = useState(null);
  const [existingSentiment, setExistingSentiment] = useState(null);
  const [isReranking, setIsReranking] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [existingShowRatings, setExistingShowRatings] = useState([]);
  const [showRatingForm, setShowRatingForm] = useState(false);
  const [friendsRatings, setFriendsRatings] = useState(null); // null = not loaded yet
  const [friendsError, setFriendsError] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [openFriendDropdownSeason, setOpenFriendDropdownSeason] = useState(undefined);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteSeason, setPendingDeleteSeason] = useState(undefined);
  const [deleting, setDeleting] = useState(false);
  const [overallAverage, setOverallAverage] = useState(null); // { average, count } | null
  const [persistingComparison, setPersistingComparison] = useState(false);
  const { ratings: userRatings, setRatings: setUserRatings, refreshRatings, loading: ratingsLoading } = useRatings();
  const [discussionUsername, setDiscussionUsername] = useState(null);

  const denormNumericScore = (d) => {
    if (!d) return null;
    if (typeof d.scoreBasic === 'number') return d.scoreBasic;
    if (typeof d.score === 'number') return d.score;
    return null;
  };

  const isComparableCandidate = useCallback((item) => {
    if (mediaType !== 'tv') return true;
    // Season ratings should only compare with seasons of the same show.
    if (selectedSeason != null) {
      return item.season != null && String(item.mediaId) === String(id);
    }
    // Whole-show ratings should only compare with whole-show ratings.
    return item.season == null;
  }, [mediaType, selectedSeason, id]);

  // Close friend dropdown when clicking outside
  useEffect(() => {
    if (openFriendDropdownSeason === undefined) return;
    const handler = () => setOpenFriendDropdownSeason(undefined);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openFriendDropdownSeason]);

  const refreshShowRatings = useCallback((ratings) => {
    const all = [];
    if (mediaType === 'tv') {
      const derivedTv = deriveDisplayScoresForTv(ratings.tv || {});
      for (const entry of derivedTv) {
        if (String(entry.mediaId) === String(id)) {
          all.push({ season: entry.season ?? null, score: entry.displayScore ?? 0 });
        }
      }
    } else {
      for (const sentiment in ratings[mediaType] || {}) {
        const derived = deriveDisplayScoresForGroup(ratings[mediaType][sentiment] || [], sentiment);
        for (const entry of derived) {
          if (String(entry.mediaId) === String(id)) {
            all.push({ season: entry.season ?? null, score: entry.displayScore ?? 0 });
          }
        }
      }
    }
    setExistingShowRatings(all.sort((a, b) => (a.season ?? Infinity) - (b.season ?? Infinity)));
  }, [id, mediaType]);

  // Load media details
  useEffect(() => {
    if (!id || !mediaType) return;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchMediaDetails(mediaType, id);
        setMedia(data);
        setCurrentTitle(mediaType === 'movie' ? data.title : data.name);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [id, mediaType]);

  // Load overall average rating for this title (from mediaRatings aggregate)
  useEffect(() => {
    if (!id || !mediaType) return;
    const mediaKey = mediaType === 'tv' ? `tv_${id}` : `movie_${id}`;
    getMediaAverageRating(mediaKey).then(setOverallAverage).catch(() => setOverallAverage(null));
  }, [id, mediaType]);

  // O(1) read for this movie’s rating doc (scoreBasic + sentiment) while full cache may still load.
  useEffect(() => {
    if (!authUser || !id || mediaType !== 'movie') return;
    getDoc(doc(db, 'users', authUser.uid, 'ratings', `movie_${id}`)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (typeof d.scoreBasic === 'number') {
        setFinalScore(d.scoreBasic);
        setExistingSentiment(d.sentiment ?? null);
        setRatingPhase('done');
      }
    }).catch(() => {});
  }, [authUser, id, mediaType]);

  // Apply global ratings cache to local details state.
  useEffect(() => {
    if (!authUser || !id || !mediaType || !userRatings) return;
    refreshShowRatings(userRatings);
    if (mediaType === 'movie') {
      let found = false;
      for (const sentiment in userRatings[mediaType] || {}) {
        const derived = deriveDisplayScoresForGroup(userRatings[mediaType][sentiment] || [], sentiment);
        for (const entry of derived) {
          if (String(entry.mediaId) === String(id)) {
            setExistingRating(entry);
            setExistingSentiment(sentiment);
            setRatingPhase('done');
            setFinalScore(entry.displayScore ?? null);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  }, [authUser, id, mediaType, userRatings, refreshShowRatings]);

  // Load friends' ratings when page is loaded
  useEffect(() => {
    if (!authUser || !id || !mediaType) return;

    (async () => {
      try {
        const userRef = doc(db, 'users', authUser.uid);
        const userSnap = await getDoc(userRef);
        const following = userSnap.exists() ? (userSnap.data().followinglist || []) : [];

        if (!following.length) {
          setFriendsRatings([]);
        } else {
          const mediaKey = mediaType === 'tv' ? `tv_${id}` : `movie_${id}`;
          let friendsArray = [];

          if (mediaType === 'tv') {
            const friendRows = await Promise.all(
              following
                .filter((uid) => uid !== authUser.uid)
                .map(async (uid) => {
                  const wholeRef = doc(db, 'mediaRatings', mediaKey, 'userRatings', uid);
                  const seasonsRef = collection(db, 'mediaRatings', mediaKey, 'userRatings', uid, 'seasons');
                  const [wholeSnap, seasonsSnap] = await Promise.all([getDoc(wholeRef), getDocs(seasonsRef)]);

                  const seasons = [];
                  seasonsSnap.forEach((seasonDoc) => {
                    const seasonData = seasonDoc.data();
                    seasons.push({
                      season: seasonData.season ?? Number(seasonDoc.id),
                      score: denormNumericScore(seasonData),
                      note: seasonData.note ?? null,
                    });
                  });

                  const wholeShow = wholeSnap.exists() ? {
                    score: denormNumericScore(wholeSnap.data()),
                    note: wholeSnap.data().note ?? null,
                  } : null;

                  if (!wholeShow && seasons.length === 0) return null;
                  return {
                    uid,
                    wholeShow,
                    seasons,
                    mediaType: 'tv',
                  };
                })
            );
            friendsArray = friendRows.filter(Boolean);
          } else {
            const colRef = collection(db, 'mediaRatings', mediaKey, 'userRatings');
            const snap = await getDocs(colRef);
            const byFriend = new Map();
            snap.forEach((d) => {
              const data = d.data();
              const uid = data.uid;
              if (!uid) return;
              if (uid === authUser.uid) return;
              if (!following.includes(uid)) return;
              byFriend.set(uid, {
                uid,
                wholeShow: {
                  score: denormNumericScore(data),
                  note: data.note ?? null,
                },
                seasons: [],
                mediaType: 'movie',
              });
            });
            friendsArray = Array.from(byFriend.values());
          }

          // Enrich with user display data (name, username, photo)
          const enriched = await Promise.all(
            friendsArray.map(async (friend) => {
              try {
                const uSnap = await getDoc(doc(db, 'users', friend.uid));
                if (!uSnap.exists()) return friend;
                const uData = uSnap.data();
                const fullName = `${uData.firstname || ''} ${uData.lastname || ''}`.trim();
                return {
                  ...friend,
                  displayName: fullName || null,
                  username: uData.username || null,
                  photoURL: uData.photoURL || null,
                };
              } catch {
                return friend;
              }
            })
          );

          // For movies or whole-show view, compute a primary score for sorting
          enriched.forEach((f) => {
            if (f.mediaType === 'movie') {
              f.primaryScore = f.wholeShow?.score ?? 0;
            } else {
              const seasonsSorted = [...f.seasons].sort((a, b) => (a.season ?? 0) - (b.season ?? 0));
              f.seasons = seasonsSorted;
              const scores = [];
              if (f.wholeShow?.score != null) scores.push(f.wholeShow.score);
              seasonsSorted.forEach((s) => {
                if (s.score != null) scores.push(s.score);
              });
              if (scores.length) {
                f.primaryScore = Math.round(
                  (scores.reduce((sum, v) => sum + v, 0) / scores.length) * 10
                ) / 10;
              } else {
                f.primaryScore = 0;
              }
            }
          });

          enriched.sort((a, b) => (b.primaryScore || 0) - (a.primaryScore || 0));
          setFriendsRatings(enriched);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to load friends ratings', err);
        setFriendsError('Could not load friends ratings.');
        setFriendsRatings([]);
      }
    })();
  }, [authUser, id, mediaType]);

  // Extract dominant colors from poster for background gradient
  useEffect(() => {
    if (!media?.poster_path) return;

    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.src = getPosterUrl(media.poster_path, 'w92');

    img.onload = () => {
      const W = 10, H = 15;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const pixels = ctx.getImageData(0, 0, W, H).data;

      // Pick the most saturated pixel from the top half (left glow) and bottom half (right glow)
      const saturation = (r, g, b) => {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        return max === 0 ? 0 : (max - min) / max;
      };

      let r1 = 0, g1 = 0, b1 = 0, sat1 = -1;
      let r3 = 0, g3 = 0, b3 = 0, sat3 = -1;
      const halfH = Math.floor(H / 2);

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
          const s = saturation(r, g, b);
          if (y < halfH) {
            if (s > sat1) { sat1 = s; r1 = r; g1 = g; b1 = b; }
          } else {
            if (s > sat3) { sat3 = s; r3 = r; g3 = g; b3 = b; }
          }
        }
      }

      setBgGradient(
        `radial-gradient(ellipse 70% 60% at 10% 0%, rgba(${r1},${g1},${b1},0.25) 0%, rgba(${r1},${g1},${b1},0.1) 50%, transparent 100%),` +
        `radial-gradient(ellipse 70% 60% at 90% 0%, rgba(${r3},${g3},${b3},0.18) 0%, transparent 100%)`
      );
    };
  }, [media?.poster_path]);

  useEffect(() => {
    if (!authUser) return;
    getDoc(doc(db, 'users', authUser.uid)).then(snap => {
      const name = snap.exists()
        ? (snap.data().username || authUser.displayName || 'Anonymous')
        : (authUser.displayName || 'Anonymous');
      setDiscussionUsername(name);
    }).catch(() => setDiscussionUsername(authUser.displayName || 'Anonymous'));
  }, [authUser]);

  const autoPostDiscussionNote = async (displayScore) => {
    if (!note.trim() || isReranking) return;
    const user = auth.currentUser;
    if (!user) return;
    try {
      await addDoc(collection(db, 'mediaDiscussions', `${mediaType}_${id}`, 'threads'), {
        uid: user.uid,
        username: discussionUsername || 'Anonymous',
        photoURL: authUser?.photoURL || null,
        text: note.trim(),
        voteCount: 1,
        upvoterUids: [user.uid],
        createdAt: serverTimestamp(),
        replyCount: 0,
        userScore: displayScore ?? null,
      });
    } catch (e) {
      console.error('Failed to auto-post discussion note', e);
    }
  };

  const handleNext = async () => {
    if (persistingComparison) return;
    if (!selectedSentiment) { alert('Please select a rating!'); return; }
    const user = auth.currentUser;
    if (!user) { alert('Please log in to rate'); return; }

    if (ratingsLoading || !userRatings) return;
    let ratings = userRatings;

    if (!ratings[mediaType]) ratings[mediaType] = {};
    if (!ratings[mediaType][selectedSentiment]) ratings[mediaType][selectedSentiment] = [];

    const matchesCurrent = (item) => item.mediaId === id && (item.season ?? null) === (selectedSeason ?? null);

    const group = (ratings[mediaType][selectedSentiment] || [])
      .filter(item => !matchesCurrent(item) && isComparableCandidate(item))
      .sort(sortRatingsByRank);
    const untouchedInSentiment = (ratings[mediaType][selectedSentiment] || [])
      .filter(item => !matchesCurrent(item) && !isComparableCandidate(item));

    if (group.length === 0) {
      const rankKey = createInitialRankKey();
      const max = scoreForPosition(selectedSentiment, 0, 1);
      const existedInRatings = Object.keys(ratings[mediaType] || {}).some((sentiment) =>
        (ratings[mediaType][sentiment] || []).some(matchesCurrent)
      );
      const newRating = {
        mediaId: id,
        mediaType,
        sentiment: selectedSentiment,
        mediaName: currentTitle || null,
        note: note || null,
        score: rankKey,
        timestamp: new Date().toISOString(),
        ...(selectedSeason != null && { season: selectedSeason }),
      };

      for (const sentiment of Object.keys(ratings[mediaType])) {
        ratings[mediaType][sentiment] = (ratings[mediaType][sentiment] || []).filter(item => !matchesCurrent(item));
      }
      ratings[mediaType][selectedSentiment] = [...untouchedInSentiment, newRating];
      const enriched = enrichRatingsWithScoreBasic(ratings);
      setUserRatings(enriched);
      refreshShowRatings(enriched);

      await saveRatings(user.uid, enriched);
      if (!existedInRatings && !isReranking) {
        await incrementRatingCount(user.uid);
        autoPostDiscussionNote(max);
      }
      if (mediaType === 'tv') {
        setSelectedSentiment(null);
        setSelectedSeason(null);
        setNote('');
        setIsReranking(false);
        setRatingPhase('initial');
        setShowRatingForm(false);
      } else {
        setFinalScore(max);
        setRatingPhase('done');
      }
      return;
    }

    // Start binary insertion
    setComparisonGroup(group);
    const initState = { low: 0, high: group.length - 1, mid: Math.floor((0 + group.length - 1) / 2) };
    setInsertionState(initState);

    const compareEntry0 = group[initState.mid];
    const baseName0 = compareEntry0.mediaName || String(compareEntry0.mediaId);
    setCompareTitle(compareEntry0.season != null ? `${baseName0} (Season ${compareEntry0.season})` : baseName0);
    setRatingPhase('comparing');
  };

  const handleComparison = async (prefersCurrent) => {
    if (persistingComparison) return;
    const { low, high, mid } = insertionState;
    let newLow = low;
    let newHigh = high;

    if (prefersCurrent) {
      newHigh = mid - 1;
    } else {
      newLow = mid + 1;
    }

    if (newLow > newHigh) {
      // Insert at newLow position
      saveWithInsertion(newLow, true);
    } else {
      const newMid = Math.floor((newLow + newHigh) / 2);
      setInsertionState({ low: newLow, high: newHigh, mid: newMid });
      const compareEntry = comparisonGroup[newMid];
      const baseName = compareEntry.mediaName || String(compareEntry.mediaId);
      setCompareTitle(compareEntry.season != null ? `${baseName} (Season ${compareEntry.season})` : baseName);
    }
  };

  const handleSkip = async () => {
    if (persistingComparison) return;
    saveWithInsertion(insertionState?.low ?? comparisonGroup.length, true);
  };

  const   saveWithInsertion = async (position, background = false) => {
    const user = auth.currentUser;
    if (ratingsLoading || !userRatings) return;
    let ratings = userRatings;

    if (!ratings[mediaType]) ratings[mediaType] = {};

    const matchesCurrent = (item) => item.mediaId === id && (item.season ?? null) === (selectedSeason ?? null);
    const existedInRatings = Object.keys(ratings[mediaType] || {}).some((sentiment) =>
      (ratings[mediaType][sentiment] || []).some(matchesCurrent)
    );
    const ratingDocId = getRatingDocId(mediaType, id, selectedSeason);

    const group = [...(ratings[mediaType][selectedSentiment] || [])]
      .filter(item => !matchesCurrent(item) && isComparableCandidate(item))
      .sort(sortRatingsByRank);
    const untouchedInSentiment = (ratings[mediaType][selectedSentiment] || [])
      .filter(item => !matchesCurrent(item) && !isComparableCandidate(item));

    const leftKey = position > 0 ? group[position - 1]?.score ?? group[position - 1]?.scoreV2 ?? null : null;
    const rightKey = position < group.length ? group[position]?.score ?? group[position]?.scoreV2 ?? null : null;
    let nextScore = keyBetween(leftKey, rightKey);
    let total = group.length + 1;
    const scoreAtPosition = scoreForPosition(selectedSentiment, position, total);

    const newEntry = {
      id: ratingDocId,
      mediaId: id,
      mediaType,
      sentiment: selectedSentiment,
      mediaName: currentTitle || null,
      note: note || null,
      score: '',
      timestamp: new Date().toISOString(),
      ...(selectedSeason != null && { season: selectedSeason }),
    };

    let rebalancedEntries = null;
    if (nextScore == null) {
      // Rare path: no room between neighbor keys. Rebalance only this target group.
      const expanded = [...group];
      expanded.splice(position, 0, newEntry);
      const keys = rebalanceRankKeys(expanded.length);
      rebalancedEntries = expanded.map((entry, idx) => ({
        ...entry,
        score: keys[idx],
      }));
      nextScore = rebalancedEntries[position].score;
    }

    for (const sentiment of Object.keys(ratings[mediaType])) {
      ratings[mediaType][sentiment] = (ratings[mediaType][sentiment] || []).filter(item => !matchesCurrent(item));
    }
    const optimistic = { ...newEntry, score: nextScore };
    const updatedGroup = rebalancedEntries || [...group];
    if (!rebalancedEntries) updatedGroup.splice(position, 0, optimistic);
    ratings[mediaType][selectedSentiment] = [...untouchedInSentiment, ...updatedGroup];
    const enriched = enrichRatingsWithScoreBasic(ratings);
    setUserRatings(enriched);
    refreshShowRatings(enriched);

    if (!existedInRatings && !isReranking) autoPostDiscussionNote(scoreAtPosition);

    if (mediaType === 'tv') {
      setSelectedSentiment(null);
      setSelectedSeason(null);
      setNote('');
      setIsReranking(false);
      setInsertionState(null);
      setRatingPhase('initial');
      setShowRatingForm(false);
    } else {
      setFinalScore(scoreAtPosition);
      setExistingSentiment(selectedSentiment);
      setIsReranking(false);
      setRatingPhase('done');
      setInsertionState(null);
    }
    setInsertionState(null);

    const persistWrite = async () => {
      await saveRatings(user.uid, enriched);
      if (!existedInRatings && !isReranking) await incrementRatingCount(user.uid);
    };

    if (background) {
      setPersistingComparison(true);
      persistWrite().catch(async (e) => {
        // eslint-disable-next-line no-console
        console.error('Failed to persist rating update', e);
        alert('Could not finish saving your rating. Please try again.');
        try {
          const fresh = await refreshRatings();
          setUserRatings(fresh);
          refreshShowRatings(fresh);
        } catch {
          // ignore secondary read error
        }
      }).finally(() => {
        setPersistingComparison(false);
      });
      return;
    }

    await persistWrite();
  };

  const handleRerankSeason = (season) => {
    setSelectedSeason(season);
    setSelectedSentiment(null);
    setNote('');
    setIsReranking(true);
    setRatingPhase('initial');
    setShowRatingForm(true);
  };

  const handleSeasonSelect = (season) => {
    setSelectedSeason(season);
    setSelectedSentiment(null);
  };

  const handleRerank = () => {
    setRatingPhase('initial');
    setSelectedSeason(null);
    setSelectedSentiment(null);
    setNote('');
    setIsReranking(true);
  };

  const scoredFriends = friendsRatings ? friendsRatings.filter(f => f.primaryScore > 0) : [];
  const friendsAvg = scoredFriends.length > 0
    ? Math.round((scoredFriends.reduce((sum, f) => sum + f.primaryScore, 0) / scoredFriends.length) * 10) / 10
    : null;
  const tvUserOverall = existingShowRatings.length > 0
    ? Math.round((existingShowRatings.reduce((sum, r) => sum + r.score, 0) / existingShowRatings.length) * 10) / 10
    : null;

  const getFriendsForSeason = (season) =>
    scoredFriends
      .map(f => {
        const score = season === null
          ? (f.wholeShow?.score ?? null)
          : (f.seasons?.find(s => s.season === season)?.score ?? null);
        return score != null ? { ...f, score } : null;
      })
      .filter(Boolean);

  // Collect all unique seasons across user + friends for the breakdown table
  const breakdownSeasons = (() => {
    const seen = new Set();
    const seasons = [];
    existingShowRatings.forEach(r => { if (!seen.has(r.season)) { seen.add(r.season); seasons.push(r.season); } });
    scoredFriends.forEach(f => {
      if (f.wholeShow?.score != null && !seen.has(null)) { seen.add(null); seasons.push(null); }
      f.seasons?.forEach(s => { if (s.score != null && !seen.has(s.season)) { seen.add(s.season); seasons.push(s.season); } });
    });
    return seasons.sort((a, b) => a === null ? -1 : b === null ? 1 : a - b);
  })();

  const getFriendsSeasonAvg = (season) => {
    const scores = scoredFriends
      .map(f => season === null ? (f.wholeShow?.score ?? null) : (f.seasons?.find(s => s.season === season)?.score ?? null))
      .filter(s => s != null);
    if (!scores.length) return null;
    return Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10;
  };

  const handleDeleteRatingClick = () => {
    setPendingDeleteSeason(undefined);
    setShowDeleteConfirm(true);
  };

  const handleDeleteSeasonClick = (season) => {
    setPendingDeleteSeason(season);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    const user = auth.currentUser;
    if (!user || !mediaType || !id) return;
    setDeleting(true);
    const targetSeason = pendingDeleteSeason !== undefined ? pendingDeleteSeason : null;
    try {
      let ratings = userRatings || await refreshRatings();
      if (!ratings[mediaType]) {
        ratings[mediaType] = {};
      }

      let removed = false;
      for (const sentiment of Object.keys(ratings[mediaType])) {
        const before = ratings[mediaType][sentiment] || [];
        const after = before.filter((item) => {
          if (String(item.mediaId) !== String(id)) return true;
          if (pendingDeleteSeason !== undefined) {
            // Delete specific season (or whole-show entry if season === null)
            return item.season !== pendingDeleteSeason;
          }
          // Delete movie rating (original behaviour)
          return mediaType === 'tv' && item.season != null;
        });
        if (after.length !== before.length) {
          ratings[mediaType][sentiment] = after;
          removed = true;
        }
      }

      if (removed) {
        const enriched = enrichRatingsWithScoreBasic(ratings);
        setUserRatings(enriched);
        refreshShowRatings(enriched);
        setFinalScore(null);
        setExistingSentiment(null);
        setRatingPhase('initial');

        setDeleting(false);
        setShowDeleteConfirm(false);
        setPendingDeleteSeason(undefined);

        (async () => {
          try {
            await saveRatings(user.uid, enriched);
            await updateDoc(doc(db, 'users', user.uid), { ratingCount: increment(-1) });

            if (mediaType === 'movie') {
              const mediaKey = `movie_${id}`;
              try {
                const updated = await getMediaAverageRating(mediaKey);
                setOverallAverage(updated);
              } catch {
                setOverallAverage(null);
              }
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('Failed to persist delete', e);
            alert('Could not finish removing rating. Refreshing data.');
            try {
              const fresh = await refreshRatings();
              setUserRatings(fresh);
              refreshShowRatings(fresh);
            } catch {
              // ignore secondary read error
            }
          }
        })();
        return;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to delete rating', e);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
      setPendingDeleteSeason(undefined);
    }
  };

  const handleCancelDelete = () => {
    if (deleting) return;
    setShowDeleteConfirm(false);
    setPendingDeleteSeason(undefined);
  };

  const incrementRatingCount = async (uid) => {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, { ratingCount: increment(1) });
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <Image src={publicAssetPath('/images/jumpingin.gif')} alt="Loading" width={300} height={300} unoptimized />
        Hold tight, we&apos;re sniffing around for the right content...
      </div>
    );
  }

  if (!media) return null;

  const posterUrl = getPosterUrl(media.poster_path, 'w500');
  const year = (media.release_date || media.first_air_date || '').split('-')[0];
  const displayType = mediaType === 'movie' ? 'movie' : 'show';

  const runtimeMins = media.runtime || media.episode_run_time?.[0];
  const runtime = runtimeMins ? `${Math.floor(runtimeMins / 60)}h ${runtimeMins % 60}m` : null;

  const director = (media.credits?.crew || []).find((c) => c.job === 'Director')?.name;
  const cast = (media.credits?.cast || []).slice(0, 3).map((c) => c.name).join(', ');

  return (
    <>
    {showListModal && (
      <AddToListModal
        mediaId={id}
        mediaType={mediaType}
        onClose={() => setShowListModal(false)}
      />
    )}
    <div className={styles.mainContent} style={bgGradient ? { background: `${bgGradient}, var(--color-surface-default)` } : {}}>

      <div className={styles.content}>
        <div className={styles.headerContainer}>
          <div className={styles.posterCard}>
            <Image src={posterUrl} alt={currentTitle} className={styles.posterCardImage} width={500} height={750} />
            <button
              className={styles.watchlistIconBtn}
              onClick={() => setShowListModal(true)}
              data-tooltip="Add to list"
            >
              <i className="fas fa-plus"></i>
            </button>
          </div>

          <div className={styles.info}>
            <div className={styles.title}>{currentTitle}</div>
            <div className={styles.metaRow}>
              {year && <span className={styles.metaItem}>{year}</span>}
              {runtime && mediaType !== 'tv' && <><span className={styles.metaDot}>·</span><span className={styles.metaItem}>{runtime}</span></>}
              {(media.genres || []).length > 0 && <span className={styles.metaDot}>·</span>}
              {(media.genres || []).map((g) => (
                <span key={g.id} className={styles.genreBadge}>{g.name}</span>
              ))}
            </div>
            <div className={styles.description}>{media.overview}</div>
            {(director || cast) && (
              <div className={styles.creditsLine}>
                {director && <><span className={styles.creditsLabel}>Dir.</span><span className={styles.creditsValue}>{director}</span></>}
                {director && cast && <span className={styles.metaDot}>·</span>}
                {cast && <><span className={styles.creditsLabel}>Starring</span><span className={styles.creditsValue}>{cast}</span></>}
              </div>
            )}

            <hr className={styles.divider} />

            {/* Rating box */}
            <div className={styles.ratingBox}>
          {mediaType === 'tv' && existingShowRatings.length > 0 && (
            <>
              <div className={styles.ratingDone}>
                <div className={styles.ratingColumn}>
                  <div className="eyebrow">Your avg</div>
                  <div className={styles.ratingColumnScore}>{tvUserOverall}</div>
                  <div className={styles.ratingColumnSentiment}>{existingShowRatings.length} {existingShowRatings.length === 1 ? 'rating' : 'ratings'}</div>
                </div>
                {friendsAvg != null && (
                  <>
                    <div className={styles.ratingColumnDivider} />
                    <div className={styles.ratingColumn}>
                      <div className="eyebrow">Friends</div>
                      <div className={styles.ratingColumnScore}>{friendsAvg}</div>
                      <div className={styles.ratingColumnSentiment}>{scoredFriends.length} {scoredFriends.length === 1 ? 'rating' : 'ratings'}</div>
                    </div>
                  </>
                )}
                {overallAverage && (
                  <>
                    <div className={styles.ratingColumnDivider} />
                    <div className={`${styles.ratingColumn} ${styles.ratingColumnGrow}`}>
                      <div className="eyebrow">Community avg</div>
                      <div className={styles.ratingColumnScore}>{overallAverage.average}</div>
                      <div className={styles.ratingColumnSentiment}>{overallAverage.count} {overallAverage.count === 1 ? 'rating' : 'ratings'}</div>
                    </div>
                  </>
                )}
              </div>
              <div className={styles.breakdownCard}>
              <button className={styles.breakdownCollapsible} onClick={() => setShowBreakdown(v => !v)}>
                <span>Breakdown</span>
                <ChevronDown size={14} className={showBreakdown ? styles.chevronOpen : styles.chevronClosed} />
              </button>
              {showBreakdown && (
                <div className={styles.breakdownTable}>
                  <div className={`${styles.breakdownRow} ${styles.breakdownHeader}`}>
                    <span className={styles.breakdownLabelCell} />
                    <span className="eyebrow" style={{ textAlign: 'right' }}>You</span>
                    <span className="eyebrow" style={{ textAlign: 'right' }}>Friends</span>
                    <span className="eyebrow" style={{ textAlign: 'right' }}>Community</span>
                  </div>
                  {breakdownSeasons.map(season => {
                    const userScore = existingShowRatings.find(r => r.season === season)?.score ?? null;
                    const friendSeasonAvg = getFriendsSeasonAvg(season);
                    const friendsForSeason = getFriendsForSeason(season);
                    const isOpen = openFriendDropdownSeason === season;
                    return (
                      <div key={season ?? 'whole'} className={styles.breakdownRow}>
                        <span className={styles.breakdownLabelCell}>
                          {season != null ? `Season ${season}` : 'Whole show'}
                        </span>
                        <span className={styles.breakdownCell}>
                          {userScore != null ? (
                            <span className={styles.breakdownScoreCell}>
                              <span className={styles.breakdownScore}>{userScore}</span>
                              <button className={styles.iconActionBtn} onClick={() => handleRerankSeason(season)} aria-label="Re-rank" data-tooltip="Re-rank">
                                <Repeat size={12} />
                              </button>
                              <button className={styles.iconActionBtnDanger} onClick={() => handleDeleteSeasonClick(season)} aria-label="Remove rating" data-tooltip="Remove rating">
                                <Trash2 size={12} />
                              </button>
                            </span>
                          ) : <span className={styles.breakdownEmpty}>–</span>}
                        </span>
                        <span className={styles.breakdownCell} style={{ position: 'relative' }}>
                          {friendSeasonAvg != null ? (
                            <>
                              <button
                                className={styles.breakdownFriendsToggle}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={() => setOpenFriendDropdownSeason(isOpen ? undefined : season)}
                              >
                                {friendSeasonAvg}
                                <ChevronDown size={14} className={isOpen ? styles.chevronOpen : styles.chevronClosed} />
                              </button>
                              {isOpen && friendsForSeason.length > 0 && (
                                <div className={styles.friendsBreakdownList} onMouseDown={e => e.stopPropagation()}>
                                  {friendsForSeason.map(friend => (
                                    <div key={friend.uid} className={styles.friendBreakdownRow}>
                                      <div className={styles.friendAvatarCircle}>
                                        {friend.photoURL ? (
                                          <img src={friend.photoURL} alt={friend.displayName || friend.username || '?'} className={styles.friendAvatarImg} />
                                        ) : (
                                          <span className={styles.friendAvatarInitials}>
                                            {(friend.displayName || friend.username || '?')[0].toUpperCase()}
                                          </span>
                                        )}
                                      </div>
                                      <span className={styles.friendBreakdownName}>{friend.displayName || friend.username || 'Unknown'}</span>
                                      <span className={styles.friendBreakdownScore}>{friend.score}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : <span className={styles.breakdownEmpty}>–</span>}
                        </span>
                        <span className={styles.breakdownCell}><span className={styles.breakdownEmpty}>–</span></span>
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            </>
          )}
          {mediaType === 'tv' && existingShowRatings.length > 0 && !showRatingForm && !cancelled && ratingPhase !== 'comparing' && (
            <button className={styles.rateAnotherBtn} onClick={() => setShowRatingForm(true)}>
              <i className="fas fa-plus" aria-hidden="true" />
              Rate another season
            </button>
          )}
          {cancelled ? (
            <p className={styles.resultText}>Ok! Come back when you&apos;ve watched it.</p>
          ) : ratingPhase === 'done' && mediaType !== 'tv' ? (
            <>
              <div className={styles.ratingDone}>
                <div className={styles.ratingColumn}>
                  <div className="eyebrow">Your rating</div>
                  <div className={styles.ratingColumnScore}>{finalScore}</div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <button className={styles.iconActionBtn} onClick={handleRerank} aria-label="Re-rank" data-tooltip="Re-rank">
                      <Repeat size={14} />
                    </button>
                    <button className={styles.iconActionBtnDanger} onClick={handleDeleteRatingClick} aria-label="Remove rating" data-tooltip="Remove rating">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {friendsAvg != null && (
                  <>
                    <div className={styles.ratingColumnDivider} />
                    <div className={styles.ratingColumn} style={{ position: 'relative' }}>
                      <div className="eyebrow">Friends</div>
                      <div className={styles.ratingColumnScore}>{friendsAvg}</div>
                      <button className={styles.friendsCountToggle} onClick={() => setShowBreakdown(v => !v)}>
                        {scoredFriends.length} {scoredFriends.length === 1 ? 'rating' : 'ratings'}
                        <ChevronDown size={12} className={showBreakdown ? styles.chevronOpen : styles.chevronClosed} />
                      </button>
                      {showBreakdown && (
                        <div className={styles.friendsBreakdownList}>
                          {scoredFriends.map(friend => (
                            <div key={friend.uid} className={styles.friendBreakdownRow}>
                              <div className={styles.friendAvatarCircle}>
                                {friend.photoURL ? (
                                  <img src={friend.photoURL} alt={friend.displayName || friend.username || '?'} className={styles.friendAvatarImg} />
                                ) : (
                                  <span className={styles.friendAvatarInitials}>
                                    {(friend.displayName || friend.username || '?')[0].toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <span className={styles.friendBreakdownName}>{friend.displayName || friend.username || 'Unknown'}</span>
                              <span className={styles.friendBreakdownScore}>{friend.primaryScore}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {overallAverage && (
                  <>
                    <div className={styles.ratingColumnDivider} />
                    <div className={`${styles.ratingColumn} ${styles.ratingColumnGrow}`}>
                      <div className="eyebrow">Community avg</div>
                      <div className={styles.ratingColumnScore}>{overallAverage.average}</div>
                      <div className={styles.ratingColumnSentiment}>{overallAverage.count} {overallAverage.count === 1 ? 'rating' : 'ratings'}</div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : ratingPhase === 'comparing' ? (
            <>
              <h3>Which did you like more?</h3>
              <div className={styles.comparisonButtons}>
                <button className={styles.compareBtn} onClick={() => handleComparison(true)} disabled={persistingComparison}>
                  {selectedSeason != null ? `${currentTitle} (Season ${selectedSeason})` : currentTitle}
                </button>
                <button className={styles.compareBtn} onClick={() => handleComparison(false)} disabled={persistingComparison}>
                  {compareTitle}
                </button>
              </div>
              <button className={styles.skipLink} onClick={handleSkip} disabled={persistingComparison}>
                Too tough, skip
              </button>
            </>
          ) : (mediaType === 'tv' && existingShowRatings.length > 0 && !showRatingForm) ? null : (
            <>
              {mediaType === 'tv' ? (
                <div className={styles.seasonDropdownRow}>
                  How would you rate{' '}
                  <span className={styles.seasonDropdownWrapper}>
                    <span className={styles.seasonDropdownSizer}>
                      <select
                        className={styles.seasonDropdown}
                        value={selectedSeason ?? 'whole'}
                        onChange={(e) => handleSeasonSelect(e.target.value === 'whole' ? null : Number(e.target.value))}
                      >
                        <option value="whole">all</option>
                        {(media?.seasons || []).filter(s => s.season_number > 0).map(s => (
                          <option key={s.season_number} value={s.season_number}>Season {s.season_number}</option>
                        ))}
                      </select>
                      <span aria-hidden="true">
                        {selectedSeason != null ? `Season ${selectedSeason}` : 'all'}
                      </span>
                    </span>
                    <i className={`fas fa-chevron-down ${styles.seasonDropdownIcon}`}></i>
                  </span>
                  {' '}of {currentTitle}?
                </div>
              ) : (
                <h3>How would you rate this {displayType}?</h3>
              )}
              <div className={styles.ratingOptions}>
                {[
                  { value: 'not-good', label: 'Not good', emoji: '😒' },
                  { value: 'okay', label: 'Okay', emoji: '😐' },
                  { value: 'good', label: 'Good', emoji: '😊' },
                  { value: 'amazing', label: 'Amazing', emoji: '😍' },
                ].map(({ value, label, emoji }) => (
                  <button
                    key={value}
                    className={selectedSentiment === value ? styles.ratingButtonSelected : styles.ratingButton}
                    onClick={() => setSelectedSentiment(value)}
                  >
                    <span className={styles.ratingLabel}>{label}</span>
                    <span className={styles.ratingEmoji}>{emoji}</span>
                  </button>
                ))}
              </div>
              <textarea
                placeholder="Leave an optional note for your review"
                className={styles.noteInput}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
              <div className={styles.buttonRow}>
                {mediaType === 'tv' && existingShowRatings.length > 0 && (
                  <button className={styles.cancelBtn} onClick={() => setShowRatingForm(false)}>
                    Cancel
                  </button>
                )}
                <button
                  className={styles.nextBtn}
                  onClick={handleNext}
                  disabled={!(mediaType === 'tv' && existingShowRatings.length > 0) && !selectedSentiment}
                >
                  Next
                </button>
              </div>
            </>
          )}
            </div>

          </div>
        </div>
      </div>

      {(mediaType === 'tv' ? existingShowRatings.length > 0 : finalScore !== null) && (
        <div className={styles.discussionWrapper}>
          <DiscussionSection
            mediaKey={`${mediaType}_${id}`}
            mediaTitle={currentTitle}
            userScore={mediaType === 'tv' ? tvUserOverall : finalScore}
          />
        </div>
      )}

      {showDeleteConfirm && (
        <div className={styles.deleteModalBackdrop} onClick={handleCancelDelete}>
          <div
            className={styles.deleteModal}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.deleteModalTitle}>Are you sure?</h3>
            <p className={styles.deleteModalText}>
              This action is permanent.
            </p>
            <div className={styles.deleteModalButtons}>
              <button
                className={styles.deleteCancelBtn}
                onClick={handleCancelDelete}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className={styles.deleteConfirmBtn}
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Removing…' : 'Remove rating'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

export default function DetailsPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--color-text-secondary)' }}>
        Loading...
      </div>
    }>
      <DetailsContent />
    </Suspense>
  );
}
