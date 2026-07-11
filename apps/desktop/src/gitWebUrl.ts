export interface ParsedGitWebUrl {
  url: string;
  ref_: string;
  repo_path: string;
}

interface RemoteSyncDraftLike {
  url: string;
  ref_: string;
  repo_path: string;
}

export function parseGitWebUrl(value: string): ParsedGitWebUrl | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (segments.length < 2) {
    return null;
  }

  if (parsed.hostname === "github.com") {
    return parseTwoSegmentProjectUrl(parsed.origin, segments, ["tree", "blob"]);
  }

  if (parsed.hostname === "gitee.com") {
    return parseTwoSegmentProjectUrl(parsed.origin, segments, ["tree", "blob"]);
  }

  const gitLabSeparatorIndex = segments.indexOf("-");
  if (gitLabSeparatorIndex > 0 && gitLabSeparatorIndex + 2 < segments.length) {
    return parseSeparatedProjectUrl(parsed.origin, segments, gitLabSeparatorIndex);
  }

  return null;
}

export function normalizeRemoteSyncDraft<T extends RemoteSyncDraftLike>(draft: T): T {
  const parsed = parseGitWebUrl(draft.url);
  if (!parsed) {
    return draft;
  }

  const shouldReplacePathFields =
    parsed.ref_.length > 0 || parsed.repo_path.length > 0 || isTreeOrBlobUrl(draft.url);

  return {
    ...draft,
    url: parsed.url,
    ref_: shouldReplacePathFields ? parsed.ref_ : draft.ref_,
    repo_path: shouldReplacePathFields ? parsed.repo_path : draft.repo_path,
  };
}

function parseTwoSegmentProjectUrl(
  origin: string,
  segments: string[],
  pathMarkers: string[],
): ParsedGitWebUrl | null {
  const [owner, repoSegment] = segments;
  const repo = stripGitSuffix(repoSegment);
  if (!owner || !repo) {
    return null;
  }

  const markerIndex = pathMarkers.includes(segments[2] ?? "") ? 2 : -1;
  const base = {
    url: `${origin}/${owner}/${repo}.git`,
    ref_: "",
    repo_path: "",
  };
  if (markerIndex === -1) {
    return base;
  }

  return withRefAndPath(base, segments[markerIndex + 1] ?? "", segments.slice(markerIndex + 2));
}

function parseSeparatedProjectUrl(
  origin: string,
  segments: string[],
  separatorIndex: number,
): ParsedGitWebUrl | null {
  const projectSegments = segments.slice(0, separatorIndex);
  const marker = segments[separatorIndex + 1] ?? "";
  if (!["tree", "blob"].includes(marker) || projectSegments.length === 0) {
    return null;
  }

  const repoSegments = [...projectSegments];
  repoSegments[repoSegments.length - 1] = stripGitSuffix(repoSegments[repoSegments.length - 1]);
  const base = {
    url: `${origin}/${repoSegments.join("/")}.git`,
    ref_: "",
    repo_path: "",
  };
  return withRefAndPath(base, segments[separatorIndex + 2] ?? "", segments.slice(separatorIndex + 3));
}

function withRefAndPath(
  base: ParsedGitWebUrl,
  ref_: string,
  rawPathSegments: string[],
): ParsedGitWebUrl {
  const pathSegments = normalizeRepoPathSegments(rawPathSegments);
  return {
    ...base,
    ref_,
    repo_path: pathSegments.join("/"),
  };
}

function normalizeRepoPathSegments(segments: string[]) {
  if (segments[segments.length - 1]?.toLowerCase() === "skill.md") {
    return segments.slice(0, -1);
  }
  return segments;
}

function stripGitSuffix(value: string) {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function isTreeOrBlobUrl(value: string) {
  return /\/(?:-\/)?(?:tree|blob)\//.test(value);
}
