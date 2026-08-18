export interface CrestConfig {
  /** Persisted as-is in teams.crest_config JSONB — renaming this key requires a data migration, not just a code change. */
  shape: string;
  division: string;
  primaryColor: string;
  secondaryColor: string;
  borderColor: string;
  tertiaryColor?: string;
  icon: string | null;
  iconColor: string;
  showText: boolean;
  textColor: string;
}
