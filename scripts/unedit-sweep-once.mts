// Test helper for scripts/verify-unedit-plan.mjs: run the studio cron's due-post sweep once (preview database only).
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const { sweepDuePosts } = await import('../lib/unedit.ts');
console.log(`swept ${await sweepDuePosts()}`);
