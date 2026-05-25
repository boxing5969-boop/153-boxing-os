/**
 * 환경 변수 로드 + zod 검증
 * - production: process.env 에서 직접 (Secret Manager 가 주입)
 * - development: .env 파일에서 dotenv 로 로드
 */
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "production") {
  loadDotenv();
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_JWT_SECRET: z.string().min(20).optional(),

  // Aligo
  ALIGO_USER_ID: z.string().optional().default(""),
  ALIGO_API_KEY: z.string().optional().default(""),
  ALIGO_SENDER_DEFAULT: z.string().optional(),

  // Payssam
  PAYSSAM_API_KEY: z.string().optional().default(""),
  PAYSSAM_API_BASE_URL: z.string().url().optional().default("https://api.payssam.example.com"),
  PAYSSAM_WEBHOOK_SECRET: z.string().optional(),

  // Internal auth
  INTERNAL_TASK_SECRET: z.string().min(16).optional(),

  // Toggles
  MOCK_PROVIDERS: z.coerce.boolean().default(false),
  CLOUD_TASKS_QUEUE: z.string().optional(),

  // Misc
  WEBHOOK_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

/**
 * 운영 부팅 시 1회 검증. test 환경에서는 호출 시점마다 process.env 재읽기.
 */
export function loadConfig(): AppConfig {
  if (cached && process.env.NODE_ENV !== "test") return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}
