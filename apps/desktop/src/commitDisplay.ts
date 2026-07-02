export const DISPLAY_COMMIT_LENGTH = 8;

export function shortCommit(commit: string) {
  return commit.length > DISPLAY_COMMIT_LENGTH
    ? commit.slice(0, DISPLAY_COMMIT_LENGTH)
    : commit;
}
