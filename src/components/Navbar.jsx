'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { publicAssetPath } from '../lib/publicPath';
import styles from './Navbar.module.css';

export default function Navbar() {
  const router = useRouter();
  const { user, initials, photoURL, signOut, loading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const toggleMenu = () => setMenuOpen((prev) => {
    const next = !prev;
    document.body.style.overflow = next ? 'hidden' : '';
    if (!next) setProfileMenuOpen(false);
    return next;
  });

  const closeMenu = () => {
    setMenuOpen(false);
    setProfileMenuOpen(false);
    document.body.style.overflow = '';
  };

  useEffect(() => {
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleLogout = async () => {
    closeMenu();
    await signOut();
    router.push('/login');
  };

  return (
    <nav className={styles.navbar}>
      <div className={styles.navbarContainer}>
        <Link href="/" className={styles.navbarLogo}>
          <img
            src={publicAssetPath('/images/Rabbit.svg')}
            alt="Lore"
            width={40}
            height={40}
            className={styles.logo}
          />
        </Link>

        <div
          className={`${styles.navbarToggle} ${menuOpen ? styles.isActive : ''}`}
          onClick={toggleMenu}
          aria-label="Toggle menu"
        >
          <span className={styles.bar}></span>
          <span className={styles.bar}></span>
          <span className={styles.bar}></span>
        </div>

        <ul className={`${styles.navbarMenu} ${menuOpen ? styles.active : ''}`}>
          <li className={styles.navbarItem}>
            <Link href="/" className={styles.navbarLinks} onClick={closeMenu}>Home</Link>
          </li>
          <li className={styles.navbarItem}>
            <Link href="/explore" className={styles.navbarLinks} onClick={closeMenu}>Search</Link>
          </li>

          {/* Mobile-only auth section */}
          {!loading && (
            user ? (
              <li className={`${styles.navbarItem} ${styles.mobileOnly}`}>
                <button
                  type="button"
                  className={styles.mobileProfileBtn}
                  onClick={() => setProfileMenuOpen((p) => !p)}
                >
                  <span>Profile</span>
                  <ChevronRight
                    size={18}
                    className={profileMenuOpen ? styles.chevronRotated : styles.chevronIcon}
                  />
                </button>
                {profileMenuOpen && (
                  <div className={styles.mobileSubMenu}>
                    <Link href="/profile" className={styles.mobileSubItem} onClick={closeMenu}>Profile</Link>
                    <Link href="/settings" className={styles.mobileSubItem} onClick={closeMenu}>Settings</Link>
                    <button
                      type="button"
                      className={`${styles.mobileSubItem} ${styles.mobileSubItemLogout}`}
                      onClick={handleLogout}
                    >
                      Log out
                    </button>
                  </div>
                )}
              </li>
            ) : (
              <li className={`${styles.navbarItem} ${styles.mobileOnly}`}>
                <Link href="/login" className={styles.navbarLinks} onClick={closeMenu}>Sign in</Link>
              </li>
            )
          )}

          {/* Desktop-only auth section */}
          <div className={`${styles.navRight} ${styles.desktopOnly}`}>
            {loading ? (
              <span className={styles.authPending} aria-hidden />
            ) : user ? (
              <div
                className={styles.userMenuWrapper}
                onMouseEnter={() => setUserMenuOpen(true)}
                onMouseLeave={() => setUserMenuOpen(false)}
              >
                <button
                  type="button"
                  className={styles.profileCircle}
                  aria-haspopup="true"
                  aria-expanded={userMenuOpen}
                  aria-label="User menu"
                  onClick={() => router.push('/profile')}
                >
                  {photoURL
                    ? <Image src={photoURL} alt="Profile" className={styles.profileCircleImg} width={36} height={36} priority />
                    : initials
                  }
                </button>
                {userMenuOpen && (
                  <div className={styles.userDropdown} role="menu">
                    <Link href="/profile" className={styles.userDropdownItem} role="menuitem">
                      Profile
                    </Link>
                    <Link href="/settings" className={styles.userDropdownItem} role="menuitem">
                      Settings
                    </Link>
                    <button
                      type="button"
                      className={`${styles.userDropdownItem} ${styles.userDropdownItemLogout}`}
                      role="menuitem"
                      onClick={handleLogout}
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link href="/login" className={styles.signupNavBtn}>Sign in</Link>
              </>
            )}
          </div>
        </ul>
      </div>
    </nav>
  );
}
