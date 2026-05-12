export type ApiConfig = {
  host: string;
  port: number;
  databaseUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start the operations API");
  }

  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number.parseInt(env.PORT ?? "3001", 10),
    databaseUrl
  };
}
