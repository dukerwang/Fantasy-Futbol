import CreateLeagueForm from './CreateLeagueForm';
import styles from './create.module.css';

export default function CreateLeaguePage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Create a League</h1>
        <p className={styles.subtitle}>Set up your dynasty fantasy football league</p>
      </header>
      <div className={styles.formWrapper}>
        <CreateLeagueForm />
      </div>
    </div>
  );
}
