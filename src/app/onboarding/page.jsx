'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { FolderOpen, ExternalLink, Smile, User } from 'lucide-react';
import { doc, getDoc, deleteDoc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
import { buildPublicFirebaseDownloadUrl, stripFirebaseStorageUrlToken } from '../../lib/firebaseStorageUrl';
import { createAvatarVariantBlobs } from '../../lib/imageUtils';
import { useAuth } from '../../contexts/AuthContext';
import { useImportStatus } from '../../contexts/ImportStatusContext';
import { parseRatingsCsv, importLetterboxdRatings } from '../../lib/letterboxdImport';
import Toast from '../../components/Toast';
import styles from '../login/page.module.css';
import onboardStyles from './page.module.css';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const TOTAL_STEPS = 3;

const STEP_LABELS = ['Profile Creation', 'Your name', 'Import Ratings'];

function Stepper({ current, onStepClick }) {
  return (
    <div className={onboardStyles.stepper}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div key={i} className={`${onboardStyles.stepWrapper} ${i + 1 !== current ? onboardStyles.stepWrapperHoverable : ''}`}>
          <button
            type="button"
            className={i + 1 <= current ? onboardStyles.stepActive : onboardStyles.stepInactive}
            onClick={() => onStepClick(i + 1)}
          />
          <span className={onboardStyles.stepTooltip}>
            {i + 1 < current ? `Back to ${STEP_LABELS[i]}` : STEP_LABELS[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [savedUsername, setSavedUsername] = useState('');
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [nameSaved, setNameSaved] = useState(false);
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [importFolder, setImportFolder] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const folderInputRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState(null);
  const [importFiles, setImportFiles] = useState(null);
  const {
    startLetterboxdImport,
    updateLetterboxdImport,
    finishLetterboxdImport,
    failLetterboxdImport,
  } = useImportStatus();

  const avatarInputRef = useRef(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    setError('');
  }, [step]);

  /** Restore step from Firestore; prefill name from Google displayName when DB has no name yet. */
  useEffect(() => {
    if (!user || loading) return;
    if (!db) {
      setProfileHydrated(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (cancelled) return;
      if (!snap.exists()) {
        if (user.displayName) {
          const parts = user.displayName.trim().split(/\s+/);
          setFirstname(parts[0] || '');
          setLastname(parts.slice(1).join(' ') || '');
        }
        setProfileHydrated(true);
        return;
      }
      const d = snap.data();
      if (!d.username) {
        if (user.displayName) {
          const parts = user.displayName.trim().split(/\s+/);
          setFirstname(parts[0] || '');
          setLastname(parts.slice(1).join(' ') || '');
        }
        setProfileHydrated(true);
        return;
      }
      setSavedUsername(d.username);
      setUsername(d.username);
      const fn = (d.firstname || '').trim();
      const ln = (d.lastname || '').trim();
      if (fn || ln) {
        setFirstname(d.firstname || '');
        setLastname(d.lastname || '');
        setNameSaved(true);
        setStep(3);
      } else {
        setStep(2);
        if (user.displayName) {
          const parts = user.displayName.trim().split(/\s+/);
          setFirstname(parts[0] || '');
          setLastname(parts.slice(1).join(' ') || '');
        }
      }
      setProfileHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, db]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = username.trim().toLowerCase();

    if (!USERNAME_RE.test(trimmed)) {
      setError('Please use 3–20 characters, letters, numbers, and underscores only.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const usernameRef = doc(db, 'usernames', trimmed);
      const usernameSnap = await getDoc(usernameRef);

      if (usernameSnap.exists() && trimmed !== savedUsername) {
        setError('That username is already taken.');
        setSaving(false);
        return;
      }

      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const previousUsername = (userSnap.exists() ? (userSnap.data()?.username || '') : '').trim().toLowerCase();

      /** Tokenless Storage URLs, or stripped Auth/Google URL when no upload happened. */
      let photoURLToSave = user.photoURL ? stripFirebaseStorageUrlToken(user.photoURL) : null;
      let photoURLSearchToSave = null;
      let photoURLThumbToSave = null;

      if (avatarFile) {
        if (!storage) {
          setError('Storage is not configured. Check NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.');
          setSaving(false);
          return;
        }
        const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
        if (!bucket) {
          setError('Storage bucket is not configured.');
          setSaving(false);
          return;
        }
        const { full, search, thumb } = await createAvatarVariantBlobs(avatarFile);
        const fullPath = `avatars/${user.uid}/full`;
        const searchPath = `avatars/${user.uid}/search`;
        const thumbPath = `avatars/${user.uid}/thumb`;
        await Promise.all([
          uploadBytes(ref(storage, fullPath), full),
          uploadBytes(ref(storage, searchPath), search),
          uploadBytes(ref(storage, thumbPath), thumb),
        ]);
        const version = Date.now();
        photoURLToSave = buildPublicFirebaseDownloadUrl(bucket, fullPath, version);
        photoURLSearchToSave = buildPublicFirebaseDownloadUrl(bucket, searchPath, version);
        photoURLThumbToSave = buildPublicFirebaseDownloadUrl(bucket, thumbPath, version);
      }

      if (savedUsername && savedUsername !== trimmed) {
        await deleteDoc(doc(db, 'usernames', savedUsername));
      }

      const batch = writeBatch(db);
      batch.set(usernameRef, { uid: user.uid });
      if (previousUsername && previousUsername !== trimmed) {
        batch.delete(doc(db, 'usernames', previousUsername));
      }

      if (userSnap.exists()) {
        const patch = { username: trimmed };
        if (avatarFile) {
          patch.photoURL = photoURLToSave;
          patch.photoURLThumb = photoURLThumbToSave;
          patch.photoURLSearch = photoURLSearchToSave;
        }
        batch.set(userRef, patch, { merge: true });
      } else {
        batch.set(userRef, {
          email: user.email || null,
          photoURL: photoURLToSave,
          photoURLSearch: photoURLSearchToSave,
          photoURLThumb: photoURLThumbToSave,
          username: trimmed,
          isDeveloper: false,
          createdAt: serverTimestamp(),
          lists: { watchlist: [] },
        });
      }

      await batch.commit();

      setSavedUsername(trimmed);
      setStep(2);
    } catch (err) {
      console.error('Onboarding error:', err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleNameSubmit = async (e) => {
    e.preventDefault();
    const fn = firstname.trim();
    const ln = lastname.trim();
    if (!fn) {
      setError('Please enter your first name.');
      return;
    }
    setSavingName(true);
    setError('');
    try {
      const fullNameLower = `${fn} ${ln}`.trim().toLowerCase();
      await updateDoc(doc(db, 'users', user.uid), {
        firstname: fn,
        lastname: ln,
        fullNameLower: fullNameLower || null,
      });
      setNameSaved(true);
      setStep(3);
    } catch (err) {
      console.error('Onboarding name error:', err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSavingName(false);
    }
  };

  const runImport = async (files) => {
    if (!user || !files?.length) return;
    setImporting(true);
    try {
      const ratingsFile = Array.from(files).find(
        (f) => f.name === 'ratings.csv' || f.webkitRelativePath?.endsWith('/ratings.csv')
      );
      if (!ratingsFile) {
        setToast({ type: 'error', message: 'ratings.csv not found in the selected folder.' });
        return;
      }
      const csvText = await ratingsFile.text();
      const rows = parseRatingsCsv(csvText);
      if (rows.length === 0) {
        failLetterboxdImport('No valid rows found in ratings.csv.');
        setToast({ type: 'error', message: 'No valid rows found in ratings.csv.' });
        return;
      }
      startLetterboxdImport({ total: rows.length });
      const result = await importLetterboxdRatings(user.uid, rows, {
        onProgress: (p) => {
          updateLetterboxdImport({
            processed: p.processed,
            successful: p.successful,
            skipped: p.skipped,
            failed: p.failed,
            total: p.total,
            lastTitle: p.lastTitle || '',
          });
        },
      });
      finishLetterboxdImport({
        successful: result.successful,
        skipped: result.skipped,
        failed: result.failed,
      });
      await updateDoc(doc(db, 'users', user.uid), {
        lastImport: {
          importedAt: serverTimestamp(),
          successful: result.successful,
          skipped: result.skipped,
          failed: result.failed,
          details: result.details,
        },
      });
    } catch (err) {
      failLetterboxdImport(err?.message || 'Import failed.');
      setToast({ type: 'error', message: err?.message || 'Import failed.' });
    } finally {
      setImporting(false);
    }
  };

  if (loading || !user) return null;

  if (!profileHydrated) {
    return (
      <div className={onboardStyles.page}>
        <p className={onboardStyles.subheading}>Loading…</p>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className={onboardStyles.page}>
        <Stepper
          current={3}
          onStepClick={async (s) => {
            if (s === 1) {
              if (savedUsername) await deleteDoc(doc(db, 'usernames', savedUsername));
              setSavedUsername('');
              setStep(1);
            }
            if (s === 2) setStep(2);
          }}
        />
        <div className={onboardStyles.appIcon}>
          <Image src="/images/Letterboxd.svg" alt="Letterboxd" width={30} height={30} />
        </div>
        <div className={onboardStyles.header}>
          <h1 className={onboardStyles.heading}>Keep your film journey in one place</h1>
          <p className={onboardStyles.subheading}>Already a Letterboxd user? Import your ratings here.</p>
        </div>
        <div className={`${onboardStyles.form} ${onboardStyles.formWide}`}>
          <a
            className={onboardStyles.importStep}
            href="https://letterboxd.com/settings/data/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className={onboardStyles.importStepNum}>1</span>
            <div className={onboardStyles.importStepText}>
              <span className={onboardStyles.importStepTitle}>Export your Letterboxd data</span>
              <span className={onboardStyles.importStepSub}>Open letterboxd.com/settings/data</span>
            </div>
            <ExternalLink size={16} className={onboardStyles.importStepIcon} />
          </a>
          <div className={onboardStyles.importStep}>
            <span className={onboardStyles.importStepNum}>2</span>
            <div className={onboardStyles.importStepText}>
              <span className={onboardStyles.importStepTitle}>Unzip and upload</span>
            </div>
          </div>
          <div
            className={`${onboardStyles.dropzone} ${dragOver ? onboardStyles.dropzoneOver : ''} ${importFolder ? onboardStyles.dropzoneFilled : ''}`}
            onClick={() => folderInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const files = e.dataTransfer.files;
              if (files?.[0]) {
                setImportFolder(files[0].name);
                setImportFiles(files);
              }
            }}
          >
            <input
              ref={folderInputRef}
              type="file"
              webkitdirectory="true"
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) {
                  const folder = files[0].webkitRelativePath.split('/')[0];
                  setImportFolder(folder || files[0].name);
                  setImportFiles(files);
                }
              }}
            />
            <FolderOpen size={24} className={onboardStyles.dropzoneIcon} />
            <span className={onboardStyles.dropzoneLabel}>Drop your Letterboxd export folder</span>
            <span className={onboardStyles.dropzoneHint}>or click to browse</span>
          </div>
          <button
            className={onboardStyles.continueBtn}
            disabled={!importFiles || importing}
            onClick={async () => {
              await runImport(importFiles);
              router.push('/explore');
            }}
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
          <span className={onboardStyles.skipLink} onClick={() => router.push('/explore')}>
            Or, start fresh in Lore
          </span>
        </div>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            action={toast.action}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className={onboardStyles.page}>
        <Stepper
          current={2}
          onStepClick={async (s) => {
            if (s === 1) {
              if (savedUsername) await deleteDoc(doc(db, 'usernames', savedUsername));
              setSavedUsername('');
              setStep(1);
            }
            if (s === 3) {
              if (nameSaved) setStep(3);
              else document.getElementById('onboarding-name-form')?.requestSubmit();
            }
          }}
        />
        <div className={onboardStyles.appIcon}>
          <User size={28} strokeWidth={2} />
        </div>
        <div className={onboardStyles.header}>
          <h1 className={onboardStyles.heading}>Name</h1>
          <p className={onboardStyles.subheading}>
            This is how you&apos;ll show up to friends. You can change it later in settings.
          </p>
        </div>
        <form id="onboarding-name-form" className={onboardStyles.form} onSubmit={handleNameSubmit}>
          {error && <p className={styles.error}>{error}</p>}
          <div className={onboardStyles.inputWrapper}>
            <input
              className={onboardStyles.inputName}
              type="text"
              name="firstname"
              autoComplete="given-name"
              placeholder="First name"
              value={firstname}
              onChange={(e) => setFirstname(e.target.value)}
              disabled={savingName}
            />
          </div>
          <div className={onboardStyles.inputWrapper}>
            <input
              className={onboardStyles.inputName}
              type="text"
              name="lastname"
              autoComplete="family-name"
              placeholder="Last name"
              value={lastname}
              onChange={(e) => setLastname(e.target.value)}
              disabled={savingName}
            />
          </div>
          <button className={onboardStyles.continueBtn} type="submit" disabled={savingName || !firstname.trim()}>
            {savingName ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={onboardStyles.page}>
      <Stepper
        current={1}
        onStepClick={(s) => {
          if (s === 2) {
            if (savedUsername) setStep(2);
            else if (username.trim()) document.getElementById('onboarding-form')?.requestSubmit();
          }
          if (s === 3) {
            if (savedUsername && nameSaved) setStep(3);
            else if (savedUsername) setStep(2);
          }
        }}
      />
      <div className={onboardStyles.appIcon}>
        <Smile size={32} strokeWidth={2} />
      </div>
      <div className={onboardStyles.header}>
        <h1 className={onboardStyles.heading}>Hey{firstname.trim() ? `, ${firstname.trim()}` : ''}!</h1>
        <p className={onboardStyles.subheading}>Let&apos;s start by creating your profile. You can edit this at any time in your profile page.</p>
      </div>
      <form id="onboarding-form" className={onboardStyles.form} onSubmit={handleSubmit}>
        {error && <p className={styles.error}>{error}</p>}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setAvatarFile(file);
              setAvatarPreview(URL.createObjectURL(file));
            }
          }}
        />
        <button type="button" className={onboardStyles.avatarBtn} onClick={() => avatarInputRef.current?.click()}>
          {avatarPreview && (
            <img src={avatarPreview} alt="" className={onboardStyles.avatarImg} />
          )}
          <span className={onboardStyles.avatarOverlay}>
            <i className="fas fa-camera" aria-hidden="true" />
          </span>
        </button>
        <div className={onboardStyles.inputWrapper}>
          <span className={onboardStyles.inputAt}>@</span>
          <input
            className={onboardStyles.input}
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button className={onboardStyles.continueBtn} type="submit" disabled={saving || !username.trim()}>
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
