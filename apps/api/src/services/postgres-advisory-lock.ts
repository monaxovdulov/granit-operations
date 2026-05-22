import type postgres from "postgres";

export type PostgresAdvisoryLockKey = readonly [number, number];

export type PostgresAdvisoryLockHandle = {
  acquired: boolean;
  release(): Promise<void>;
};

export async function tryAcquirePostgresAdvisoryLock(
  client: postgres.Sql,
  key: PostgresAdvisoryLockKey
): Promise<PostgresAdvisoryLockHandle> {
  const reserved = await client.reserve();
  let released = false;

  try {
    const rows = await reserved<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(${key[0]}, ${key[1]}) AS acquired
    `;
    const acquired = rows[0]?.acquired === true;

    if (!acquired) {
      reserved.release();
      released = true;

      return {
        acquired: false,
        release: async () => undefined
      };
    }

    return {
      acquired: true,
      release: async () => {
        if (released) {
          return;
        }

        released = true;

        try {
          await reserved`
            SELECT pg_advisory_unlock(${key[0]}, ${key[1]})
          `;
        } finally {
          reserved.release();
        }
      }
    };
  } catch (error) {
    if (!released) {
      reserved.release();
    }

    throw error;
  }
}
