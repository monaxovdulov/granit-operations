# Backup Restore Rollback

Status: later slice

Backup, restore, and rollback are not implemented in S01, but production launch cannot happen without evidence.

Future coverage:

- operations Postgres backup and restore;
- Payload content/media backup coordination with `granit-site-cms`;
- environment/config inventory;
- deploy version and immutable commit SHA;
- public intake contract version;
- rollback path that does not overwrite leads created after deploy;
- manual intake fallback if automated intake fails.

S13 will harden backup/restore/rollback. Production deploy must not happen from this scaffold.
