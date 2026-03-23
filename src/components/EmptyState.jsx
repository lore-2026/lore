import Image from 'next/image';
import styles from './EmptyState.module.css';
import { publicAssetPath } from '../lib/publicPath';

/**
 * Generic empty state component.
 *
 * Props:
 *   title           — main heading text
 *   subtitle        — secondary description text
 *   action          — { label, onClick } for the primary CTA (optional)
 *   secondaryAction — { label, onClick } for a secondary text link below the CTA (optional)
 */
export default function EmptyState({ title, subtitle, action, secondaryAction }) {
  return (
    <div className={styles.container}>
      <div className={styles.iconWrap}>
        <Image
          src={publicAssetPath('/images/Rabbitjumping.svg')}
          alt=""
          width={160}
          height={160}
          className={styles.icon}
        />
      </div>
      <div className={styles.text}>
        <h3 className={styles.title}>{title}</h3>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {action && (
        <button className={styles.btn} onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {secondaryAction && (
        <span className={styles.secondaryLink} onClick={secondaryAction.onClick}>
          {secondaryAction.label}
        </span>
      )}
    </div>
  );
}
