import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "site", "data");
const DATA_PATH = path.join(DATA_DIR, "adoption.json");
const API_ROOT = "https://api.github.com";
const PER_PAGE = 100;
const MAX_PAGES = 10;
const SEARCH_QUERY = "repo:torvalds/linux Assisted-by";

function headers() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "linux-ai-watch",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson(url) {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function subjectForMessage(message) {
  return String(message || "").split("\n")[0].trim();
}

function subsystemForSubject(subject) {
  const head = subject.split(":")[0]?.trim();
  if (!head || head === subject) {
    return "misc";
  }
  return head.toLowerCase();
}

function parseAssistedBy(message) {
  const matches = [...String(message || "").matchAll(/^Assisted-by:\s*(.+)$/gim)];
  return matches.map((match) => {
    const raw = match[1].trim();
    const splitAt = raw.indexOf(":");
    const identity = raw;
    const agent = splitAt === -1 ? raw : raw.slice(0, splitAt);
    const model = splitAt === -1 ? "" : raw.slice(splitAt + 1);
    return {
      raw,
      identity,
      agent,
      model,
    };
  });
}

async function fetchAllCommits() {
  const commits = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await githubJson(
      `${API_ROOT}/search/commits?q=${encodeURIComponent(SEARCH_QUERY)}&sort=author-date&order=desc&per_page=${PER_PAGE}&page=${page}`,
    );
    const items = payload.items || [];
    if (!items.length) {
      break;
    }

    for (const item of items) {
      const subject = subjectForMessage(item.commit?.message);
      commits.push({
        sha: item.sha,
        htmlUrl: item.html_url,
        authoredAt: item.commit?.author?.date,
        committedAt: item.commit?.committer?.date,
        authorName: item.commit?.author?.name || item.author?.login || "unknown",
        committerName: item.commit?.committer?.name || item.committer?.login || "unknown",
        subject,
        subsystem: subsystemForSubject(subject),
        assistedBy: parseAssistedBy(item.commit?.message),
      });
    }

    if (items.length < PER_PAGE) {
      break;
    }
  }

  return commits
    .filter((commit) => commit.authoredAt && commit.assistedBy.length)
    .sort((a, b) => new Date(b.authoredAt) - new Date(a.authoredAt));
}

function summarize(commits) {
  const subsystemSet = new Set();
  const authorSet = new Set();
  const agentSet = new Set();

  for (const commit of commits) {
    subsystemSet.add(commit.subsystem);
    authorSet.add(commit.authorName);
    for (const agent of commit.assistedBy) {
      agentSet.add(agent.identity);
    }
  }

  return {
    totalCommits: commits.length,
    totalSubsystems: subsystemSet.size,
    totalAuthors: authorSet.size,
    totalAgents: agentSet.size,
  };
}

async function main() {
  const commits = await fetchAllCommits();
  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      repo: "torvalds/linux",
      query: SEARCH_QUERY,
    },
    stats: summarize(commits),
    commits,
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`wrote ${commits.length} commits to ${DATA_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
