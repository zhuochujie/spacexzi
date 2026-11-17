export const WEEK_SECONDS = 604800;
export function shanghaiWeekStart(timestamp = Math.floor(Date.now() / 1000)) {
  return (
    Math.floor((timestamp + 288000) / WEEK_SECONDS) * WEEK_SECONDS - 288000
  );
}
