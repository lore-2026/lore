'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initials, setInitials] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  /** Resized avatar for small UI (navbar, profile); falls back to photoURL when unset. */
  const [photoURLThumb, setPhotoURLThumb] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);

        try {
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userRef);

          if (userSnap.exists()) {
            const data = userSnap.data();
            const first = data.firstname || '';
            const last = data.lastname || '';
            setInitials((first.charAt(0) + last.charAt(0)).toUpperCase());
            setPhotoURL(data.photoURL || '');
            setPhotoURLThumb(data.photoURLThumb || '');
          } else {
            const parts = firebaseUser.email
              .split(/[@.\s_]/)
              .filter(Boolean)
              .slice(0, 2)
              .map((p) => p.charAt(0).toUpperCase());
            setInitials(parts.join(''));
            setPhotoURL('');
            setPhotoURLThumb('');
          }
        } catch {
          setInitials('');
          setPhotoURL('');
          setPhotoURLThumb('');
        }
      } else {
        setUser(null);
        setInitials('');
        setPhotoURL('');
        setPhotoURLThumb('');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    if (auth) await firebaseSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, initials, photoURL, photoURLThumb, setPhotoURL, setPhotoURLThumb, loading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
